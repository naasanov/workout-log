import { useEffect, useState } from 'react';
import clientApi from '../../api/clientApi.js';
import useAuth from '../../hooks/useAuth.js';
import useIsMobile from '../../hooks/useIsMobile.js';
import ThinVariation from './ThinVariation.jsx';
import WideVariation from './WideVariation.jsx';
import ConfirmModal from '../ConfirmModal.jsx';
import WeightGraphModal from '../WeightGraphModal.jsx';

function Variation({ variation, setVariations, removeAllowed }) {
  const { isMobile } = useIsMobile();
  const [details, setDetails] = useState({});
  const [showRemove, setShowRemove] = useState(isMobile);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showGraph, setShowGraph] = useState(false);
  const { withAuth } = useAuth();

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

  const props = { variation, details, handleLabelEdit, handleDetailEdit, handleRemove: handleRemoveClick, showRemove, setShowRemove, removeAllowed, onGraphOpen: () => setShowGraph(true) }
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
      {isMobile
        ? <ThinVariation {...props} />
        : <WideVariation {...props} />
      }
    </>
  )
}

export default Variation;