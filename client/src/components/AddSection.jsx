import { useError } from './ErrorProvider';
import styles from "../styles/Workouts.module.scss";
import plus from "../assets/plus.svg";

function AddSection({ setSections }) {
    const setShowError = useError();

    function handleSubmit(e) {
        e.preventDefault();
        const key = Date.now()

        setSections(prevSections => [...prevSections, { id: key, name: 'Muscle Group' }]);
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