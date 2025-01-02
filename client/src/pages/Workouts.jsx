import Section from '../components/Section.jsx';
import AddSection from '../components/AddSection.jsx';
import { useUser } from '../context/UserProvider.jsx';
import { useState, useEffect } from 'react';
import styles from "../styles/Workouts.module.scss";
import Header from '../components/Header.jsx';
import axios from 'axios';
const URL = process.env.REACT_APP_API_URL;
function Workouts() {
  const [sections, setSections] = useState([]);
  const { user } = useUser();

  useEffect(() => {
    const fetchSections = async () => {
      if (!user) return;
      let res;
      try {
        res = await axios.get(`${URL}/sections/user/${user.uuid}`);
      } catch (error) {
        console.error(error)
      }
      if (res) {
        setSections(res.data.data)
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