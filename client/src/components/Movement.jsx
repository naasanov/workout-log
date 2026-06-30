import Editable from "./Editable";
import Variation from "./variation/Variation";
import ConfirmModal from "./ConfirmModal";
import { useEffect, useState, useRef } from "react";
import useAuth from '../hooks/useAuth.js';
import clientApi from "../api/clientApi.js";
import styles from "../styles/Movement.module.scss";
import { v4 as uuid } from "uuid";
import { MoreVertical } from 'lucide-react';

// ---- Three-dots exercise menu (#95) ----
function MovementMenu({ onAddVariation, onDeleteExercise }) {
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
        aria-label="Exercise options"
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
            onClick={() => { setOpen(false); onAddVariation(); }}
          >
            Add variation
          </button>
          <button
            className={`${styles.dotsDropdownItem} ${styles.dotsDropdownItemDanger}`}
            role="menuitem"
            type="button"
            onClick={() => { setOpen(false); onDeleteExercise(); }}
          >
            Delete exercise
          </button>
        </div>
      )}
    </div>
  );
}

function Movement({ movement, setMovements }) {
  const [variations, setVariations] = useState([])
  const [showConfirm, setShowConfirm] = useState(false);
  const { withAuth } = useAuth();

  useEffect(() => {
    const fetchMovements = async () => {
      const res = await withAuth(() => clientApi.get(`/variations/movement/${movement.id}`));
      setVariations(res?.data.data ?? [{
        id: uuid(),
        label: "Variation",
        date: new Date()
      }])
    }
    fetchMovements();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movement.id])

  async function handleRemove() {
    setMovements(prevMovements => (
      prevMovements.filter(m => m.id !== movement.id)
    ));
    await withAuth(() => clientApi.delete(`/movements/${movement.id}`))
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

  async function handleVariationSubmit() {
    const res = await withAuth(() => (
      clientApi.post(`/variations/${movement.id}`, {
        label: "Variation"
      })
    ))

    const key = res?.data.data.variationId ?? uuid();
    setVariations(prevVariatons => (
      [...prevVariatons, { id: key, label: 'Variation', date: new Date() }]
    ))
  }

  async function handleNameEdit(change) {
    setMovements(prevMovements => (
      prevMovements.map(m => (
        m.id === movement.id
          ? { ...m, label: change }
          : m
      ))
    ))
    await withAuth(() => (
      clientApi.patch(`/movements/${movement.id}`, {
        label: change
      })
    ))
  }

  return (
    <li className={styles.section}>
      {showConfirm && (
        <ConfirmModal
          message="Delete this exercise?"
          onConfirm={handleConfirmRemove}
          onCancel={handleCancelRemove}
        />
      )}
      <div className={styles.header}>
        {/* label */}
        <Editable className={styles.sectionPart} value={movement.label} onSubmit={handleNameEdit} />

        {/* three-dots menu */}
        <MovementMenu
          onAddVariation={handleVariationSubmit}
          onDeleteExercise={handleRemoveClick}
        />
      </div>

      {/* variations */}
      <div className={styles.variations}>
        {variations.map(v => <Variation key={v.id} variation={v} setVariations={setVariations} removeAllowed={variations.length > 1}/>)}
      </div>
    </li>
  )
}

export default Movement;
