// Nightly retention job for chat_messages. Keeps the table (and the DB as a
// whole) under the JawsDB Kitefin free-tier 5 MB quota by (1) redacting old
// embedded chat images and (2) trimming old tool-call payloads, then
// reclaiming the freed InnoDB pages with OPTIMIZE TABLE.
//
// ============================================================================
// !!! THIS JOB MUST BE REGISTERED WITH HEROKU SCHEDULER — IT DOES NOT SELF-
// !!! SCHEDULE. Run once per deploy/setup:
// !!!
// !!!   heroku addons:open scheduler   (or the Scheduler dashboard tab)
// !!!   Add job -> Every day at <off-peak time> ->
// !!!     npm run redact-chat-images
// !!!
// !!! This exact gap — the script existing and working, but nobody ever
// !!! adding it to Scheduler — is *why this incident happened a second time*
// !!! after the first redaction-only version of this script was written and
// !!! merged. Confirm the job is actually listed in `heroku addons:open
// !!! scheduler` after deploying this change, not just that this file exists.
// ============================================================================
//
// --- Incident history (read this before touching the retention logic) -----
//
// Occurrence 1: chat photos (food photos, barcode-scan screenshots) were
// stored as full base64 data URIs directly inside chat_messages.parts (JSON),
// with no retention policy. That filled the 5MB quota and JawsDB responded by
// REVOKING THE INSERT PRIVILEGE on the whole database (SELECT/UPDATE/DELETE/
// ALTER/DROP were left intact). That takes the whole app down in a
// non-obvious way: login fails because it INSERTs a refresh token, and
// `scripts/migrate.js` fails on `INSERT INTO schema_migrations`, so even a
// deploy meant to fix the problem can't land. This was fixed manually in
// prod and this script was written to redact image bytes out of rows older
// than "yesterday" (by the `date` column) on a nightly schedule.
//
// Occurrence 2 (this fix): the incident happened AGAIN. Live production
// diagnosis found:
//   - chat_messages was 7.05 MB of a 7.86 MB database (215 rows).
//   - The image-redaction logic above was working correctly the whole time —
//     17 rows already redacted, and the only 10 rows still holding base64
//     were from today/yesterday, which it deliberately protects.
//   - Images were only PART of it. With every image byte hypothetically
//     stripped, 3.12 MB still remained across just 42 days, ALL of it tool-
//     call transcripts: 2114 `tool-calculator` parts, 603 `reasoning` parts,
//     plus hundreds of `tool-search_foods` / `tool-search_foods_batch` /
//     `tool-web_search` parts — each storing the FULL tool input and output
//     inline. Individual assistant rows reached 96 KB. So even flawless image
//     handling was never going to prevent this: the table needed a second,
//     independent retention pass for tool payloads. That's what
//     trimToolPayloads (in ./chatImageRedaction.js) and the second pass below
//     add.
//   - Separately, OPTIMIZE TABLE had never been run, so 3.00 MB of
//     `data_free` (pages InnoDB freed internally from earlier redactions/
//     deletes but never returned to the OS/`data_length`) was STILL counting
//     against the quota. InnoDB does not shrink a table's on-disk footprint
//     without an explicit rebuild — OPTIMIZE TABLE does that rebuild. This
//     job now runs it after every cleanup pass.
//   - Gotcha that will bite you measuring any of this by hand: MySQL 8
//     caches information_schema table-size stats for
//     `information_schema_stats_expiry` seconds (default 86400 = 24h). A
//     size check run immediately after a cleanup will report the OLD,
//     pre-cleanup size unless you `SET SESSION information_schema_stats_
//     expiry = 0` first. getDbSizeBytes() below does this on every call.
//
// --- What this job does, in order ------------------------------------------
//
//   1. Redact embedded images in rows older than CHAT_IMAGE_RETENTION_HOURS
//      (default 6h), by `created_at` (a true age, not the calendar `date`
//      column — see cutoff design note below).
//   2. Trim tool-call payloads (input/output/result) out of `tool-*` parts in
//      rows older than CHAT_TOOLPAYLOAD_RETENTION_DAYS (default 7d).
//   3. Run OPTIMIZE TABLE chat_messages to return freed InnoDB pages to
//      data_length. This requires the INSERT privilege (it's an InnoDB
//      table rebuild) — if the DB is ALREADY in the revoked state, this step
//      cannot self-heal it (see the catch block in optimizeTable() for the
//      full explanation of that catch-22). It fails loudly but non-fatally
//      in that case rather than crashing the whole scheduled job.
//   4. Measure and log DB size before/after (with the stats-cache gotcha
//      above handled), and warn loudly if the DB is at/above 80% of the 5MB
//      quota — this early warning is what was missing both times.
//
// --- Cutoff design: why images use HOURS and tool payloads use DAYS --------
//
// The stored transcript is not just for display — client/src/features/
// nutrition/NutritionChat.tsx hydrates useChat's `initialMessages` straight
// from GET /chat/transcript, and those messages get posted back to the model
// on the next turn. So the stored transcript IS the model's context after a
// page reload, and retention here has to respect an in-progress conversation:
//
//   - Images: redacting instantly would break a multi-turn photo
//     conversation the moment the user refreshes mid-session (the model
//     would lose the photo it was just asked about). But letting them live
//     for 2 days (the old cutoff) is most of what caused this incident.
//     6 hours is comfortably longer than one sitting/session but short
//     enough that images can't accumulate for two days like before.
//   - Tool payloads: these have no "does the user need to see this again on
//     refresh" story the way an image does — they're the model's working
//     notes from past tool calls. But trimming them on a conversation that's
//     still active would still degrade it (the model loses the exact numbers
//     it computed earlier today). 7 days safely outlives any realistic
//     "come back to this" window while still bounding growth, which is the
//     actual fix for the recurrence (see occurrence 2 above: image handling
//     alone left 3.12 MB of tool payloads untouched).
//
// Both cutoffs are computed off `created_at` (DATETIME, UTC) rather than the
// `date` column, because `date` is a calendar day with no time-of-day
// resolution — "older than yesterday" could mean anywhere from 0 to 48 hours
// depending on what time within the day a message was posted. `created_at`
// gives a true, hour-precision age.
//
// Run manually with: node scripts/redactOldChatImages.js
// (Same connection convention as scripts/migrate.js: JAWSDB_URL if set,
// otherwise discrete DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD/DB_NAME env
// vars, matching database.ts.)
'use strict';

const mysql = require('mysql2/promise');
const { redactParts, trimToolPayloads, isInsertPrivilegeError } = require('./chatImageRedaction');

async function connect() {
  if (process.env.JAWSDB_URL) {
    return mysql.createPool(process.env.JAWSDB_URL);
  }
  return mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
}

/** Parse a positive-integer env var, falling back to `fallback` if unset/invalid. */
function envPositiveInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** `now` minus `hours`, as a Date. */
function hoursAgo(now, hours) {
  return new Date(now.getTime() - hours * 60 * 60 * 1000);
}

/** `now` minus `days`, as a Date. */
function daysAgo(now, days) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/** Format a Date as a MySQL DATETIME literal ('YYYY-MM-DD HH:MM:SS'), UTC. */
function toMysqlDatetime(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

// The JawsDB Kitefin free-tier quota this whole job exists to protect.
const QUOTA_BYTES = 5 * 1024 * 1024;
// Warn once the DB is at/above this fraction of quota — early warning that
// was missing both times this incident happened.
const WARN_RATIO = 0.8;

/**
 * Total on-disk footprint of the current database, the way JawsDB counts it
 * against the quota: data_length + index_length + data_free summed across
 * every table. data_free (pages InnoDB has freed internally but not returned
 * to the OS) is included deliberately — occurrence 2 of this incident found
 * 3.00 MB of stale data_free STILL counting against the quota because
 * OPTIMIZE TABLE had never run, so a size report that only counted "used"
 * bytes would have missed exactly the thing that was biting us.
 *
 * Forces `information_schema_stats_expiry = 0` for this session first: MySQL
 * 8 otherwise caches information_schema table-size stats for up to 24h
 * (information_schema_stats_expiry, default 86400), so a size check run
 * immediately after a cleanup would silently report the stale, pre-cleanup
 * size.
 */
async function getDbSizeBytes(pool) {
  await pool.query('SET SESSION information_schema_stats_expiry = 0');
  const [rows] = await pool.query(
    `SELECT
       COALESCE(SUM(data_length), 0) AS dataLength,
       COALESCE(SUM(index_length), 0) AS indexLength,
       COALESCE(SUM(data_free), 0) AS dataFree
     FROM information_schema.TABLES
     WHERE table_schema = DATABASE()`,
  );
  const row = rows[0] || {};
  const dataLength = Number(row.dataLength) || 0;
  const indexLength = Number(row.indexLength) || 0;
  const dataFree = Number(row.dataFree) || 0;
  return { total: dataLength + indexLength + dataFree, dataLength, indexLength, dataFree };
}

function formatMb(bytes) {
  return (bytes / (1024 * 1024)).toFixed(3);
}

function logSize(label, size) {
  console.log(
    `[redact-chat-images] DB size (${label}): total=${formatMb(size.total)}MB ` +
      `(data=${formatMb(size.dataLength)}MB index=${formatMb(size.indexLength)}MB ` +
      `free=${formatMb(size.dataFree)}MB) of ${formatMb(QUOTA_BYTES)}MB quota`,
  );
}

/**
 * Pass 1: redact embedded base64 image bytes out of rows older than
 * `cutoff`. See redactParts() in ./chatImageRedaction.js for the per-row
 * logic; this just does the DB scan/update loop around it.
 */
async function runImageRedactionPass(pool, cutoff) {
  let scanned = 0;
  let redacted = 0;
  let bytesFreed = 0;

  // parts LIKE '%base64%' is a cheap pre-filter so we only JSON.parse rows
  // that plausibly still contain embedded image data — this is what makes
  // repeated runs cheap/idempotent (already-redacted rows drop out here).
  const [rows] = await pool.query(
    `SELECT id, parts FROM chat_messages WHERE created_at < ? AND parts LIKE '%base64%'`,
    [toMysqlDatetime(cutoff)],
  );

  for (const row of rows) {
    scanned++;
    let parsed;
    try {
      parsed = JSON.parse(row.parts);
    } catch (err) {
      console.error(
        `[redact-chat-images] row ${row.id}: failed to parse parts, skipping (image pass)`,
        err,
      );
      continue;
    }

    const { parts: nextParts, changed } = redactParts(parsed);
    if (!changed) continue;

    const nextJson = JSON.stringify(nextParts);
    bytesFreed += Buffer.byteLength(row.parts, 'utf8') - Buffer.byteLength(nextJson, 'utf8');

    await pool.query('UPDATE chat_messages SET parts = ? WHERE id = ?', [nextJson, row.id]);
    redacted++;
  }

  return { scanned, redacted, bytesFreed };
}

/**
 * Pass 2: strip bulky tool-call input/output/result payloads out of `tool-*`
 * parts in rows older than `cutoff`. See trimToolPayloads() in
 * ./chatImageRedaction.js for the per-row logic and the "why this is the
 * pass that actually matters" explanation.
 */
async function runToolPayloadTrimPass(pool, cutoff) {
  let scanned = 0;
  let trimmed = 0;
  let bytesFreed = 0;

  // Cheap pre-filter mirroring the image pass's `%base64%` trick: the AI SDK
  // always serializes a part's `type` key before its other keys, so a
  // tool-call part's JSON starts `{"type":"tool-...`. Rows that don't match
  // this (already-trimmed, or never had tool parts) skip the JSON.parse.
  const [rows] = await pool.query(
    `SELECT id, parts FROM chat_messages WHERE created_at < ? AND parts LIKE '%"type":"tool-%'`,
    [toMysqlDatetime(cutoff)],
  );

  for (const row of rows) {
    scanned++;
    let parsed;
    try {
      parsed = JSON.parse(row.parts);
    } catch (err) {
      console.error(
        `[redact-chat-images] row ${row.id}: failed to parse parts, skipping (tool-payload pass)`,
        err,
      );
      continue;
    }

    const { parts: nextParts, changed } = trimToolPayloads(parsed);
    if (!changed) continue;

    const nextJson = JSON.stringify(nextParts);
    bytesFreed += Buffer.byteLength(row.parts, 'utf8') - Buffer.byteLength(nextJson, 'utf8');

    await pool.query('UPDATE chat_messages SET parts = ? WHERE id = ?', [nextJson, row.id]);
    trimmed++;
  }

  return { scanned, trimmed, bytesFreed };
}

/**
 * Run OPTIMIZE TABLE chat_messages so freed InnoDB pages actually shrink
 * data_length instead of lingering as data_free (see incident notes: 3.00 MB
 * of stale data_free alone counted against the quota because this had never
 * been run).
 *
 * The catch-22 this guards against: OPTIMIZE TABLE on InnoDB works by
 * rebuilding the table (copy-to-new-table-then-swap), which requires the
 * INSERT privilege. If the DB is ALREADY in the revoked state (the exact
 * failure mode this whole job exists to prevent), OPTIMIZE TABLE itself will
 * fail with ER_TABLEACCESS_DENIED_ERROR (MySQL error 1142) — this job cannot
 * use OPTIMIZE to dig the DB out of a hole it's already in. In that case the
 * only ways out are something that doesn't need INSERT (TRUNCATE, deleting
 * rows via DELETE, or an ALTER-based shrink) or a JawsDB plan upgrade, done
 * OUTSIDE this job, before INSERT is restored — after which OPTIMIZE (or
 * this job) can run normally again.
 *
 * `pool` and `log` are parameters (rather than reading the module-level pool
 * / console directly) specifically so this is unit-testable with a fake pool
 * that throws a simulated 1142 — see redactOldChatImages.test.js.
 */
async function optimizeTable(pool, log = console) {
  try {
    await pool.query('OPTIMIZE TABLE chat_messages');
    log.log('[redact-chat-images] OPTIMIZE TABLE chat_messages complete.');
    return { ok: true };
  } catch (err) {
    if (isInsertPrivilegeError(err)) {
      log.error(
        '[redact-chat-images] OPTIMIZE TABLE chat_messages FAILED: INSERT privilege is ' +
          'revoked (ER_TABLEACCESS_DENIED_ERROR / 1142), almost certainly because the DB is ' +
          'already over the JawsDB quota. This is a catch-22: OPTIMIZE TABLE on InnoDB is a ' +
          'table rebuild and itself requires INSERT, so it cannot be used to recover a DB ' +
          "that's already in this state. Freed pages will stay counted as data_free until " +
          'the quota is brought down some OTHER way first (e.g. TRUNCATE chat_messages if ' +
          'acceptable, DELETE old rows, or a JawsDB plan upgrade) to get INSERT restored — ' +
          'then re-run OPTIMIZE TABLE chat_messages (or this job) manually. Continuing the ' +
          'rest of this job without optimizing; this is not treated as a fatal error so the ' +
          'redaction/trim passes above still land.',
      );
      return { ok: false, reason: 'insert_privilege_revoked' };
    }
    // Any other error here is unexpected (e.g. lock timeout, connection
    // drop) and should surface loudly rather than being silently swallowed —
    // only the specific, anticipated quota catch-22 above is non-fatal.
    throw err;
  }
}

async function run() {
  const pool = await connect();
  const now = new Date();

  const imageRetentionHours = envPositiveInt('CHAT_IMAGE_RETENTION_HOURS', 6);
  const toolPayloadRetentionDays = envPositiveInt('CHAT_TOOLPAYLOAD_RETENTION_DAYS', 7);
  const imageCutoff = hoursAgo(now, imageRetentionHours);
  const toolPayloadCutoff = daysAgo(now, toolPayloadRetentionDays);

  console.log(
    `[redact-chat-images] image cutoff: created_at < ${toMysqlDatetime(imageCutoff)} ` +
      `(${imageRetentionHours}h)`,
  );
  console.log(
    `[redact-chat-images] tool-payload cutoff: created_at < ${toMysqlDatetime(toolPayloadCutoff)} ` +
      `(${toolPayloadRetentionDays}d)`,
  );

  try {
    let sizeBefore = null;
    try {
      sizeBefore = await getDbSizeBytes(pool);
      logSize('before', sizeBefore);
    } catch (err) {
      console.error('[redact-chat-images] failed to measure DB size before cleanup:', err);
    }

    const imageStats = await runImageRedactionPass(pool, imageCutoff);
    console.log(
      `[redact-chat-images] images: scanned=${imageStats.scanned} redacted=${imageStats.redacted} ` +
        `bytesFreed=${imageStats.bytesFreed}`,
    );

    const toolStats = await runToolPayloadTrimPass(pool, toolPayloadCutoff);
    console.log(
      `[redact-chat-images] tool payloads: scanned=${toolStats.scanned} trimmed=${toolStats.trimmed} ` +
        `bytesFreed=${toolStats.bytesFreed}`,
    );

    await optimizeTable(pool);

    let sizeAfter = null;
    try {
      sizeAfter = await getDbSizeBytes(pool);
      logSize('after', sizeAfter);
    } catch (err) {
      console.error('[redact-chat-images] failed to measure DB size after cleanup:', err);
    }

    if (sizeAfter && sizeAfter.total >= QUOTA_BYTES * WARN_RATIO) {
      console.warn(
        `[redact-chat-images] WARNING: DB size ${formatMb(sizeAfter.total)}MB is at or above ` +
          `${Math.round(WARN_RATIO * 100)}% of the ${formatMb(QUOTA_BYTES)}MB JawsDB quota. ` +
          'If this keeps climbing, INSERT will be revoked again — investigate before that ' +
          'happens, do not wait for the next incident.',
      );
    }
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  run().catch((err) => {
    console.error('[redact-chat-images] failed:', err);
    process.exit(1);
  });
}

module.exports = {
  run,
  envPositiveInt,
  hoursAgo,
  daysAgo,
  toMysqlDatetime,
  getDbSizeBytes,
  runImageRedactionPass,
  runToolPayloadTrimPass,
  optimizeTable,
  QUOTA_BYTES,
  WARN_RATIO,
};
