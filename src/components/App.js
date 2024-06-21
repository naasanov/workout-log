import { useState } from 'react';
import Section from './Section.js';

function App() {
  const [sections, setSections] = useState([]);
  const [inputTerm, setInputTerm] = useState("");
  const [showError, setShowError] = useState(false);

  function handleSubmit(e) {
    e.preventDefault();

    if (inputTerm === "") {
      setShowError(true);
      return;
    }

    let key = Date.now()

    setSections((prevSections) => [...prevSections, {id: key, name: inputTerm, movements: []}]);
    setInputTerm("");
    setShowError(false);
  }

  function handleChange(e) {
    setInputTerm(e.target.value);
  }

  function handleRemove(key) {
    setSections((prevSections) => (
      prevSections.filter((item) => item.id !== key)
    ));
  }

  function handleMovementRemove(sectionId, movement) {
    setSections((prevSections) => (
      prevSections.map((section) => (
        section.id === sectionId
        ? {...section, movements: section.movements.filter((m) => m !== movement)}
        : section
      ))
    ));
  }

  function handleMovementAdd(sectionId, movement) {
    setSections((prevSections) => (
      prevSections.map((section) => (
        section.id === sectionId
        ? {...section, movements: [...section.movements, movement]}
        : section
      ))
    ));
  }

  return (
    <>
      <h1 className="title">Workout Log</h1>
      <ul>
        {sections.map((item) => (
          <Section 
            section={item} 
            onRemove={()=>{handleRemove(item.id)}}
            onMovementAdd={(movement) => handleMovementAdd(item.id, movement)}
            onMovementRemove={(movement) => handleMovementRemove(item.id, movement)}
          />))}
      </ul>
      <form onSubmit={handleSubmit}>
        <button type="submit">Add Section</button>
        <input type="text" value={inputTerm} onChange={handleChange} />
        {showError && <p className="error">enter at least one character</p>}
      </form>
    </>
  );
}

export default App;