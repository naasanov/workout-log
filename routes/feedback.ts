import { Router, Request } from 'express';
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

/**
 * Base URL for links back into this app (e.g. attachment images in a GitHub
 * issue body). Prefers PUBLIC_APP_URL; otherwise derives it from the
 * request, since index.ts sets no `trust proxy` and req.protocol/hostname
 * would report Heroku's internal http rather than what the client used.
 */
function resolveBaseUrl(req: Request): string {
  const configured = process.env.PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/+$/, '');
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() ?? req.protocol;
  return `${proto}://${req.headers.host}`;
}

type AttachmentRow = { token: string };

/**
 * Build the GitHub issue title: `[submitter][category][tool] excerpt`.
 * `submitterEmail` is the local part before '@' only — the repo is public,
 * so the full address never goes into the title — or `unknown` when the
 * submitter's email couldn't be resolved. Newlines in the message are
 * flattened to spaces and anything past 60 characters is truncated with '...'.
 */
export function buildIssueTitle(body: Pick<FeedbackBody, 'category' | 'tool' | 'message'>, submitterEmail: string): string {
  const excerpt = body.message.slice(0, 60).replace(/\n/g, ' ');
  const categoryLabel = body.category ?? 'other';
  const tool = body.tool ?? 'other';
  const submitterTag = submitterEmail === 'unknown' ? 'unknown' : submitterEmail.split('@')[0];
  return `[${submitterTag}][${categoryLabel}][${tool}] ${excerpt}${body.message.length > 60 ? '...' : ''}`;
}

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
  baseUrl: string,
): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return;

  try {
    const repo = getGithubRepo();
    const categoryLabel = body.category ?? 'other';
    const tool = body.tool ?? 'other';
    const title = buildIssueTitle(body, submitterEmail);

    // Attachments are already saved in the DB (see the POST handler), so the
    // issue body just links back to this app's own public attachment route.
    let attachmentSection = '';
    if (attachmentRows.length > 0) {
      const links = attachmentRows.map(
        (row) => `![screenshot](${baseUrl}/api/feedback/attachments/${row.token})`,
      );
      attachmentSection += `\n\n${links.join('\n\n')}`;
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

  // Persist attachment bytes alongside the feedback row, each keyed by an
  // unguessable token so it can be served back publicly at
  // GET /api/feedback/attachments/:token. Best-effort: a failed insert here
  // doesn't undo the already-saved feedback message.
  const attachmentRows: AttachmentRow[] = [];
  for (const dataUrl of attachments ?? []) {
    try {
      const { mimeType, base64 } = parseDataUrl(dataUrl);
      const publicToken = randomBytes(16).toString('hex');
      await pool.query<ResultSetHeader>(
        `INSERT INTO feedback_attachments (feedback_id, mime_type, image_data, public_token) VALUES (?, ?, ?, ?)`,
        [feedbackId, mimeType, Buffer.from(base64, 'base64'), publicToken],
      );
      attachmentRows.push({ token: publicToken });
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
  createGithubIssue(feedbackId, parsed.data, submitterEmail, attachmentRows, resolveBaseUrl(req)).catch(() => {});

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
