import { Router } from 'express';
import { authenticateToken } from './auth';
import {
  getUserEmail,
  getOwnerUsageReport,
  getDailyUserCosts,
  apportionBilledCost,
  narrowBilledCostToUser,
  toBilledCostReport,
} from '../services/nutrition/usage';
import { getActualCostReport } from '../services/nutrition/openaiCosts';
import handleSqlError from '../utils/handleSqlError';
import { User } from '../types';
import type { OwnerUsageReport } from '../shared/nutritionUsage';

const router = Router();
router.use(authenticateToken);

const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_RANGE_DAYS = 30;

// OWNER_EMAIL holds the owner's email or user uuid, compared case-insensitively.
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

// GET /usage?from=YYYY-MM-DD&to=YYYY-MM-DD: owner-only AI usage totals and daily series.
// Any other signed-in user gets 404, not 403, so the endpoint isn't disclosed, and an
// unset OWNER_EMAIL closes it to everyone. Unauthenticated requests fail auth first.
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

  const userUuidParam = req.query.userUuid;
  if (userUuidParam !== undefined && (typeof userUuidParam !== 'string' || !UUID_FORMAT.test(userUuidParam))) {
    return res.status(400).json({ message: 'userUuid must be a valid uuid' });
  }
  const userUuid = userUuidParam as string | undefined;

  try {
    const data = await getOwnerUsageReport(from, to, userUuid);
    // Actual cost is org/project-wide (OpenAI has no per-user billing split),
    // so it's fetched for the range regardless of the userUuid filter above.
    const actualCost = await getActualCostReport(from, to);

    // Billed cost apportions actualCost's daily totals across users by their
    // estimated-cost share (see apportionBilledCost). Only attempted when the
    // Costs API actually returned data; otherwise the dashboard falls back to
    // each row's own `costUsd` estimate, same as before this feature existed.
    let billedCost = null;
    if (actualCost?.status === 'ok') {
      const estimates = await getDailyUserCosts(from, to);
      const billedByDay = new Map(actualCost.daily.map((d) => [d.date, d.costUsd]));
      const apportioned = apportionBilledCost(estimates, billedByDay);
      billedCost = userUuid ? narrowBilledCostToUser(apportioned, userUuid) : toBilledCostReport(apportioned);
    }

    const report: OwnerUsageReport = { from, to, ...data, actualCost, billedCost };
    return res.status(200).json({
      data: report,
      message: 'AI usage report retrieved',
    });
  } catch (error) {
    return handleSqlError(error, res);
  }
});

export default router;
