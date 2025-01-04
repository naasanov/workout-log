import Section from '../components/Section.jsx';
import AddSection from '../components/AddSection.jsx';
import { useUser } from '../context/UserProvider.jsx';
import { useState, useEffect } from 'react';
import styles from "../styles/Workouts.module.scss";
import Header from '../components/Header.jsx';
import api from '../api/api.js';

function Workouts() {
  const [sections, setSections] = useState([]);
  const { user, setUser } = useUser();

  useEffect(() => {
    const fetchSections = async () => {
      if (!user) return;
      let res, userRes;
      try {
        res = await api.get(`/sections/user`);
        userRes = await api.get('/users');
      } catch (error) {
        return console.error(error)
      }
      setSections(res.data.data);
      setUser(userRes.data.data);
    }
    fetchSections();
  }, [user, setUser])

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