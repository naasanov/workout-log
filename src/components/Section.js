import { useState } from "react";
import Movement from "./Movement";

function Section({ section, onRemove, onMovementRemove, onMovementAdd}) {
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
        <div>
            <li onMouseEnter={()=>{setShowRemove(true)}} onMouseLeave={()=>{setShowRemove(false)}}>
                {
                    section.editing
                    ? (
                        <form>
                            <input type="text" placeholder={section.name}/>
                            <button type="submit" style={{ display: 'none' }} />
                        </form>
                    )
                    : <b>{section.name}</b>
                }
                <form onSubmit={handleSubmit}>
                    <button type="submit">Add Movement</button>
                    <input type="text" value={inputTerm} onChange={handleChange} />
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