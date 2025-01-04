import { useError } from '../context/ErrorProvider';
import styles from "../styles/Workouts.module.scss";
import plus from "../assets/plus.svg";
import api from '../api/api.js';

function AddSection({ setSections }) {
    const setShowError = useError();

    async function handleSubmit(e) {
        e.preventDefault();
        const label = 'Muscle Group';
        let res;
        try {
            res = await api.post(`/sections`, {
                label
            })
        } catch (error) {
            return console.error(error)
        }
        const id = res.data.data.sectionId
        setSections(prevSections => [...prevSections, { id, label }]);
        setShowError(false);
    }

    return (
        <>
            <div className={styles.addItem}>
                <button onClick={handleSubmit}>Add Section</button>
                <img src={plus} alt="plus" />
            </div>
        </>
    );
}

export default AddSection;