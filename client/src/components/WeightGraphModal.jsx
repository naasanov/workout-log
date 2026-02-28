import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { format } from 'date-fns';
import clientApi from '../api/clientApi.js';
import useAuth from '../hooks/useAuth.js';
import styles from '../styles/WeightGraphModal.module.scss';

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
            weight: entry.weight,
            date: format(new Date(entry.date), 'MMM d'),
            rawDate: new Date(entry.date).getTime()
          }))
        );
      }
      setLoading(false);
    }
    fetchHistory();
  }, [variation.id]);

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
              ? 'No weight history yet. Update the weight to start tracking.'
              : 'Only one data point recorded. Update the weight again to see a trend.'}
          </p>
        ) : (
          <div className={styles.chartWrap}>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={history} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: '#EBEDE9', fontSize: 12, fontFamily: 'Sarabun, sans-serif' }}
                  axisLine={{ stroke: '#575757' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: '#EBEDE9', fontSize: 12, fontFamily: 'Sarabun, sans-serif' }}
                  axisLine={{ stroke: '#575757' }}
                  tickLine={false}
                  width={48}
                  tickFormatter={v => `${v}`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#282B28',
                    border: '1px solid #575757',
                    borderRadius: '8px',
                    color: '#EBEDE9',
                    fontFamily: 'Sarabun, sans-serif',
                  }}
                  formatter={(value) => [`${value} lbs`, 'Weight']}
                />
                <Line
                  type="monotone"
                  dataKey="weight"
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
    </div>
  );
}

export default WeightGraphModal;
