import Editable from './Editable';
import { useState } from 'react';

import styles from '../styles/Variation.module.scss';

import { Delete, Dumbbell, Calender, Number } from './Icons';

function Variation({ variation, setVariations }) {
  const [details, setDetails] = useState({
    weight: "___",
    reps: "___",
    date: "mm/dd/yy"
  });
  const [showRemove, setShowRemove] = useState(false);

  function handleRemove() {
    setVariations(prevVariations => (
      prevVariations.filter(v => (
        v.id !== variation.id
      ))
    ));
  }

  function handleTitleEdit(change) {
    setVariations(prevVariations => (
      prevVariations.map(v => (
        v.id === variation.id
          ? { ...v, name: change }
          : v
      ))
    ));
  }

  function handleDetailEdit(field, change) {
    setDetails(prevDetails => (
      { ...prevDetails, [field]: change }
    ));
  }

  return (
    <>
      {/* variation name */}
      <div className={`${styles.part} ${styles.variationName}`} onMouseEnter={() => setShowRemove(true)} onMouseLeave={() => setShowRemove(false)}>
        <Editable value={variation.name} onSubmit={handleTitleEdit} />
      </ div>

      {/* weight */}
      <div className={styles.part} onMouseEnter={() => setShowRemove(true)} onMouseLeave={() => setShowRemove(false)}>
        <Dumbbell className={styles.icon}/>
        <Editable value={details.weight} onSubmit={change => handleDetailEdit("weight", change)} />
        <span> lbs</span>
      </ div>

      {/* reps */}
      <div className={styles.part} onMouseEnter={() => setShowRemove(true)} onMouseLeave={() => setShowRemove(false)}>
        <Number className={styles.icon}/>
        <Editable value={details.reps} onSubmit={change => handleDetailEdit("reps", change)} />
        <span> reps</span>
      </ div>

      {/* whitespace */}
      <div onMouseEnter={() => setShowRemove(true)} onMouseLeave={() => setShowRemove(false)}></div>

      {/* date */}
      <div className={styles.part} onMouseEnter={() => setShowRemove(true)} onMouseLeave={() => setShowRemove(false)}>
        <Calender className={styles.icon}/>
        <Editable value={details.date} onSubmit={change => handleDetailEdit("date", change)} />
      </ div>

      {/* remove */}
      <div onMouseEnter={() => setShowRemove(true)} onMouseLeave={() => setShowRemove(false)} className={`${styles.part} ${styles.remove}`}>
        <button className={styles.delete} onClick={handleRemove}>
          <Delete style={{ width: showRemove ? 'auto' : '0px' }} className={styles.icon}/>
        </button>
      </div>
    </>
  )
}

export default Variation;