import { Router } from 'express';
import { z } from 'zod';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { authenticateToken } from './auth';
import { User } from '../types';
import pool from '../database';

const router = Router();
router.use(authenticateToken);

const feedbackSchema = z.object({
  category: z.enum(['bug', 'idea', 'other']).optional(),
  message: z.string().min(1).max(4000),
});

type FeedbackBody = z.infer<typeof feedbackSchema>;

/** Derive the owner/repo string from the GITHUB_REPO env var or default. */
function getGithubRepo(): string {
  return process.env.GITHUB_REPO ?? 'naasanov/workout-log';
}

/** Create a GitHub issue for the submitted feedback. Best-effort — never throws. */
async function createGithubIssue(
  body: FeedbackBody,
  submitterEmail: string,
): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return;

  try {
    const repo = getGithubRepo();
    const excerpt = body.message.slice(0, 60).replace(/\n/g, ' ');
    const categoryLabel = body.category ?? 'other';
    const title = `[${categoryLabel}] ${excerpt}${body.message.length > 60 ? '...' : ''}`;

    const issueBody =
      `**Category:** ${categoryLabel}\n` +
      `**Submitted by:** ${submitterEmail}\n\n` +
      `---\n\n${body.message}`;

    await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        title,
        body: issueBody,
        labels: [categoryLabel],
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    console.error('[feedback] GitHub issue creation failed:', err);
  }
}

/** POST /feedback */
router.post('/', async (req, res): Promise<any> => {
  const { uuid }: User = res.locals.user;

  const parsed = feedbackSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: parsed.error.issues[0]?.message ?? 'Invalid request body' });
  }

  const { category, message } = parsed.data;

  // Always insert into the DB (record + fallback)
  try {
    await pool.query<ResultSetHeader>(
      `INSERT INTO feedback (user_uuid, category, message) VALUES (UUID_TO_BIN(?), ?, ?)`,
      [uuid, category ?? null, message],
    );
  } catch (err) {
    console.error('[feedback] DB insert failed:', err);
    return res.status(500).json({ message: 'Failed to save feedback' });
  }

  // Lookup submitter email for the GitHub issue body (best-effort)
  let submitterEmail = 'unknown';
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT email FROM users WHERE user_uuid = UUID_TO_BIN(?)`,
      [uuid],
    );
    if (rows.length > 0) submitterEmail = rows[0].email as string;
  } catch {
    // ignore
  }

  // Fire-and-forget GitHub issue creation
  createGithubIssue(parsed.data, submitterEmail).catch(() => {});

  return res.status(200).json({ message: 'Feedback received. Thank you!' });
});

export default router;
