import { useState, useEffect, useRef } from 'react';
import { useError } from '../context/ErrorProvider';

function Editable({ value, onSubmit, className, type }) {
  const [input, setInput] = useState(value);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef(null);
  const setShowError = useError();

  // keeps width of input locked to width of text
  useEffect(() => {
    const input = inputRef.current;
    if (input) {
      input.style.width = '2ch';
      input.style.width = `${input.scrollWidth}px`;
    }
  }, [input, editing]);

  // selects all text upon editing
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing])

  useEffect(() => {
    if (type === "number") {
      setInput(isNaN(value) ? "" : value);
    }
    else {
      setInput(value)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  // cancels editing upon clicking outside of element
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (inputRef.current && onSubmit && !inputRef.current.contains(e.target)) {
        const isWhitespace = !inputRef.current.value.trim();
        if (!isWhitespace) {
          handleSubmit(input)
        }
        else if (type === "number") {
          handleSubmit(isNaN(value) ? "" : value)
        }
        else {
          handleSubmit(value)
        }
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
    console.log(newValue)
    const trimmed = newValue.toString().trim();
    console.log("trimmed: ", !trimmed)
    if (!trimmed) { 
      setShowError(true); // show error if new value is only whitespace
      if (type === "number") {
        setEditing(false);
      }
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
            <form onSubmit={(e) => { e.preventDefault(); handleSubmit(input); }}>
              <input
                ref={inputRef}
                value={input}
                onChange={handleChange}
                onFocus={e => e.target.select()}
                type={type ?? "text"}
              />
            </form>
          )
          : <span onClick={() => setEditing(true)}>{value}</span>
      }
    </div>
  );
}

export default Editable;