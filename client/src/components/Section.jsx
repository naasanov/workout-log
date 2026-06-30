import Movement from "./Movement.jsx";
import Editable from "./Editable.jsx";
import ConfirmModal from "./ConfirmModal.jsx";
import { useState, useEffect, useRef } from "react";
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
  const [showConfirm, setShowConfirm] = useState(false);
  const { withAuth } = useAuth();

  useEffect(() => {
    const fetchMovements = async () => {
      const res = await withAuth(() => clientApi.get(`/movements/section/${section.id}`));
      setMovements(res?.data.data ?? [])
    }
    fetchMovements();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section.id])

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
              />
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export default Section;
