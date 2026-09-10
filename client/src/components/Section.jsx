import Movement from "./Movement.jsx";
import Editable from "./Editable.jsx";
import ConfirmModal from "./ConfirmModal.jsx";
import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery } from '@tanstack/react-query';
import styles from "../styles/Workouts.module.scss";
import CollapseButton from "./CollapseButton.jsx";
import useAuth from '../hooks/useAuth.js';
import clientApi from "../api/clientApi.js";
import { v4 as uuid } from "uuid";
import { MoreVertical } from 'lucide-react';

// ---- Three-dots section menu (#95) ----
function SectionMenu({ onAddExercise, onDeleteSection }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);
  const btnRef = useRef(null);

  // Close on outside tap/click
  useEffect(() => {
    if (!open) return;
    function handleOutside(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e) {
      if (e.key === 'Escape') {
        setOpen(false);
        btnRef.current?.focus();
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  return (
    <div className={styles.dotsMenuWrapper} ref={wrapperRef}>
      <button
        ref={btnRef}
        className={styles.dotsBtn}
        onClick={() => setOpen(v => !v)}
        aria-label="Section options"
        aria-haspopup="true"
        aria-expanded={open}
        type="button"
      >
        <MoreVertical className={styles.dotsIcon} size={16} aria-hidden="true" />
      </button>

      {open && (
        <div className={styles.dotsDropdown} role="menu">
          <button
            className={styles.dotsDropdownItem}
            role="menuitem"
            type="button"
            onClick={() => { setOpen(false); onAddExercise(); }}
          >
            Add exercise
          </button>
          <button
            className={`${styles.dotsDropdownItem} ${styles.dotsDropdownItemDanger}`}
            role="menuitem"
            type="button"
            onClick={() => { setOpen(false); onDeleteSection(); }}
          >
            Delete section
          </button>
        </div>
      )}
    </div>
  );
}

function Section({ setSections, section }) {
  const [movements, setMovements] = useState([]);
  // null while loading, 'error' if the request failed, otherwise a movement id -> variations map
  const [variationsByMovement, setVariationsByMovement] = useState(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const { withAuth } = useAuth();

  // React-Query-backed (rather than a plain useEffect fetch into local
  // state) so a chat-confirmed agent mutation elsewhere can invalidate
  // ['movements'] and have this section's list actually refetch -- a plain
  // imperative fetch keyed only on section.id never re-runs on its own.
  // `movements` stays local state, synced from the query below, so the
  // existing optimistic add/remove/rename handlers can keep updating it
  // directly without waiting on a round trip (same pattern Workouts.jsx
  // uses for its own `sections` local state).
  const movementsQuery = useQuery({
    queryKey: ['movements', 'section', section.id],
    queryFn: async () => {
      const res = await clientApi.get(`/movements/section/${section.id}`);
      return res.data.data ?? [];
    },
    enabled: !!section.id,
  });

  useEffect(() => {
    if (movementsQuery.data) setMovements(movementsQuery.data);
  }, [movementsQuery.data]);

  // Fetch every movement's variations in one request rather than letting each Movement
  // fire its own — that fan-out was saturating the database connection pool on load.
  // Same React-Query rationale as movementsQuery above: ['variations', ...] is
  // what an agent-confirmed variation mutation invalidates.
  const movementIdsKey = movements.map(m => m.id).join(',');
  const movementIds = useMemo(
    () => movementIdsKey.split(',').filter(id => /^\d+$/.test(id)),
    [movementIdsKey]
  );

  const variationsQuery = useQuery({
    queryKey: ['variations', 'byMovementIds', movementIdsKey],
    queryFn: async () => {
      const res = await clientApi.get(`/variations/movements`, { params: { ids: movementIds.join(',') } });
      return res.data.data ?? {};
    },
    enabled: movementIds.length > 0,
  });

  useEffect(() => {
    if (movementIds.length === 0) {
      setVariationsByMovement({});
    } else if (variationsQuery.isError) {
      setVariationsByMovement('error');
    } else if (variationsQuery.data) {
      setVariationsByMovement(variationsQuery.data);
    } else {
      setVariationsByMovement(null); // loading
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movementIds.length, variationsQuery.data, variationsQuery.isError])

  async function handleRemove() {
    setSections(prevSections => (
      prevSections.filter((item) => item.id !== section.id)
    ));
    await withAuth(() => clientApi.delete(`/sections/${section.id}`))
  }

  function handleRemoveClick() {
    setShowConfirm(true);
  }

  async function handleConfirmRemove() {
    setShowConfirm(false);
    await handleRemove();
  }

  function handleCancelRemove() {
    setShowConfirm(false);
  }

  async function handleMovementSubmit() {
    const wasClosed = !section.showItems;
    const res = await withAuth(() => (
      clientApi.post(`/movements/${section.id}`, { label: "Exercise" })
    ));
    const key = res?.data.data.movementId ?? uuid();
    setMovements(prevMovements => (
      [...prevMovements, { id: key, label: 'Exercise' }]
    ))
    if (wasClosed) {
      setSections(prevSections => (
        prevSections.map(s => s.id === section.id ? { ...s, showItems: true } : s)
      ));
      await withAuth(() => clientApi.patch(`/sections/${section.id}`, { is_open: true }));
    }
  }

  async function handleEditSubmit(value) {
    setSections(prevSections => (
      prevSections.map(s => (
        s.id === section.id
          ? { ...s, label: value }
          : s
      ))
    ))
    await withAuth(() => (
      clientApi.patch(`/sections/${section.id}`, { label: value })
    ))
  }

  async function handleDropdownClick() {
    setSections(prevSections => (
      prevSections.map(s => (
        s.id === section.id
          ? { ...s, showItems: !s.showItems }
          : s
      ))
    ));
    await withAuth(() => (
      clientApi.patch(`/sections/${section.id}`, { is_open: !section.showItems })
    ))
  }

  return (
    <section>
      {showConfirm && (
        <ConfirmModal
          message="Delete this section?"
          onConfirm={handleConfirmRemove}
          onCancel={handleCancelRemove}
        />
      )}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionPart}>
            <Editable
              className={styles.item}
              value={section.label}
              onSubmit={handleEditSubmit}
            />
          </div>
          <div className={`${styles.sectionPart} ${styles.remove}`}>
            <SectionMenu
              onAddExercise={handleMovementSubmit}
              onDeleteSection={handleRemoveClick}
            />
            {movements.length > 0 &&
              <CollapseButton isOpen={section.showItems} onClick={handleDropdownClick} />
            }
          </div>
        </div>
      </div>
      <div className={`${styles.movementsWrap} ${section.showItems ? styles.movementsWrapOpen : ''}`}>
        <div className={styles.movementsInner}>
          <ul className={styles.movements}>
            {movements.map((m) => (
              <Movement
                key={m.id ?? uuid()}
                movement={m}
                setMovements={setMovements}
                sectionId={section.id}
                variationsStatus={
                  variationsByMovement === null ? 'loading'
                    : variationsByMovement === 'error' ? 'error'
                      : 'ready'
                }
                serverVariations={
                  variationsByMovement && variationsByMovement !== 'error'
                    ? variationsByMovement[m.id]
                    : undefined
                }
              />
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export default Section;
