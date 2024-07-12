import { useState } from 'react';
import Section from './Section.js';
import AddSection from './AddSection.js';

console.log("test");

function App() {
  const [sections, setSections] = useState([]);

  return (
    <>
      <h1 className="title">Workout Log</h1>

      <ul>
        {sections.map((s) => (
          <Section
            key={s.id}
            section={s}
            setSections={setSections}
          />))}
      </ul>

      <AddSection setSections={setSections}/>
    </>
  );
}

export default App;