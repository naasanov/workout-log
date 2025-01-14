import Editable from './Editable';
import DateInput from './DateInput';
import { useEffect, useState } from 'react';
import styles from '../styles/Variation.module.scss';
import { Delete, Dumbbell, Calender, Number } from './Icons';
import clientApi from '../api/clientApi.js';
import useAuth from '../hooks/useAuth.js';

function Variation({ variation, setVariations }) {
  const [details, setDetails] = useState({});
  const [showRemove, setShowRemove] = useState(false);
  const { withAuth } = useAuth();

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
    console.log("before validation: ", change)
    if (field === "weight") {
      change = parseFloat(change);
    }
    else if (field === "reps") {
      change = parseInt(change);
    }
    console.log("after validation: ", change)

    setDetails(prevDetails => (
      { ...prevDetails, [field]: change }
    ));

    await withAuth(() => (
      clientApi.patch(`/variations/${variation.id}`, {
        [field]: change
      })
    ))
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