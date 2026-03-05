import Editable from "../Editable";
import styles from "../../styles/Variation.module.scss";
import mobileStyles from "../../styles/ThinVariation.module.scss";
import { Dumbbell, Number, Delete, Calender, Chart } from "../Icons";
import DateInput from "../DateInput";

function ThinVariation({ variation, details, handleLabelEdit, handleDetailEdit, handleRemove, showRemove, removeAllowed, onGraphOpen }) {
  return (
    <div className={mobileStyles.variation}>
      <section>
        {/* variation label */}
        <div className={`${styles.part} ${styles.variationName} ${mobileStyles.variationName}`}>
          <Editable value={variation.label} onSubmit={handleLabelEdit} />
        </div>

        {/* date + graph + remove grouped for consistent right-alignment */}
        <div className={mobileStyles.rightGroup}>
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
                <Delete className={styles.icon} />
              </button>
            )
            : (
              <div className={styles.noRemove} />
            )
          }
        </div>
      </section>

      <section>
        {/* weight */}
        <div className={`${styles.part} ${mobileStyles.weight}`}>
          <Dumbbell className={styles.icon} />
          <Editable
            value={details.weight}
            onSubmit={change => handleDetailEdit("weight", change)}
            type="number"
          />
          <span> lbs</span>
        </div>

        {/* reps */}
        <div className={styles.part}>
          <Number className={styles.icon} />
          <Editable
            value={details.reps}
            onSubmit={change => handleDetailEdit("reps", change)}
            type="number"
          />
          <span> reps</span>
        </div>
      </section>
    </div>
  );
}

export default ThinVariation;