import { Router } from 'express';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { authenticateToken } from './auth';
import { User } from '../types';
import pool from '../database';
import handleSqlError from '../utils/handleSqlError';

const router = Router();
router.use(authenticateToken);

// #296: up to 3 image attachments, sent as data URLs and capped at ~5MB
// decoded each — comfortably under the 10mb express.json body limit for 3
// downscaled (max-1024px) client-side JPEGs.
const MAX_ATTACHMENTS = 3;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const DATA_URL_RE = /^data:image\/(png|jpeg|webp);base64,/;

/** Approximate decoded byte length of a base64 data URL's payload. */
function decodedByteLength(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

const feedbackSchema = z.object({
  category: z.enum(['bug', 'idea', 'ui', 'other']).optional(),
  // #215: which tab/tool the feedback concerns. Free-form-ish but constrained
  // to the client's known values (the four tabs, or 'other').
  tool: z.string().min(1).max(32).optional(),
  // #266: explicit messages — zod's defaults ("String must contain at
  // most 4000 character(s)") surface as-is via the 400 body below, so they
  // need to already read like something a user should see.
  message: z.string()
    .min(1, 'Please add a message.')
    .max(4000, 'Message is too long — please keep it under 4000 characters.'),
  // #296: same explicit-message convention as above — parsed.error.issues[0]
  // is returned verbatim in the 400 body and shown to the user.
  attachments: z
    .array(
      z.string()
        .refine((val) => DATA_URL_RE.test(val), 'Attachments must be a PNG, JPEG, or WEBP image.')
        .refine(
          (val) => decodedByteLength(val) <= MAX_ATTACHMENT_BYTES,
          'Each attachment must be smaller than 5MB.',
        ),
    )
    .max(MAX_ATTACHMENTS, 'You can attach up to 3 images.')
    .optional(),
});

type FeedbackBody = z.infer<typeof feedbackSchema>;

/** Derive the owner/repo string from the GITHUB_REPO env var or default. */
function getGithubRepo(): string {
  return process.env.GITHUB_REPO ?? 'naasanov/workout-log';
}

/** Extract the full mime type, file extension, and base64 payload from a validated attachment data URL. */
function parseDataUrl(dataUrl: string): { mimeType: string; ext: string; base64: string } {
  const match = dataUrl.match(/^data:image\/(png|jpeg|webp);base64,([\s\S]+)$/);
  if (!match) throw new Error('Invalid attachment data URL');
  const [, subtype, base64] = match;
  return { mimeType: `image/${subtype}`, ext: subtype === 'jpeg' ? 'jpg' : subtype, base64 };
}

const FEEDBACK_ASSETS_BRANCH = 'feedback-assets';

/**
 * Create the feedback-assets branch off master's current head, if it doesn't
 * already exist. GitHub returns 422 when the ref is already there — treated
 * as success so concurrent/repeat calls are safe.
 */
async function ensureFeedbackAssetsBranch(repo: string, token: string): Promise<void> {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  const refRes = await fetch(`https://api.github.com/repos/${repo}/git/ref/heads/master`, {
    headers,
    signal: AbortSignal.timeout(8000),
  });
  if (!refRes.ok) throw new Error(`Failed to read master ref: ${refRes.status}`);
  const refData = (await refRes.json()) as { object: { sha: string } };

  const createRes = await fetch(`https://api.github.com/repos/${repo}/git/refs`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: `refs/heads/${FEEDBACK_ASSETS_BRANCH}`, sha: refData.object.sha }),
    signal: AbortSignal.timeout(8000),
  });
  // 422 = "Reference already exists" — another submission raced us to it.
  if (createRes.ok || createRes.status === 422) return;
  throw new Error(`Failed to create ${FEEDBACK_ASSETS_BRANCH} branch: ${createRes.status}`);
}

/**
 * Commit one attachment into the feedback-assets branch via the Contents API
 * and return its raw.githubusercontent.com URL. Throws on any failure —
 * callers must catch per-attachment and continue.
 */
async function uploadAttachment(repo: string, token: string, dataUrl: string): Promise<string> {
  const { ext, base64 } = parseDataUrl(dataUrl);
  const day = new Date().toISOString().slice(0, 10);
  const filename = `attachments/${day}-${randomBytes(8).toString('hex')}.${ext}`;

  await ensureFeedbackAssetsBranch(repo, token);

  const putRes = await fetch(
    `https://api.github.com/repos/${repo}/contents/${filename}?branch=${FEEDBACK_ASSETS_BRANCH}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        message: `feedback attachment ${filename}`,
        content: base64,
        branch: FEEDBACK_ASSETS_BRANCH,
      }),
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!putRes.ok) throw new Error(`Failed to upload attachment: ${putRes.status}`);

  return `https://raw.githubusercontent.com/${repo}/${FEEDBACK_ASSETS_BRANCH}/${filename}`;
}

type AttachmentRow = { id: number; dataUrl: string };

/**
 * Create a GitHub issue for the submitted feedback and record its issue
 * number on the feedback row. Best-effort — never throws; a GitHub or DB
 * failure here must not affect the already-saved feedback submission.
 */
async function createGithubIssue(
  feedbackId: number,
  body: FeedbackBody,
  submitterEmail: string,
  attachmentRows: AttachmentRow[],
): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return;

  try {
    const repo = getGithubRepo();
    const excerpt = body.message.slice(0, 60).replace(/\n/g, ' ');
    const categoryLabel = body.category ?? 'other';
    const tool = body.tool ?? 'other';
    const title = `[${categoryLabel}][${tool}] ${excerpt}${body.message.length > 60 ? '...' : ''}`;

    // Upload attachments (if any) and turn them into markdown image links.
    // A failed upload is noted in the issue body rather than aborting —
    // the feedback row and its attachment bytes are already saved in the DB.
    let attachmentSection = '';
    if (attachmentRows.length > 0) {
      const links: string[] = [];
      let failures = 0;
      for (const row of attachmentRows) {
        try {
          const url = await uploadAttachment(repo, token, row.dataUrl);
          links.push(`![screenshot](${url})`);
          pool.query(
            `UPDATE feedback_attachments SET github_url = ? WHERE id = ?`,
            [url, row.id],
          ).catch((err) => console.error('[feedback] failed to record attachment url:', err));
        } catch (err) {
          failures += 1;
          console.error('[feedback] attachment upload failed:', err);
        }
      }
      if (links.length > 0) attachmentSection += `\n\n${links.join('\n\n')}`;
      if (failures > 0) {
        attachmentSection += `\n\n_(${failures} attachment${failures > 1 ? 's' : ''} failed to upload)_`;
      }
    }

    const issueBody =
      `**Category:** ${categoryLabel}\n` +
      `**Tool:** ${tool}\n` +
      `**Submitted by:** ${submitterEmail}\n\n` +
      `---\n\n${body.message}${attachmentSection}`;

    const issueRes = await fetch(`https://api.github.com/repos/${repo}/issues`, {
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

    if (!issueRes.ok) {
      console.error(`[feedback] issue creation failed: ${issueRes.status}`);
      return;
    }

    const issueData = (await issueRes.json()) as { number?: number };
    if (typeof issueData.number !== 'number') {
      console.error('[feedback] issue creation response had no number');
      return;
    }

    await pool.query(
      `UPDATE feedback SET issue_number = ? WHERE id = ?`,
      [issueData.number, feedbackId],
    );
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

  const { category, tool, message, attachments } = parsed.data;

  // Always insert into the DB (record + fallback)
  let feedbackId: number;
  try {
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO feedback (user_uuid, category, tool, message) VALUES (UUID_TO_BIN(?), ?, ?, ?)`,
      [uuid, category ?? null, tool ?? null, message],
    );
    feedbackId = result.insertId;
  } catch (err) {
    console.error('[feedback] DB insert failed:', err);
    return res.status(500).json({ message: 'Failed to save feedback' });
  }

  // Persist attachment bytes alongside the feedback row. Best-effort: a
  // failed insert here doesn't undo the already-saved feedback message.
  const attachmentRows: AttachmentRow[] = [];
  for (const dataUrl of attachments ?? []) {
    try {
      const { mimeType, base64 } = parseDataUrl(dataUrl);
      const [result] = await pool.query<ResultSetHeader>(
        `INSERT INTO feedback_attachments (feedback_id, mime_type, image_data) VALUES (?, ?, ?)`,
        [feedbackId, mimeType, Buffer.from(base64, 'base64')],
      );
      attachmentRows.push({ id: result.insertId, dataUrl });
    } catch (err) {
      console.error('[feedback] attachment insert failed:', err);
    }
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
  createGithubIssue(feedbackId, parsed.data, submitterEmail, attachmentRows).catch(() => {});

  return res.status(200).json({ message: 'Feedback received. Thank you!' });
});

/**
 * GET /my-issues — the signed-in user's own feedback submissions that made
 * it to a GitHub issue, as a plain array of issue numbers. Used to badge
 * changelog bullets the user reported; deliberately minimal (no messages,
 * no other users' rows).
 */
router.get('/my-issues', async (req, res): Promise<any> => {
  const { uuid }: User = res.locals.user;

  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT issue_number FROM feedback WHERE user_uuid = UUID_TO_BIN(?) AND issue_number IS NOT NULL`,
      [uuid],
    );
    return res.status(200).json(rows.map((row) => row.issue_number as number));
  } catch (error) {
    return handleSqlError(error, res);
  }
});

export default router;
