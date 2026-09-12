import { useState, useMemo, useRef } from 'react';
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { format } from 'date-fns';
import clientApi from '../api/clientApi.js';
import useAuth from '../hooks/useAuth.js';
import useHorizontalPan from '../hooks/useHorizontalPan.js';
import ConfirmModal from './ConfirmModal.jsx';
import styles from '../styles/BodyWeightTracker.module.scss';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

const DAY_MS = 24 * 60 * 60 * 1000;

// Visible range chips. Each also sets the moving-average window in days, wider
// for longer ranges so the trend isn't lost in noise. "All" has no fixed span
// and never pans.
const RANGE_DEFS = [
  { key: '1M', label: '1M', days: 30, smoothingDays: 7 },
  { key: '3M', label: '3M', days: 90, smoothingDays: 7 },
  { key: '6M', label: '6M', days: 180, smoothingDays: 14 },
  { key: '1Y', label: '1Y', days: 365, smoothingDays: 30 },
  { key: 'ALL', label: 'All', days: null, smoothingDays: 30 },
];

// Matches the ComposedChart's margin/YAxis width below, so a pixel drag
// converts to roughly the right amount of time regardless of the plotted
// area being narrower than the container it sits in.
const CHART_RIGHT_MARGIN_PX = 16;
const Y_AXIS_WIDTH_PX = 48;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function BodyWeightTracker() {
  const [weight, setWeight] = useState('');
  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [deleteId, setDeleteId] = useState(null);
  const [rangeKey, setRangeKey] = useState('3M');
  const [panOffsetMs, setPanOffsetMs] = useState(0);
  const chartWrapRef = useRef(null);
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const entriesQuery = useQuery({
    queryKey: ['body-weight'],
    queryFn: async () => {
      const res = await clientApi.get('/body-weight');
      return res.data.data ?? [];
    },
    enabled: user !== undefined && user !== null,
  });

  const entries = entriesQuery.data ?? [];
  const loading = entriesQuery.isLoading;

  const addMutation = useMutation({
    mutationFn: async ({ weight, date }) => {
      const body = { weight: Number(weight) };
      if (date) body.date = new Date(date).toISOString();
      const res = await clientApi.post('/body-weight', body);
      return res.data.data;
    },
    onSuccess: (data, { weight, date }) => {
      const newEntry = {
        id: data.id,
        weight: Number(weight),
        date: date ? new Date(date).toISOString() : new Date().toISOString(),
      };
      queryClient.setQueryData(['body-weight'], (prev) =>
        [...(prev ?? []), newEntry].sort((a, b) => new Date(a.date) - new Date(b.date))
      );
      setWeight('');
      setDate(format(new Date(), 'yyyy-MM-dd'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      await clientApi.delete(`/body-weight/${id}`);
      return id;
    },
    onSuccess: (id) => {
      queryClient.setQueryData(['body-weight'], (prev) =>
        (prev ?? []).filter(e => e.id !== id)
      );
    },
  });

  async function handleSubmit(e) {
    e.preventDefault();
    if (!weight || isNaN(Number(weight)) || Number(weight) <= 0) return;
    addMutation.mutate({ weight, date });
  }

  async function handleDelete() {
    const id = deleteId;
    setDeleteId(null);
    deleteMutation.mutate(id);
  }

  const submitting = addMutation.isPending;

  const rawChartData = useMemo(() => entries.map(e => ({
    weight: e.weight,
    date: format(new Date(e.date), 'MMM d'),
    rawDate: new Date(e.date).getTime(),
  })), [entries]);

  const rangeDef = RANGE_DEFS.find(r => r.key === rangeKey) ?? RANGE_DEFS[1];

  // Centered moving average over days, not a point count, since entries are
  // unevenly spaced. It runs over the full dataset so the leftmost visible
  // segment stays correct while panned.
  const chartDataFull = useMemo(() => {
    const halfWindowMs = (rangeDef.smoothingDays / 2) * DAY_MS;
    return rawChartData.map(point => {
      const neighbors = rawChartData.filter(
        p => Math.abs(p.rawDate - point.rawDate) <= halfWindowMs
      );
      const avg = neighbors.reduce((sum, p) => sum + p.weight, 0) / neighbors.length;
      return { ...point, smoothedWeight: avg };
    });
  }, [rawChartData, rangeDef]);

  // Visible window in epoch ms, clamped so panning can't go past the oldest
  // entry. "All" always spans the full dataset and is never panned.
  const { windowStartMs, windowEndMs, rangeMs, maxPanOffsetMs, effectivePanOffsetMs } = useMemo(() => {
    if (rawChartData.length === 0) {
      return { windowStartMs: 0, windowEndMs: 0, rangeMs: 0, maxPanOffsetMs: 0, effectivePanOffsetMs: 0 };
    }
    let oldestMs = Infinity;
    let latestMs = -Infinity;
    for (const p of rawChartData) {
      if (p.rawDate < oldestMs) oldestMs = p.rawDate;
      if (p.rawDate > latestMs) latestMs = p.rawDate;
    }
    const totalSpanMs = latestMs - oldestMs;
    const spanMs = rangeDef.days != null ? rangeDef.days * DAY_MS : Math.max(totalSpanMs, DAY_MS);
    const maxOffset = rangeDef.days != null ? Math.max(0, totalSpanMs - spanMs) : 0;
    const offset = clamp(panOffsetMs, 0, maxOffset);
    const endMs = latestMs - offset;
    const startMs = rangeDef.days != null ? endMs - spanMs : oldestMs;
    return { windowStartMs: startMs, windowEndMs: endMs, rangeMs: spanMs, maxPanOffsetMs: maxOffset, effectivePanOffsetMs: offset };
  }, [rawChartData, rangeDef, panOffsetMs]);

  const chartData = useMemo(
    () => chartDataFull.filter(p => p.rawDate >= windowStartMs && p.rawDate <= windowEndMs),
    [chartDataFull, windowStartMs, windowEndMs]
  );

  const yDomain = useMemo(() => {
    const values = chartData.flatMap(p => [p.weight, p.smoothedWeight]).filter(v => v != null);
    if (!values.length) return ['auto', 'auto'];
    const dataMin = Math.min(...values);
    const dataMax = Math.max(...values);
    const range = dataMax - dataMin;
    const padding = range > 0 ? range * 0.15 : Math.max(dataMax * 0.1, 5);
    return [Math.max(0, Math.floor(dataMin - padding)), Math.ceil(dataMax + padding)];
  }, [chartData]);

  const isPanned = effectivePanOffsetMs > 0;
  const panDisabled = rangeDef.days == null || maxPanOffsetMs <= 0;

  function handlePanBy(dxPx) {
    const containerWidth = chartWrapRef.current?.clientWidth ?? 300;
    const plotWidthPx = Math.max(1, containerWidth - Y_AXIS_WIDTH_PX - CHART_RIGHT_MARGIN_PX);
    const msPerPx = rangeMs / plotWidthPx;
    setPanOffsetMs(prev => clamp(prev + dxPx * msPerPx, 0, maxPanOffsetMs));
  }

  const { isDragging, handlers: panHandlers } = useHorizontalPan({
    onPanBy: handlePanBy,
    disabled: panDisabled,
  });

  function handleRangeChange(key) {
    setRangeKey(key);
    setPanOffsetMs(0);
  }

  return (
    <section className={styles.container}>
      <form className={styles.form} onSubmit={handleSubmit}>
        <input
          className={styles.input}
          type="number"
          step="0.1"
          min="0"
          placeholder="Weight (lbs)"
          value={weight}
          onChange={e => setWeight(e.target.value)}
          required
        />
        <input
          className={styles.input}
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
        />
        <button className={styles.submitBtn} type="submit" disabled={submitting}>
          Log
        </button>
      </form>

      {loading ? (
        <p className={styles.empty}>Loading…</p>
      ) : entries.length < 2 ? (
        <p className={styles.empty}>
          {entries.length === 0
            ? 'No entries yet. Log your weight to start tracking.'
            : 'Only one entry recorded. Log again to see a trend.'}
        </p>
      ) : (
        <>
          <div className={styles.rangeRow} role="group" aria-label="Time range">
            {RANGE_DEFS.map(r => (
              <button
                key={r.key}
                type="button"
                aria-pressed={rangeKey === r.key}
                className={`${styles.rangeChip} ${rangeKey === r.key ? styles.rangeChipActive : ''}`}
                onClick={() => handleRangeChange(r.key)}
              >
                {r.label}
              </button>
            ))}
          </div>
          <div
            className={styles.chartWrap}
            ref={chartWrapRef}
            {...panHandlers}
          >
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                <XAxis
                  dataKey="rawDate"
                  type="number"
                  scale="time"
                  domain={[windowStartMs, windowEndMs]}
                  allowDataOverflow
                  tickFormatter={(ms) => format(new Date(ms), 'MMM d')}
                  tick={{ fill: '#EBEDE9', fontSize: 12 }}
                  axisLine={{ stroke: '#575757' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: '#EBEDE9', fontSize: 12 }}
                  axisLine={{ stroke: '#575757' }}
                  tickLine={false}
                  width={48}
                  domain={yDomain}
                />
                {!isDragging && (
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#282B28',
                      border: '1px solid #575757',
                      borderRadius: '8px',
                      color: '#EBEDE9',
                    }}
                    labelFormatter={(ms) => format(new Date(ms), 'MMM d, yyyy')}
                    formatter={(value, name) => [`${Number(value).toFixed(1)} lbs`, name === 'smoothedWeight' ? 'Trend' : 'Weight']}
                  />
                )}
                <Line
                  type="monotone"
                  dataKey="smoothedWeight"
                  stroke="#70EB70"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="weight"
                  stroke="none"
                  dot={{ fill: '#70EB70', r: 4 }}
                  activeDot={isDragging ? false : { r: 6 }}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
            <p className={styles.yLabel}>lbs</p>
            {isPanned && (
              <button
                type="button"
                className={styles.latestBtn}
                onClick={() => setPanOffsetMs(0)}
              >
                Latest
              </button>
            )}
          </div>
        </>
      )}

      {entries.length > 0 && (
        <ul className={styles.list}>
          {[...entries].reverse().map(entry => (
            <li key={entry.id} className={styles.listItem}>
              <span className={styles.entryDate}>{format(new Date(entry.date), 'MMM d, yyyy')}</span>
              <span className={styles.entryWeight}>{entry.weight} lbs</span>
              <button
                className={styles.deleteBtn}
                onClick={() => setDeleteId(entry.id)}
                aria-label="Delete entry"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {deleteId !== null && (
        <ConfirmModal
          message="Delete this weight entry?"
          onConfirm={handleDelete}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </section>
  );
}

export default BodyWeightTracker;
