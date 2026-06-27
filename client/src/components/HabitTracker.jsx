import { useEffect, useState, useCallback, useRef } from 'react';
import { format } from 'date-fns';
import clientApi from '../api/clientApi.js';
import useAuth from '../hooks/useAuth.js';
import styles from '../styles/HabitTracker.module.scss';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

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

// ─── Tally row ──────────────────────────────────────────────────────────────────
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

// ─── Inline rename input ────────────────────────────────────────────────────────
function RenameInput({ initialValue, onSave, onCancel }) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function handleKeyDown(e) {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') onCancel();
  }

  function handleSave() {
    const trimmed = value.trim();
    if (!trimmed || trimmed === initialValue) {
      onCancel();
      return;
    }
    onSave(trimmed);
  }

  return (
    <div className={styles.renameRow}>
      <input
        ref={inputRef}
        className={styles.renameInput}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleSave}
        maxLength={100}
        aria-label="Rename habit"
      />
    </div>
  );
}

// ─── New habit input ────────────────────────────────────────────────────────────
function NewHabitInput({ onSave, onCancel }) {
  const [value, setValue] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleKeyDown(e) {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') onCancel();
  }

  function handleSave() {
    const trimmed = value.trim();
    if (!trimmed) {
      onCancel();
      return;
    }
    onSave(trimmed);
  }

  return (
    <div className={styles.newHabitRow}>
      <input
        ref={inputRef}
        className={styles.newHabitInput}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Habit name…"
        maxLength={100}
        aria-label="New habit name"
      />
      <button className={styles.newHabitSaveBtn} onClick={handleSave} type="button">
        Add
      </button>
      <button className={styles.newHabitCancelBtn} onClick={onCancel} type="button" aria-label="Cancel">
        <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <line x1="3" y1="3" x2="13" y2="13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <line x1="13" y1="3" x2="3" y2="13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

// ─── Habit list item (inside dropdown) ─────────────────────────────────────────
function HabitListItem({ habit, isActive, onSelect, onRename, onDelete }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const menuRef = useRef(null);

  // Close menu on outside tap/click
  useEffect(() => {
    if (!menuOpen) return;
    function handleOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('pointerdown', handleOutside);
    return () => document.removeEventListener('pointerdown', handleOutside);
  }, [menuOpen]);

  if (renaming) {
    return (
      <div className={`${styles.habitItem} ${isActive ? styles.habitItemActive : ''}`}>
        <RenameInput
          initialValue={habit.name}
          onSave={(newName) => { setRenaming(false); onRename(habit.id, newName); }}
          onCancel={() => setRenaming(false)}
        />
      </div>
    );
  }

  return (
    <div className={`${styles.habitItem} ${isActive ? styles.habitItemActive : ''}`}>
      <button
        className={styles.habitSelectBtn}
        onClick={() => onSelect(habit)}
        type="button"
      >
        {habit.name}
      </button>
      <div className={styles.habitMenuWrap} ref={menuRef}>
        <button
          className={styles.habitMenuBtn}
          onClick={() => setMenuOpen(o => !o)}
          type="button"
          aria-label={`Options for ${habit.name}`}
          aria-expanded={menuOpen}
        >
          <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <circle cx="8" cy="3" r="1.5" fill="currentColor" />
            <circle cx="8" cy="8" r="1.5" fill="currentColor" />
            <circle cx="8" cy="13" r="1.5" fill="currentColor" />
          </svg>
        </button>
        {menuOpen && (
          <div className={styles.habitMenu} role="menu">
            <button
              className={styles.habitMenuItem}
              role="menuitem"
              onClick={() => { setMenuOpen(false); setRenaming(true); }}
              type="button"
            >
              Rename
            </button>
            <button
              className={`${styles.habitMenuItem} ${styles.habitMenuItemDanger}`}
              role="menuitem"
              onClick={() => { setMenuOpen(false); onDelete(habit); }}
              type="button"
            >
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Confirm delete dialog ──────────────────────────────────────────────────────
function ConfirmDeleteDialog({ habit, onConfirm, onCancel }) {
  return (
    <div className={styles.confirmOverlay} role="dialog" aria-modal="true" aria-label="Confirm delete">
      <div className={styles.confirmBox}>
        <p className={styles.confirmText}>
          Delete <strong>{habit.name}</strong>? This will remove all its tallies and cannot be undone.
        </p>
        <div className={styles.confirmBtns}>
          <button className={styles.confirmCancel} onClick={onCancel} type="button">
            Cancel
          </button>
          <button className={styles.confirmDelete} onClick={onConfirm} type="button">
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────────
function HabitTracker() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [activeHabit, setActiveHabit] = useState(null);
  const [showNewHabit, setShowNewHabit] = useState(false);
  const [habitToDelete, setHabitToDelete] = useState(null);
  const [habitsOpen, setHabitsOpen] = useState(false);

  // ── Habits registry query ──────────────────────────────────────────────────
  const habitsQuery = useQuery({
    queryKey: ['habits-registry'],
    queryFn: async () => {
      const res = await clientApi.get('/habits');
      return res.data.data;
    },
    enabled: user !== undefined && user !== null,
  });

  const habits = habitsQuery.data ?? [];

  // Auto-select the first habit when registry loads; keep active in sync on rename
  useEffect(() => {
    if (activeHabit === null && habits.length > 0) {
      setActiveHabit(habits[0]);
    }
    if (activeHabit !== null) {
      const fresh = habits.find(h => h.id === activeHabit.id);
      if (fresh && fresh.name !== activeHabit.name) {
        setActiveHabit(fresh);
      }
    }
  }, [habits]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Tallies query (depends on selected habit) ──────────────────────────────
  const talliesQuery = useQuery({
    queryKey: ['habits', activeHabit?.name],
    queryFn: async () => {
      const res = await clientApi.get(`/habits/${activeHabit.name}`);
      // mysql2 DATE columns serialize to ISO strings through JSON
      // slice(0,10) normalizes both bare "YYYY-MM-DD" and ISO datetime strings
      return res.data.data.map(row => ({
        ...row,
        date: String(row.date).slice(0, 10),
      }));
    },
    enabled: user !== undefined && user !== null && activeHabit !== null,
  });

  const rows = talliesQuery.data ?? [];
  const talliesLoading = talliesQuery.isLoading;

  // ── Habit CRUD mutations ───────────────────────────────────────────────────
  const createHabitMutation = useMutation({
    mutationFn: async (name) => {
      const res = await clientApi.post('/habits', { name });
      return res.data.data;
    },
    onSuccess: (newHabit) => {
      queryClient.setQueryData(['habits-registry'], (prev) => [...(prev ?? []), newHabit]);
      setActiveHabit(newHabit);
      setShowNewHabit(false);
      setHabitsOpen(false);
    },
  });

  const renameHabitMutation = useMutation({
    mutationFn: async ({ id, name }) => {
      const res = await clientApi.patch(`/habits/${id}`, { name });
      return res.data.data;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['habits-registry'], (prev) =>
        (prev ?? []).map(h => h.id === updated.id ? { ...h, name: updated.name } : h)
      );
      if (activeHabit?.id === updated.id) {
        // Remove old tallies cache key; will refetch under new name
        queryClient.removeQueries({ queryKey: ['habits', activeHabit.name] });
        setActiveHabit(prev => ({ ...prev, name: updated.name }));
      }
    },
  });

  const deleteHabitMutation = useMutation({
    mutationFn: async (id) => {
      await clientApi.delete(`/habits/${id}`);
      return id;
    },
    onSuccess: (id) => {
      queryClient.setQueryData(['habits-registry'], (prev) => {
        const next = (prev ?? []).filter(h => h.id !== id);
        if (activeHabit?.id === id) {
          setActiveHabit(next.length > 0 ? next[0] : null);
        }
        return next;
      });
      setHabitToDelete(null);
    },
  });

  // ── Tally mutations ────────────────────────────────────────────────────────
  const addTallyMutation = useMutation({
    mutationFn: async ({ localDate, localTime }) => {
      const res = await clientApi.post(`/habits/${activeHabit.name}/tally`, { localDate, localTime });
      return res.data.data;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['habits', activeHabit.name], (prev) => {
        const list = prev ?? [];
        const existing = list.find(r => r.date === updated.date);
        if (existing) {
          return list.map(r => r.date === updated.date ? { ...r, ...updated } : r);
        } else {
          return [updated, ...list];
        }
      });
    },
  });

  const patchTallyMutation = useMutation({
    mutationFn: async ({ date, fields }) => {
      await clientApi.patch(`/habits/${activeHabit.name}/${date}`, fields);
      return { date, fields };
    },
    onSuccess: ({ date, fields }) => {
      queryClient.setQueryData(['habits', activeHabit.name], (prev) =>
        (prev ?? []).map(r => r.date === date ? { ...r, ...fields } : r)
      );
    },
  });

  // ── Ensure today row is always present ────────────────────────────────────
  const today = getTodayLocalDate();
  const todayExists = rows.some(r => r.date === today);
  const displayRows = todayExists
    ? rows
    : [{ date: today, count: 0, range_start: null, range_end: null }, ...rows];

  // ── Handlers ───────────────────────────────────────────────────────────────
  async function handleAddTally() {
    if (!activeHabit || addTallyMutation.isPending) return;
    addTallyMutation.mutate({ localDate: getTodayLocalDate(), localTime: getNowLocalTime() });
  }

  async function handleIncrement(date) {
    if (!activeHabit) return;
    const row = displayRows.find(r => r.date === date);
    if (!row) return;
    const newCount = row.count + 1;
    // Optimistic update
    queryClient.setQueryData(['habits', activeHabit.name], (prev) => {
      const list = prev ?? [];
      const existing = list.find(r => r.date === date);
      if (existing) return list.map(r => r.date === date ? { ...r, count: newCount } : r);
      return [{ date, count: newCount, range_start: null, range_end: null }, ...list];
    });
    try {
      await clientApi.patch(`/habits/${activeHabit.name}/${date}`, { count: newCount });
    } catch {
      // Roll back on failure
      queryClient.setQueryData(['habits', activeHabit.name], (prev) =>
        (prev ?? []).map(r => r.date === date ? { ...r, count: row.count } : r)
      );
    }
  }

  async function handleDecrement(date) {
    if (!activeHabit) return;
    const row = displayRows.find(r => r.date === date);
    if (!row || row.count === 0) return;
    const newCount = row.count - 1;
    // Optimistic update
    queryClient.setQueryData(['habits', activeHabit.name], (prev) =>
      (prev ?? []).map(r => r.date === date ? { ...r, count: newCount } : r)
    );
    try {
      await clientApi.patch(`/habits/${activeHabit.name}/${date}`, { count: newCount });
    } catch {
      // Roll back on failure
      queryClient.setQueryData(['habits', activeHabit.name], (prev) =>
        (prev ?? []).map(r => r.date === date ? { ...r, count: row.count } : r)
      );
    }
  }

  const handleRangeChange = useCallback(async (date, fields) => {
    patchTallyMutation.mutate({ date, fields });
  }, [patchTallyMutation]);

  // ── Render ─────────────────────────────────────────────────────────────────
  const habitsLoading = habitsQuery.isLoading;

  return (
    <section className={styles.container}>

      {/* ── Habit selector ──────────────────────────────────────────────── */}
      <div className={styles.habitSelectorWrap}>
        <button
          className={styles.habitSelectorBtn}
          onClick={() => setHabitsOpen(o => !o)}
          type="button"
          aria-expanded={habitsOpen}
          aria-label="Select habit"
          disabled={habitsLoading}
        >
          <span className={styles.habitSelectorName}>
            {habitsLoading
              ? 'Loading…'
              : activeHabit
              ? activeHabit.name
              : habits.length === 0
              ? 'No habits yet'
              : 'Select a habit'}
          </span>
          <svg
            className={`${styles.habitSelectorChevron} ${habitsOpen ? styles.habitSelectorChevronOpen : ''}`}
            viewBox="0 0 16 16"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <polyline points="4,6 8,10 12,6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {habitsOpen && (
          <div className={styles.habitDropdown}>
            {habits.map(habit => (
              <HabitListItem
                key={habit.id}
                habit={habit}
                isActive={activeHabit?.id === habit.id}
                onSelect={(h) => { setActiveHabit(h); setHabitsOpen(false); }}
                onRename={(id, newName) => renameHabitMutation.mutate({ id, name: newName })}
                onDelete={(h) => setHabitToDelete(h)}
              />
            ))}
            {showNewHabit ? (
              <NewHabitInput
                onSave={(name) => createHabitMutation.mutate(name)}
                onCancel={() => setShowNewHabit(false)}
              />
            ) : (
              <button
                className={styles.addHabitBtn}
                onClick={() => setShowNewHabit(true)}
                type="button"
                disabled={createHabitMutation.isPending}
              >
                <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <line x1="8" y1="2" x2="8" y2="14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                New habit
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Add tally button ─────────────────────────────────────────────── */}
      <button
        className={styles.addTallyBtn}
        onClick={handleAddTally}
        disabled={addTallyMutation.isPending || !activeHabit}
      >
        <span className={styles.addTallyPlus}>+</span> Add Tally
      </button>

      {/* ── Tally rows ───────────────────────────────────────────────────── */}
      {!activeHabit ? (
        <p className={styles.empty}>
          {habits.length === 0 ? 'Create a habit above to get started.' : 'Select a habit to view tallies.'}
        </p>
      ) : talliesLoading ? (
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

      {/* ── Confirm delete dialog ────────────────────────────────────────── */}
      {habitToDelete && (
        <ConfirmDeleteDialog
          habit={habitToDelete}
          onConfirm={() => deleteHabitMutation.mutate(habitToDelete.id)}
          onCancel={() => setHabitToDelete(null)}
        />
      )}
    </section>
  );
}

export default HabitTracker;
