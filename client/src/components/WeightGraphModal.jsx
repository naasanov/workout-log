import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { format } from 'date-fns';
import clientApi from '../api/clientApi.js';
import { useUser } from '../context/UserProvider.jsx';
import Modal from './Modal.jsx';
import styles from '../styles/WeightGraphModal.module.scss';

// Single global flag shared by every variation graph — not per-variation.
// Switching one graph to "Weight" switches all of them.
const METRIC_STORAGE_KEY = 'variationGraphMetric';
const METRIC_EST_1RM = 'est1rm';
const METRIC_WEIGHT = 'weight';

function readStoredMetric() {
  try {
    const stored = localStorage.getItem(METRIC_STORAGE_KEY);
    if (stored === METRIC_EST_1RM || stored === METRIC_WEIGHT) return stored;
  } catch (_) {
    // localStorage can throw (e.g. Safari private mode); fall back to default.
  }
  return METRIC_EST_1RM;
}

function writeStoredMetric(metric) {
  try {
    localStorage.setItem(METRIC_STORAGE_KEY, metric);
  } catch (_) {
    // Best-effort; nothing to do if storage is unavailable.
  }
}

// Epley formula. When reps is null/undefined/0 we have no rep data for that
// point (pre-existing history rows never recorded reps), so the est. 1RM is
// just the weight itself rather than an extrapolation.
function estimate1RM(weight, reps) {
  if (weight == null) return null;
  if (!reps) return Math.round(weight);
  return Math.round(weight * (1 + reps / 30));
}

function GraphTooltip({ active, payload, isEst1RM }) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;
  const contentStyle = {
    backgroundColor: '#282B28',
    border: '1px solid #575757',
    borderRadius: '8px',
    color: '#EBEDE9',
    fontFamily: 'Sarabun, sans-serif',
    padding: '8px 12px',
    fontSize: '13px',
  };

  if (!isEst1RM) {
    return (
      <div style={contentStyle}>
        <div>{`${point.value} lbs`}</div>
        <div style={{ opacity: 0.7 }}>Weight</div>
      </div>
    );
  }

  const setLabel = point.reps ? `${point.weight} lbs × ${point.reps}` : `${point.weight} lbs`;
  return (
    <div style={contentStyle}>
      <div>{`${point.value} lbs (est. 1RM)`}</div>
      <div style={{ opacity: 0.7 }}>{setLabel}</div>
    </div>
  );
}

/**
 * WeightGraphModal — weight / estimated-1RM-over-time chart for a variation.
 *
 * Props (unchanged):
 *   variation {object} — must have .id and .label
 *   onClose   {fn}     — called to close the modal
 */
function WeightGraphModal({ variation, onClose }) {
  const { user } = useUser();
  const [metric, setMetric] = useState(readStoredMetric);

  const { data: history = [], isLoading: loading } = useQuery({
    queryKey: ['variationHistory', variation.id],
    queryFn: async () => {
      const res = await clientApi.get(`/variations/history/${variation.id}`);
      return res.data.data.map(entry => ({
        weight: entry.weight,
        reps: entry.reps,
        date: format(new Date(entry.date), 'MMM d'),
        rawDate: new Date(entry.date).getTime()
      }));
    },
    enabled: !!user,
  });

  function handleMetricChange(next) {
    setMetric(next);
    writeStoredMetric(next);
  }

  const isEst1RM = metric === METRIC_EST_1RM;
  const chartData = isEst1RM
    ? history.map(entry => ({
        ...entry,
        value: estimate1RM(entry.weight, entry.reps),
      }))
    : history.map(entry => ({ ...entry, value: entry.weight }));

  // Anchoring the axis at 0 compresses a typical progress curve (e.g.
  // 175 -> 247) into the top third of the chart. Pad around the actual
  // range instead so the trend is visible, without ever going negative.
  const chartValues = chartData.map(d => d.value).filter(v => v != null);
  const dataMin = chartValues.length ? Math.min(...chartValues) : 0;
  const dataMax = chartValues.length ? Math.max(...chartValues) : 0;
  const range = dataMax - dataMin;
  const padding = range > 0 ? range * 0.15 : Math.max(dataMax * 0.1, 5);
  const yDomain = [Math.max(0, Math.floor(dataMin - padding)), Math.ceil(dataMax + padding)];

  return (
    <Modal
      open={true}
      onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}
      title={variation.label || 'Variation'}
      showTitle={false}
      contentClassName={styles.modalContent}
    >
      <div className={styles.modal}>
        <div className={styles.header}>
          <span className={styles.title}>{variation.label || 'Variation'}</span>
          <button className={styles.close} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className={styles.toggle} role="tablist" aria-label="Graph metric">
          <button
            type="button"
            role="tab"
            aria-selected={isEst1RM}
            className={`${styles.toggleOption} ${isEst1RM ? styles.toggleOptionActive : ''}`}
            onClick={() => handleMetricChange(METRIC_EST_1RM)}
          >
            Est. 1RM
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={!isEst1RM}
            className={`${styles.toggleOption} ${!isEst1RM ? styles.toggleOptionActive : ''}`}
            onClick={() => handleMetricChange(METRIC_WEIGHT)}
          >
            Weight
          </button>
        </div>

        {loading ? (
          <p className={styles.empty}>Loading…</p>
        ) : history.length < 2 ? (
          <p className={styles.empty}>
            {history.length === 0
              ? 'No weight history yet. Update the weight to start tracking.'
              : 'Only one data point recorded. Update the weight again to see a trend.'}
          </p>
        ) : (
          <div className={styles.chartWrap}>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: '#EBEDE9', fontSize: 12, fontFamily: 'Sarabun, sans-serif' }}
                  axisLine={{ stroke: '#575757' }}
                  tickLine={false}
                />
                <YAxis
                  domain={yDomain}
                  tick={{ fill: '#EBEDE9', fontSize: 12, fontFamily: 'Sarabun, sans-serif' }}
                  axisLine={{ stroke: '#575757' }}
                  tickLine={false}
                  width={48}
                  tickFormatter={v => `${v}`}
                />
                <Tooltip content={<GraphTooltip isEst1RM={isEst1RM} />} />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#70EB70"
                  strokeWidth={2}
                  dot={{ fill: '#70EB70', r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
            <p className={styles.yLabel}>lbs</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

export default WeightGraphModal;
