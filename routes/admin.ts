import { Router } from 'express';
import { authenticateToken } from './auth';
import { getUserEmail, getOwnerUsageReport } from '../services/nutrition/usage';
import handleSqlError from '../utils/handleSqlError';
import { User } from '../types';

const router = Router();
router.use(authenticateToken);

const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_RANGE_DAYS = 30;

/**
 * OWNER_EMAIL may hold either the owner's email or their raw user uuid, so
 * one env var covers both identification styles without hardcoding an
 * address in source. Comparison is case-insensitive on both sides.
 */
function isOwner(ownerId: string, userUuid: string, userEmail: string | null): boolean {
  const target = ownerId.trim().toLowerCase();
  if (userEmail && userEmail.toLowerCase() === target) return true;
  return userUuid.toLowerCase() === target;
}

function defaultFrom(): string {
  const d = new Date(Date.now() - (DEFAULT_RANGE_DAYS - 1) * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function defaultTo(): string {
  return new Date().toISOString().slice(0, 10);
}

// GET /usage?from=YYYY-MM-DD&to=YYYY-MM-DD -- aggregate AI usage (totals + a
// daily series) for the repo owner only. Every other authenticated user, and
// every unauthenticated request, gets 404 rather than 403 so the endpoint's
// existence isn't disclosed -- same convention as routes/flags.ts's PATCH /
// and routes/nutrition.ts's GET /usage all-users view. Closed by default:
// unset OWNER_EMAIL means nobody can reach this.
router.get('/usage', async (req, res): Promise<any> => {
  const { uuid }: User = res.locals.user;

  const ownerId = process.env.OWNER_EMAIL;
  if (!ownerId) {
    return res.status(404).json({ message: 'Not found' });
  }
  const callerEmail = await getUserEmail(uuid);
  if (!isOwner(ownerId, uuid, callerEmail)) {
    return res.status(404).json({ message: 'Not found' });
  }

  const fromParam = req.query.from;
  const toParam = req.query.to;
  if (fromParam !== undefined && (typeof fromParam !== 'string' || !BARE_DATE.test(fromParam))) {
    return res.status(400).json({ message: 'from must be in YYYY-MM-DD format' });
  }
  if (toParam !== undefined && (typeof toParam !== 'string' || !BARE_DATE.test(toParam))) {
    return res.status(400).json({ message: 'to must be in YYYY-MM-DD format' });
  }
  const from = (fromParam as string | undefined) ?? defaultFrom();
  const to = (toParam as string | undefined) ?? defaultTo();

  try {
    const data = await getOwnerUsageReport(from, to);
    return res.status(200).json({ data: { from, to, ...data }, message: 'AI usage report retrieved' });
  } catch (error) {
    return handleSqlError(error, res);
  }
});

export default router;
