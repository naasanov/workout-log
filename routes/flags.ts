import { Router } from 'express';
import { authenticateToken } from './auth';
import { getUserEmail } from '../services/nutrition/usage';
import { getUserFlags, setUserFlag, UserFlags } from '../services/flags';
import { User } from '../types';

const router = Router();
router.use(authenticateToken);

// Allowlist of flag keys that may be set via PATCH — never trust the request
// body's `flag` string directly, since it maps to a column name inside
// setUserFlag.
const KNOWN_FLAGS: (keyof UserFlags)[] = ['unc_dining'];

// GET / — the caller's own feature flags.
router.get('/', async (req, res): Promise<any> => {
  const { uuid }: User = res.locals.user;
  const data = await getUserFlags(uuid);
  res.status(200).json({ data, message: 'Successfully retrieved feature flags' });
});

// PATCH / — owner-only admin toggle for another user's flag, by email.
// Body: { email: string, flag: 'unc_dining', enabled: boolean }
router.patch('/', async (req, res): Promise<any> => {
  const { uuid }: User = res.locals.user;
  const { email, flag, enabled } = req.body as { email?: unknown; flag?: unknown; enabled?: unknown };

  // Owner-only, same check as routes/nutrition.ts's GET /usage: compare
  // OWNER_EMAIL (case-insensitively) against the caller's email. If
  // OWNER_EMAIL is unset or the caller isn't the owner, respond 404 rather
  // than 403 — deliberate, so the existence of this admin endpoint isn't
  // disclosed to non-owners.
  //
  // This check MUST run BEFORE body validation. If it ran after, a non-owner
  // probing with a malformed body would get a 400 while a well-formed one got
  // a 404 — and that difference alone reveals the endpoint exists. Every
  // non-owner request must be indistinguishable from a missing route.
  const ownerEmail = process.env.OWNER_EMAIL;
  if (!ownerEmail) {
    return res.status(404).json({ message: 'Not found' });
  }
  const callerEmail = await getUserEmail(uuid);
  if (!callerEmail || callerEmail.toLowerCase() !== ownerEmail.toLowerCase()) {
    return res.status(404).json({ message: 'Not found' });
  }

  if (typeof email !== 'string' || !email.trim()) {
    return res.status(400).json({ message: 'email must be a non-empty string' });
  }
  if (typeof flag !== 'string' || !KNOWN_FLAGS.includes(flag as keyof UserFlags)) {
    return res.status(400).json({ message: `flag must be one of: ${KNOWN_FLAGS.join(', ')}` });
  }
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ message: 'enabled must be a boolean' });
  }

  let updated: boolean;
  try {
    updated = await setUserFlag(email, flag as keyof UserFlags, enabled);
  } catch (error) {
    console.error('[flags] failed to set user flag:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }

  if (!updated) {
    return res.status(404).json({ message: `No user with email ${email} found` });
  }

  res.status(200).json({
    data: { email, flag, enabled },
    message: `Successfully set ${flag} to ${enabled} for ${email}`,
  });
});

export default router;
