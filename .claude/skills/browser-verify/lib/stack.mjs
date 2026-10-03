// Boots the real dev stack (MySQL via docker compose, the Express server,
// vite) for a standalone verification script, and tears it down again.
// See ../SKILL.md ("What startStack does") for the narrative version of
// this; keep this file as the source of truth and that doc as the summary.

import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DB_HOST = '127.0.0.1';
const DB_PORT = 3307;
const DB_ENV = {
  DB_HOST,
  DB_PORT: String(DB_PORT),
  DB_USERNAME: 'dev',
  DB_PASSWORD: 'dev',
  DB_NAME: 'workout_log',
};

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', ...opts });
}

// Resolves the checkout this process is actually running from (could be a
// worktree) and separately the MAIN checkout, since a worktree has no .env
// of its own but the main checkout's secrets (OPENAI_API_KEY etc.) are
// still useful for a server booted from the worktree's code.
function resolveCheckouts(cwd) {
  const top = run('git', ['rev-parse', '--show-toplevel'], { cwd });
  if (top.status !== 0) throw new Error(`git rev-parse --show-toplevel failed: ${top.stderr}`);
  const checkoutRoot = top.stdout.trim();

  const common = run('git', ['rev-parse', '--git-common-dir'], { cwd: checkoutRoot });
  if (common.status !== 0) throw new Error(`git rev-parse --git-common-dir failed: ${common.stderr}`);
  const gitDir = path.resolve(checkoutRoot, common.stdout.trim());
  const mainCheckout = path.dirname(gitDir);

  return { checkoutRoot, mainCheckout };
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
  });
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function pickPorts(hintA, hintB) {
  if ((await isPortFree(hintA)) && (await isPortFree(hintB))) return [hintA, hintB];
  const a = await findFreePort();
  let b = await findFreePort();
  while (b === a) b = await findFreePort();
  return [a, b];
}

function isTcpOpen(host, port, timeout = 500) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host, port });
    const to = setTimeout(() => { sock.destroy(); resolve(false); }, timeout);
    sock.once('connect', () => { clearTimeout(to); sock.end(); resolve(true); });
    sock.once('error', () => { clearTimeout(to); resolve(false); });
  });
}

async function waitUntil(fn, { timeout, interval = 500, label }) {
  const start = Date.now();
  let lastErr;
  while (Date.now() - start < timeout) {
    try {
      if (await fn()) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`Timed out waiting for ${label}${lastErr ? `: ${lastErr.message}` : ''}`);
}

function tail(filePath, lines = 40) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    return text.split('\n').slice(-lines).join('\n');
  } catch {
    return '(no log)';
  }
}

// Finds which docker container currently holds host port 3307, so a caller
// reusing someone else's database knows whose it is before touching it.
function describeDbOwner() {
  const ps = run('docker', ['ps', '--format', '{{.Names}}\t{{.Ports}}']);
  const line = (ps.stdout || '').split('\n').find((l) => l.includes('3307->'));
  return line ? line.split('\t')[0] : 'unknown container';
}

async function ensureDb(checkoutRoot) {
  const alreadyUp = await isTcpOpen(DB_HOST, DB_PORT, 500);
  let startedContainer = false;

  if (alreadyUp) {
    console.error(`[stack] reusing MySQL already on ${DB_HOST}:${DB_PORT} (container: ${describeDbOwner()})`);
  } else {
    console.error('[stack] starting docker compose db...');
    const up = run('docker', ['compose', 'up', '-d'], { cwd: checkoutRoot });
    if (up.status !== 0) throw new Error(`docker compose up -d failed:\n${up.stderr}`);
    startedContainer = true;
    await waitUntil(() => isTcpOpen(DB_HOST, DB_PORT, 500), {
      timeout: 60000,
      interval: 1000,
      label: `MySQL on ${DB_HOST}:${DB_PORT}`,
    });
  }

  console.error('[stack] npm run db:setup...');
  const setup = run('npm', ['run', 'db:setup'], {
    cwd: checkoutRoot,
    env: { ...process.env, ...DB_ENV },
  });
  if (setup.status !== 0) {
    throw new Error(`npm run db:setup failed:\n${setup.stdout}\n${setup.stderr}`);
  }

  return { startedContainer };
}

// Parses a .env file the way the server's own `dotenv.config()` would,
// preferring the repo's own dotenv dependency (so quoting/escaping rules
// stay identical to what the server sees) and falling back to a small
// hand-rolled parser if that package isn't installed yet.
async function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath);
  try {
    const dotenv = await import('dotenv');
    return dotenv.parse(raw);
  } catch {
    const out = {};
    for (const rawLine of raw.toString('utf8').split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      out[key] = val;
    }
    return out;
  }
}

async function buildServerEnv({ mainCheckout, serverPort, clientPort, opts }) {
  const mainEnv = await parseEnvFile(path.join(mainCheckout, '.env'));
  const env = {
    ...process.env,
    ...mainEnv,
    ...DB_ENV,
    PORT: String(serverPort),
    FRONTEND_URL: `http://localhost:${clientPort}`,
  };
  env.ACCESS_TOKEN_SECRET = env.ACCESS_TOKEN_SECRET || 'x';
  env.REFRESH_TOKEN_SECRET = env.REFRESH_TOKEN_SECRET || 'x';
  Object.assign(env, opts.env ?? {});
  for (const key of opts.unsetEnv ?? []) delete env[key];
  return env;
}

function ensureDeps(dir, label) {
  if (fs.existsSync(path.join(dir, 'node_modules'))) return;
  console.error(`[stack] installing ${label} deps (npm ci)...`);
  const res = run('npm', ['ci'], { cwd: dir });
  if (res.status !== 0) throw new Error(`npm ci failed in ${dir}:\n${res.stdout}\n${res.stderr}`);
}

function buildServer(checkoutRoot, env) {
  console.error('[stack] npm run build...');
  const res = run('npm', ['run', 'build'], { cwd: checkoutRoot, env });
  if (res.status !== 0) throw new Error(`npm run build failed:\n${res.stdout}\n${res.stderr}`);
}

// Writes client/.env.local for this run. Refuses to clobber one that
// already points somewhere else (another process's stack) unless
// opts.force, and reports whether IT created the file so stop() only
// removes what it made.
function writeClientEnvLocal(clientDir, apiBaseNoSlash, opts) {
  const envLocalPath = path.join(clientDir, '.env.local');
  const desired = `VITE_API_URL=${apiBaseNoSlash}\n`;

  if (fs.existsSync(envLocalPath)) {
    const existing = fs.readFileSync(envLocalPath, 'utf8');
    const match = existing.match(/^VITE_API_URL=(.*)$/m);
    const existingUrl = match ? match[1].trim() : null;
    if (existingUrl === apiBaseNoSlash) return { path: envLocalPath, created: false };
    if (!opts.force) {
      throw new Error(
        `client/.env.local already points at ${existingUrl ?? '(unparseable)'}; refusing to overwrite with ` +
        `${apiBaseNoSlash}. Pass { force: true } in stackOptions to override.`,
      );
    }
    fs.writeFileSync(envLocalPath, desired);
    return { path: envLocalPath, created: false };
  }

  fs.writeFileSync(envLocalPath, desired);
  return { path: envLocalPath, created: true };
}

function spawnLogged(cmd, args, { cwd, env }, logPath) {
  const fd = fs.openSync(logPath, 'a');
  const child = spawn(cmd, args, { cwd, env, detached: true, stdio: ['ignore', fd, fd] });
  fs.closeSync(fd); // Node dup'd it into the child; our copy is no longer needed.
  child.unref();
  return child;
}

async function waitForServer(apiBaseNoSlash, serverLogPath, child) {
  await waitUntil(async () => {
    if (child.exitCode !== null) {
      throw new Error(`server process exited early (code ${child.exitCode})`);
    }
    try {
      const res = await fetch(apiBaseNoSlash);
      return res.ok;
    } catch {
      return false;
    }
  }, { timeout: 30000, interval: 500, label: `server health at ${apiBaseNoSlash}` });

  // A status code alone isn't proof: on macOS, port 5000 is AirPlay
  // Receiver and answers HTTP with a plausible status while the real
  // server died of EADDRINUSE in the background. Only the server's own
  // log line proves OUR process bound the port.
  if (!fs.readFileSync(serverLogPath, 'utf8').includes('Server running on port')) {
    throw new Error(`server log never printed "Server running on port":\n${tail(serverLogPath)}`);
  }
}

async function waitForVite(appBase, viteLogPath, child) {
  // First request against a cold vite dev process compiles SCSS on demand
  // and can take several seconds beyond normal fetch+render; give it real
  // headroom rather than the server's tighter budget.
  await waitUntil(async () => {
    if (child.exitCode !== null) {
      throw new Error(`vite process exited early (code ${child.exitCode})`);
    }
    try {
      const res = await fetch(appBase);
      return res.status > 0;
    } catch {
      return false;
    }
  }, { timeout: 45000, interval: 500, label: `vite at ${appBase}` });
  void viteLogPath;
}

/**
 * Boots MySQL (docker compose) + the Express server + vite, from either the
 * main checkout or a worktree, and returns `{ apiBase, appBase, stop, logs }`.
 *
 * Options:
 *   - env: {}          extra/override env vars for the server process
 *   - unsetEnv: []      env var names to delete after everything else is applied
 *   - build: true       set false to skip `npm run build` (server already built)
 *   - force: false      overwrite an existing client/.env.local pointing elsewhere
 *   - stopDb: false     allow stop() to `docker compose down` if THIS call started it
 *   - serverPort/clientPort: 5055/5056 preferred ports; falls back to any free pair
 */
export async function startStack(opts = {}) {
  const { checkoutRoot, mainCheckout } = resolveCheckouts(process.cwd());
  const clientDir = path.join(checkoutRoot, 'client');

  const [serverPort, clientPort] = await pickPorts(opts.serverPort ?? 5055, opts.clientPort ?? 5056);
  const apiBase = `http://localhost:${serverPort}/api/`;
  const apiBaseNoSlash = `http://localhost:${serverPort}/api`;
  const appBase = `http://localhost:${clientPort}`;

  const { startedContainer } = await ensureDb(checkoutRoot);

  ensureDeps(checkoutRoot, 'server');
  ensureDeps(clientDir, 'client');

  const env = await buildServerEnv({ mainCheckout, serverPort, clientPort, opts });

  if (opts.build !== false) buildServer(checkoutRoot, env);

  const { path: envLocalPath, created: createdEnvLocal } = writeClientEnvLocal(clientDir, apiBaseNoSlash, opts);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-verify-stack-'));
  const serverLogPath = path.join(tmpDir, 'server.log');
  const viteLogPath = path.join(tmpDir, 'vite.log');

  console.error(`[stack] starting server on ${serverPort}, vite on ${clientPort} (logs: ${tmpDir})`);
  const serverChild = spawnLogged('node', ['dist/index.js'], { cwd: checkoutRoot, env }, serverLogPath);
  const viteChild = spawnLogged(
    'npx',
    ['vite', '--port', String(clientPort), '--strictPort'],
    { cwd: clientDir, env: process.env },
    viteLogPath,
  );

  let stopped = false;
  const doStop = () => {
    if (stopped) return;
    stopped = true;
    for (const child of [serverChild, viteChild]) {
      if (!child || child.exitCode !== null) continue;
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        // already gone
      }
    }
    if (createdEnvLocal) {
      try {
        fs.unlinkSync(envLocalPath);
      } catch {
        // already gone
      }
    }
    if (startedContainer && opts.stopDb) {
      run('docker', ['compose', 'down'], { cwd: checkoutRoot });
    }
  };

  process.once('exit', doStop);
  const onSignal = () => { doStop(); process.exit(130); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    await waitForServer(apiBaseNoSlash, serverLogPath, serverChild);
    await waitForVite(appBase, viteLogPath, viteChild);
  } catch (err) {
    err.message += `\n\n--- server.log ---\n${tail(serverLogPath)}\n\n--- vite.log ---\n${tail(viteLogPath)}`;
    doStop();
    throw err;
  }

  return {
    apiBase,
    appBase,
    stop: async () => doStop(),
    logs: () => {
      try {
        return fs.readFileSync(serverLogPath, 'utf8');
      } catch {
        return '';
      }
    },
  };
}
