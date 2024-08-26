import Movement from "./Movement";
import Editable from "./Editable";
import { useError } from "./ErrorProvider";
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

    const setShowError = useError();

    function handleRemove() {
        setSections(prevSections => (
            prevSections.filter((item) => item.id !== section.id)
        ));
    }

    function handleMovementSubmit(e) {
        e.preventDefault();

        // adding a movement to this section
        const key = Date.now();
        setMovements(prevMovements => (
            [...prevMovements, { id: key, name: 'movement' }]
        ))

        setShowError(false);
    }

    function handleEditSubmit(value) {
        if (value === "") {
            setShowError(true);
            return;
        }

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
                        {hovering && (
                            <div className={styles.addItem} >
                                <button onClick={handleMovementSubmit}>Add Exercise</button>
                                <img src={plus} alt="plus" />
                            </div>
                        )}
                    </div>
                    <div className={styles.sectionPart}>
                        {hovering &&
                            <button onClick={handleRemove} className={styles.icon}>
                                <img src={X} alt="delete"/>
                            </button>
                        }
                        <button onClick={() => setShowItems(prev => !prev)} className={styles.icon}>
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