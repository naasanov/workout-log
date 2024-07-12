import { useState } from "react";

function Movement({ movement, setSections, sectionId }) {
    const [showRemove, setShowRemove] = useState(false);

    function handleRemove() {
        setSections((prevSections) => (
            prevSections.map((s) => (
                s.id === sectionId
                ? {...s, movements: s.movements.filter((m) => m.id !== movement.id)}
                : s
            ))
        ));
    }

    return (
        <li onMouseEnter={() => setShowRemove(true)} onMouseLeave={() => setShowRemove(false)}>
            <span>{movement.name}</span>
            {showRemove && <button onClick={handleRemove}>x</button>}
        </li>
    )
}

export default Movement;