import { useError } from '../context/ErrorProvider';
import styles from "../styles/Workouts.module.scss";
import plus from "../assets/plus.svg";
import useApi from '../api/api.js';
import { v4 as uuid } from 'uuid';

function AddSection({ setSections }) {
    const setShowError = useError();
    const { api } = useApi();

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
        const id = res?.data.data.sectionId ?? uuid();
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