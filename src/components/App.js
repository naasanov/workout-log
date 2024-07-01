import { useState } from 'react';
import Section from './Section.js';
import AddSection from './AddSection.js';

console.log("test");

function App() {
  const [sections, setSections] = useState([]);
  const [showError, setShowError] = useState(false);
  const [newInput, setNewInput] = useState("");

  function handleSubmit(e) {
    e.preventDefault();

    if (newInput === "") {
      setShowError(true);
      return;
    }

    const key = Date.now()

    setSections((prevSections) => [...prevSections, {id: key, name: newInput, movements: [], editing: false}]);
    setNewInput("");
    setShowError(false);
  }

  function handleRemove(key) {
    setSections((prevSections) => (
      prevSections.filter((item) => item.id !== key)
    ));
  }

  function handleMovementAdd(sectionId, movement) {
    const key = Date.now();
    setSections((prevSections) => (
      prevSections.map((section) => (
        section.id === sectionId
        ? {...section, movements: [...section.movements, { id: key, name: movement }]}
        : section
      ))
    ));
  }

  function handleMovementRemove(sectionId, movementId) {
    setSections((prevSections) => (
      prevSections.map((section) => (
        section.id === sectionId
        ? {...section, movements: section.movements.filter((m) => m.id !== movementId)}
        : section
      ))
    ));
  }

  function handleEdit(sectionId) {
    setSections(prevSections => (
      prevSections.map(s => (
        s.id === sectionId
        ? {...s, editing: true}
        : s
      ))
    ))
    console.log(sections)
  }

  function handleEditSubmit(sectionName, sectionId) {
    setSections(prevSections => (
      prevSections.map(s => (
        s.id === sectionId
        ? {...s, editing: false, name: sectionName}
        : s
      ))
    ))
  }

  return (
    <>
      <h1 className="title">Workout Log</h1>

      <ul>
        {sections.map((item) => (
          <Section
            section={item} 
            onRemove={()=>{handleRemove(item.id)}}
            onMovementAdd={movement => handleMovementAdd(item.id, movement)}
            onMovementRemove={movementId => handleMovementRemove(item.id, movementId)}
            onEdit={()=>handleEdit(item.id)}
            onEditSubmit={(name)=>{handleEditSubmit(name, item.id)}}
          />))}
      </ul>

      <AddSection
        onSubmit={handleSubmit}
        value={newInput}
        onChange={e => setNewInput(e.target.value)}
        showError={showError}
      />
    </>
  );
}

export default App;