import Editable from "../Editable";
import styles from "../../styles/Variation.module.scss";
import { Dumbbell, Number, Delete, Chart, Notes } from "../Icons";
import DateInput from "../DateInput";

function WideVariation({
  variation, details, handleLabelEdit, handleDetailEdit, handleRemove, showRemove, setShowRemove, removeAllowed,
  onGraphOpen, onNotesOpen, hasNotes,
  pairEditing, pairFocus, weightInputRef, repsInputRef, onOpenPair, onPairInputChange, onPairSubmit
}) {
  const hoverProps = {
    onMouseEnter: () => setShowRemove(true),
    onMouseLeave: () => setShowRemove(false)
  }

  return (
    <>
      {/* variation label + date subtext */}
      <div className={styles.nameCell} {...hoverProps}>
        <div className={`${styles.part} ${styles.variationName}`}>
          <Editable value={variation.label} onSubmit={handleLabelEdit} />
        </div>
        <div className={styles.dateSubtext}>
          <DateInput
            date={details.date}
            onSubmit={change => handleDetailEdit("date", change)}
          />
        </div>
      </div>

      {/* weight + reps: joined into one editing pair (#231) — tapping
          either one opens both, so a single PATCH covers both fields and
          the server logs one history row instead of two. */}
      <div className={styles.part} {...hoverProps}>
        <Dumbbell className={styles.icon} />
        <Editable
          value={details.weight}
          editing={pairEditing}
          onEditingChange={opening => opening && onOpenPair("weight")}
          autoFocus={pairFocus === "weight"}
          onInputChange={change => onPairInputChange("weight", change)}
          onSubmit={onPairSubmit}
          inputRef={weightInputRef}
          type="number"
        />
        <span> lbs</span>
      </div>

      {/* reps */}
      <div className={styles.part} {...hoverProps}>
        <Number className={styles.icon} />
        <Editable
          value={details.reps}
          editing={pairEditing}
          onEditingChange={opening => opening && onOpenPair("reps")}
          autoFocus={pairFocus === "reps"}
          onInputChange={change => onPairInputChange("reps", change)}
          onSubmit={onPairSubmit}
          inputRef={repsInputRef}
          type="number"
        />
        <span> reps</span>
      </div>

      {/* whitespace */}
      <div {...hoverProps}></div>

      {/* graph + remove grouped for right-alignment */}
      <div className={styles.rightGroup} {...hoverProps}>
        <button
          className={`${styles.notesBtn} ${hasNotes ? styles.notesBtnActive : ''}`}
          onClick={onNotesOpen}
          aria-label="Notes"
        >
          <Notes className={styles.icon} />
        </button>

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