import Section from './Section.js';
import AddSection from './AddSection.js';
import ErrorProvider from './ErrorProvider.js';
import { useState } from 'react';


function Workouts() {
  const [sections, setSections] = useState([]);

  return (
    <ErrorProvider>
      <ul>
        {sections.map((s) => (
          <Section
            key={s.id}
            section={s}
            setSections={setSections}
          />))}
      </ul>
      <AddSection setSections={setSections}/>
    </ErrorProvider>
  );
}

export default Workouts;