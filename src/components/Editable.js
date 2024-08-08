import { useState, useEffect, useRef } from 'react';

function Editable({ value, onSubmit }) {
  const [input, setInput] = useState(value);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef(null);

  function handleSubmit(e) {
    e.preventDefault();
    setEditing(false);
    onSubmit(input);
  }

  useEffect(() => {
    const input = inputRef.current;
    if (input) {
      input.style.width = '1px';
      input.style.width = `${input.scrollWidth}px`;
    }
  })

  // cancels editing upon clicking outside of element
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (inputRef.current && onSubmit && !inputRef.current.contains(e.target)) {
        onSubmit(inputRef.current.value);
        setEditing(false);
      }
    };

    document.addEventListener('click', handleOutsideClick, true);

    return () => {
      document.removeEventListener('click', handleOutsideClick, true)
    }
  }, [onSubmit])

  // selects all text upon editing
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing])

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
              <button type='submit' style={{ display: 'none' }} />
            </form>
          )
          : <span onClick={() => setEditing(true)}>{value}</span>
      }
    </>
  );
}

export default Editable;