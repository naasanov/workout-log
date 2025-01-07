import Section from '../components/Section.jsx';
import AddSection from '../components/AddSection.jsx';
import { useUser } from '../context/UserProvider.jsx';
import { useState, useEffect } from 'react';
import styles from "../styles/Workouts.module.scss";
import Header from '../components/Header.jsx';
import useApi from '../api/api.js';

function Workouts() {
  const [sections, setSections] = useState([]);
  const { user } = useUser();
  const { api } = useApi();

  useEffect(() => {
    const fetchSections = async () => {
      if (!user) return setSections([]);
      let res;
      try {
        res = await api.get(`/sections/user`);
      } catch (error) {
        return console.error(error)
      }
      setSections(res.data.data);
    }
    fetchSections();
  }, [user, api])

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
            />
          )
          )}
        </div>
        <AddSection setSections={setSections} />
      </main>
    </>
  );
}

export default Workouts;