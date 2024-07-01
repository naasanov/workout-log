import { useState, useRef, useEffect } from "react";
import Movement from "./Movement";

function Section({ section, onRemove, onMovementRemove, onMovementAdd, onEdit, onEditSubmit }) {
    const [newInput, setNewInput] = useState("");
    const [editInput, setEditInput] = useState(section.name);
    const [showError, setShowError] = useState(false);
    const [showRemove, setShowRemove] = useState(false);
    const editInputRef = useRef(null);

    useEffect(() => {
        if (section.editing && editInputRef.current) {
            editInputRef.current.focus();
            editInputRef.current.select();
        }
    },[section.editing])

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

    function handleEditSubmit(e) {
        e.preventDefault();

        if (editInput === "") {
            setShowError(true);
            return;
        }

        onEditSubmit(editInput);
    }

    return(
        <div>
            <li onMouseEnter={()=>{setShowRemove(true)}} onMouseLeave={()=>{setShowRemove(false)}}>
                {
                    section.editing
                    ? (
                        <form onSubmit={handleEditSubmit}>
                            <input 
                                ref={editInputRef}
                                type="text" 
                                value={editInput} 
                                onChange={e => setEditInput(e.target.value)}
                                onFocus={e => e.target.select()}
                                />
                            <button type="submit" style={{ display: 'none' }} />
                        </form>
                    )
                    : <b onClick={onEdit}>{section.name}</b>
                }
                <form onSubmit={handleNewSubmit}>
                    <button type="submit">Add Movement</button>
                    <input type="text" value={newInput} onChange={e => setNewInput(e.target.value)} />
                </form>
                {showRemove && <button onClick={()=>{onRemove()}}>x</button>}
            </li>
            <ul>
                {section.movements.map((item) => <Movement name={item.name} onRemove={()=>{onMovementRemove(item.id)}}/>)}
                {showError && <p className="error">enter at least one character</p>}
            </ul>
        </div>
    );
}

export default Section;