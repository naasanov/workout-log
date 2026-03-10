import Movement from "./Movement.jsx";
import Editable from "./Editable.jsx";
import ConfirmModal from "./ConfirmModal.jsx";
import { useState, useEffect } from "react";
import styles from "../styles/Workouts.module.scss";
import plus from "../assets/plus.svg";
import CollapseButton from "./CollapseButton.jsx";
import X from "../assets/delete.svg";
import useAuth from '../hooks/useAuth.js';
import clientApi from "../api/clientApi.js";
import { v4 as uuid } from "uuid";
import useIsMobile from "../hooks/useIsMobile.js";

function Section({ setSections, section }) {
  const [hovering, setHovering] = useState(false);
  const [movements, setMovements] = useState([]);
  const [showConfirm, setShowConfirm] = useState(false);
  const { withAuth } = useAuth();
  const { isMobile } = useIsMobile();

  useEffect(() => {
    const fetchMovements = async () => {
      const res = await withAuth(() => clientApi.get(`/movements/section/${section.id}`));
      setMovements(res?.data.data ?? [])
    }
    fetchMovements();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section.id])

  async function handleRemove() {
    setSections(prevSections => (
      prevSections.filter((item) => item.id !== section.id)
    ));
    await withAuth(() => clientApi.delete(`/sections/${section.id}`))
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

  async function handleMovementSubmit(e) {
    e.preventDefault();
    const isFirst = movements.length === 0;
    const res = await withAuth(() => (
      clientApi.post(`/movements/${section.id}`, { label: "Exercise" })
    ));
    const key = res?.data.data.movementId ?? uuid();
    setMovements(prevMovements => (
      [...prevMovements, { id: key, label: 'Exercise' }]
    ))
    if (isFirst) {
      setSections(prevSections => (
        prevSections.map(s => s.id === section.id ? { ...s, showItems: true } : s)
      ));
      await withAuth(() => clientApi.patch(`/sections/${section.id}`, { is_open: true }));
    }
  }

  async function handleEditSubmit(value) {
    setSections(prevSections => (
      prevSections.map(s => (
        s.id === section.id
          ? { ...s, label: value }
          : s
      ))
    ))
    await withAuth(() => (
      clientApi.patch(`/sections/${section.id}`, { label: value })
    ))
  }

  async function handleDropdownClick() {
    setSections(prevSections => (
      prevSections.map(s => (
        s.id === section.id
          ? { ...s, showItems: !s.showItems }
          : s
      ))
    ));
    await withAuth(() => (
      clientApi.patch(`/sections/${section.id}`, { is_open: !section.showItems })
    ))
  }

  return (
    <section>
      {showConfirm && (
        <ConfirmModal
          message="Delete this section?"
          onConfirm={handleConfirmRemove}
          onCancel={handleCancelRemove}
        />
      )}
      <div className={styles.section} onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionPart}>
            <Editable
              className={styles.item}
              value={section.label}
              onSubmit={handleEditSubmit}
            />
            {(hovering && (section.showItems || movements.length === 0) && !isMobile) && (
              <div className={styles.addItem} >
                <button type='button' onClick={handleMovementSubmit}>Add Exercise</button>
                <img src={plus} alt="plus" />
              </div>
            )}
          </div>
          <div className={`${styles.sectionPart} ${styles.remove}`}>
            {(hovering || isMobile) &&
              <button type='button' onClick={handleRemoveClick} className={styles.icon}>
                <img src={X} alt="delete" />
              </button>
            }
            {movements.length > 0 &&
              <CollapseButton isOpen={section.showItems} onClick={handleDropdownClick} />
            }
          </div>
        </div>
        <div className={styles.mobileAdd}>
          {(section.showItems || movements.length === 0) && isMobile && (
            <div className={styles.addItem} >
              <button type='button' onClick={handleMovementSubmit}>Add Exercise</button>
              <img src={plus} alt="plus" />
            </div>
          )}
        </div>
      </div>
      {
        <ul className={styles.movements} style={{ display: section.showItems ? 'block' : 'none' }}>
          {movements.map((m) => (
            <Movement
              key={m.id ?? uuid()}
              movement={m}
              setMovements={setMovements}
              sectionId={section.id}
            />
          ))}
        </ul>
      }
    </section>
  );
}

export default Section;