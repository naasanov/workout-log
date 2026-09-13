import { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { format } from 'date-fns';
import { useAdminUsageReport } from './api';
import { computeRange, DEFAULT_RANGE_DAYS } from './range';
import { formatUsd, formatUsdPrecise, formatCompactNumber, formatPercent, formatAverage } from './format';
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

function AdminUsageDashboard() {
  const [rangeKey, setRangeKey] = useState('30D');
  const rangeDef = RANGE_DEFS.find((r) => r.key === rangeKey) ?? RANGE_DEFS[1];
  const { from, to } = useMemo(() => computeRange(rangeDef.days), [rangeDef]);

  const query = useAdminUsageReport(from, to, true);
  const report = query.data;
  const totals = report?.totals;

  const dailyChartData = useMemo(
    () => (report?.daily ?? []).map((d) => ({
      ...d,
      label: format(new Date(`${d.day}T00:00:00`), 'MMM d'),
    })),
    [report],
  );

  const totalInputTokens = totals ? totals.uncachedInputTokens + totals.cachedInputTokens : 0;
  const cacheHitRate = totalInputTokens > 0 ? (totals?.cachedInputTokens ?? 0) / totalInputTokens : NaN;
  const showOldDataNote = from < USAGE_SCHEMA_CUTOFF;
  const isEmpty = !!totals && totals.turns === 0;

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
      </div>

      {query.isLoading ? (
        <p className={styles.empty}>Loading…</p>
      ) : query.isError ? (
        <p className={styles.empty}>Couldn't load usage data. Try again shortly.</p>
      ) : isEmpty ? (
        <p className={styles.empty}>No AI usage recorded in this range.</p>
      ) : totals ? (
        <>
          {showOldDataNote && (
            <p className={styles.note}>
              Rows before {USAGE_SCHEMA_CUTOFF} predate per-step tracking (steps, tool calls, web
              search, and cache stats weren't recorded yet) and were costed as if fully uncached,
              overstating their cost by roughly 2.5x. Totals for this range include them as-is.
            </p>
          )}

          <div className={styles.statsGrid}>
            <div className={styles.statTile}>
              <span className={styles.statLabel}>Estimated cost</span>
              <span className={styles.statValue}>{formatUsd(totals.costUsd)}</span>
            </div>
            <div className={styles.statTile}>
              <span className={styles.statLabel}>Turns</span>
              <span className={styles.statValue}>{formatCompactNumber(totals.turns)}</span>
            </div>
            <div className={styles.statTile}>
              <span className={styles.statLabel}>Avg cost / turn</span>
              <span className={styles.statValue}>
                {formatUsdPrecise(totals.turns > 0 ? totals.costUsd / totals.turns : 0)}
              </span>
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

          <h3 className={styles.chartHeading}>Estimated cost per day</h3>
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
                  formatter={(value) => [formatUsdPrecise(Number(value)), 'Cost']}
                />
                <Bar dataKey="costUsd" fill={COLOR_COST} radius={[4, 4, 0, 0]} isAnimationActive={false} />
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
        </>
      ) : null}
    </section>
  );
}

export default AdminUsageDashboard;
