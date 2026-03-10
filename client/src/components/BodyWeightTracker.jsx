import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { format } from 'date-fns';
import clientApi from '../api/clientApi.js';
import useAuth from '../hooks/useAuth.js';
import ConfirmModal from './ConfirmModal.jsx';
import CollapseButton from './CollapseButton.jsx';
import styles from '../styles/BodyWeightTracker.module.scss';

function BodyWeightTracker() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [weight, setWeight] = useState('');
  const [date, setDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  const { withAuth } = useAuth();

  useEffect(() => {
    async function fetchEntries() {
      const res = await withAuth(() => clientApi.get('/body-weight'));
      if (res?.data?.data) {
        setEntries(res.data.data);
      }
      setLoading(false);
    }
    fetchEntries();
  }, [withAuth]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!weight || isNaN(Number(weight)) || Number(weight) <= 0) return;
    setSubmitting(true);

    const body = { weight: Number(weight) };
    if (date) body.date = new Date(date).toISOString();

    const res = await withAuth(() => clientApi.post('/body-weight', body));
    if (res?.data?.data) {
      const newEntry = {
        id: res.data.data.id,
        weight: Number(weight),
        date: date ? new Date(date).toISOString() : new Date().toISOString(),
      };
      setEntries(prev => [...prev, newEntry].sort((a, b) => new Date(a.date) - new Date(b.date)));
      setWeight('');
      setDate('');
    }
    setSubmitting(false);
  }

  async function handleDelete() {
    const id = deleteId;
    setDeleteId(null);
    const res = await withAuth(() => clientApi.delete(`/body-weight/${id}`));
    if (res !== undefined) {
      setEntries(prev => prev.filter(e => e.id !== id));
    }
  }

  const chartData = entries.map(e => ({
    weight: e.weight,
    date: format(new Date(e.date), 'MMM d'),
    rawDate: new Date(e.date).getTime(),
  }));

  return (
    <section className={styles.container}>
      <div className={`${styles.headingRow} ${collapsed ? styles.headingRowCollapsed : ''}`}>
        <h2 className={styles.heading}>Body Weight</h2>
        <CollapseButton isOpen={!collapsed} onClick={() => setCollapsed(c => !c)} />
      </div>

      {!collapsed && <><form className={styles.form} onSubmit={handleSubmit}>
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
        <div className={styles.chartWrap}>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }} style={{ fontFamily: 'Sarabun, sans-serif' }}>
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
                domain={['auto', 'auto']}
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
      </>}

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
