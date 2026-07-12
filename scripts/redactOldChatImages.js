// Nightly retention job: strips embedded base64 image data out of old
// chat_messages rows to keep the DB from filling up with photo bytes.
//
// Root cause: chat photos (food photos, barcode-scan screenshots) are stored
// as full base64 data URIs directly inside chat_messages.parts (JSON). With
// no retention policy this exceeded the JawsDB free-tier 5MB quota and put
// the whole database into read-only mode (login/writes failing). That
// incident was resolved manually in prod; this script prevents recurrence
// going forward by redacting image bytes out of rows 2+ days old, on a
// schedule (see README note below / PR description for the required Heroku
// Scheduler setup — this script does not schedule itself).
//
// Safety: only rows with `date < (today UTC - 1 day)` are touched, i.e. we
// never redact "today" or "yesterday" — same-day / just-yesterday
// conversations always resume with images fully intact. Redacted parts are
// replaced with a small marker (`data-imageRedacted` / `imageRedacted: true`)
// rather than being silently dropped, so the client can render a "photo no
// longer available" note instead of the attachment just vanishing.
//
// Run manually with: node scripts/redactOldChatImages.js
// (Same connection convention as scripts/migrate.js: JAWSDB_URL if set,
// otherwise discrete DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD/DB_NAME env
// vars, matching database.ts.)
'use strict';

const mysql = require('mysql2/promise');
const { redactParts } = require('./chatImageRedaction');

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

/** Today (UTC) minus 1 day, as YYYY-MM-DD — rows with date < this are redacted. */
function cutoffDate(now = new Date()) {
  const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const cutoff = new Date(utcMidnight - 24 * 60 * 60 * 1000);
  return cutoff.toISOString().slice(0, 10);
}

async function run() {
  const pool = await connect();
  const cutoff = cutoffDate();
  console.log(`[redact-chat-images] cutoff date: rows with date < ${cutoff}`);

  let scanned = 0;
  let redacted = 0;
  let bytesFreed = 0;

  try {
    // parts LIKE '%base64%' is a cheap pre-filter so we only JSON.parse rows
    // that plausibly still contain embedded image data — this is what makes
    // repeated runs cheap/idempotent (already-redacted rows drop out here).
    const [rows] = await pool.query(
      `SELECT id, parts FROM chat_messages WHERE date < ? AND parts LIKE '%base64%'`,
      [cutoff],
    );

    for (const row of rows) {
      scanned++;
      let parsed;
      try {
        parsed = JSON.parse(row.parts);
      } catch (err) {
        console.error(`[redact-chat-images] row ${row.id}: failed to parse parts, skipping`, err);
        continue;
      }

      const { parts: nextParts, changed } = redactParts(parsed);
      if (!changed) continue;

      const nextJson = JSON.stringify(nextParts);
      bytesFreed += Buffer.byteLength(row.parts, 'utf8') - Buffer.byteLength(nextJson, 'utf8');

      await pool.query('UPDATE chat_messages SET parts = ? WHERE id = ?', [nextJson, row.id]);
      redacted++;
    }
  } finally {
    await pool.end();
  }

  console.log(
    `[redact-chat-images] scanned=${scanned} redacted=${redacted} bytesFreed=${bytesFreed}`,
  );
}

if (require.main === module) {
  run().catch((err) => {
    console.error('[redact-chat-images] failed:', err);
    process.exit(1);
  });
}

module.exports = { run, cutoffDate };
