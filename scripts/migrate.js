const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// Parse mysql://user:pass@host:port/db
function parseUrl(url) {
  const m = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!m) throw new Error('Invalid JAWSDB_URL format');
  return { user: m[1], password: m[2], host: m[3], port: parseInt(m[4]), database: m[5] };
}

// Mirrors database.ts's precedence exactly: JAWSDB_URL (Heroku/production) wins whenever
// it's set, full stop. DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD/DB_NAME are only a fallback
// for local dev (docker-compose), so that `npm run migrate` can be pointed at the local
// MySQL container the same way the server already can be.
function getConnectionConfig() {
  if (process.env.JAWSDB_URL !== undefined) {
    return parseUrl(process.env.JAWSDB_URL);
  }
  return {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 3306,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Splits a migration file into individual statements on top-level semicolons,
// skipping semicolons inside `--` line comments, `/* */` block comments, and
// single- or double-quoted string literals (doubled '' / "" and backslash
// escapes are treated as staying inside the literal). Statements come back
// trimmed with empties dropped. DELIMITER-based stored-procedure bodies are
// out of scope and cause a loud failure rather than a silently mangled split.
function splitStatements(sql) {
  if (/^\s*DELIMITER\b/im.test(sql)) {
    throw new Error('splitStatements does not support DELIMITER; this migration needs manual handling');
  }

  const statements = [];
  let current = '';
  let state = 'normal'; // normal | single | double | line-comment | block-comment
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (state === 'normal') {
      if (ch === "'") {
        state = 'single';
        current += ch;
        i += 1;
      } else if (ch === '"') {
        state = 'double';
        current += ch;
        i += 1;
      } else if (ch === '-' && next === '-') {
        state = 'line-comment';
        current += ch + next;
        i += 2;
      } else if (ch === '/' && next === '*') {
        state = 'block-comment';
        current += ch + next;
        i += 2;
      } else if (ch === ';') {
        const trimmed = current.trim();
        if (trimmed) statements.push(trimmed);
        current = '';
        i += 1;
      } else {
        current += ch;
        i += 1;
      }
    } else if (state === 'single' || state === 'double') {
      const quote = state === 'single' ? "'" : '"';
      if (ch === '\\' && next !== undefined) {
        current += ch + next;
        i += 2;
      } else if (ch === quote && next === quote) {
        current += ch + next;
        i += 2;
      } else if (ch === quote) {
        state = 'normal';
        current += ch;
        i += 1;
      } else {
        current += ch;
        i += 1;
      }
    } else if (state === 'line-comment') {
      current += ch;
      i += 1;
      if (ch === '\n') state = 'normal';
    } else {
      // block-comment
      if (ch === '*' && next === '/') {
        current += ch + next;
        i += 2;
        state = 'normal';
      } else {
        current += ch;
        i += 1;
      }
    }
  }

  const trimmed = current.trim();
  if (trimmed) statements.push(trimmed);
  return statements;
}

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
  const conn = await connectWithRetry(getConnectionConfig());
  console.log('Connected to database');

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(255) PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const [applied] = await conn.execute('SELECT filename FROM schema_migrations');
  const appliedSet = new Set(applied.map(r => r.filename));

  // MIGRATIONS_DIR lets tests point this at scratch fixture files instead of
  // the real migrations directory. Unset in production, so the Heroku release
  // phase always uses the real ../migrations.
  const migrationsDir = process.env.MIGRATIONS_DIR
    ? path.resolve(process.env.MIGRATIONS_DIR)
    : path.join(__dirname, '../migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

  for (const file of files) {
    if (appliedSet.has(file)) {
      console.log(`  skip  ${file}`);
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const statements = splitStatements(sql);

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

    // Abort immediately rather than trying later files: migrations are ordered
    // and later ones commonly depend on schema this one was supposed to create,
    // so continuing would risk a confusing cascade of unrelated-looking errors.
    if (failed) {
      await conn.end();
      throw new Error(`Migration ${file} failed; aborting before any later migration runs`);
    }

    await conn.execute('INSERT INTO schema_migrations (filename) VALUES (?)', [file]);
    console.log(`  apply ${file}`);
  }

  await conn.end();
  console.log('Done');
}

// Only auto-run when invoked directly (`node scripts/migrate.js` / `npm run migrate`,
// including the Heroku release-phase Procfile entry). When required as a module — e.g. by
// scripts/seedDev.js, which wants the same JAWSDB_URL/DB_* connection logic without
// re-running migrations — just export the helpers.
if (require.main === module) {
  run().catch(err => { console.error(err); process.exit(1); });
}

module.exports = { getConnectionConfig, connectWithRetry, splitStatements };
