import Editable from "./Editable";
import Variation from "./Variation";
import { useError } from "./ErrorProvider";
import { useState } from "react";

function Movement({ movement, setMovements }) {
    const [variations, setVariations] = useState([])
    const [showRemove, setShowRemove] = useState(false);

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
            [...prevVariatons, {id: key, name: 'variation'}]
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
                ? {...m, name: change}
                : m
            ))
        ))
        setShowError(false);
    }

    return (
        <li onMouseEnter={() => setShowRemove(true)} onMouseLeave={() => setShowRemove(false)}>
            <b><Editable value={movement.name} onSubmit={handleNameEdit}/>:</b>
            <form onSubmit={handleVariationSubmit}>
                    <button type="submit">Add Variation</button>
            </form>
            {showRemove && <button onClick={handleRemove}>x</button>}
            <br />
            {variations.map(v => <Variation key={v.id} variation={v} setVariations={setVariations}/>)}
        </li>
    )
}

export default Movement;