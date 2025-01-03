import { useError } from '../context/ErrorProvider';
import styles from "../styles/Workouts.module.scss";
import plus from "../assets/plus.svg";
import axios from 'axios';
import { useUser } from '../context/UserProvider';
const URL = process.env.REACT_APP_API_URL;

function AddSection({ setSections }) {
    const setShowError = useError();
    const { user } = useUser();

    async function handleSubmit(e) {
        e.preventDefault();
        const label = 'Muscle Group';
        let res;
        try {
            res = await axios.post(`${URL}/sections/${user.uuid}`, {
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