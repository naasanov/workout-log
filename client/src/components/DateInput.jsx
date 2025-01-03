import { useRef, useState, useEffect } from "react";
import styles from "../styles/DateInput.module.scss";
import { useError } from '../context/ErrorProvider';
import { format, isValid, parse } from "date-fns";

function DateInput({ date, onSubmit }) {
  const [input, setInput] = useState({
    month: "",
    day: "",
    year: ""
  })
  const [editing, setEditing] = useState(false);
  const inputRef = useRef();
  const monthRef = useRef();
  const dayRef = useRef();
  const yearRef = useRef();
  const setShowError = useError();

  useEffect(() => {
    if (date) {
      setInput({
        month: format(date, "MM"),
        day: format(date, "dd"),
        year: format(date, "yy")
      })
    }
  }, [date])

  useEffect(() => {
    if (editing && monthRef.current) {
      monthRef.current.focus();
      monthRef.current.select();
    }
  }, [editing])

  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (inputRef.current && onSubmit && !inputRef.current.contains(e.target)) {
        handleSubmit(input);
      }
    };

    document.addEventListener('click', handleOutsideClick, true);
    return () => document.removeEventListener('click', handleOutsideClick, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, input]);

  const handleSubmit = (newDate) => {
    if (newDate instanceof Date) {
      setEditing(false)
      setInput({
        month: format(newDate, "MM"),
        day: format(newDate, "dd"),
        year: format(newDate, "yy")
      })
      return onSubmit(newDate);
    }

    const { month, day, year } = newDate;
    const parsedDate = parse(`${month}/${day}/${year}`, "MM/dd/yy", new Date());
    if (!isValid(parsedDate)) {
      setShowError(true);
      handleSubmit(date);
    }
    else {
      onSubmit(parsedDate);
      setShowError(false);
      setEditing(false);
    }
  }

  const handleChange = (e, field) => {
    const value = e.target.value;
    if (
      /^\d*$/.test(value)
      && !(field === "month" && parseInt(value) > 12)
      && !(field === "day" && parseInt(value) > 31)
    ) {
      setInput(prev => ({ ...prev, [field]: value }));
      if (field === "month" && value.length === 2) {
        dayRef.current.focus();
      }
      if (field === "day" && value.length === 0) {
        monthRef.current.focus();
      }
      if (field === "day" && value.length === 2) {
        yearRef.current.focus();
      }
      if (field === "year" && value.length === 0) {
        dayRef.current.focus();
      }
    }
  }

  return (
    <div className={styles.date} ref={inputRef}>
      {
        editing
          ? (
            <form onSubmit={e => { e.preventDefault(); handleSubmit(input) }}>
              <input
                ref={monthRef}
                type="text"
                value={input.month}
                maxLength="2"
                onChange={e => handleChange(e, "month")}
                placeholder="mm"
              />
              <span>/</span>
              <input
                ref={dayRef}
                type="text"
                value={input.day}
                maxLength="2"
                onChange={e => handleChange(e, "day")}
                placeholder="dd"
              />
              <span>/</span>
              <input
                ref={yearRef}
                type="text"
                value={input.year}
                maxLength="2"
                onChange={e => handleChange(e, "year")}
                placeholder="yy"
              />
              <button type="submit" style={{ display: "none" }}/>
            </form>
          )
          : <span onClick={() => setEditing(true)}>{date ? format(date, "MM/dd/yy") : "mm/dd/yy"}</span>
      }
    </div>
  )
}

export default DateInput;