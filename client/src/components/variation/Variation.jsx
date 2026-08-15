import { useEffect, useRef, useState } from 'react';
import clientApi from '../../api/clientApi.js';
import useAuth from '../../hooks/useAuth.js';
import useIsMobile from '../../hooks/useIsMobile.js';
import { useError } from '../../context/ErrorProvider.jsx';
import ThinVariation from './ThinVariation.jsx';
import WideVariation from './WideVariation.jsx';
import ConfirmModal from '../ConfirmModal.jsx';
import WeightGraphModal from '../WeightGraphModal.jsx';
import VariationNotesModal from '../VariationNotesModal.jsx';

// #231 — weight and reps display "no value yet" as the literal string
// "___" (see the `details` initializer below). Editable's own type="number"
// effect already treats that as blank input; this mirrors the same check so
// the joint commit handler can tell "no real value" apart from a real 0.
function numberDisplay(value) {
  return isNaN(value) ? "" : `${value}`;
}

function Variation({ variation, setVariations, removeAllowed }) {
  const { isMobile } = useIsMobile();
  const [details, setDetails] = useState({});
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
  const [pairFocus, setPairFocus] = useState(null); // 'weight' | 'reps' | null
  const [pairInputs, setPairInputs] = useState({ weight: '', reps: '' });
  const weightInputRef = useRef(null);
  const repsInputRef = useRef(null);
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
  function openPair(field) {
    setPairInputs({
      weight: numberDisplay(details.weight),
      reps: numberDisplay(details.reps)
    });
    setPairFocus(field);
    setPairEditing(true);
  }

  function handlePairInputChange(field, value) {
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

    let weightVal = weightRaw ? parseFloat(weightRaw) : NaN;
    let repsVal = repsRaw ? parseInt(repsRaw) : NaN;

    // A field left blank (or otherwise unparseable) falls back to its prior
    // value and surfaces the error banner — it must never PATCH NaN.
    let hasBlank = false;
    if (!weightRaw || isNaN(weightVal)) {
      hasBlank = true;
      weightVal = priorWeight;
    }
    if (!repsRaw || isNaN(repsVal)) {
      hasBlank = true;
      repsVal = priorReps;
    }

    if (hasBlank) setShowError(true);

    setPairEditing(false);
    setPairFocus(null);

    const today = new Date();
    setDetails(prevDetails => ({
      ...prevDetails,
      ...(weightVal !== undefined ? { weight: weightVal } : {}),
      ...(repsVal !== undefined ? { reps: repsVal } : {}),
      date: today
    }));

    const payload = { date: today.toISOString() };
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

    function handleOutsideClick(e) {
      const insideGroup = [weightInputRef.current, repsInputRef.current]
        .some(el => el && el.contains(e.target));
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

  async function handleLabelEdit(change) {
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

  async function handleDetailEdit(field, change) {
    if (field === "weight") {
      change = parseFloat(change);
    }
    else if (field === "reps") {
      change = parseInt(change);
    }

    const today = new Date();
    const dateUpdate = field === "date" ? {} : { date: today };

    setDetails(prevDetails => ({
      ...prevDetails,
      [field]: change,
      ...dateUpdate
    }));

    await withAuth(() => (
      clientApi.patch(`/variations/${variation.id}`, {
        [field]: change,
        ...(field === "date" ? {} : { date: today.toISOString() })
      })
    ))
  }

  async function handleNotesEdit(change) {
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

  const props = {
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
          notes={variation.notes}
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