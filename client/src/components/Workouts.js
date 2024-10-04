import Section from './Section.js';
import AddSection from './AddSection.js';
import { useState } from 'react';

import styles from "../styles/Workouts.module.scss";

function Workouts() {
  const [sections, setSections] = useState([]);

  return (
    <main className={styles.container}>
      <div>
        {sections.map((s) => (
          <Section
            key={s.id}
            section={s}
            setSections={setSections}
          />))}
      </div>
      <AddSection setSections={setSections} />
    </main>
  );
}

export default Workouts;