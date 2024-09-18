import Movement from "./Movement";
import Editable from "./Editable";
import { useState } from "react";

import styles from "../styles/Workouts.module.scss";
import plus from "../assets/plus.svg";
import closedDropdown from "../assets/dropdown_closed.svg";
import openDropdown from "../assets/dropdown_open.svg";
import X from "../assets/delete.svg";

function Section({ setSections, section }) {
    const [hovering, setHovering] = useState(false);
    const [showItems, setShowItems] = useState(true);
    const [movements, setMovements] = useState([]);

    function handleRemove() {
        setSections(prevSections => (
            prevSections.filter((item) => item.id !== section.id)
        ));
    }

    function handleMovementSubmit(e) {
        e.preventDefault();

        const key = Date.now();
        setMovements(prevMovements => (
            [...prevMovements, { id: key, name: 'Exercise' }]
        ))
    }

    function handleEditSubmit(value) {
        setSections(prevSections => (
            prevSections.map(s => (
                s.id === section.id
                    ? { ...s, editing: false, name: value }
                    : s
            ))
        ))
    }

    return (
        <section>
            <div className={styles.section} onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)}>
                    <div className={styles.sectionPart}>
                        <Editable
                            className={styles.item}
                            value={section.name}
                            onSubmit={handleEditSubmit}
                        />
                        {hovering && showItems && (
                            <div className={styles.addItem} >
                                <button type='button' onClick={handleMovementSubmit}>Add Exercise</button>
                                <img src={plus} alt="plus" />
                            </div>
                        )}
                    </div>
                    <div className={styles.sectionPart}>
                        {hovering &&
                            <button type='button'  onClick={handleRemove} className={styles.icon}>
                                <img src={X} alt="delete"/>
                            </button>
                        }
                        <button type='button'  onClick={() => setShowItems(prev => !prev)} className={styles.icon}>
                            <img src={showItems ? openDropdown : closedDropdown} alt="dropdown closed" />
                        </button>
                    </div>
            </div>
            {
                <ul className={styles.movements} style={{ display: showItems ? 'block' : 'none' }}>
                    {movements.map((m) => (
                        <Movement
                            key={m.id}
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