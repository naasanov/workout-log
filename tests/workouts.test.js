// Characterization tests for routes/sections.ts, routes/movements.ts, and
// routes/variations.ts, pinning their CURRENT behavior (including warts) so a
// later SQL-to-service-module refactor can be verified against these as a
// baseline. Exercises real HTTP requests through the actual routers against a
// real MySQL schema (workout_log_test) rather than mocking pool.query, since a
// mock would only prove the SQL string was retyped identically -- not that
// behavior survived a refactor.
//
// Requires a reachable database (see scripts/testDb.js). If none is
// reachable, every test here is skipped (not failed) so `npm test` still
// passes for someone who hasn't started Docker.
//
// Run with: node --test tests/workouts.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../scripts/testDb');

// --- HTTP helpers -----------------------------------------------------

async function request(baseUrl, method, path, user, body) {
  const headers = { ...(user ? user.authHeader() : {}) };
  const init = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${baseUrl}${path}`, init);
  let responseBody = null;
  try {
    responseBody = await res.json();
  } catch {
    // no body / not json
  }
  return { status: res.status, body: responseBody };
}

// sections
const postSection = (baseUrl, user, body) => request(baseUrl, 'POST', '/api/sections', user, body ?? {});
const getUserSections = (baseUrl, user) => request(baseUrl, 'GET', '/api/sections/user', user);
const getSection = (baseUrl, user, id) => request(baseUrl, 'GET', `/api/sections/section/${id}`, user);
const patchSection = (baseUrl, user, id, body) => request(baseUrl, 'PATCH', `/api/sections/${id}`, user, body ?? {});
const deleteSection = (baseUrl, user, id) => request(baseUrl, 'DELETE', `/api/sections/${id}`, user);

// movements
const postMovement = (baseUrl, user, sectionId, body) => request(baseUrl, 'POST', `/api/movements/${sectionId}`, user, body ?? {});
const listMovementsForSection = (baseUrl, user, sectionId) => request(baseUrl, 'GET', `/api/movements/section/${sectionId}`, user);
const getMovement = (baseUrl, user, movementId) => request(baseUrl, 'GET', `/api/movements/movement/${movementId}`, user);
const patchMovement = (baseUrl, user, movementId, body) => request(baseUrl, 'PATCH', `/api/movements/${movementId}`, user, body ?? {});
const deleteMovement = (baseUrl, user, movementId) => request(baseUrl, 'DELETE', `/api/movements/${movementId}`, user);

// variations
const postVariation = (baseUrl, user, movementId, body) => request(baseUrl, 'POST', `/api/variations/${movementId}`, user, body ?? {});
const getVariationsBatch = (baseUrl, user, idsParam) => request(baseUrl, 'GET', `/api/variations/movements?ids=${encodeURIComponent(idsParam)}`, user);
const listVariationsForMovement = (baseUrl, user, movementId) => request(baseUrl, 'GET', `/api/variations/movement/${movementId}`, user);
const getVariation = (baseUrl, user, variationId) => request(baseUrl, 'GET', `/api/variations/variation/${variationId}`, user);
const getHistory = (baseUrl, user, variationId) => request(baseUrl, 'GET', `/api/variations/history/${variationId}`, user);
const patchVariation = (baseUrl, user, variationId, body) => request(baseUrl, 'PATCH', `/api/variations/${variationId}`, user, body ?? {});
const deleteVariation = (baseUrl, user, variationId) => request(baseUrl, 'DELETE', `/api/variations/${variationId}`, user);

// --- fixture helpers ----------------------------------------------------

async function makeSection(baseUrl, user, body = { label: 'Legs' }) {
  const { body: created } = await postSection(baseUrl, user, body);
  return created.data.sectionId;
}

async function makeMovement(baseUrl, user, sectionId, body = { label: 'Squat' }) {
  const { body: created } = await postMovement(baseUrl, user, sectionId, body);
  return created.data.movementId;
}

async function makeVariation(baseUrl, user, movementId, body = { label: 'Variation', weight: 100, reps: 5 }) {
  const { body: created } = await postVariation(baseUrl, user, movementId, body);
  return created.data.variationId;
}

// Builds section -> movement -> variation in one call for tests that only care
// about the leaf variation.
async function makeChain(baseUrl, user, variationBody) {
  const sectionId = await makeSection(baseUrl, user);
  const movementId = await makeMovement(baseUrl, user, sectionId);
  const variationId = await makeVariation(baseUrl, user, movementId, variationBody);
  return { sectionId, movementId, variationId };
}

// Starts one express app with all three routers mounted at their production
// paths (see index.ts), so cross-router fixtures (a movement needs a section,
// a variation needs a movement) are one baseUrl away. Mirrors
// scripts/testDb.js's startTestServer, generalized to more than one router,
// without modifying that shared file.
async function startWorkoutsServer() {
  const express = require('express');
  const sections = db.requireTs('routes/sections.ts').default;
  const movements = db.requireTs('routes/movements.ts').default;
  const variations = db.requireTs('routes/variations.ts').default;

  const app = express();
  app.use(express.json());
  app.use('/api/sections', sections);
  app.use('/api/movements', movements);
  app.use('/api/variations', variations);

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

test('workouts routes (sections, movements, variations)', async (t) => {
  const available = await db.isDbReachable();
  if (!available) {
    t.skip('No reachable database on 127.0.0.1:3307. Start it with: docker compose up -d, then npm run db:setup (see scripts/testDb.js).');
    return;
  }

  await db.setupTestDb();
  const pool = db.getPool();
  const { server, baseUrl } = await startWorkoutsServer();

  t.beforeEach(async () => {
    await db.resetDb();
  });

  t.after(async () => {
    await db.stopTestServer(server);
    await db.closePool();
  });

  // --- auth ---------------------------------------------------------

  await t.test('auth', async (t) => {
    for (const [name, path] of [
      ['sections', '/api/sections/user'],
      ['movements', '/api/movements/section/1'],
      ['variations', '/api/variations/movement/1'],
    ]) {
      await t.test(`${name} router rejects an unauthenticated request`, async () => {
        const res = await fetch(`${baseUrl}${path}`);
        assert.equal(res.status, 401);
        const body = await res.json();
        assert.equal(body.message, 'Unauthorized: access token required');
      });

      await t.test(`${name} router rejects a garbage bearer token`, async () => {
        const res = await fetch(`${baseUrl}${path}`, { headers: { Authorization: 'Bearer not-a-real-token' } });
        assert.equal(res.status, 403);
        const body = await res.json();
        assert.equal(body.message, 'Forbidden access token');
      });
    }
  });

  // --- sections -------------------------------------------------------

  await t.test('sections', async (t) => {
    await t.test('POST /', async (t) => {
      await t.test('creates a section owned by the caller', async () => {
        const user = await db.createTestUser();
        const { status, body } = await postSection(baseUrl, user, { label: 'Push Day' });
        assert.equal(status, 201);
        assert.equal(typeof body.data.sectionId, 'number');
        assert.equal(body.message, `Successfullly created section with id ${body.data.sectionId}`);
      });

      await t.test('allows an empty string label', async () => {
        const user = await db.createTestUser();
        const { status } = await postSection(baseUrl, user, { label: '' });
        assert.equal(status, 201);
      });

      await t.test('rejects a missing label', async () => {
        const user = await db.createTestUser();
        const { status, body } = await postSection(baseUrl, user, {});
        assert.equal(status, 400);
        assert.equal(body.message, 'Request body must include a non-null label');
      });

      await t.test('rejects a non-string label', async () => {
        const user = await db.createTestUser();
        const { status, body } = await postSection(baseUrl, user, { label: 5 });
        assert.equal(status, 400);
        assert.equal(body.message, 'Label must be a string');
      });

      await t.test('rejects a label over 50 characters', async () => {
        const user = await db.createTestUser();
        const { status, body } = await postSection(baseUrl, user, { label: 'x'.repeat(51) });
        assert.equal(status, 400);
        assert.equal(body.message, 'Label must not exceed 50 characters');
      });

      await t.test('a malformed uuid claim in the token pins whatever status UUID_TO_BIN produces (current wart)', async () => {
        // authenticateToken never validates the shape of the `uuid` JWT claim;
        // it's whatever was signed. UUID_TO_BIN(<garbage>) is left to MySQL.
        const badToken = db.signAccessToken('not-a-uuid');
        const user = { authHeader: () => ({ Authorization: `Bearer ${badToken}` }) };
        const { status, body } = await postSection(baseUrl, user, { label: 'x' });
        assert.equal(status, 400);
        assert.equal(body.message, 'Request parameter must be a 36 character, hyphen separated uuid');
      });
    });

    await t.test('GET /user', async (t) => {
      await t.test('returns an empty list for a user with no sections', async () => {
        const user = await db.createTestUser();
        const { status, body } = await getUserSections(baseUrl, user);
        assert.equal(status, 200);
        assert.deepEqual(body.data, []);
        assert.equal(body.message, `Successfully retrieved all sections for user with id ${user.uuid}`);
      });

      await t.test('returns sections with is_open converted from 0/1 to a JS boolean', async () => {
        const user = await db.createTestUser();
        const sectionId = await makeSection(baseUrl, user, { label: 'Pull Day' });
        await patchSection(baseUrl, user, sectionId, { is_open: true });

        const { status, body } = await getUserSections(baseUrl, user);
        assert.equal(status, 200);
        assert.equal(body.data.length, 1);
        assert.deepEqual(body.data[0], { id: sectionId, label: 'Pull Day', showItems: true });
      });

      await t.test('only returns the authenticated user\'s own sections', async () => {
        const userA = await db.createTestUser();
        const userB = await db.createTestUser();
        await makeSection(baseUrl, userA, { label: 'A1' });
        await makeSection(baseUrl, userB, { label: 'B1' });
        await makeSection(baseUrl, userB, { label: 'B2' });

        const { body: bodyA } = await getUserSections(baseUrl, userA);
        const { body: bodyB } = await getUserSections(baseUrl, userB);
        assert.equal(bodyA.data.length, 1);
        assert.equal(bodyB.data.length, 2);
      });

      await t.test('404s when the user backing the token no longer exists', async () => {
        const user = await db.createTestUser();
        await pool.query('DELETE FROM users WHERE user_uuid = UUID_TO_BIN(?)', [user.uuid]);

        const { status, body } = await getUserSections(baseUrl, user);
        assert.equal(status, 404);
        assert.equal(body.message, `User with id ${user.uuid} does not exist`);
      });
    });

    await t.test('GET /section/:sectionId', async (t) => {
      await t.test('returns the section\'s id and label only (no showItems)', async () => {
        const user = await db.createTestUser();
        const sectionId = await makeSection(baseUrl, user, { label: 'Legs' });

        const { status, body } = await getSection(baseUrl, user, sectionId);
        assert.equal(status, 200);
        assert.deepEqual(body.data, { id: sectionId, label: 'Legs' });
        assert.equal(body.message, `Successfully retrieved section with id ${sectionId}`);
      });

      await t.test('404s for a non-existent numeric id', async () => {
        const user = await db.createTestUser();
        const { status, body } = await getSection(baseUrl, user, 999999);
        assert.equal(status, 404);
        assert.equal(body.message, 'Section with id 999999 not found');
      });

      await t.test('404s for another user\'s section, without leaking its data', async () => {
        const userA = await db.createTestUser();
        const userB = await db.createTestUser();
        const sectionId = await makeSection(baseUrl, userA, { label: 'Private To A' });

        const { status, body } = await getSection(baseUrl, userB, sectionId);
        assert.equal(status, 404);
        assert.equal(body.message, `Section with id ${sectionId} not found`);
      });

      await t.test('an invalid (non-numeric) id responds 400 promptly instead of hanging', async () => {
        const user = await db.createTestUser();
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        try {
          const res = await fetch(`${baseUrl}/api/sections/section/not-a-number`, {
            headers: user.authHeader(),
            signal: controller.signal,
          });
          const body = await res.json();
          assert.equal(res.status, 400);
          assert.equal(body.message, 'Request parameter id must be a positive integer');
        } finally {
          clearTimeout(timeoutId);
        }
      });
    });

    await t.test('PATCH /:sectionId', async (t) => {
      await t.test('updates the label', async () => {
        const user = await db.createTestUser();
        const sectionId = await makeSection(baseUrl, user, { label: 'Old' });

        const { status, body } = await patchSection(baseUrl, user, sectionId, { label: 'New' });
        assert.equal(status, 200);
        assert.equal(body.message, `Successfully updated section with id ${sectionId}`);

        const { body: getBody } = await getSection(baseUrl, user, sectionId);
        assert.equal(getBody.data.label, 'New');
      });

      await t.test('updates is_open', async () => {
        const user = await db.createTestUser();
        const sectionId = await makeSection(baseUrl, user);

        const { status } = await patchSection(baseUrl, user, sectionId, { is_open: true });
        assert.equal(status, 200);

        const { body: listBody } = await getUserSections(baseUrl, user);
        assert.equal(listBody.data[0].showItems, true);
      });

      await t.test('rejects a non-numeric id with a normal 400 (res is passed here, unlike the GET route)', async () => {
        const user = await db.createTestUser();
        const { status, body } = await patchSection(baseUrl, user, 'abc', { label: 'x' });
        assert.equal(status, 400);
        assert.equal(body.message, 'Request parameter id must be a positive integer');
      });

      await t.test('rejects fields outside label/is_open', async () => {
        const user = await db.createTestUser();
        const sectionId = await makeSection(baseUrl, user);
        const { status, body } = await patchSection(baseUrl, user, sectionId, { foo: 'bar' });
        assert.equal(status, 400);
        assert.equal(body.message, 'Invalid fields: foo. Allowed fields are: label, is_open.');
      });

      await t.test('rejects an empty body', async () => {
        const user = await db.createTestUser();
        const sectionId = await makeSection(baseUrl, user);
        const { status, body } = await patchSection(baseUrl, user, sectionId, {});
        assert.equal(status, 400);
        assert.equal(body.message, 'Request body cannot be empty');
      });

      await t.test('rejects a non-boolean is_open', async () => {
        const user = await db.createTestUser();
        const sectionId = await makeSection(baseUrl, user);
        const { status, body } = await patchSection(baseUrl, user, sectionId, { is_open: 'true' });
        assert.equal(status, 400);
        assert.equal(body.message, 'is_open must be a boolean');
      });

      await t.test('404s for a non-existent id', async () => {
        const user = await db.createTestUser();
        const { status, body } = await patchSection(baseUrl, user, 999999, { label: 'x' });
        assert.equal(status, 404);
        assert.equal(body.message, 'No section with id 999999');
      });

      await t.test('404s for another user\'s section, leaving it unchanged', async () => {
        const userA = await db.createTestUser();
        const userB = await db.createTestUser();
        const sectionId = await makeSection(baseUrl, userA, { label: 'Mine' });

        const { status, body } = await patchSection(baseUrl, userB, sectionId, { label: 'Hijacked' });
        assert.equal(status, 404);
        assert.equal(body.message, `No section with id ${sectionId}`);

        const { body: listBody } = await getUserSections(baseUrl, userA);
        assert.equal(listBody.data[0].label, 'Mine');
      });
    });

    await t.test('DELETE /:sectionId', async (t) => {
      await t.test('deletes a section', async () => {
        const user = await db.createTestUser();
        const sectionId = await makeSection(baseUrl, user);

        const { status, body } = await deleteSection(baseUrl, user, sectionId);
        assert.equal(status, 200);
        assert.equal(body.message, `Successfully deleted section with id ${sectionId}`);

        const { body: listBody } = await getUserSections(baseUrl, user);
        assert.deepEqual(listBody.data, []);
      });

      await t.test('rejects a non-numeric id with a normal 400 (res is passed here, unlike the GET route)', async () => {
        const user = await db.createTestUser();
        const { status, body } = await deleteSection(baseUrl, user, 'abc');
        assert.equal(status, 400);
        assert.equal(body.message, 'Request parameter id must be a positive integer');
      });

      await t.test('404s for a non-existent id', async () => {
        const user = await db.createTestUser();
        const { status, body } = await deleteSection(baseUrl, user, 999999);
        assert.equal(status, 404);
        assert.equal(body.message, 'No section found with id 999999');
      });

      await t.test('404s for another user\'s section, leaving it intact', async () => {
        const userA = await db.createTestUser();
        const userB = await db.createTestUser();
        const sectionId = await makeSection(baseUrl, userA);

        const { status, body } = await deleteSection(baseUrl, userB, sectionId);
        assert.equal(status, 404);
        assert.equal(body.message, `No section found with id ${sectionId}`);

        const { body: listBody } = await getUserSections(baseUrl, userA);
        assert.equal(listBody.data.length, 1);
      });

      await t.test('cascades: deletes the section\'s movements, variations, and variation_history', async () => {
        const user = await db.createTestUser();
        const { sectionId, movementId, variationId } = await makeChain(baseUrl, user, { label: 'V', weight: 100, reps: 5 });
        await patchVariation(baseUrl, user, variationId, { weight: 110 });
        const [[{ historyCountBefore }]] = await pool.query(
          'SELECT COUNT(*) as historyCountBefore FROM variation_history WHERE variation_id = ?',
          [variationId],
        );
        assert.equal(historyCountBefore, 1);

        await deleteSection(baseUrl, user, sectionId);

        const [[{ movementCount }]] = await pool.query('SELECT COUNT(*) as movementCount FROM movements WHERE movement_id = ?', [movementId]);
        const [[{ variationCount }]] = await pool.query('SELECT COUNT(*) as variationCount FROM variations WHERE variation_id = ?', [variationId]);
        const [[{ historyCount }]] = await pool.query('SELECT COUNT(*) as historyCount FROM variation_history WHERE variation_id = ?', [variationId]);
        assert.equal(movementCount, 0);
        assert.equal(variationCount, 0);
        assert.equal(historyCount, 0);
      });
    });
  });

  // --- movements -------------------------------------------------------

  await t.test('movements', async (t) => {
    await t.test('POST /:sectionId', async (t) => {
      await t.test('creates a movement and a default "Variation" for it', async () => {
        const user = await db.createTestUser();
        const sectionId = await makeSection(baseUrl, user);

        const { status, body } = await postMovement(baseUrl, user, sectionId, { label: 'Bench Press' });
        assert.equal(status, 201);
        assert.equal(typeof body.data.movementId, 'number');
        assert.equal(body.message, `Successfullly created movement with id ${body.data.movementId}`);

        const { body: variationsBody } = await listVariationsForMovement(baseUrl, user, body.data.movementId);
        assert.equal(variationsBody.data.length, 1);
        assert.equal(variationsBody.data[0].label, 'Variation');
        assert.equal(variationsBody.data[0].weight, null);
        assert.equal(variationsBody.data[0].reps, 0);
        assert.equal(variationsBody.data[0].notes, null);
      });

      await t.test('rejects a missing label', async () => {
        const user = await db.createTestUser();
        const sectionId = await makeSection(baseUrl, user);
        const { status, body } = await postMovement(baseUrl, user, sectionId, {});
        assert.equal(status, 400);
        assert.equal(body.message, 'Request body must include a non-null label');
      });

      await t.test('404s for a section owned by another user', async () => {
        const userA = await db.createTestUser();
        const userB = await db.createTestUser();
        const sectionId = await makeSection(baseUrl, userA);

        const { status, body } = await postMovement(baseUrl, userB, sectionId, { label: 'x' });
        assert.equal(status, 404);
        assert.equal(body.message, `Section with id ${sectionId} not found`);
      });

      await t.test('404s for a non-existent section', async () => {
        const user = await db.createTestUser();
        const { status, body } = await postMovement(baseUrl, user, 999999, { label: 'x' });
        assert.equal(status, 404);
        assert.equal(body.message, 'Section with id 999999 not found');
      });
    });

    await t.test('GET /section/:sectionId', async (t) => {
      await t.test('lists movements for a section the user owns', async () => {
        const user = await db.createTestUser();
        const sectionId = await makeSection(baseUrl, user);
        await makeMovement(baseUrl, user, sectionId, { label: 'Squat' });
        await makeMovement(baseUrl, user, sectionId, { label: 'Deadlift' });

        const { status, body } = await listMovementsForSection(baseUrl, user, sectionId);
        assert.equal(status, 200);
        assert.equal(body.data.length, 2);
      });

      await t.test('404s for another user\'s section', async () => {
        const userA = await db.createTestUser();
        const userB = await db.createTestUser();
        const sectionId = await makeSection(baseUrl, userA);

        const { status, body } = await listMovementsForSection(baseUrl, userB, sectionId);
        assert.equal(status, 404);
        assert.equal(body.message, `Section with id ${sectionId} does not exist`);
      });
    });

    await t.test('GET /movement/:movementId', async (t) => {
      await t.test('returns a movement the user owns', async () => {
        const user = await db.createTestUser();
        const sectionId = await makeSection(baseUrl, user);
        const movementId = await makeMovement(baseUrl, user, sectionId, { label: 'Row' });

        const { status, body } = await getMovement(baseUrl, user, movementId);
        assert.equal(status, 200);
        assert.deepEqual(body.data, { id: movementId, label: 'Row' });
      });

      await t.test('404s for another user\'s movement', async () => {
        const userA = await db.createTestUser();
        const userB = await db.createTestUser();
        const sectionId = await makeSection(baseUrl, userA);
        const movementId = await makeMovement(baseUrl, userA, sectionId);

        const { status, body } = await getMovement(baseUrl, userB, movementId);
        assert.equal(status, 404);
        assert.equal(body.message, `movement with id ${movementId} not found`);
      });
    });

    await t.test('PATCH /:movementId', async (t) => {
      await t.test('updates the label', async () => {
        const user = await db.createTestUser();
        const sectionId = await makeSection(baseUrl, user);
        const movementId = await makeMovement(baseUrl, user, sectionId, { label: 'Old' });

        const { status, body } = await patchMovement(baseUrl, user, movementId, { label: 'New' });
        assert.equal(status, 200);
        assert.equal(body.message, `Successfully updated movement with id ${movementId}`);

        const { body: getBody } = await getMovement(baseUrl, user, movementId);
        assert.equal(getBody.data.label, 'New');
      });

      await t.test('WART: silently ignores unknown fields instead of rejecting them (no allow-list check, unlike sections/variations PATCH)', async () => {
        const user = await db.createTestUser();
        const sectionId = await makeSection(baseUrl, user);
        const movementId = await makeMovement(baseUrl, user, sectionId, { label: 'Old' });

        const { status } = await patchMovement(baseUrl, user, movementId, { label: 'New', notAField: 'x' });
        assert.equal(status, 200);
      });

      await t.test('rejects a missing label (label is mandatory on every PATCH, there is no other patchable field)', async () => {
        const user = await db.createTestUser();
        const sectionId = await makeSection(baseUrl, user);
        const movementId = await makeMovement(baseUrl, user, sectionId);

        const { status, body } = await patchMovement(baseUrl, user, movementId, {});
        assert.equal(status, 400);
        assert.equal(body.message, 'Request body must include a non-null label');
      });

      await t.test('404s for another user\'s movement', async () => {
        const userA = await db.createTestUser();
        const userB = await db.createTestUser();
        const sectionId = await makeSection(baseUrl, userA);
        const movementId = await makeMovement(baseUrl, userA, sectionId);

        const { status, body } = await patchMovement(baseUrl, userB, movementId, { label: 'Hijacked' });
        assert.equal(status, 404);
        assert.equal(body.message, `No movement with id ${movementId}`);
      });
    });

    await t.test('DELETE /:movementId', async (t) => {
      await t.test('deletes a movement and cascades to its variations and their history', async () => {
        const user = await db.createTestUser();
        const sectionId = await makeSection(baseUrl, user);
        const movementId = await makeMovement(baseUrl, user, sectionId);
        const variationId = await makeVariation(baseUrl, user, movementId, { label: 'V', weight: 100, reps: 5 });
        await patchVariation(baseUrl, user, variationId, { weight: 110 });

        const { status, body } = await deleteMovement(baseUrl, user, movementId);
        assert.equal(status, 200);
        assert.equal(body.message, `Successfully deleted movement with id ${movementId}`);

        const [[{ variationCount }]] = await pool.query('SELECT COUNT(*) as variationCount FROM variations WHERE movement_id = ?', [movementId]);
        const [[{ historyCount }]] = await pool.query('SELECT COUNT(*) as historyCount FROM variation_history WHERE variation_id = ?', [variationId]);
        assert.equal(variationCount, 0);
        assert.equal(historyCount, 0);
      });

      await t.test('404s for another user\'s movement (ownership enforced via the delete\'s own join)', async () => {
        const userA = await db.createTestUser();
        const userB = await db.createTestUser();
        const sectionId = await makeSection(baseUrl, userA);
        const movementId = await makeMovement(baseUrl, userA, sectionId);

        const { status, body } = await deleteMovement(baseUrl, userB, movementId);
        assert.equal(status, 404);
        assert.equal(body.message, `No movement found with id ${movementId}`);

        const { body: getBody } = await getMovement(baseUrl, userA, movementId);
        assert.equal(getBody.data.id, movementId);
      });

      await t.test('404s for a non-existent id', async () => {
        const user = await db.createTestUser();
        const { status, body } = await deleteMovement(baseUrl, user, 999999);
        assert.equal(status, 404);
        assert.equal(body.message, 'No movement found with id 999999');
      });
    });
  });

  // --- variations -------------------------------------------------------

  await t.test('variations', async (t) => {
    await t.test('POST /:movementId', async (t) => {
      await t.test('creates a variation with the given fields', async () => {
        const user = await db.createTestUser();
        const sectionId = await makeSection(baseUrl, user);
        const movementId = await makeMovement(baseUrl, user, sectionId);

        const { status, body } = await postVariation(baseUrl, user, movementId, { label: 'Close Grip', weight: 135, reps: 8 });
        assert.equal(status, 201);
        assert.equal(typeof body.data.variationId, 'number');
        assert.equal(body.message, `Successfullly created variation with id ${body.data.variationId}`);

        const { body: getBody } = await getVariation(baseUrl, user, body.data.variationId);
        assert.equal(getBody.data.label, 'Close Grip');
        assert.equal(getBody.data.weight, 135);
        assert.equal(getBody.data.reps, 8);
      });

      await t.test('omitting weight alone succeeds and stores it as null (the column is nullable)', async () => {
        const user = await db.createTestUser();
        const sectionId = await makeSection(baseUrl, user);
        const movementId = await makeMovement(baseUrl, user, sectionId);

        const { status, body } = await postVariation(baseUrl, user, movementId, { label: 'Bodyweight', reps: 0 });
        assert.equal(status, 201);

        const { body: getBody } = await getVariation(baseUrl, user, body.data.variationId);
        assert.equal(getBody.data.weight, null);
        assert.equal(getBody.data.reps, 0);
      });

      await t.test('BUG: omitting reps 500s instead of falling back to the column default 0', async () => {
        // The INSERT always lists the reps column, so an omitted reps sends a
        // literal SQL NULL (mysql2's handling of a JS `undefined` bind param)
        // rather than leaving the column out for its DEFAULT 0 to apply.
        // `reps` is NOT NULL, so this throws and falls through to a generic 500.
        // Contrast with routes/movements.ts's auto-created variation, whose
        // INSERT omits weight/reps entirely and so gets the defaults cleanly.
        const user = await db.createTestUser();
        const sectionId = await makeSection(baseUrl, user);
        const movementId = await makeMovement(baseUrl, user, sectionId);

        const { status, body } = await postVariation(baseUrl, user, movementId, { label: 'Bodyweight' });
        assert.equal(status, 500);
        assert.equal(body.message, 'Internal Server Error');
      });

      await t.test('omitting date defaults it to roughly now', async () => {
        const user = await db.createTestUser();
        const sectionId = await makeSection(baseUrl, user);
        const movementId = await makeMovement(baseUrl, user, sectionId);
        const before = Date.now();

        const { body } = await postVariation(baseUrl, user, movementId, { label: 'V', reps: 0 });
        const after = Date.now();

        const { body: getBody } = await getVariation(baseUrl, user, body.data.variationId);
        const stored = new Date(getBody.data.date).getTime();
        assert.ok(stored >= before - 1000 && stored <= after + 1000);
      });

      await t.test('rejects a body without a label key', async () => {
        const user = await db.createTestUser();
        const sectionId = await makeSection(baseUrl, user);
        const movementId = await makeMovement(baseUrl, user, sectionId);

        const { status, body } = await postVariation(baseUrl, user, movementId, { weight: 100 });
        assert.equal(status, 400);
        assert.equal(body.message, 'Request body must include label');
      });

      await t.test('rejects a negative weight', async () => {
        const user = await db.createTestUser();
        const sectionId = await makeSection(baseUrl, user);
        const movementId = await makeMovement(baseUrl, user, sectionId);

        const { status, body } = await postVariation(baseUrl, user, movementId, { label: 'V', weight: -1 });
        assert.equal(status, 400);
        assert.match(body.message, /Weight must be a valid non-negative number/);
      });

      await t.test('rejects a non-integer reps', async () => {
        const user = await db.createTestUser();
        const sectionId = await makeSection(baseUrl, user);
        const movementId = await makeMovement(baseUrl, user, sectionId);

        const { status, body } = await postVariation(baseUrl, user, movementId, { label: 'V', reps: 1.5 });
        assert.equal(status, 400);
        assert.match(body.message, /Reps must be a valid non-negative integer/);
      });

      await t.test('rejects a non-ISO date string', async () => {
        const user = await db.createTestUser();
        const sectionId = await makeSection(baseUrl, user);
        const movementId = await makeMovement(baseUrl, user, sectionId);

        const { status, body } = await postVariation(baseUrl, user, movementId, { label: 'V', date: 'not-a-date' });
        assert.equal(status, 400);
        assert.match(body.message, /Date field must be a ISO 8601 formatted date string/);
      });

      await t.test('rejects notes over 2000 characters', async () => {
        const user = await db.createTestUser();
        const sectionId = await makeSection(baseUrl, user);
        const movementId = await makeMovement(baseUrl, user, sectionId);

        const { status, body } = await postVariation(baseUrl, user, movementId, { label: 'V', notes: 'x'.repeat(2001) });
        assert.equal(status, 400);
        assert.match(body.message, /Notes must not exceed 2000 characters/);
      });

      await t.test('404s for a movement owned by another user', async () => {
        const userA = await db.createTestUser();
        const userB = await db.createTestUser();
        const sectionId = await makeSection(baseUrl, userA);
        const movementId = await makeMovement(baseUrl, userA, sectionId);

        const { status, body } = await postVariation(baseUrl, userB, movementId, { label: 'V' });
        assert.equal(status, 404);
        assert.equal(body.message, `Movement with id ${movementId} not found`);
      });
    });

    await t.test('GET /movements?ids= (batched)', async (t) => {
      await t.test('rejects a missing ids param', async () => {
        const user = await db.createTestUser();
        const { status, body } = await getVariationsBatch(baseUrl, user, '');
        assert.equal(status, 400);
        assert.equal(body.message, 'Query parameter ids must be a comma separated list of movement ids');
      });

      await t.test('rejects non-numeric ids', async () => {
        const user = await db.createTestUser();
        const { status, body } = await getVariationsBatch(baseUrl, user, '1,abc');
        assert.equal(status, 400);
        assert.equal(body.message, 'Query parameter ids must contain only numeric movement ids');
      });

      await t.test('rejects more than 200 ids (checked before any DB/ownership lookup)', async () => {
        const user = await db.createTestUser();
        const manyIds = Array.from({ length: 201 }, (_, i) => 100000 + i).join(',');
        const { status, body } = await getVariationsBatch(baseUrl, user, manyIds);
        assert.equal(status, 400);
        assert.equal(body.message, 'Query parameter ids must contain at most 200 movement ids');
      });

      await t.test('dedupes repeated ids so the ownership count check stays exact', async () => {
        const user = await db.createTestUser();
        const sectionId = await makeSection(baseUrl, user);
        const movementId = await makeMovement(baseUrl, user, sectionId);

        const { status, body } = await getVariationsBatch(baseUrl, user, `${movementId},${movementId}`);
        assert.equal(status, 200);
        assert.deepEqual(Object.keys(body.data), [String(movementId)]);
      });

      await t.test('404s all-or-nothing when any requested movement is not owned', async () => {
        const userA = await db.createTestUser();
        const userB = await db.createTestUser();
        const sectionA = await makeSection(baseUrl, userA);
        const movementA = await makeMovement(baseUrl, userA, sectionA);
        const sectionB = await makeSection(baseUrl, userB);
        const movementB = await makeMovement(baseUrl, userB, sectionB);

        const { status, body } = await getVariationsBatch(baseUrl, userA, `${movementA},${movementB}`);
        assert.equal(status, 404);
        assert.equal(body.message, 'One or more requested movements not found');
      });

      await t.test('returns an entry (possibly empty) for every requested movement, keyed by movement id', async () => {
        const user = await db.createTestUser();
        const sectionId = await makeSection(baseUrl, user);
        const movementWithVariations = await makeMovement(baseUrl, user, sectionId, { label: 'M1' });
        await makeVariation(baseUrl, user, movementWithVariations, { label: 'Extra', weight: 50, reps: 5 });

        const movementWithNone = await makeMovement(baseUrl, user, sectionId, { label: 'M2' });
        // M2 gets an auto-created default variation on POST; delete it to get to zero.
        const { body: listBody } = await listVariationsForMovement(baseUrl, user, movementWithNone);
        await deleteVariation(baseUrl, user, listBody.data[0].id);

        const { status, body } = await getVariationsBatch(baseUrl, user, `${movementWithVariations},${movementWithNone}`);
        assert.equal(status, 200);
        // movementWithVariations has its auto-created "Variation" plus the extra one.
        assert.equal(body.data[movementWithVariations].length, 2);
        assert.deepEqual(body.data[movementWithNone], []);
        assert.equal(body.message, 'Successfully retrieved all variations for 2 movement(s)');
      });
    });

    await t.test('GET /movement/:movementId', async (t) => {
      await t.test('lists variations for a movement the user owns', async () => {
        const user = await db.createTestUser();
        const sectionId = await makeSection(baseUrl, user);
        const movementId = await makeMovement(baseUrl, user, sectionId);
        await makeVariation(baseUrl, user, movementId, { label: 'Extra', weight: 50, reps: 5 });

        const { status, body } = await listVariationsForMovement(baseUrl, user, movementId);
        assert.equal(status, 200);
        assert.equal(body.data.length, 2);
      });

      await t.test('404s for another user\'s movement', async () => {
        const userA = await db.createTestUser();
        const userB = await db.createTestUser();
        const sectionId = await makeSection(baseUrl, userA);
        const movementId = await makeMovement(baseUrl, userA, sectionId);

        const { status, body } = await listVariationsForMovement(baseUrl, userB, movementId);
        assert.equal(status, 404);
        assert.equal(body.message, `movement with id ${movementId} not found`);
      });
    });

    await t.test('GET /variation/:variationId', async (t) => {
      await t.test('returns a variation the user owns', async () => {
        const user = await db.createTestUser();
        const { variationId } = await makeChain(baseUrl, user, { label: 'V', weight: 100, reps: 5, notes: 'note' });

        const { status, body } = await getVariation(baseUrl, user, variationId);
        assert.equal(status, 200);
        assert.equal(body.data.label, 'V');
        assert.equal(body.data.weight, 100);
        assert.equal(body.data.reps, 5);
        // POST destructures only label/weight/reps/date, so a notes value sent
        // at create time is silently dropped rather than rejected. Notes are
        // settable only via a later PATCH.
        assert.equal(body.data.notes, null);
      });

      await t.test('404s for another user\'s variation', async () => {
        const userA = await db.createTestUser();
        const userB = await db.createTestUser();
        const { variationId } = await makeChain(baseUrl, userA, { label: 'V', reps: 0 });

        const { status, body } = await getVariation(baseUrl, userB, variationId);
        assert.equal(status, 404);
        assert.equal(body.message, `variation with id ${variationId} not found`);
      });
    });

    // --- the variation_history append rule -----------------------------

    await t.test('variation_history append rule (PATCH /:variationId)', async (t) => {
      await t.test('creating a variation writes no history rows', async () => {
        const user = await db.createTestUser();
        const { variationId } = await makeChain(baseUrl, user, { label: 'V', weight: 100, reps: 5 });

        const { status, body } = await getHistory(baseUrl, user, variationId);
        assert.equal(status, 200);
        assert.deepEqual(body.data, []);
      });

      await t.test('BUG/WART: the first weight-or-reps PATCH always inserts a baseline row, even if the values are unchanged from creation (no prior history to compare against)', async () => {
        const user = await db.createTestUser();
        const { variationId } = await makeChain(baseUrl, user, { label: 'V', weight: 100, reps: 5 });

        const { status } = await patchVariation(baseUrl, user, variationId, { weight: 100 });
        assert.equal(status, 200);

        const { body } = await getHistory(baseUrl, user, variationId);
        assert.equal(body.data.length, 1);
        assert.equal(body.data[0].weight, 100);
        assert.equal(body.data[0].reps, 5);
      });

      await t.test('a second identical PATCH (no-op) does not insert another row', async () => {
        const user = await db.createTestUser();
        const { variationId } = await makeChain(baseUrl, user, { label: 'V', weight: 100, reps: 5 });
        await patchVariation(baseUrl, user, variationId, { weight: 100 }); // baseline row

        await patchVariation(baseUrl, user, variationId, { weight: 100 });

        const { body } = await getHistory(baseUrl, user, variationId);
        assert.equal(body.data.length, 1);
      });

      await t.test('changing weight alone appends a row', async () => {
        const user = await db.createTestUser();
        const { variationId } = await makeChain(baseUrl, user, { label: 'V', weight: 100, reps: 5 });
        await patchVariation(baseUrl, user, variationId, { weight: 100 }); // baseline row

        await patchVariation(baseUrl, user, variationId, { weight: 110 });

        const { body } = await getHistory(baseUrl, user, variationId);
        assert.equal(body.data.length, 2);
        assert.equal(body.data[1].weight, 110);
        assert.equal(body.data[1].reps, 5);
      });

      await t.test('changing reps alone appends a row', async () => {
        const user = await db.createTestUser();
        const { variationId } = await makeChain(baseUrl, user, { label: 'V', weight: 100, reps: 5 });
        await patchVariation(baseUrl, user, variationId, { weight: 100 }); // baseline row

        await patchVariation(baseUrl, user, variationId, { reps: 8 });

        const { body } = await getHistory(baseUrl, user, variationId);
        assert.equal(body.data.length, 2);
        assert.equal(body.data[1].weight, 100);
        assert.equal(body.data[1].reps, 8);
      });

      await t.test('changing weight and reps together in one PATCH appends exactly one row reflecting both', async () => {
        const user = await db.createTestUser();
        const { variationId } = await makeChain(baseUrl, user, { label: 'V', weight: 100, reps: 5 });
        await patchVariation(baseUrl, user, variationId, { weight: 100 }); // baseline row

        await patchVariation(baseUrl, user, variationId, { weight: 120, reps: 10 });

        const { body } = await getHistory(baseUrl, user, variationId);
        assert.equal(body.data.length, 2);
        assert.equal(body.data[1].weight, 120);
        assert.equal(body.data[1].reps, 10);
      });

      await t.test('patching neither weight nor reps (e.g. only label or notes) never touches history', async () => {
        const user = await db.createTestUser();
        const { variationId } = await makeChain(baseUrl, user, { label: 'V', weight: 100, reps: 5 });
        await patchVariation(baseUrl, user, variationId, { weight: 100 }); // baseline row

        await patchVariation(baseUrl, user, variationId, { label: 'Renamed', notes: 'hi' });

        const { body } = await getHistory(baseUrl, user, variationId);
        assert.equal(body.data.length, 1);
      });

      await t.test('when the variation has no weight, a reps-only PATCH inserts no history row ("a history point needs a weight to be plottable")', async () => {
        const user = await db.createTestUser();
        const sectionId = await makeSection(baseUrl, user);
        const movementId = await makeMovement(baseUrl, user, sectionId);
        const variationId = await makeVariation(baseUrl, user, movementId, { label: 'Bodyweight', reps: 0 }); // no weight

        const { status } = await patchVariation(baseUrl, user, variationId, { reps: 12 });
        assert.equal(status, 200);

        const { body } = await getHistory(baseUrl, user, variationId);
        assert.deepEqual(body.data, []);
      });

      await t.test('the history row\'s date comes from the PATCH body\'s date field when provided', async () => {
        const user = await db.createTestUser();
        const { variationId } = await makeChain(baseUrl, user, { label: 'V', weight: 100, reps: 5 });

        await patchVariation(baseUrl, user, variationId, { weight: 110, date: '2022-06-01T00:00:00.000Z' });

        const { body } = await getHistory(baseUrl, user, variationId);
        assert.equal(body.data.length, 1);
        assert.equal(new Date(body.data[0].date).toISOString(), '2022-06-01T00:00:00.000Z');
      });

      await t.test('the history row\'s date defaults to "now" when the PATCH omits date, even if the variation\'s own date column is old', async () => {
        const user = await db.createTestUser();
        const { variationId } = await makeChain(baseUrl, user, { label: 'V', weight: 100, reps: 5, date: '2020-01-01T00:00:00.000Z' });

        const before = Date.now();
        await patchVariation(baseUrl, user, variationId, { weight: 110 });
        const after = Date.now();

        const { body } = await getHistory(baseUrl, user, variationId);
        const historyTime = new Date(body.data[0].date).getTime();
        assert.ok(historyTime >= before - 1000 && historyTime <= after + 1000);
      });

      await t.test('legacy history rows with reps IS NULL are treated as reps=0 for the unchanged comparison', async () => {
        const user = await db.createTestUser();
        const { variationId } = await makeChain(baseUrl, user, { label: 'V', weight: 100, reps: 0 });
        // Simulate a pre-reps-tracking history row inserted directly (bypassing the API).
        await pool.query(
          'INSERT INTO variation_history (variation_id, weight, reps, date) VALUES (?, ?, NULL, NOW())',
          [variationId, 100],
        );

        // weight and reps both match the legacy row once NULL is treated as 0.
        await patchVariation(baseUrl, user, variationId, { weight: 100, reps: 0 });

        const { body } = await getHistory(baseUrl, user, variationId);
        assert.equal(body.data.length, 1);
      });

      await t.test('GET /history/:variationId orders rows by date ascending and returns only {weight, reps, date}', async () => {
        const user = await db.createTestUser();
        const { variationId } = await makeChain(baseUrl, user, { label: 'V', weight: 100, reps: 5 });

        await patchVariation(baseUrl, user, variationId, { weight: 100, date: '2024-03-01T00:00:00.000Z' }); // baseline
        await patchVariation(baseUrl, user, variationId, { weight: 90, date: '2024-01-01T00:00:00.000Z' });
        await patchVariation(baseUrl, user, variationId, { weight: 80, date: '2024-02-01T00:00:00.000Z' });

        const { status, body } = await getHistory(baseUrl, user, variationId);
        assert.equal(status, 200);
        assert.equal(body.data.length, 3);
        const dates = body.data.map((row) => row.date);
        assert.deepEqual(dates, [...dates].sort());
        assert.deepEqual(Object.keys(body.data[0]).sort(), ['date', 'reps', 'weight']);
      });

      await t.test('404s for another user\'s variation', async () => {
        const userA = await db.createTestUser();
        const userB = await db.createTestUser();
        const { variationId } = await makeChain(baseUrl, userA, { label: 'V', weight: 100, reps: 5 });

        const { status, body } = await getHistory(baseUrl, userB, variationId);
        assert.equal(status, 404);
        assert.equal(body.message, `variation with id ${variationId} not found`);
      });

      await t.test('history rows are gone (cascaded) once the parent variation is deleted', async () => {
        const user = await db.createTestUser();
        const { variationId } = await makeChain(baseUrl, user, { label: 'V', weight: 100, reps: 5 });
        await patchVariation(baseUrl, user, variationId, { weight: 110 });

        await deleteVariation(baseUrl, user, variationId);

        const [[{ historyCount }]] = await pool.query('SELECT COUNT(*) as historyCount FROM variation_history WHERE variation_id = ?', [variationId]);
        assert.equal(historyCount, 0);
      });
    });

    await t.test('PATCH /:variationId (general)', async (t) => {
      await t.test('updates label and notes without touching weight/reps', async () => {
        const user = await db.createTestUser();
        const { variationId } = await makeChain(baseUrl, user, { label: 'Old', weight: 100, reps: 5 });

        const { status, body } = await patchVariation(baseUrl, user, variationId, { label: 'New', notes: 'note' });
        assert.equal(status, 200);
        assert.equal(body.message, `Successfully updated label, notes of variation with id ${variationId}`);

        const { body: getBody } = await getVariation(baseUrl, user, variationId);
        assert.equal(getBody.data.label, 'New');
        assert.equal(getBody.data.notes, 'note');
        assert.equal(getBody.data.weight, 100);
      });

      await t.test('rejects fields outside label/weight/reps/date/notes', async () => {
        const user = await db.createTestUser();
        const { variationId } = await makeChain(baseUrl, user, { label: 'V', reps: 0 });

        const { status, body } = await patchVariation(baseUrl, user, variationId, { foo: 'bar' });
        assert.equal(status, 400);
        assert.equal(body.message, 'Invalid fields: foo. Allowed fields are: label, weight, reps, date, notes.');
      });

      await t.test('rejects an empty body', async () => {
        const user = await db.createTestUser();
        const { variationId } = await makeChain(baseUrl, user, { label: 'V', reps: 0 });

        const { status, body } = await patchVariation(baseUrl, user, variationId, {});
        assert.equal(status, 400);
        assert.equal(body.message, 'Request body cannot be empty');
      });

      await t.test('404s for a non-existent id', async () => {
        const user = await db.createTestUser();
        const { status, body } = await patchVariation(baseUrl, user, 999999, { label: 'x' });
        assert.equal(status, 404);
        assert.equal(body.message, 'No variation with id 999999');
      });

      await t.test('404s for another user\'s variation', async () => {
        const userA = await db.createTestUser();
        const userB = await db.createTestUser();
        const { variationId } = await makeChain(baseUrl, userA, { label: 'V', reps: 0 });

        const { status, body } = await patchVariation(baseUrl, userB, variationId, { label: 'Hijacked' });
        assert.equal(status, 404);
        assert.equal(body.message, `No variation with id ${variationId}`);
      });
    });

    await t.test('DELETE /:variationId', async (t) => {
      await t.test('deletes a variation the user owns', async () => {
        const user = await db.createTestUser();
        const { variationId } = await makeChain(baseUrl, user, { label: 'V', reps: 0 });

        const { status, body } = await deleteVariation(baseUrl, user, variationId);
        assert.equal(status, 200);
        assert.equal(body.message, `Successfully deleted variation with id ${variationId}`);

        const { status: getStatus } = await getVariation(baseUrl, user, variationId);
        assert.equal(getStatus, 404);
      });

      await t.test('404s for another user\'s variation', async () => {
        const userA = await db.createTestUser();
        const userB = await db.createTestUser();
        const { variationId } = await makeChain(baseUrl, userA, { label: 'V', reps: 0 });

        const { status, body } = await deleteVariation(baseUrl, userB, variationId);
        assert.equal(status, 404);
        assert.equal(body.message, `No variation found with id ${variationId}`);

        const { status: getStatus } = await getVariation(baseUrl, userA, variationId);
        assert.equal(getStatus, 200);
      });

      await t.test('404s for a non-existent id', async () => {
        const user = await db.createTestUser();
        const { status, body } = await deleteVariation(baseUrl, user, 999999);
        assert.equal(status, 404);
        assert.equal(body.message, 'No variation found with id 999999');
      });
    });
  });
});
