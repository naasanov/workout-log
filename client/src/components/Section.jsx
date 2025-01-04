import Movement from "./Movement";
import Editable from "./Editable";
import { useState, useEffect } from "react";
import styles from "../styles/Workouts.module.scss";
import plus from "../assets/plus.svg";
import openDropdown from "../assets/dropdown_open.svg";
import X from "../assets/delete.svg";
import api from "../api/api.js";

function Section({ setSections, section }) {
    const [hovering, setHovering] = useState(false);
    const [showItems, setShowItems] = useState(true);
    const [movements, setMovements] = useState([]);

    useEffect(() => {
        const fetchMovements = async () => {
            let res;
            try {
                res = await api.get(`/movements/section/${section.id}`);
            } catch (error) {
                return console.error(error)
            }
            setMovements(res.data.data)
        }
        fetchMovements();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [section.id])

    async function handleRemove() {
        try {
            await api.delete(`/sections/${section.id}`)
        } catch (error) {
            return console.error(error)
        }
        setSections(prevSections => (
            prevSections.filter((item) => item.id !== section.id)
        ));
    }

    async function handleMovementSubmit(e) {
        e.preventDefault();
        let res;
        try {
            res = await api.post(`/movements/${section.id}`, {
                label: "Exercise"
            })
        } catch (error) {
            return console.error(error)
        }
        const key = res.data.data.movementId;
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
        try {
            await api.patch(`/sections/${section.id}`, {
                label: value
            })
        } catch (error) {
            return console.error(error);
        }
    }

    return (
        <section>
            <div className={styles.section} onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)}>
                <div className={styles.sectionPart}>
                    <Editable
                        className={styles.item}
                        value={section.label}
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