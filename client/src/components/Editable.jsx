import { useState, useEffect, useRef } from 'react';
import { useError } from '../context/ErrorProvider';

// #231 — `editing`/`onEditingChange`/`autoFocus`/`onInputChange`/`inputRef` are
// all OPTIONAL. When they're omitted (label editing, DateInput, etc.) this
// component behaves exactly as before: it owns its own editing state and its
// own outside-click-to-commit listener. They exist so a parent can join two
// Editable instances (weight + reps) into one logical form — see
// Variation.jsx's pair-editing state and ThinVariation/WideVariation, which
// pass them for the weight/reps fields only.
function Editable({
  value,
  onSubmit,
  className,
  type,
  editing: editingProp,
  onEditingChange,
  autoFocus = true,
  onInputChange,
  inputRef: externalInputRef
}) {
  const [input, setInput] = useState(value);
  const [internalEditing, setInternalEditing] = useState(false);
  const isControlled = editingProp !== undefined;
  const editing = isControlled ? editingProp : internalEditing;
  const localInputRef = useRef(null);
  const inputRef = externalInputRef ?? localInputRef;
  const setShowError = useError();

  function setEditing(next) {
    if (isControlled) {
      // #231 — controlled instances never close themselves; the parent
      // (which owns both fields of the pair) decides when editing ends, via
      // its own commit / outside-click logic. We only ever forward `true`
      // here (the "user tapped this field's label" case).
      onEditingChange?.(next);
    } else {
      setInternalEditing(next);
    }
  }

  // keeps width of input locked to width of text
  useEffect(() => {
    const input = inputRef.current;
    if (input) {
      input.style.width = '2ch';
      input.style.width = `${input.scrollWidth}px`;
    }
  }, [input, editing]);

  // selects all text upon editing — skipped when autoFocus=false, i.e. when
  // this instance is the non-tapped member of a joint pair (#231). That
  // keeps the idle field unfocused/unselected so typing can never land in
  // the field the user didn't tap.
  useEffect(() => {
    if (editing && autoFocus && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, autoFocus])

  useEffect(() => {
    if (type === "number") {
      setInput(isNaN(value) ? "" : value);
    }
    else {
      setInput(value)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  // cancels editing upon clicking outside of element. #231 — controlled
  // instances skip this entirely: outside-click detection is hoisted to the
  // parent, which treats the whole pair (both refs) as one unit. Without
  // this guard, clicking from the weight input into the reps input would
  // trip THIS instance's own listener and commit weight prematurely — the
  // original bug.
  useEffect(() => {
    if (isControlled) return;
    const handleOutsideClick = (e) => {
      if (inputRef.current && onSubmit && !inputRef.current.contains(e.target)) {
        const isWhitespace = !inputRef.current.value.trim();
        if (!isWhitespace) {
          handleSubmit(input);
        }
        else if (type === "number") {
          handleSubmit(isNaN(value) ? "" : value);
          setEditing(false);
        }
        else {
          handleSubmit(value);
        }
        if (isWhitespace) setShowError(true);
      }
    };

    document.addEventListener('click', handleOutsideClick, true);

    return () => {
      document.removeEventListener('click', handleOutsideClick, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, input, isControlled]);

  function handleSubmit(newValue) {
    const trimmed = newValue.toString().trim();
    if (!trimmed) {
      setShowError(true); // show error if new value is only whitespace
    }
    else {
      setInput(trimmed);
      onSubmit(trimmed);
      setEditing(false);
      setShowError(false);
    }
  }

  function handleChange(e) {
    setInput(e.target.value);
    setShowError(false);
    onInputChange?.(e.target.value);
  }

  function handleFormSubmit(e) {
    e.preventDefault();
    if (isControlled) {
      // #231 — Enter in either field of a joint pair commits BOTH. The
      // parent already has this instance's latest value (via onInputChange
      // on every keystroke) plus the other field's, so it owns the actual
      // commit/PATCH; we just signal "submit requested".
      onSubmit?.(input);
    } else {
      handleSubmit(input);
    }
  }

  return (
    <div className={className}>
      {
        editing
          ? (
            <form onSubmit={handleFormSubmit}>
              <input
                ref={inputRef}
                value={input}
                onChange={handleChange}
                onFocus={e => e.target.select()}
                type={type ?? "text"}
              />
            </form>
          )
          : <span onClick={() => setEditing(true)} style={{ cursor: "pointer" }}>{value}</span>
      }
    </div>
  );
}

export default Editable;
