import Movement from "./Movement";
import Editable from "./Editable";
import { useError } from "./ErrorProvider";
import { useState } from "react";

import WorkStyles from "../styles/Workouts.module.scss";
import plus from "../assets/plus.svg";

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
            <div className={WorkStyles.section} onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)}>
                <div>
                    <Editable
                        value={section.name}
                        onSubmit={handleEditSubmit}
                    />
                    {hovering && (
                        <div className={WorkStyles.addMovement}>
                            <button onClick={handleMovementSubmit}>Add Movement</button>
                            <img src={plus} alt="plus" />
                        </div>
                    )}
                </div>
                <div>
                    {hovering && <button onClick={handleRemove}>x</button>}
                    <button onClick={() => setShowItems(prev => !prev)}>V</button>
                </div>
            </div>
            {
                <ul style={{ display: showItems ? 'block' : 'none' }}>
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
            {!showItems && <span>...</span>}
        </section>
    );
}

export default Section;