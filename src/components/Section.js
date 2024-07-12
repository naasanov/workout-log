import { useState } from "react";
import Movement from "./Movement";
import Editable from "./Editable";

function Section({ setSections, section }) {
    const [newInput, setNewInput] = useState("");
    const [showError, setShowError] = useState(false);
    const [showRemove, setShowRemove] = useState(false);
    const [movements, setMovements] = useState([]);

    function handleRemove() {
        setSections(prevSections => (
          prevSections.filter((item) => item.id !== section.id)
        ));
    }

    function handleMovementSubmit(e) {
        e.preventDefault();

        if (newInput === "") {
            setShowError(true);
            return;
        }

        // adding a movement to this section
        const key = Date.now();
        setMovements(prevMovements => (
            [...prevMovements, {id: key, name: newInput}]
        ))

        setNewInput("");
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
            ? {...s, editing: false, name: value}
            : s
          ))
        ))
    }

    return (
        <div>
            <li onMouseEnter={() => setShowRemove(true)} onMouseLeave={() => setShowRemove(false)}>
                <Editable 
                    value={section.name}
                    onSubmit={handleEditSubmit}
                />
                <form onSubmit={handleMovementSubmit}>
                    <button type="submit">Add Movement</button>
                    <input type="text" value={newInput} onChange={e => setNewInput(e.target.value)} />
                </form>
                {showRemove && <button onClick={handleRemove}>x</button>}
            </li>
            <ul>
                {movements.map((m) => <Movement key={m.id} movement={m} setMovements={setMovements} sectionId={section.id}/>)}
                {showError && <p className="error">enter at least one character</p>}
            </ul>
        </div>
    );
}

export default Section;