import { useEffect, useRef, useState } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import clientApi from '../../api/clientApi';
import useAuth from '../../hooks/useAuth';
import useIsMobile from '../../hooks/useIsMobile';
import { useError } from '../../context/ErrorProvider';
import ThinVariation from './ThinVariation';
import WideVariation from './WideVariation';
import ConfirmModal from '../ConfirmModal';
import WeightGraphModal from '../WeightGraphModal';
import VariationNotesModal from '../VariationNotesModal';

// A single exercise variation, as returned by the server (and as optimistically
// created client-side -- see Movement.tsx). `date` arrives as an ISO string over
// JSON but can also be a freshly-created client-side Date before the next fetch.
export type VariationData = {
  id: number | string;
  label: string;
  date: Date | string;
  weight?: number | null;
  reps?: number | null;
  notes?: string | null;
};

// #231 -- weight and reps display "no value yet" as the literal string "___"
// until a real value is entered; see the `details` initializer below.
type VariationDetails = {
  weight: number | '___';
  reps: number | '___';
  date: Date | string;
};

type PairField = 'weight' | 'reps';

// Props shared with ThinVariation/WideVariation, which each render a subset
// of this (mobile vs. desktop layouts) -- see those files.
export type VariationDisplayProps = {
  variation: VariationData;
  details: Partial<VariationDetails>;
  handleLabelEdit: (value: string) => void;
  handleDetailEdit: (field: 'date', change: Date) => void;
  handleRemove: () => void;
  showRemove: boolean;
  setShowRemove: Dispatch<SetStateAction<boolean>>;
  removeAllowed: boolean;
  onGraphOpen: () => void;
  onNotesOpen: () => void;
  hasNotes: boolean;
  // #231 -- joint weight/reps editing (see below)
  pairEditing: boolean;
  pairFocus: PairField | null;
  weightInputRef: RefObject<HTMLInputElement>;
  repsInputRef: RefObject<HTMLInputElement>;
  onOpenPair: (field: PairField) => void;
  onPairInputChange: (field: PairField, value: string) => void;
  onPairSubmit: () => void;
};

// #231 — weight and reps display "no value yet" as the literal string
// "___" (see the `details` initializer below). Editable's own type="number"
// effect already treats that as blank input; this mirrors the same check so
// the joint commit handler can tell "no real value" apart from a real 0.
function numberDisplay(value: number | '___' | undefined): string {
  return isNaN(Number(value)) ? "" : `${value}`;
}

type VariationProps = {
  variation: VariationData;
  setVariations: Dispatch<SetStateAction<VariationData[]>>;
  removeAllowed: boolean;
};

function Variation({ variation, setVariations, removeAllowed }: VariationProps) {
  const { isMobile } = useIsMobile();
  const [details, setDetails] = useState<Partial<VariationDetails>>({});
  const [showRemove, setShowRemove] = useState(isMobile);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showGraph, setShowGraph] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const { withAuth } = useAuth();
  const setShowError = useError();

  // #231 — weight and reps are joined into a single logical form: tapping
  // either one opens BOTH as inputs, and Enter/outside-click commits both
  // together in one PATCH. This is what collapses what used to be two
  // separate PATCHes (and two `variation_history` rows) into one.
  const [pairEditing, setPairEditing] = useState(false);
  const [pairFocus, setPairFocus] = useState<PairField | null>(null);
  const [pairInputs, setPairInputs] = useState({ weight: '', reps: '' });
  const weightInputRef = useRef<HTMLInputElement>(null);
  const repsInputRef = useRef<HTMLInputElement>(null);
  const commitPairRef = useRef(() => {});

  useEffect(() => {
    if (variation) setDetails({
        weight: variation.weight ?? "___",
        reps: variation.reps ?? "___",
        date: variation.date
      })
  }, [variation])

  useEffect(() => {
    setShowRemove(isMobile);
  }, [isMobile])

  // #231 — opens BOTH weight and reps as inputs; `field` only decides which
  // one receives focus/select (the one the user actually tapped).
  function openPair(field: PairField) {
    setPairInputs({
      weight: numberDisplay(details.weight),
      reps: numberDisplay(details.reps)
    });
    setPairFocus(field);
    setPairEditing(true);
  }

  function handlePairInputChange(field: PairField, value: string) {
    setPairInputs(prev => ({ ...prev, [field]: value }));
  }

  // #231 — the single commit path for the weight/reps pair: fires on Enter
  // in either field, or on a click outside both inputs. Always issues ONE
  // PATCH carrying both weight and reps (plus date), so the server logs
  // exactly one variation_history row instead of one per field — that's the
  // bug this whole pairing exists to fix.
  async function commitPairEdit() {
    const weightRaw = pairInputs.weight.trim();
    const repsRaw = pairInputs.reps.trim();

    // "___" (no value yet) fails typeof === 'number', same as a real prior
    // value that just isn't there.
    const priorWeight = typeof details.weight === 'number' ? details.weight : undefined;
    const priorReps = typeof details.reps === 'number' ? details.reps : undefined;

    let weightVal: number | undefined = weightRaw ? parseFloat(weightRaw) : NaN;
    let repsVal: number | undefined = repsRaw ? parseInt(repsRaw) : NaN;

    // A field left blank (or otherwise unparseable) falls back to its prior
    // value and must never PATCH NaN. The error banner is only for a field
    // the user actually CLEARED — a field that never had a value ("___", e.g.
    // the weight of a freshly created variation, or reps before the first
    // edit) is legitimately blank, and opening the pair to fill in the OTHER
    // field must not accuse the user of emptying it.
    let clearedExisting = false;
    if (!weightRaw || isNaN(weightVal)) {
      if (priorWeight !== undefined) clearedExisting = true;
      weightVal = priorWeight;
    }
    if (!repsRaw || isNaN(repsVal)) {
      if (priorReps !== undefined) clearedExisting = true;
      repsVal = priorReps;
    }

    if (clearedExisting) setShowError?.(true);

    setPairEditing(false);
    setPairFocus(null);

    const today = new Date();
    setDetails(prevDetails => ({
      ...prevDetails,
      ...(weightVal !== undefined ? { weight: weightVal } : {}),
      ...(repsVal !== undefined ? { reps: repsVal } : {}),
      date: today
    }));

    const payload: { date: string; weight?: number; reps?: number } = { date: today.toISOString() };
    if (weightVal !== undefined) payload.weight = weightVal;
    if (repsVal !== undefined) payload.reps = repsVal;

    // Both fields blank with no prior value at all — nothing real to
    // persist, so skip the request rather than PATCHing an empty change.
    if (!('weight' in payload) && !('reps' in payload)) return;

    await withAuth(() => (
      clientApi.patch(`/variations/${variation.id}`, payload)
    ))
  }

  // Keep the ref pointing at the latest closure so the outside-click
  // listener below always runs a fresh commit without needing to be
  // re-registered on every keystroke (which would risk leaking/duplicating
  // listeners across renders).
  commitPairRef.current = commitPairEdit;

  // #231 — outside-click detection for the pair as ONE unit. The two
  // Editable instances don't share a DOM wrapper (ThinVariation nests them
  // in separate `.part` divs under one `<section>`; WideVariation puts them
  // in separate CSS-grid cells with an unrelated element in between). So
  // "was this click inside the group" is built from both inputs' refs
  // directly, not a shared container — a click landing on the OTHER
  // field's input must NOT count as "outside" (that was the original bug:
  // clicking from the weight input into the reps input committed weight
  // prematurely).
  useEffect(() => {
    if (!pairEditing) return;

    function handleOutsideClick(e: MouseEvent) {
      const insideGroup = [weightInputRef.current, repsInputRef.current]
        .some(el => el && el.contains(e.target as Node));
      if (!insideGroup) {
        commitPairRef.current();
      }
    }

    document.addEventListener('click', handleOutsideClick, true);
    return () => {
      document.removeEventListener('click', handleOutsideClick, true);
    }
  }, [pairEditing]);

  async function handleRemove() {
    setVariations(prevVariations => (
      prevVariations.filter(v => (
        v.id !== variation.id
      ))
    ));
    await withAuth(() => clientApi.delete(`/variations/${variation.id}`))
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

  async function handleLabelEdit(change: string) {
    const today = new Date();
    setVariations(prevVariations => (
      prevVariations.map(v => (
        v.id === variation.id
          ? { ...v, label: change }
          : v
      ))
    ));
    setDetails(prevDetails => ({ ...prevDetails, date: today }));
    await withAuth(() => (
      clientApi.patch(`/variations/${variation.id}`, {
        label: change,
        date: today.toISOString()
      })
    ))
  }

  // Only ever called with field "date" today (ThinVariation/WideVariation's
  // DateInput) -- weight/reps now go through the joint pair-edit flow above.
  async function handleDetailEdit(field: 'date', change: Date) {
    setDetails(prevDetails => ({
      ...prevDetails,
      [field]: change
    }));

    await withAuth(() => (
      clientApi.patch(`/variations/${variation.id}`, {
        [field]: change.toISOString()
      })
    ))
  }

  async function handleNotesEdit(change: string) {
    // Note edits don't bump `date` — date reflects when the lift was last
    // updated, and a note edit isn't a PR update.
    setVariations(prevVariations => (
      prevVariations.map(v => (
        v.id === variation.id
          ? { ...v, notes: change }
          : v
      ))
    ));
    await withAuth(() => (
      clientApi.patch(`/variations/${variation.id}`, { notes: change })
    ))
  }

  const props: VariationDisplayProps = {
    variation, details, handleLabelEdit, handleDetailEdit,
    handleRemove: handleRemoveClick, showRemove, setShowRemove, removeAllowed,
    onGraphOpen: () => setShowGraph(true), onNotesOpen: () => setShowNotes(true),
    hasNotes: !!(variation.notes && variation.notes.trim()),
    // #231 — joint weight/reps editing (see above)
    pairEditing, pairFocus, weightInputRef, repsInputRef,
    onOpenPair: openPair, onPairInputChange: handlePairInputChange, onPairSubmit: commitPairEdit
  }
  return (
    <>
      {showConfirm && (
        <ConfirmModal
          message="Delete this variation?"
          onConfirm={handleConfirmRemove}
          onCancel={handleCancelRemove}
        />
      )}
      {showGraph && (
        <WeightGraphModal
          variation={variation}
          onClose={() => setShowGraph(false)}
        />
      )}
      {showNotes && (
        <VariationNotesModal
          variation={variation}
          notes={variation.notes ?? null}
          onSave={handleNotesEdit}
          onClose={() => setShowNotes(false)}
        />
      )}
      {isMobile
        ? <ThinVariation {...props} />
        : <WideVariation {...props} />
      }
    </>
  )
}

export default Variation;
