import Editable from './Editable';
import { useState } from 'react';

import styles from '../styles/Variation.module.scss';

import X from '../assets/delete.svg';
import dumbbell from '../assets/dumbbell.svg';
import number from '../assets/number.svg';
import calender from '../assets/calender.svg';

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
        <img className={styles.icon} src={dumbbell} alt='dumbbell icon'/>
        <Editable value={details.weight} onSubmit={change => handleDetailEdit("weight", change)} />
        <span> lbs</span>
      </ div>

      {/* reps */}
      <div className={styles.part} onMouseEnter={() => setShowRemove(true)} onMouseLeave={() => setShowRemove(false)}>
        <img className={styles.icon} src={number} alt='number icon'/>
        <Editable value={details.reps} onSubmit={change => handleDetailEdit("reps", change)} />
        <span> reps</span>
      </ div>

      {/* whitespace */}
      <div onMouseEnter={() => setShowRemove(true)} onMouseLeave={() => setShowRemove(false)}></div>

      {/* date */}
      <div className={styles.part} onMouseEnter={() => setShowRemove(true)} onMouseLeave={() => setShowRemove(false)}>
        <img className={styles.icon} src={calender} alt='date icon'/>
        <Editable value={details.date} onSubmit={change => handleDetailEdit("date", change)} />
      </ div>

      {/* remove */}
      <div onMouseEnter={() => setShowRemove(true)} onMouseLeave={() => setShowRemove(false)} className={`${styles.part} ${styles.remove}`}>
        <button className={styles.delete} onClick={handleRemove}>
          <img style={{ width: showRemove ? 'auto' : '0px' }} src={X} alt="delete" />
        </button>
      </div>
    </>
  )
}

export default Variation;