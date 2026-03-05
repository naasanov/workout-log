import { useEffect, useState } from 'react';
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { format } from 'date-fns';
import clientApi from '../api/clientApi.js';
import useAuth from '../hooks/useAuth.js';
import styles from '../styles/WeightGraphModal.module.scss';

const WEIGHT_COLOR = '#70EB70';
const REPS_COLOR = '#70C5EB';

function WeightGraphModal({ variation, onClose }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const { withAuth } = useAuth();

  useEffect(() => {
    async function fetchHistory() {
      const res = await withAuth(() => clientApi.get(`/variations/history/${variation.id}`));
      if (res?.data?.data) {
        setHistory(
          res.data.data.map(entry => ({
            weight: entry.weight ?? null,
            reps: entry.reps ?? null,
            date: format(new Date(entry.date), 'MMM d'),
            rawDate: new Date(entry.date).getTime()
          }))
        );
      }
      setLoading(false);
    }
    fetchHistory();
  }, [variation.id]);

  const hasWeight = history.some(e => e.weight != null);
  const hasReps = history.some(e => e.reps != null);

  const tooltipFormatter = (value, name) => {
    if (name === 'weight') return [`${value} lbs`, 'Weight'];
    if (name === 'reps') return [value, 'Reps'];
    return [value, name];
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>{variation.label || 'Variation'}</span>
          <button className={styles.close} onClick={onClose}>✕</button>
        </div>

        {loading ? (
          <p className={styles.empty}>Loading…</p>
        ) : history.length < 2 ? (
          <p className={styles.empty}>
            {history.length === 0
              ? 'No history yet. Update the weight to start tracking.'
              : 'Only one data point recorded. Update again to see a trend.'}
          </p>
        ) : (
          <div className={styles.chartWrap}>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={history} margin={{ top: 10, right: hasReps ? 48 : 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: '#EBEDE9', fontSize: 12, fontFamily: 'Sarabun, sans-serif' }}
                  axisLine={{ stroke: '#575757' }}
                  tickLine={false}
                />
                {hasWeight && (
                  <YAxis
                    yAxisId="weight"
                    orientation="left"
                    tick={{ fill: WEIGHT_COLOR, fontSize: 12, fontFamily: 'Sarabun, sans-serif' }}
                    axisLine={{ stroke: '#575757' }}
                    tickLine={false}
                    width={48}
                    unit=" lbs"
                  />
                )}
                {hasReps && (
                  <YAxis
                    yAxisId="reps"
                    orientation="right"
                    tick={{ fill: REPS_COLOR, fontSize: 12, fontFamily: 'Sarabun, sans-serif' }}
                    axisLine={{ stroke: '#575757' }}
                    tickLine={false}
                    width={40}
                    allowDecimals={false}
                    unit=" reps"
                  />
                )}
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#282B28',
                    border: '1px solid #575757',
                    borderRadius: '8px',
                    color: '#EBEDE9',
                    fontFamily: 'Sarabun, sans-serif',
                  }}
                  formatter={tooltipFormatter}
                />
                <Legend
                  wrapperStyle={{ fontFamily: 'Sarabun, sans-serif', fontSize: 13, color: '#EBEDE9' }}
                  formatter={(value) => value === 'weight' ? 'Weight' : 'Reps'}
                />
                {hasWeight && (
                  <Line
                    yAxisId="weight"
                    type="monotone"
                    dataKey="weight"
                    stroke={WEIGHT_COLOR}
                    strokeWidth={2}
                    dot={{ fill: WEIGHT_COLOR, r: 4 }}
                    activeDot={{ r: 6 }}
                    connectNulls
                  />
                )}
                {hasReps && (
                  <Line
                    yAxisId="reps"
                    type="monotone"
                    dataKey="reps"
                    stroke={REPS_COLOR}
                    strokeWidth={2}
                    dot={{ fill: REPS_COLOR, r: 4 }}
                    activeDot={{ r: 6 }}
                    connectNulls
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

export default WeightGraphModal;
