import { useState, useEffect, useRef } from 'react';

function Editable({ value, editing, onSubmit, onEdit }) {
  const [input, setInput] = useState(value);
  const inputRef = useRef(null);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(input);
  }

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  },[editing])

  return (
    <>
      {
        editing
        ? (
          <form onSubmit={handleSubmit}>
            <input 
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onFocus={e => e.target.select()}
              type='text'
            />
            <button type='submit' style={{ display: 'none' }}/>
          </form> 
        )
        : <span onClick={onEdit}>{value}</span>
      }
    </>
  );
}

export default Editable;