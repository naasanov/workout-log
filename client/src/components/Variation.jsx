import Editable from './Editable';
import DateInput from './DateInput';
import { useEffect, useState } from 'react';
import styles from '../styles/Variation.module.scss';
import { Delete, Dumbbell, Calender, Number } from './Icons';
import api from '../api/api.js';

function Variation({ variation, setVariations }) {
  const [details, setDetails] = useState({});
  const [showRemove, setShowRemove] = useState(false);
  useEffect(() => {
    if (variation) {
      setDetails({
        weight: variation.weight ?? "___",
        reps: variation.reps ?? "___",
        date: variation.date
      })
    }
  }, [variation])

  async function handleRemove() {
    setVariations(prevVariations => (
      prevVariations.filter(v => (
        v.id !== variation.id
      ))
    ));
    try {
      await api.delete(`/variations/${variation.id}`)
    } catch (error) {
      console.error(error)
    }
  }

  async function handleLabelEdit(change) {
    setVariations(prevVariations => (
      prevVariations.map(v => (
        v.id === variation.id
          ? { ...v, label: change }
          : v
      ))
    ));
    try {
      await api.patch(`/variations/${variation.id}`, {
        label: change
      })
    } catch (error) {
      console.error(error)
    }
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

    try {
      await api.patch(`/variations/${variation.id}`, {
        [field]: change
      })
    } catch (error) {
      console.error(error.response.data.message)
    }
  }

  return (
    <>
      {/* variation label */}
      <div className={`${styles.part} ${styles.variationName}`} onMouseEnter={() => setShowRemove(true)} onMouseLeave={() => setShowRemove(false)}>
        <Editable value={variation.label} onSubmit={handleLabelEdit} />
      </div>

      {/* weight */}
      <div className={styles.part} onMouseEnter={() => setShowRemove(true)} onMouseLeave={() => setShowRemove(false)}>
        <Dumbbell className={styles.icon} />
        <Editable
          value={details.weight}
          onSubmit={change => handleDetailEdit("weight", change)}
          type="number"
        />
        <span> lbs</span>
      </div>

      {/* reps */}
      <div className={styles.part} onMouseEnter={() => setShowRemove(true)} onMouseLeave={() => setShowRemove(false)}>
        <Number className={styles.icon} />
        <Editable
          value={details.reps}
          onSubmit={change => handleDetailEdit("reps", change)}
          type="number"
        />
        <span> reps</span>
      </div>

      {/* whitespace */}
      <div onMouseEnter={() => setShowRemove(true)} onMouseLeave={() => setShowRemove(false)}></div>

      {/* date */}
      <div className={styles.part} onMouseEnter={() => setShowRemove(true)} onMouseLeave={() => setShowRemove(false)}>
        <Calender className={styles.icon} />
        <DateInput
          date={details.date}
          onSubmit={change => handleDetailEdit("date", change)}
        />
      </div>

      {/* remove */}
      <div onMouseEnter={() => setShowRemove(true)} onMouseLeave={() => setShowRemove(false)} className={`${styles.part} ${styles.remove}`}>
        <button className={styles.delete} onClick={handleRemove}>
          <Delete style={{ width: showRemove ? 'auto' : '0px' }} className={styles.icon} />
        </button>
      </div>
    </>
  )
}

export default Variation;