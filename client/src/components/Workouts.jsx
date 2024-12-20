import Section from './Section.jsx';
import AddSection from './AddSection.jsx';
import { useEffect, useState } from 'react';
import { useUser } from './UserProvider.jsx';

import styles from "../styles/Workouts.module.scss";
import Header from './Header.jsx';
import axios from 'axios';

const URL = "http://localhost:4000"

function Workouts() {
  const [sections, setSections] = useState([]);
  const { user } = useUser();

  useEffect(() => {
    const fetchSections = async () => {
      if (!user) return;
      let data;
      try {
        data = await axios.get(`${URL}/sections/user/${user.uuid}`);
      } catch (error) {
        console.error(error)
      }
      if (data) {
        setSections(data)
      }
    }
    fetchSections();
  }, [user])

  return (
    <>
      <Header />
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
    </>
  );
}

export default Workouts;