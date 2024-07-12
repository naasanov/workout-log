import { useState } from 'react';

function AddSection({ setSections }) {
    const [input, setInput] = useState('')
    const [showError, setShowError] = useState(false);

    function handleSubmit(e) {
      e.preventDefault();
  
      if (input === "") {
        setShowError(true);
        return;
      }
  
      const key = Date.now()
  
      setSections(prevSections => [...prevSections, {id: key, name: input}]);
      setInput("");
      setShowError(false);
    }

    return (
        <>
            <form onSubmit={handleSubmit}>
                <button type="submit">Add Section</button>
                <input type="text" value={input} onChange={e => setInput(e.target.value)} />
                {showError && <p className="error">enter at least one character</p>}
            </form>
        </>
    );
}

export default AddSection;