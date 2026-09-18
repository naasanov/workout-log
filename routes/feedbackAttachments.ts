import { Router } from 'express';
import { RowDataPacket } from 'mysql2';
import pool from '../database';

const router = Router();

// public_token is CHAR(32) hex, from randomBytes(16).toString('hex').
const TOKEN_RE = /^[0-9a-f]{32}$/;

/**
 * GET /:token — unauthenticated so GitHub's image proxy (and anyone with the
 * link) can fetch a feedback screenshot straight from the DB. The token is
 * unguessable, so knowing it is the access control; no user/session check.
 */
router.get('/:token', async (req, res): Promise<any> => {
  const { token } = req.params;
  if (!TOKEN_RE.test(token)) {
    return res.status(404).end();
  }

  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT mime_type, image_data FROM feedback_attachments WHERE public_token = ?`,
      [token],
    );
    if (rows.length === 0) {
      return res.status(404).end();
    }

    const { mime_type: mimeType, image_data: imageData } = rows[0];
    res.set('Content-Type', mimeType);
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    return res.status(200).send(imageData);
  } catch (err) {
    console.error('[feedbackAttachments] lookup failed:', err);
    return res.status(500).end();
  }
});

export default router;
