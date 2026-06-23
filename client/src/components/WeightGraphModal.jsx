import { useQuery } from '@tanstack/react-query';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { format } from 'date-fns';
import clientApi from '../api/clientApi.js';
import { useUser } from '../context/UserProvider.jsx';
import Modal from './Modal.jsx';
import styles from '../styles/WeightGraphModal.module.scss';

/**
 * WeightGraphModal — weight-over-time chart for a variation.
 *
 * Props (unchanged):
 *   variation {object} — must have .id and .label
 *   onClose   {fn}     — called to close the modal
 *
 * Data logic: unchanged (React Query useQuery).
 */
function WeightGraphModal({ variation, onClose }) {
  const { user } = useUser();

  // ── React Query data logic (untouched) ──────────────────────────────────────
  const { data: history = [], isLoading: loading } = useQuery({
    queryKey: ['variationHistory', variation.id],
    queryFn: async () => {
      const res = await clientApi.get(`/variations/history/${variation.id}`);
      return res.data.data.map(entry => ({
        weight: entry.weight,
        date: format(new Date(entry.date), 'MMM d'),
        rawDate: new Date(entry.date).getTime()
      }));
    },
    enabled: !!user,
  });

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
    </Modal>
  );
}

export default WeightGraphModal;
