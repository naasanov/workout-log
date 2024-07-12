import { useState } from "react";
import Movement from "./Movement";
import Editable from "./Editable";

function Section({ section, onRemove, onMovementRemove, onMovementAdd, onEdit, onEditSubmit }) {
    const [newInput, setNewInput] = useState("");
    const [showError, setShowError] = useState(false);
    const [showRemove, setShowRemove] = useState(false);

    function handleNewSubmit(e) {
        e.preventDefault();

        if (newInput === "") {
            setShowError(true);
            return;
        }

        onMovementAdd(newInput);
        setNewInput("");
        setShowError(false);
    }

    function handleEditSubmit(value) {
        if (value === "") {
            setShowError(true);
            return;
        }

        onEditSubmit(value);
    }

    return (
        <div>
            <li onMouseEnter={() => setShowRemove(true)} onMouseLeave={() => setShowRemove(false)}>
                <Editable 
                    value={section.name}
                    editing={section.editing}
                    onEdit={onEdit}
                    onSubmit={handleEditSubmit}
                />
                <form onSubmit={handleNewSubmit}>
                    <button type="submit">Add Movement</button>
                    <input type="text" value={newInput} onChange={e => setNewInput(e.target.value)} />
                </form>
                {showRemove && <button onClick={onRemove}>x</button>}
            </li>
            <ul>
                {section.movements.map((item) => <Movement name={item.name} onRemove={() => onMovementRemove(item.id)} />)}
                {showError && <p className="error">enter at least one character</p>}
            </ul>
        </div>
    );
}

export default Section;