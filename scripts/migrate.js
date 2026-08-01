const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// Parse mysql://user:pass@host:port/db
function parseUrl(url) {
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error('Invalid JAWSDB_URL format');
  return { user: m[1], password: m[2], host: m[3], port: parseInt(m[4]), database: m[5] };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// The old web dyno is still serving traffic during the release phase, so its pool may be
// holding every connection JawsDB allows us. Those free up quickly; retry instead of
// failing the whole deploy on a transient spike.
async function connectWithRetry(config, attempts = 6, delayMs = 5000) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await mysql.createConnection(config);
    } catch (err) {
      const transient = err.code === 'ER_USER_LIMIT_REACHED'
        || err.code === 'ER_CON_COUNT_ERROR'
        || err.code === 'ETIMEDOUT'
        || err.code === 'ECONNREFUSED'
        || err.code === 'ECONNRESET';
      if (!transient || attempt >= attempts) throw err;
      console.log(`  retry connect (${attempt}/${attempts - 1}) after ${err.code}`);
      await sleep(delayMs);
    }
  }
}

async function run() {
  const dbUrl = process.env.JAWSDB_URL;
  if (!dbUrl) throw new Error('JAWSDB_URL not set');

  const conn = await connectWithRetry(parseUrl(dbUrl));
  console.log('Connected to database');

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(255) PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const [applied] = await conn.execute('SELECT filename FROM schema_migrations');
  const appliedSet = new Set(applied.map(r => r.filename));

  const migrationsDir = path.join(__dirname, '../migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

  for (const file of files) {
    if (appliedSet.has(file)) {
      console.log(`  skip  ${file}`);
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const statements = sql.split(';').map(s => s.trim()).filter(Boolean);

    let failed = false;
    for (const stmt of statements) {
      try {
        await conn.execute(stmt);
      } catch (err) {
        // Tolerate "already exists" errors so re-running on a pre-existing DB is safe
        if (err.errno === 1050 || err.errno === 1060) {
          console.log(`  warn  ${file}: ${err.message}`);
        } else {
          console.error(`  ERROR ${file}: ${err.message}`);
          failed = true;
          break;
        }
      }
    }

    if (!failed) {
      await conn.execute('INSERT INTO schema_migrations (filename) VALUES (?)', [file]);
      console.log(`  apply ${file}`);
    }
  }

  await conn.end();
  console.log('Done');
}

run().catch(err => { console.error(err); process.exit(1); });
