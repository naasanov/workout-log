import { useEffect, useState, useCallback } from 'react';
import { format, parseISO } from 'date-fns';
import clientApi from '../api/clientApi.js';
import useAuth from '../hooks/useAuth.js';
import styles from '../styles/HabitTracker.module.scss';

const HABIT_NAME = 'nail-biting';

// Returns today's local date as YYYY-MM-DD
function getTodayLocalDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Returns the current local time as HH:mm
function getNowLocalTime() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  return `${h}:${min}`;
}

// Render tally marks as SVG groups of 5 (4 vertical + 1 diagonal slash)
function TallyMarks({ count }) {
  if (count === 0) return null;

  const fullGroups = Math.floor(count / 5);
  const remainder = count % 5;

  const groups = [];

  for (let g = 0; g < fullGroups; g++) {
    groups.push({ type: 'full', key: `full-${g}` });
  }
  if (remainder > 0) {
    groups.push({ type: 'partial', count: remainder, key: `partial` });
  }

  return (
    <span className={styles.tallyWrap} aria-label={`${count} tally marks`}>
      {groups.map(group => (
        <svg
          key={group.key}
          className={styles.tallyGroup}
          viewBox="0 0 36 24"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          {/* 4 vertical bars at positions 4, 10, 16, 22 */}
          {[4, 10, 16, 22].map((x, i) => {
            const visible = group.type === 'full' || i < group.count;
            return visible ? (
              <line key={x} x1={x} y1="2" x2={x} y2="22" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            ) : null;
          })}
          {/* Diagonal slash for full groups */}
          {group.type === 'full' && (
            <line x1="1" y1="22" x2="33" y2="2" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          )}
        </svg>
      ))}
    </span>
  );
}

function formatDateLabel(dateStr) {
  const today = getTodayLocalDate();
  if (dateStr === today) return 'Today';
  // dateStr is YYYY-MM-DD — parse as local date
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  return format(d, 'MMM d, yyyy');
}

// Converts "HH:mm" or "HH:mm:ss" (24h) to "h:mm AM/PM" for display
function to12h(timeStr) {
  if (!timeStr) return '';
  const parts = timeStr.split(':');
  let h = parseInt(parts[0], 10);
  const min = parts[1];
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${min} ${ampm}`;
}

// Converts "h:mm AM/PM" or "h:mm am/pm" user input back to "HH:mm" for storage.
// Returns null if the input is empty, or undefined if it's invalid.
function to24h(input) {
  if (!input) return null;
  const m = input.trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (!m) return undefined; // invalid
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ampm = m[3].toUpperCase();
  if (h < 1 || h > 12 || parseInt(min, 10) > 59) return undefined;
  if (ampm === 'AM') {
    h = h === 12 ? 0 : h;
  } else {
    h = h === 12 ? 12 : h + 12;
  }
  return `${String(h).padStart(2, '0')}:${min}`;
}

function formatTime(timeStr) {
  if (!timeStr) return '';
  return to12h(timeStr);
}

function HabitRow({ row, isToday, onIncrement, onDecrement, onRangeChange }) {
  const [rangeStart, setRangeStart] = useState(formatTime(row.range_start) || '');
  const [rangeEnd, setRangeEnd] = useState(formatTime(row.range_end) || '');

  // Keep local inputs in sync when row changes from parent (e.g. after tally)
  useEffect(() => {
    setRangeStart(formatTime(row.range_start) || '');
    setRangeEnd(formatTime(row.range_end) || '');
  }, [row.range_start, row.range_end]);

  function handleRangeStartBlur() {
    const val = rangeStart.trim();
    if (val === (formatTime(row.range_start) || '')) return;
    if (!val) {
      onRangeChange(row.date, { range_start: null });
      return;
    }
    const val24 = to24h(val);
    if (val24 === undefined) return; // invalid — ignore
    onRangeChange(row.date, { range_start: val24 });
  }

  function handleRangeEndBlur() {
    const val = rangeEnd.trim();
    if (val === (formatTime(row.range_end) || '')) return;
    if (!val) {
      onRangeChange(row.date, { range_end: null });
      return;
    }
    const val24 = to24h(val);
    if (val24 === undefined) return; // invalid — ignore
    onRangeChange(row.date, { range_end: val24 });
  }

  const hasRange = rangeStart || rangeEnd;

  return (
    <div className={`${styles.row} ${isToday ? styles.todayRow : ''}`}>
      <div className={styles.rowTop}>
        <span className={styles.dateLabel}>{formatDateLabel(row.date)}</span>
        <span className={styles.countBadge}>{row.count}</span>
        <div className={styles.adjustBtns}>
          <button
            className={styles.adjustBtn}
            onClick={() => onDecrement(row.date)}
            aria-label="Decrement tally"
            disabled={row.count === 0}
          >
            <svg className={styles.adjustBtnIcon} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          </button>
          <button
            className={styles.adjustBtn}
            onClick={() => onIncrement(row.date)}
            aria-label="Increment tally"
          >
            <svg className={styles.adjustBtnIcon} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <line x1="8" y1="2" x2="8" y2="14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {row.count > 0 && (
        <div className={styles.tallyRow}>
          <TallyMarks count={row.count} />
        </div>
      )}

      {(hasRange || isToday) && (
        <div className={styles.rangeRow}>
          <span className={styles.rangeLabel}>Time range:</span>
          <input
            className={styles.rangeInput}
            type="text"
            placeholder="h:mm AM"
            value={rangeStart}
            onChange={e => setRangeStart(e.target.value)}
            onBlur={handleRangeStartBlur}
            maxLength={8}
            aria-label="Range start time"
          />
          <span className={styles.rangeSep}>–</span>
          <input
            className={styles.rangeInput}
            type="text"
            placeholder="h:mm AM"
            value={rangeEnd}
            onChange={e => setRangeEnd(e.target.value)}
            onBlur={handleRangeEndBlur}
            maxLength={8}
            aria-label="Range end time"
          />
        </div>
      )}
    </div>
  );
}

function HabitTracker() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const { withAuth } = useAuth();

  useEffect(() => {
    async function fetchTallies() {
      const res = await withAuth(() => clientApi.get(`/habits/${HABIT_NAME}`));
      if (res?.data?.data) {
        // mysql2 DATE columns serialize to ISO strings through JSON (e.g. "2026-06-17T00:00:00.000Z")
        // slice(0,10) normalizes both bare "YYYY-MM-DD" and ISO datetime strings to "YYYY-MM-DD"
        setRows(res.data.data.map(row => ({
          ...row,
          date: String(row.date).slice(0, 10),
        })));
      }
      setLoading(false);
    }
    fetchTallies();
  }, [withAuth]);

  // Ensure today's row is always present in local state
  const today = getTodayLocalDate();
  const todayExists = rows.some(r => r.date === today);
  const displayRows = todayExists
    ? rows
    : [{ date: today, count: 0, range_start: null, range_end: null }, ...rows];

  async function handleAddTally() {
    if (submitting) return;
    setSubmitting(true);

    const localDate = getTodayLocalDate();
    const localTime = getNowLocalTime();

    const res = await withAuth(() =>
      clientApi.post(`/habits/${HABIT_NAME}/tally`, { localDate, localTime })
    );

    if (res?.data?.data) {
      const updated = res.data.data;
      setRows(prev => {
        const existing = prev.find(r => r.date === updated.date);
        if (existing) {
          return prev.map(r => r.date === updated.date ? { ...r, ...updated } : r);
        } else {
          return [updated, ...prev];
        }
      });
    }

    setSubmitting(false);
  }

  async function handleIncrement(date) {
    const row = displayRows.find(r => r.date === date);
    if (!row) return;
    const newCount = row.count + 1;
    const res = await withAuth(() =>
      clientApi.patch(`/habits/${HABIT_NAME}/${date}`, { count: newCount })
    );
    if (res !== undefined) {
      setRows(prev => {
        const existing = prev.find(r => r.date === date);
        if (existing) {
          return prev.map(r => r.date === date ? { ...r, count: newCount } : r);
        } else {
          // Row was client-only (today with count 0) — need to create it first via tally endpoint
          // This path is unusual; just reflect count change locally
          return [{ date, count: newCount, range_start: null, range_end: null }, ...prev];
        }
      });
    }
  }

  async function handleDecrement(date) {
    const row = displayRows.find(r => r.date === date);
    if (!row || row.count === 0) return;
    const newCount = row.count - 1;
    const res = await withAuth(() =>
      clientApi.patch(`/habits/${HABIT_NAME}/${date}`, { count: newCount })
    );
    if (res !== undefined) {
      setRows(prev => prev.map(r => r.date === date ? { ...r, count: newCount } : r));
    }
  }

  const handleRangeChange = useCallback(async (date, fields) => {
    const res = await withAuth(() =>
      clientApi.patch(`/habits/${HABIT_NAME}/${date}`, fields)
    );
    if (res !== undefined) {
      setRows(prev => prev.map(r => r.date === date ? { ...r, ...fields } : r));
    }
  }, [withAuth]);

  return (
    <section className={styles.container}>
      <button
        className={styles.addTallyBtn}
        onClick={handleAddTally}
        disabled={submitting}
      >
        <span className={styles.addTallyPlus}>+</span> Add Tally
      </button>

      {loading ? (
        <p className={styles.empty}>Loading…</p>
      ) : (
        <div className={styles.list}>
          {displayRows.map(row => (
            <HabitRow
              key={row.date}
              row={row}
              isToday={row.date === today}
              onIncrement={handleIncrement}
              onDecrement={handleDecrement}
              onRangeChange={handleRangeChange}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default HabitTracker;
