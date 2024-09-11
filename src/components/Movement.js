import Editable from "./Editable";
import Variation from "./Variation";
import { useError } from "./ErrorProvider";
import { useState } from "react";

import styles from "../styles/Movement.module.scss";
import plus from "../assets/plus.svg";
import X from "../assets/delete.svg";

function Movement({ movement, setMovements }) {
    const [variations, setVariations] = useState([{ id: Date.now(), name: 'variation'}])
    const [hovering, setHovering] = useState(false);

    const setShowError = useError();

    function handleRemove() {
        setMovements(prevMovements => (
            prevMovements.filter(m => m.id !== movement.id)
        ));
    }

    function handleVariationSubmit(e) {
        e.preventDefault();

        const key = Date.now();
        setVariations(prevVariatons => (
            [...prevVariatons, { id: key, name: 'variation' }]
        ))
    }

    function handleNameEdit(change) {
        if (change === '') {
            setShowError(true);
            return;
        }

        setMovements(prevMovements => (
            prevMovements.map(m => (
                m.id === movement.id
                    ? { ...m, name: change }
                    : m
            ))
        ))
        setShowError(false);
    }

    return (
        <li className={styles.section}>
            <div className={styles.header} onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)}>
                <Editable className={styles.sectionPart} value={movement.name} onSubmit={handleNameEdit} />
                <div className={`${styles.sectionPart} ${styles.addItem}`} style={{ display: hovering ? 'block' : 'none' }}>
                    <button onClick={handleVariationSubmit}>Add Variation</button>
                    <img src={plus} alt="plus" />
                </div>
                <div className={styles.sectionPart} style={{ display: hovering ? 'block' : 'none' }}>
                    <button className={styles.icon} onClick={handleRemove}>
                        <img src={X} alt="delete" />
                    </button>
                </div>
            </div>
            <div className={styles.variations}>
                {variations.map(v => <Variation key={v.id} variation={v} setVariations={setVariations} />)}
            </div>
        </li>
    )
}

export default Movement;