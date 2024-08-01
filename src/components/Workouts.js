import Section from './Section.js';
import AddSection from './AddSection.js';
import ErrorProvider from './ErrorProvider.js';
import { useState } from 'react';

import WorkStyles from "../styles/Workouts.module.scss";

function Workouts() {
  const [sections, setSections] = useState([]);

  return (
    <ErrorProvider>
      <main className={WorkStyles.container}>
        <ul>
          {sections.map((s) => (
            <Section
              key={s.id}
              section={s}
              setSections={setSections}
            />))}
        </ul>
        <AddSection setSections={setSections} />
      </main>
    </ErrorProvider>
  );
}

export default Workouts;