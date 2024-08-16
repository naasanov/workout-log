import Editable from './Editable';
import { useError } from './ErrorProvider';
import { useState } from 'react';

import styles from '../styles/Variation.module.scss';

function Variation({ variation, setVariations }) {
  const [details, setDetails] = useState({
    weight: "weight",
    reps: "___",
    date: "date"
  });
  const [showRemove, setShowRemove] = useState(false);

  const setShowError = useError();

  function handleRemove() {
    setVariations(prevVariations => (
      prevVariations.filter(v => (
        v.id !== variation.id
      ))
    ));
  }

  function handleTitleEdit(change) {
    if (change === '') {
      setShowError(true);
      return;
    }

    setVariations(prevVariations => (
      prevVariations.map(v => (
        v.id === variation.id
          ? { ...v, name: change }
          : v
      ))
    ));
    setShowError(false);
  }

  function handleDetailEdit(field, change) {
    if (change === '') {
      setShowError(true);
      return;
    }

    setDetails(prevDetails => (
      { ...prevDetails, [field]: change }
    ));
    setShowError(false);
  }

  return (
    <div className={styles.variation} onMouseEnter={() => setShowRemove(true)} onMouseLeave={() => setShowRemove(false)}>
      <span>(<Editable value={variation.name} onSubmit={handleTitleEdit} />) </ span>
      <span><Editable value={details.weight} onSubmit={change => handleDetailEdit("weight", change)} /> - </ span>
      <span><Editable value={details.reps} onSubmit={change => handleDetailEdit("reps", change)} /> reps </ span>
      <span>(<Editable value={details.date} onSubmit={change => handleDetailEdit("date", change)} />)</ span>
      {showRemove && <button onClick={handleRemove}>x</button>}
      <br />
    </div>
  )
}

export default Variation;