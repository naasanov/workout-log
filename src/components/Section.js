import { useState } from "react";
import Movement from "./Movement";

function Section({ section, onRemove, onMovementRemove, onMovementAdd }) {
    const [inputTerm, setInputTerm] = useState("");
    const [showError, setShowError] = useState(false);
    const [showRemove, setShowRemove] = useState(false);
    
    function handleChange(e) {
        setInputTerm(e.target.value);
    }

    function handleSubmit(e) {
        e.preventDefault();

        if (inputTerm === "") {
            setShowError(true);
            return;
        }

        onMovementAdd(inputTerm);
        setInputTerm("");
        setShowError(false);
    }

    return(
        <>
            <li onMouseEnter={()=>{setShowRemove(true)}} onMouseLeave={()=>{setShowRemove(false)}}>
                <b>{section.name}</b>
                <form onSubmit={handleSubmit}>
                    <button type="submit">Add Movement</button>
                    <input type="text" value={inputTerm} onChange={handleChange} />
                </form>
                {showRemove && <button onClick={()=>{onRemove()}}>x</button>}
            </li>
            <ul>
                {section.movements.map((item) => <Movement name={item} onRemove={()=>{onMovementRemove(item)}}/>)}
                {showError && <p className="error">enter at least one character</p>}
            </ul>
        </>
    );
}

export default Section;