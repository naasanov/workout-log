import Editable from "./Editable";
import Variation from "./variation/Variation";
import ConfirmModal from "./ConfirmModal";
import { useEffect, useState, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import useAuth from '../hooks/useAuth';
import clientApi from "../api/clientApi";
import styles from "../styles/Movement.module.scss";
import { v4 as uuid } from "uuid";
import { MoreVertical } from 'lucide-react';
import type { VariationData } from "./variation/Variation";

export type MovementData = {
  id: number | string;
  label: string;
};

type MovementMenuProps = {
  onAddVariation: () => void;
  onDeleteExercise: () => void;
};

// ---- Three-dots exercise menu (#95) ----
function MovementMenu({ onAddVariation, onDeleteExercise }: MovementMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // Close on outside tap/click
  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent | TouchEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
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
    function handleKey(e: KeyboardEvent) {
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

type VariationsStatus = 'loading' | 'error' | 'ready';

type MovementProps = {
  movement: MovementData;
  setMovements: Dispatch<SetStateAction<MovementData[]>>;
  // Passed by Section alongside `movement` but not currently read here;
  // kept so the call site stays a straightforward prop list.
  sectionId?: number | string;
  variationsStatus: VariationsStatus;
  serverVariations?: VariationData[];
};

function Movement({ movement, setMovements, variationsStatus, serverVariations }: MovementProps) {
  const [variations, setVariations] = useState<VariationData[]>([])
  const [showConfirm, setShowConfirm] = useState(false);
  const { withAuth } = useAuth();

  // Variations are fetched in one batched request by the parent Section
  useEffect(() => {
    if (variationsStatus === 'loading') return;
    setVariations(variationsStatus === 'error' || !serverVariations
      ? [{
        id: uuid(),
        label: "Variation",
        date: new Date()
      }]
      : serverVariations)
  }, [variationsStatus, serverVariations])

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

    const key: number | string = res?.data.data.variationId ?? uuid();
    setVariations(prevVariatons => (
      [...prevVariatons, { id: key, label: 'Variation', date: new Date() }]
    ))
  }

  async function handleNameEdit(change: string) {
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
