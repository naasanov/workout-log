import { useEffect, useState } from 'react';
import clientApi from '../../api/clientApi.js';
import useAuth from '../../hooks/useAuth.js';
import useIsMobile from '../../hooks/useIsMobile.js';
import ThinVariation from './ThinVariation.jsx';
import WideVariation from './WideVariation.jsx';

function Variation({ variation, setVariations, removeAllowed }) {
  const { isMobile } = useIsMobile();
  const [details, setDetails] = useState({});
  const [showRemove, setShowRemove] = useState(isMobile);
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

  async function handleLabelEdit(change) {
    setVariations(prevVariations => (
      prevVariations.map(v => (
        v.id === variation.id
          ? { ...v, label: change }
          : v
      ))
    ));
    await withAuth(() => (
      clientApi.patch(`/variations/${variation.id}`, {
        label: change
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

    setDetails(prevDetails => (
      { ...prevDetails, [field]: change }
    ));

    await withAuth(() => (
      clientApi.patch(`/variations/${variation.id}`, {
        [field]: change
      })
    ))
  }

  const props = { variation, details, handleLabelEdit, handleDetailEdit, handleRemove, showRemove, setShowRemove, removeAllowed }
  return (
    isMobile
    ? <ThinVariation {...props} />
    : <WideVariation {...props} />
  )
}

export default Variation;