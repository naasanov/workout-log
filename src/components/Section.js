import Movement from "./Movement";
import Editable from "./Editable";
import { useError } from "./ErrorProvider";
import { useState } from "react";

function Section({ setSections, section }) {
    const [showRemove, setShowRemove] = useState(false);
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
        <div>
            <li className="section" onMouseEnter={() => setShowRemove(true)} onMouseLeave={() => setShowRemove(false)}>
                <Editable
                    value={section.name}
                    onSubmit={handleEditSubmit}
                />
                <form onSubmit={handleMovementSubmit}>
                    <button type="submit">Add Movement</button>
                </form>
                <button onClick={() => setShowItems(prev => !prev)}>V</button>
                {showRemove && <button onClick={handleRemove}>x</button>}
            </li>
            {
                <ul style={{display: showItems ? 'block' : 'none'}}>
                    {movements.map((m) => (
                        <Movement
                            key={m.id}
                            movement={m}
                            setMovements={setMovements}
                            sectionId={section.id} />
                    ))}
                </ul>
            }
            {!showItems && <span>...</span>}
        </div>
    );
}

export default Section;