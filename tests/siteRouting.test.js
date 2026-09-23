// Exercises middleware/siteRouting.ts directly, wired the same way index.ts
// wires it, against a temp fixture "build" dir (real client/public files
// copied in, plus a throwaway index.html) so this needs neither a database
// nor a `client/build` produced by `vite build`.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const db = require('../scripts/testDb');

const REPO_ROOT = path.join(__dirname, '..');

function buildFixtureDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'peak-site-'));
  for (const name of ['robots.txt', 'sitemap.xml', 'llms.txt', 'og-image.png']) {
    fs.copyFileSync(path.join(REPO_ROOT, 'client', 'public', name), path.join(dir, name));
  }
  fs.writeFileSync(
    path.join(dir, 'index.html'),
    '<!DOCTYPE html><html><head><title>Peak</title></head><body>fixture</body></html>'
  );
  return dir;
}

async function startSiteApp() {
  const express = require('express');
  const { redirectWwwToApex, mountSiteRouting } = db.requireTs('middleware/siteRouting.ts');
  const buildDir = buildFixtureDir();

  const app = express();
  app.use(redirectWwwToApex);
  app.use(express.static(buildDir));
  mountSiteRouting(app, buildDir);

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  return { server, port, buildDir };
}

// Raw http.request instead of fetch: fetch silently drops a caller-supplied
// Host header (it's a forbidden header per the Fetch spec), which is exactly
// the header this redirect is keyed on.
function requestWithHost(port, hostHeader, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: urlPath, headers: { Host: hostHeader } },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

test('site routing (www redirect, SPA routes, crawl files, real 404s)', async (t) => {
  const { server, port, buildDir } = await startSiteApp();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(buildDir, { recursive: true, force: true });
  });

  await t.test('redirects www host to https://peakhq.me, preserving path and query', async () => {
    const res = await requestWithHost(port, 'www.peakhq.me', '/sign-in?next=%2Fworkout-log');
    assert.equal(res.status, 301);
    assert.equal(res.headers.location, 'https://peakhq.me/sign-in?next=%2Fworkout-log');
  });

  await t.test('does not redirect peakhq.me, localhost, or the herokuapp host', async () => {
    for (const host of ['peakhq.me', 'localhost', 'peak-pr-tracker.herokuapp.com']) {
      const res = await requestWithHost(port, host, '/');
      assert.notEqual(res.status, 301, `expected no redirect for Host: ${host}`);
    }
  });

  for (const route of ['/', '/workout-log', '/sign-in', '/sign-up']) {
    await t.test(`serves the SPA for ${route}`, async () => {
      const res = await fetch(`http://127.0.0.1:${port}${route}`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /html/);
    });
  }

  await t.test('serves /?tab= query params as the SPA route', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/?tab=nutrition`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /html/);
  });

  const crawlFiles = [
    ['/robots.txt', /text\/plain/],
    ['/sitemap.xml', /xml/],
    ['/llms.txt', /text\/plain/],
    ['/og-image.png', /image\/png/],
  ];
  for (const [route, contentTypePattern] of crawlFiles) {
    await t.test(`serves ${route} with a sensible content type`, async () => {
      const res = await fetch(`http://127.0.0.1:${port}${route}`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), contentTypePattern);
    });
  }

  await t.test('returns a real 404 for an unknown non-API path', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/definitely-not-a-page`);
    assert.equal(res.status, 404);
    assert.match(res.headers.get('content-type'), /html/);
  });

  await t.test('leaves unknown /api/* GET behavior unchanged (soft 200 index.html)', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/definitely-not-a-route`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /html/);
    const body = await res.text();
    assert.match(body, /Peak/);
  });
});
