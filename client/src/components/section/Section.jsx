import Movement from "../Movement.jsx";
import Editable from "../Editable.jsx";
import { useState, useEffect } from "react";
import styles from "../../styles/Workouts.module.scss";
import plus from "../../assets/plus.svg";
import openDropdown from "../../assets/dropdown_open.svg";
import X from "../../assets/delete.svg";
import useAuth from '../../hooks/useAuth.js';
import clientApi from "../../api/clientApi.js";
import { v4 as uuid } from "uuid";
import useIsMobile from "../../hooks/useIsMobile.js";

function Section({ setSections, section }) {
  const [hovering, setHovering] = useState(false);
  const [showItems, setShowItems] = useState(true);
  const [movements, setMovements] = useState([]);
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

  async function handleMovementSubmit(e) {
    e.preventDefault();
    const res = await withAuth(() => (
      clientApi.post(`/movements/${section.id}`, { label: "Exercise" })
    ));
    const key = res?.data.data.movementId ?? uuid();
    setMovements(prevMovements => (
      [...prevMovements, { id: key, label: 'Exercise' }]
    ))
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

  return (
    <section>
      <div className={styles.section} onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionPart}>
            <Editable
              className={styles.item}
              value={section.label}
              onSubmit={handleEditSubmit}
            />
            {(hovering && showItems && !isMobile) && (
              <div className={styles.addItem} >
                <button type='button' onClick={handleMovementSubmit}>Add Exercise</button>
                <img src={plus} alt="plus" />
              </div>
            )}
          </div>
          <div className={`${styles.sectionPart} ${styles.remove}`}>
            {(hovering || isMobile) &&
              <button type='button' onClick={handleRemove} className={styles.icon}>
                <img src={X} alt="delete" />
              </button>
            }
            {movements.length > 0 &&
              <button type='button' onClick={() => setShowItems(prev => !prev)} className={styles.icon}>
                <img src={openDropdown} alt="dropdown" className={showItems ? styles.open : styles.closed} />
              </button>
            }
          </div>
        </div>
        <div className={styles.mobileAdd}>
          {showItems && isMobile && (
            <div className={styles.addItem} >
              <button type='button' onClick={handleMovementSubmit}>Add Exercise</button>
              <img src={plus} alt="plus" />
            </div>
          )}
        </div>
      </div>
      {
        <ul className={styles.movements} style={{ display: showItems ? 'block' : 'none' }}>
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