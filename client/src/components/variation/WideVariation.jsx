import Editable from "../Editable";
import styles from "../../styles/Variation.module.scss";
import { Dumbbell, Number, Delete, Calender, Chart } from "../Icons";
import DateInput from "../DateInput";

function WideVariation({ variation, details, handleLabelEdit, handleDetailEdit, handleRemove, showRemove, setShowRemove, removeAllowed, onGraphOpen }) {
  const hoverProps = {
    onMouseEnter: () => setShowRemove(true),
    onMouseLeave: () => setShowRemove(false)
  }

  return (
    <>
      {/* variation label */}
      <div className={`${styles.part} ${styles.variationName}`} {...hoverProps}>
        <Editable value={variation.label} onSubmit={handleLabelEdit} />
      </div>

      {/* weight */}
      <div className={styles.part} {...hoverProps}>
        <Dumbbell className={styles.icon} />
        <Editable
          value={details.weight}
          onSubmit={change => handleDetailEdit("weight", change)}
          type="number"
        />
        <span> lbs</span>
      </div>

      {/* reps */}
      <div className={styles.part} {...hoverProps}>
        <Number className={styles.icon} />
        <Editable
          value={details.reps}
          onSubmit={change => handleDetailEdit("reps", change)}
          type="number"
        />
        <span> reps</span>
      </div>

      {/* whitespace */}
      <div {...hoverProps}></div>

      {/* date + graph + remove grouped for right-alignment */}
      <div className={styles.rightGroup} {...hoverProps}>
        <div className={styles.part}>
          <Calender className={styles.icon} />
          <DateInput
            date={details.date}
            onSubmit={change => handleDetailEdit("date", change)}
          />
        </div>

        <button className={styles.graphBtn} onClick={onGraphOpen}>
          <Chart className={styles.icon} />
        </button>

        {removeAllowed
          ? (
            <button className={styles.delete} onClick={handleRemove}>
              <Delete style={{ visibility: showRemove ? 'visible' : 'hidden' }} className={styles.icon} />
            </button>
          )
          : (
            <div className={styles.noRemove} />
          )
        }
      </div>
    </>
  );
}

export default WideVariation;