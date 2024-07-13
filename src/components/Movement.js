import Editable from "./Editable";
import { useState } from "react";

function Movement({ movement, setMovements }) {
    const [details, setDetails] = useState({
        variation: "variation",
        weight: "weight",
        reps: "___",
        date: "date"
    });
    const [showRemove, setShowRemove] = useState(false);

    function handleRemove() {
        setMovements(prevMovements => (
            prevMovements.filter(m => m.id !== movement.id)
        ));
    }

    function handleEdit(field, change) {
        setDetails(prevDetails => (
            {...prevDetails, [field]: change}
        ));
    }

    return (
        <li onMouseEnter={() => setShowRemove(true)} onMouseLeave={() => setShowRemove(false)}>
            <span><b>{movement.name}:</b></span>
            <br />
            <span>(<Editable value={details.variation} onSubmit={(change) => handleEdit("variation", change)} />) </ span>
            <span><Editable value={details.weight} onSubmit={(change) => handleEdit("weight", change)} /> - </ span>
            <span><Editable value={details.reps} onSubmit={(change) => handleEdit("reps", change)} /> reps </ span>
            <span>(<Editable value={details.date} onSubmit={(change) => handleEdit("date", change)} />)</ span>
            {showRemove && <button onClick={handleRemove}>x</button>}
        </li>
    )
}

export default Movement;