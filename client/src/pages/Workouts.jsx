import Section from '../components/Section.jsx';
import AddSection from '../components/AddSection.jsx';
import { useState, useEffect } from 'react';
import styles from "../styles/Workouts.module.scss";
import Header from '../components/Header.jsx';
import clientApi from '../api/clientApi.js';
import useAuth from '../hooks/useAuth.js';

function Workouts() {
  const [sections, setSections] = useState([]);
  const { withAuth } = useAuth();

  useEffect(() => {
    const fetchSections = async () => {
      const res = await withAuth(() => clientApi.get(`/sections/user`));
      const sections = res?.data.data;
      setSections(sections ?? []);
    }
    fetchSections();
  }, [withAuth])

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
          ))}
        </div>
        <AddSection setSections={setSections} />
      </main>
    </>
  );
}

export default Workouts;