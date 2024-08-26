import { useState, useEffect, useRef } from 'react';

function Editable({ value, onSubmit, className }) {
  const [input, setInput] = useState(value);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef(null);

  function handleSubmit(e) {
    e.preventDefault();
    setEditing(false);
    onSubmit(input);
  }

  // keeps width of input locked to width of text
  useEffect(() => {
    const input = inputRef.current;
    if (input) {
      input.style.width = '1rem';
      input.style.width = `${input.scrollWidth}px`;
    }
  });

  // cancels editing upon clicking outside of element
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (inputRef.current && onSubmit && !inputRef.current.contains(e.target)) {
        onSubmit(inputRef.current.value);
        setEditing(false);
        setInput(value); // resets input if exited without submitting
      }
    };

    document.addEventListener('click', handleOutsideClick, true);

    return () => {
      document.removeEventListener('click', handleOutsideClick, true)
    }
  }, [onSubmit]);

  useEffect(() => {
    // selects all text upon editing
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing])

  return (
    <div className={className}>
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
    </div>
  );
}

export default Editable;