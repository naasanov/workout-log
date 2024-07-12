import { useState } from "react";

function Movement({ movement, setMovements }) {
    const [showRemove, setShowRemove] = useState(false);

    function handleRemove() {
        setMovements(prevMovements => (
            prevMovements.filter(m => m.id !== movement.id)
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