import { useState } from 'react';
import { useError } from './ErrorProvider';

function AddSection({ setSections }) {
    const [input, setInput] = useState('');
    const setShowError = useError();
    
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
            </form>
        </>
    );
}

export default AddSection;