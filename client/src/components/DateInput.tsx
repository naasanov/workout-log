import { useRef, useState, useEffect } from "react";
import type { ChangeEvent, FormEvent } from "react";
import styles from "../styles/DateInput.module.scss";
import { useError } from '../context/ErrorProvider';
import { format, isValid, parse } from "date-fns";

type DateParts = {
  month: string;
  day: string;
  year: string;
};

type DateInputProps = {
  // Variations store `date` as a server DATETIME, which arrives over JSON as
  // an ISO string; a freshly-created-but-unsaved variation sets it to a real
  // Date (see Movement.tsx) before the next fetch replaces it.
  date: Date | string | undefined;
  onSubmit: (date: Date) => void;
};

function DateInput({ date, onSubmit }: DateInputProps) {
  const [input, setInput] = useState<DateParts>({
    month: "",
    day: "",
    year: ""
  })
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLDivElement>(null);
  const monthRef = useRef<HTMLInputElement>(null);
  const dayRef = useRef<HTMLInputElement>(null);
  const yearRef = useRef<HTMLInputElement>(null);
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
    const handleOutsideClick = (e: MouseEvent) => {
      if (editing && inputRef.current && !inputRef.current.contains(e.target as Node)) {
        handleSubmit(input);
      }
    };

    document.addEventListener('click', handleOutsideClick, true);
    return () => document.removeEventListener('click', handleOutsideClick, true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, input, editing]);

  const handleSubmit = (newDate: DateParts) => {
    const { month, day, year } = newDate;
    const parsedDate = parse(`${month}/${day}/${year}`, "MM/dd/yy", new Date());
    if (!isValid(parsedDate)) {
      setShowError?.(true);
      // Revert the fields to the last known-good date rather than persisting
      // an unparseable one; `date` is the source of truth they were seeded
      // from, so there's nothing further to submit.
      if (date) {
        setInput({
          month: format(date, "MM"),
          day: format(date, "dd"),
          year: format(date, "yy")
        });
      }
      setEditing(false);
    }
    else {
      onSubmit(parsedDate);
      setShowError?.(false);
      setEditing(false);
    }
  }

  const handleChange = (e: ChangeEvent<HTMLInputElement>, field: keyof DateParts) => {
    const value = e.target.value;
    if (
      /^\d*$/.test(value)
      && !(field === "month" && parseInt(value) > 12)
      && !(field === "day" && parseInt(value) > 31)
    ) {
      setInput(prev => ({ ...prev, [field]: value }));
      if (field === "month" && value.length === 2) {
        dayRef.current?.focus();
      }
      if (field === "day" && value.length === 0) {
        monthRef.current?.focus();
      }
      if (field === "day" && value.length === 2) {
        yearRef.current?.focus();
      }
      if (field === "year" && value.length === 0) {
        dayRef.current?.focus();
      }
    }
  }

  return (
    <div className={styles.date} ref={inputRef}>
      {
        editing
          ? (
            <form onSubmit={(e: FormEvent<HTMLFormElement>) => { e.preventDefault(); handleSubmit(input) }}>
              <input
                ref={monthRef}
                type="text"
                value={input.month}
                maxLength={2}
                onChange={e => handleChange(e, "month")}
                placeholder="mm"
              />
              <span>/</span>
              <input
                ref={dayRef}
                type="text"
                value={input.day}
                maxLength={2}
                onChange={e => handleChange(e, "day")}
                placeholder="dd"
              />
              <span>/</span>
              <input
                ref={yearRef}
                type="text"
                value={input.year}
                maxLength={2}
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
