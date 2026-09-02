// One-off backfill for feedback.issue_number (migrations/021), a column
// added after some feedback rows already existed. Those older rows never
// got their mirrored GitHub issue's number recorded, so this script matches
// each of them to its issue after the fact and fills the column in.
//
// Matching is by content, not by any stored id: routes/feedback.ts writes
// each issue's body as `**Submitted by:** <email>` followed by a `---`
// separator and then the feedback message verbatim, so a row's (message,
// submitter email) pair should uniquely identify its issue among all of the
// repo's issues (open and closed).
//
// Dry-run by default — prints what it would change and does nothing. Pass
// --apply to actually write. Safe to re-run: only rows with issue_number
// IS NULL are considered, so an already-backfilled row is never touched
// again, and a row this run can't match unambiguously is simply reported
// and left alone rather than guessed at.
//
// Connection convention matches scripts/migrate.js: JAWSDB_URL if set,
// otherwise the discrete DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD/DB_NAME
// vars. This does NOT load .env, same as migrate.js.
//
// Run manually — this hits the GitHub API and is deliberately not wired
// into the Procfile release phase:
//   node scripts/backfillFeedbackIssueNumbers.js            (dry run)
//   node scripts/backfillFeedbackIssueNumbers.js --apply     (writes)
'use strict';

const { getConnectionConfig, connectWithRetry } = require('./migrate');

/** Derive the owner/repo string from the GITHUB_REPO env var or default, matching routes/feedback.ts. */
function getGithubRepo() {
  return process.env.GITHUB_REPO || 'naasanov/workout-log';
}

/**
 * Fetch every issue in the repo (open and closed, PRs excluded), paginated.
 * Returns [{ number, body }]. Throws on a non-OK response so callers can
 * treat "couldn't reach GitHub" as a hard stop rather than silently
 * matching against a partial issue list.
 */
async function fetchAllIssues(repo, token) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  const issues = [];
  let page = 1;
  const perPage = 100;

  for (;;) {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/issues?state=all&per_page=${perPage}&page=${page}`,
      { headers, signal: AbortSignal.timeout(15000) },
    );
    if (!res.ok) {
      throw new Error(`GitHub issues list failed: ${res.status} ${await res.text().catch(() => '')}`);
    }
    const batch = await res.json();
    for (const item of batch) {
      // The issues endpoint also returns pull requests; those carry a
      // `pull_request` key that plain issues don't.
      if (!item.pull_request) issues.push({ number: item.number, body: item.body || '' });
    }
    if (batch.length < perPage) break;
    page += 1;
  }

  return issues;
}

/** Extract the `**Submitted by:** <email>` line's email from an issue body, or null. */
function extractSubmitter(body) {
  const match = body.match(/\*\*Submitted by:\*\*\s*(\S+)/);
  return match ? match[1].trim() : null;
}

/**
 * Find every issue whose body contains `message` verbatim and whose
 * submitter line matches `email`. Zero, one, or many matches are all
 * possible — callers decide what to do with each case.
 */
function findCandidateIssues(issues, message, email) {
  return issues.filter((issue) => {
    if (!issue.body.includes(message)) return false;
    return extractSubmitter(issue.body) === email;
  });
}

async function loadUnbackfilledRows(conn) {
  const [rows] = await conn.execute(`
    SELECT f.id, f.message, u.email
    FROM feedback f
    JOIN users u ON u.user_uuid = f.user_uuid
    WHERE f.issue_number IS NULL
    ORDER BY f.id
  `);
  return rows;
}

async function run() {
  const apply = process.argv.includes('--apply');
  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    console.log(
      '[backfill-feedback-issue-numbers] No GITHUB_TOKEN set — cannot query the GitHub API. ' +
        'Nothing to do; exiting cleanly.',
    );
    return;
  }

  const conn = await connectWithRetry(getConnectionConfig());
  console.log('[backfill-feedback-issue-numbers] Connected to database');

  try {
    const rows = await loadUnbackfilledRows(conn);
    console.log(`[backfill-feedback-issue-numbers] ${rows.length} feedback row(s) missing issue_number`);
    if (rows.length === 0) return;

    const repo = getGithubRepo();
    console.log(`[backfill-feedback-issue-numbers] Fetching issues from ${repo}...`);
    const issues = await fetchAllIssues(repo, token);
    console.log(`[backfill-feedback-issue-numbers] Fetched ${issues.length} issue(s)`);

    const matched = [];
    const ambiguous = [];
    const unmatched = [];

    for (const row of rows) {
      const candidates = findCandidateIssues(issues, row.message, row.email);
      if (candidates.length === 1) {
        matched.push({ id: row.id, issueNumber: candidates[0].number });
      } else if (candidates.length === 0) {
        unmatched.push(row.id);
      } else {
        ambiguous.push({ id: row.id, candidates: candidates.map((c) => c.number) });
      }
    }

    console.log(`[backfill-feedback-issue-numbers] matched=${matched.length} ambiguous=${ambiguous.length} unmatched=${unmatched.length}`);
    for (const m of matched) {
      console.log(`  feedback #${m.id} -> issue #${m.issueNumber}`);
    }
    for (const a of ambiguous) {
      console.log(`  AMBIGUOUS feedback #${a.id} -> candidates [${a.candidates.join(', ')}] (skipped, not written)`);
    }
    for (const u of unmatched) {
      console.log(`  UNMATCHED feedback #${u} (no candidate issue found, skipped)`);
    }

    if (!apply) {
      console.log('[backfill-feedback-issue-numbers] Dry run — no rows written. Pass --apply to write.');
      return;
    }

    for (const m of matched) {
      await conn.execute('UPDATE feedback SET issue_number = ? WHERE id = ?', [m.issueNumber, m.id]);
    }
    console.log(`[backfill-feedback-issue-numbers] Wrote issue_number for ${matched.length} row(s).`);
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  run().catch((err) => {
    console.error('[backfill-feedback-issue-numbers] failed:', err);
    process.exit(1);
  });
}

module.exports = { fetchAllIssues, extractSubmitter, findCandidateIssues, getGithubRepo };
