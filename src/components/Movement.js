import Editable from "./Editable";
import Variation from "./Variation";
import { useError } from "./ErrorProvider";
import { useState } from "react";

import styles from "../styles/Workouts.module.scss";
import plus from "../assets/plus.svg";
import X from "../assets/delete.svg";

function Movement({ movement, setMovements }) {
    const [variations, setVariations] = useState([])
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
        <li onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)} className={styles.section}>
            <div>
                <Editable value={movement.name} onSubmit={handleNameEdit} />
                {hovering &&
                    <div className={styles.addItem}>
                        <button onClick={handleVariationSubmit}>Add Variation</button>
                        <img src={plus} alt="plus" />
                    </div>}
            </div>
            <div>
                {hovering &&
                    <button onClick={handleRemove} className={styles.icon}>
                        <img src={X} alt="delete" />
                    </button>
                }
            </div>
            {variations.map(v => <Variation key={v.id} variation={v} setVariations={setVariations} />)}
        </li>
    )
}

export default Movement;