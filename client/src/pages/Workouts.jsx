import Section from '../components/Section.jsx';
import AddSection from '../components/AddSection.jsx';
import { useUser } from '../context/UserProvider.jsx';
import { useState, useEffect } from 'react';
import styles from "../styles/Workouts.module.scss";
import Header from '../components/Header.jsx';
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