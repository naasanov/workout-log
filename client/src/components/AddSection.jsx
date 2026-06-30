import { useError } from '../context/ErrorProvider';
import styles from "../styles/Workouts.module.scss";
import { Plus } from 'lucide-react';
import useAuth from '../hooks/useAuth.js';
import clientApi from '../api/clientApi.js';
import { v4 as uuid } from 'uuid';

function AddSection({ setSections }) {
  const setShowError = useError();
  const { withAuth } = useAuth();

  async function handleSubmit(e) {
    e.preventDefault();
    const label = 'Muscle Group';
    const res = await withAuth(() => clientApi.post(`/sections`, { label }))
    const id = res?.data.data.sectionId ?? uuid();
    setSections(prevSections => [...prevSections, { id, label }]);
    setShowError(false);
  }

  return (
    <>
      <div className={styles.addItem}>
        <button onClick={handleSubmit}>Add Section</button>
        <Plus size={16} aria-hidden="true" />
      </div>
    </>
  );
}

export default AddSection;
