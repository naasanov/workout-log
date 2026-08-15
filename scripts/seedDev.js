// Applies seeds/dev_user.sql (the standing dev@dev.com / dev account) against whichever DB
// scripts/migrate.js would target — JAWSDB_URL if set, otherwise the local DB_* vars.
//
// This is deliberately a separate script from migrate.js rather than folded into initdb or
// run implicitly: seeding requires the `users` table to already exist, so it must run
// *after* migrations, and it must never run against production by accident. Only run this
// against a local/dev database.
const fs = require('fs');
const path = require('path');
const { getConnectionConfig, connectWithRetry } = require('./migrate');

async function run() {
  const conn = await connectWithRetry(getConnectionConfig());
  console.log('Connected to database');

  const file = path.join(__dirname, '../seeds/dev_user.sql');
  const sql = fs.readFileSync(file, 'utf8');
  const statements = sql.split(';').map(s => s.trim()).filter(Boolean);

  for (const stmt of statements) {
    await conn.execute(stmt);
  }

  await conn.end();
  console.log('Seeded dev user (dev@dev.com / dev)');
}

run().catch(err => { console.error(err); process.exit(1); });
