import { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { format } from 'date-fns';
import { Info } from 'lucide-react';
import { useAdminUsageReport } from './api';
import { computeRange, DEFAULT_RANGE_DAYS } from './range';
import { formatUsd, formatCompactNumber, formatPercent, formatAverage } from './format';
import type { UserUsageBreakdown } from './types';
import styles from '../../styles/AdminUsageDashboard.module.scss';

interface RangeDef {
  key: string;
  label: string;
  days: number;
}

const RANGE_DEFS: RangeDef[] = [
  { key: '7D', label: '7D', days: 7 },
  { key: '30D', label: '30D', days: DEFAULT_RANGE_DAYS },
  { key: '90D', label: '90D', days: 90 },
];

const CUSTOM_RANGE_KEY = 'CUSTOM';

// ai_usage rows before this date have no cached, step, tool-call or web-search counts
// (summed as 0), and their cost priced all input at the uncached rate.
const USAGE_SCHEMA_CUTOFF = '2026-09-12';

const TOOLTIP_STYLE = {
  backgroundColor: '#282B28',
  border: '1px solid #575757',
  borderRadius: '8px',
  color: '#EBEDE9',
};

// Dark-mode categorical slots 1/2/3 (blue/orange/aqua) validated for CVD and
// normal-vision separation against a dark surface.
const COLOR_UNCACHED = '#3987e5';
const COLOR_CACHED = '#199e70';
const COLOR_OUTPUT = '#d95926';
const COLOR_COST = '#70EB70';
// Dark-mode categorical slot 7 (violet), distinct from every other hue already
// on this dashboard, for the actual-billed-cost series overlaid on COLOR_COST.
const COLOR_ACTUAL_COST = '#9085e9';

// Shortens a uuid for display when a user has no email on file (e.g. a
// deleted account), so the per-user breakdown still identifies the row.
function shortUuid(uuid: string): string {
  return `${uuid.slice(0, 8)}…`;
}

function userLabel(row: UserUsageBreakdown): string {
  return row.email ?? shortUuid(row.userUuid);
}

function AdminUsageDashboard() {
  const [rangeKey, setRangeKey] = useState('30D');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [showCutoffNote, setShowCutoffNote] = useState(false);

  const isCustom = rangeKey === CUSTOM_RANGE_KEY;
  const rangeDef = RANGE_DEFS.find((r) => r.key === rangeKey) ?? RANGE_DEFS[1];
  const presetRange = useMemo(() => computeRange(rangeDef.days), [rangeDef]);

  // Custom dates are the exact YYYY-MM-DD the user picked, passed straight through
  // rather than converted to UTC days like the preset chips (see range.ts).
  const customRangeValid = customFrom !== '' && customTo !== '' && customFrom <= customTo;
  const { from, to } = isCustom ? { from: customFrom, to: customTo } : presetRange;
  // A backwards or incomplete custom range disables the fetch instead of sending
  // it to the server, which would otherwise 400 or silently return nothing.
  const rangeReady = !isCustom || customRangeValid;

  const query = useAdminUsageReport(from, to, rangeReady, userFilter || undefined);
  const report = query.data;
  const totals = report?.totals;
  const byUser = report?.byUser ?? [];

  const actualCost = report?.actualCost ?? null;
  const hasActualCost = actualCost?.status === 'ok';

  // billedCost is non-null exactly when actualCost.status === 'ok' (routes/admin.ts only
  // apportions once the Costs API has returned data), so it's the single flag for whether
  // billed figures replace estimates in the tiles/table/chart below.
  const billedCost = report?.billedCost ?? null;
  const hasBilledCost = !!billedCost;
  const billedByUser = useMemo(
    () => new Map((billedCost?.byUser ?? []).map((u) => [u.userUuid, u.billedCostUsd])),
    [billedCost],
  );

  const dailyChartData = useMemo(() => {
    const actualByDate = new Map((actualCost?.daily ?? []).map((d) => [d.date, d.costUsd]));
    const billedByDate = new Map((billedCost?.daily ?? []).map((d) => [d.day, d]));
    return (report?.daily ?? []).map((d) => ({
      ...d,
      label: format(new Date(`${d.day}T00:00:00`), 'MMM d'),
      actualCostUsd: actualByDate.get(d.day),
      billedCostUsd: billedByDate.get(d.day)?.billedCostUsd,
      billedEstimated: billedByDate.get(d.day)?.estimated ?? false,
    }));
  }, [report, actualCost, billedCost]);

  const totalInputTokens = totals ? totals.uncachedInputTokens + totals.cachedInputTokens : 0;
  const cacheHitRate = totalInputTokens > 0 ? (totals?.cachedInputTokens ?? 0) / totalInputTokens : NaN;
  // Once billed cost is shown, it's the real OpenAI-billed figure rather than our
  // internal per-turn estimate, so the pre-cutoff overstatement this note warns
  // about no longer applies to the number actually on screen.
  const showOldDataNote = from < USAGE_SCHEMA_CUTOFF && !hasBilledCost;
  const isEmpty = !!totals && totals.turns === 0;
  const avgCostPerTurn = totals && totals.turns > 0
    ? (hasBilledCost ? billedCost!.totalUsd : totals.costUsd) / totals.turns
    : 0;

  return (
    <section className={styles.container}>
      <h2 className={styles.heading}>AI Usage</h2>

      <div className={styles.rangeRow} role="group" aria-label="Time range">
        {RANGE_DEFS.map((r) => (
          <button
            key={r.key}
            type="button"
            aria-pressed={rangeKey === r.key}
            className={`${styles.rangeChip} ${rangeKey === r.key ? styles.rangeChipActive : ''}`}
            onClick={() => setRangeKey(r.key)}
          >
            {r.label}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={isCustom}
          className={`${styles.rangeChip} ${isCustom ? styles.rangeChipActive : ''}`}
          onClick={() => setRangeKey(CUSTOM_RANGE_KEY)}
        >
          Custom
        </button>
      </div>

      {isCustom && (
        <div className={styles.customRangeRow}>
          <label className={styles.customRangeField}>
            <span>From</span>
            <input
              type="date"
              className={styles.dateInput}
              value={customFrom}
              max={customTo || undefined}
              onChange={(e) => setCustomFrom(e.target.value)}
            />
          </label>
          <label className={styles.customRangeField}>
            <span>To</span>
            <input
              type="date"
              className={styles.dateInput}
              value={customTo}
              min={customFrom || undefined}
              onChange={(e) => setCustomTo(e.target.value)}
            />
          </label>
        </div>
      )}

      {byUser.length > 0 && (
        <div className={styles.userFilterRow}>
          <label className={styles.userFilterLabel}>
            <span>User</span>
            <select
              className={styles.userSelect}
              value={userFilter}
              onChange={(e) => setUserFilter(e.target.value)}
            >
              <option value="">All users</option>
              {byUser.map((u) => (
                <option key={u.userUuid} value={u.userUuid}>{userLabel(u)}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      {!rangeReady ? (
        <p className={styles.empty}>Pick a "from" date on or before "to" to load usage.</p>
      ) : query.isLoading ? (
        <p className={styles.empty}>Loading…</p>
      ) : query.isError ? (
        <p className={styles.empty}>Couldn't load usage data. Try again shortly.</p>
      ) : isEmpty ? (
        <p className={styles.empty}>No AI usage recorded in this range.</p>
      ) : totals ? (
        <>
          <div className={styles.statsGrid}>
            {hasBilledCost ? (
              <div className={styles.statTile}>
                <span className={styles.statLabel}>Billed cost</span>
                <span className={styles.statValue}>
                  {formatUsd(billedCost!.totalUsd)}
                  {billedCost!.estimatedDayCount > 0 && (
                    <span className={styles.estimatedTag} title="Includes days OpenAI hasn't billed yet">
                      *
                    </span>
                  )}
                </span>
              </div>
            ) : (
              <>
                <div className={styles.statTile}>
                  <span className={styles.statLabel}>
                    Estimated cost
                    {showOldDataNote && (
                      <button
                        type="button"
                        className={styles.infoButton}
                        aria-expanded={showCutoffNote}
                        aria-label="Why pre-cutoff cost may be overstated"
                        onClick={() => setShowCutoffNote((v) => !v)}
                      >
                        <Info size={12} />
                      </button>
                    )}
                  </span>
                  <span className={styles.statValue}>{formatUsd(totals.costUsd)}</span>
                </div>
                {actualCost && (
                  <div className={styles.statTile}>
                    <span className={styles.statLabel}>Actual billed cost</span>
                    <span className={styles.statValue}>
                      {hasActualCost ? formatUsd(actualCost?.totalUsd ?? 0) : 'Unavailable'}
                    </span>
                  </div>
                )}
              </>
            )}
            <div className={styles.statTile}>
              <span className={styles.statLabel}>Turns</span>
              <span className={styles.statValue}>{formatCompactNumber(totals.turns)}</span>
            </div>
            <div className={styles.statTile}>
              <span className={styles.statLabel}>Avg cost / turn</span>
              <span className={styles.statValue}>{formatUsd(avgCostPerTurn)}</span>
            </div>
            <div className={styles.statTile}>
              <span className={styles.statLabel}>Cache hit rate</span>
              <span className={styles.statValue}>{formatPercent(cacheHitRate)}</span>
            </div>
            <div className={styles.statTile}>
              <span className={styles.statLabel}>Avg steps / turn</span>
              <span className={styles.statValue}>{formatAverage(totals.steps, totals.turns)}</span>
            </div>
            <div className={styles.statTile}>
              <span className={styles.statLabel}>Avg tool calls / turn</span>
              <span className={styles.statValue}>{formatAverage(totals.toolCalls, totals.turns)}</span>
            </div>
            <div className={styles.statTile}>
              <span className={styles.statLabel}>Web search calls</span>
              <span className={styles.statValue}>{formatCompactNumber(totals.webSearchCalls)}</span>
            </div>
          </div>

          {showOldDataNote && showCutoffNote && (
            <p className={styles.note}>
              Rows before {USAGE_SCHEMA_CUTOFF} predate per-step tracking (steps, tool calls, web
              search, and cache stats weren't recorded yet) and were costed as if fully uncached,
              overstating their cost by roughly 2.5x. Totals for this range include them as-is.
            </p>
          )}

          {hasBilledCost && (
            <p className={styles.note}>
              Billed cost is OpenAI's organization-wide billing (not scoped to the user filter
              above), apportioned to each user by their share of that day's estimated usage.
              {billedCost!.estimatedDayCount > 0 &&
                ` Includes ${billedCost!.estimatedDayCount} day${billedCost!.estimatedDayCount === 1 ? '' : 's'} OpenAI hasn't billed yet (marked *), shown at their estimated cost.`}
              {billedCost!.unattributedUsd >= 0.005 &&
                ` ${formatUsd(billedCost!.unattributedUsd)} of billed cost isn't tied to any user's usage and is included in the total only.`}
            </p>
          )}
          {!hasBilledCost && actualCost?.status === 'unavailable' && (
            <p className={styles.note}>
              {actualCost?.message ?? 'Actual billed cost is temporarily unavailable.'}
            </p>
          )}

          <h3 className={styles.chartHeading}>{hasBilledCost ? 'Billed cost per day' : 'Estimated cost per day'}</h3>
          {!hasBilledCost && hasActualCost && (
            <div className={styles.legend}>
              <span className={styles.legendItem}>
                <span className={styles.legendSwatch} style={{ backgroundColor: COLOR_COST }} />
                Estimated
              </span>
              <span className={styles.legendItem}>
                <span className={styles.legendSwatch} style={{ backgroundColor: COLOR_ACTUAL_COST }} />
                Actual billed
              </span>
            </div>
          )}
          <div className={styles.chartWrap}>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={dailyChartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#EBEDE9', fontSize: 12 }}
                  axisLine={{ stroke: '#575757' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: '#EBEDE9', fontSize: 12 }}
                  axisLine={{ stroke: '#575757' }}
                  tickLine={false}
                  width={56}
                  tickFormatter={(v: number) => formatUsd(v)}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(value, name) => [
                    formatUsd(Number(value)),
                    name === 'actualCostUsd' ? 'Actual billed' : name === 'billedCostUsd' ? 'Billed' : 'Estimated',
                  ]}
                />
                {hasBilledCost ? (
                  <Bar dataKey="billedCostUsd" fill={COLOR_COST} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                ) : (
                  <>
                    <Bar dataKey="costUsd" fill={COLOR_COST} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                    {hasActualCost && (
                      <Bar
                        dataKey="actualCostUsd"
                        fill={COLOR_ACTUAL_COST}
                        radius={[4, 4, 0, 0]}
                        isAnimationActive={false}
                      />
                    )}
                  </>
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>

          <h3 className={styles.chartHeading}>Tokens per day</h3>
          <div className={styles.legend}>
            <span className={styles.legendItem}>
              <span className={styles.legendSwatch} style={{ backgroundColor: COLOR_UNCACHED }} />
              Uncached input
            </span>
            <span className={styles.legendItem}>
              <span className={styles.legendSwatch} style={{ backgroundColor: COLOR_CACHED }} />
              Cached input
            </span>
            <span className={styles.legendItem}>
              <span className={styles.legendSwatch} style={{ backgroundColor: COLOR_OUTPUT }} />
              Output
            </span>
          </div>
          <div className={styles.chartWrap}>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={dailyChartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#EBEDE9', fontSize: 12 }}
                  axisLine={{ stroke: '#575757' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: '#EBEDE9', fontSize: 12 }}
                  axisLine={{ stroke: '#575757' }}
                  tickLine={false}
                  width={48}
                  tickFormatter={(v: number) => formatCompactNumber(v)}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(value, name) => [
                    formatCompactNumber(Number(value)),
                    name === 'uncachedInputTokens' ? 'Uncached input' : name === 'cachedInputTokens' ? 'Cached input' : 'Output',
                  ]}
                />
                <Bar dataKey="uncachedInputTokens" stackId="tokens" fill={COLOR_UNCACHED} isAnimationActive={false} />
                <Bar dataKey="cachedInputTokens" stackId="tokens" fill={COLOR_CACHED} isAnimationActive={false} />
                <Bar dataKey="outputTokens" stackId="tokens" fill={COLOR_OUTPUT} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {byUser.length > 0 && (
            <>
              <h3 className={styles.chartHeading}>Usage by user</h3>
              <div className={styles.userTableWrap}>
                <table className={styles.userTable}>
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Turns</th>
                      <th>{hasBilledCost ? 'Billed cost' : 'Cost'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byUser.map((u) => (
                      <tr
                        key={u.userUuid}
                        className={u.userUuid === userFilter ? styles.userRowActive : ''}
                        onClick={() => setUserFilter(u.userUuid === userFilter ? '' : u.userUuid)}
                      >
                        <td>{userLabel(u)}</td>
                        <td>{formatCompactNumber(u.turns)}</td>
                        <td>{formatUsd(hasBilledCost ? (billedByUser.get(u.userUuid) ?? 0) : u.costUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      ) : null}
    </section>
  );
}

export default AdminUsageDashboard;
