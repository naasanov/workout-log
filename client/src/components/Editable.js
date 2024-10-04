import { useState, useEffect, useRef } from 'react';
import { useError } from './ErrorProvider';

function Editable({ value, onSubmit, className }) {
  const [input, setInput] = useState(value);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef(null);
  const setShowError = useError();

  // keeps width of input locked to width of text
  useEffect(() => {
    const input = inputRef.current;
    if (input) {
      input.style.width = '1rem';
      input.style.width = `${input.scrollWidth}px`;
    }
  });

  useEffect(() => {
    // selects all text upon editing
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing])

  // cancels editing upon clicking outside of element
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (inputRef.current && onSubmit && !inputRef.current.contains(e.target)) {
        const isWhitespace = !inputRef.current.value.trim();
        handleSubmit(isWhitespace ? value : input);
        if (isWhitespace) setShowError(true);
      }
    };

    document.addEventListener('click', handleOutsideClick, true);

    return () => {
      document.removeEventListener('click', handleOutsideClick, true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, input]);
  
  function handleSubmit(newValue) {
    const trimmed = newValue.trim();
    if(!trimmed) { // show error if new value is only whitespace
      setShowError(true);
    }
    else {
      onSubmit(trimmed);
      setInput(trimmed);
      setEditing(false);
      setShowError(false);
    }
  }

  function handleChange(e) {
    setInput(e.target.value);
    setShowError(false);
  }

  return (
    <div className={className}>
      {
        editing
          ? (
            <form onSubmit={(e) => {e.preventDefault(); handleSubmit(input);}}>
              <input
                ref={inputRef}
                value={input}
                onChange={handleChange}
                onFocus={e => e.target.select()}
                type='text'
              />
            </form>
          )
          : <span onClick={() => setEditing(true)}>{value}</span>
      }
    </div>
  );
}

export default Editable;