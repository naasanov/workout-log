import { useState } from "react";

function Movement({ name, onRemove }) {
    const [showRemove, setShowRemove] = useState(false);

    return (
        <li onMouseEnter={()=>{setShowRemove(true)}} onMouseLeave={()=>{setShowRemove(false)}}>
            <span>{name}</span>
            {showRemove && <button onClick={()=>{onRemove()}}>x</button>}
        </li>
    )
}

export default Movement;