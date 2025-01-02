import Editable from "./Editable";
import Variation from "./Variation";
import { useEffect, useState } from "react";
import axios from "axios";
import styles from "../styles/Movement.module.scss";
import plus from "../assets/plus.svg";
import X from "../assets/delete.svg";
const URL = process.env.REACT_APP_API_URL;

function Movement({ movement, setMovements }) {
    const [variations, setVariations] = useState([])
    const [hovering, setHovering] = useState(false);

    useEffect(() => {
        const fetchMovements = async () => {
            let res;
            try {
                res = await axios.get(`${URL}/variations/movement/${movement.id}`);
            } catch (error) {
                console.error(error)
            }
            if (res) {
                setVariations(res.data.data)
            }
        }
        fetchMovements();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [movement.id])

    async function handleRemove() {
        await axios.delete(`${URL}/movements/${movement.id}`);
        setMovements(prevMovements => (
            prevMovements.filter(m => m.id !== movement.id)
        ));
    }

    async function handleVariationSubmit(e) {
        e.preventDefault();
        let res;
        try {
            res = await axios.post(`${URL}/variations/${movement.id}`, {
                label: "Variation"
            })
        } catch (error) {
            return console.error(error)
        }
        const key = res.data.data.variationId
        console.log(key)
        setVariations(prevVariatons => (
            [...prevVariatons, { id: key, label: 'Variation', date: new Date() }]
        ))
    }

    async function handleNameEdit(change) {
        setMovements(prevMovements => (
            prevMovements.map(m => (
                m.id === movement.id
                    ? { ...m, label: change }
                    : m
            ))
        ))
        try {
            await axios.patch(`${URL}/movements/${movement.id}`, {
                label: change
            })
        } catch (error) {
            return console.error(error)
        }
    }

    return (
        <li className={styles.section}>
            <div className={styles.header} onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)}>
                <Editable className={styles.sectionPart} value={movement.label} onSubmit={handleNameEdit} />
                <div className={`${styles.sectionPart} ${styles.addItem}`} style={{ display: hovering ? 'block' : 'none' }}>
                    <button onClick={handleVariationSubmit}>Add Variation</button>
                    <img src={plus} alt="plus" />
                </div>
                <div className={styles.sectionPart} style={{ display: hovering ? 'block' : 'none' }}>
                    <button className={styles.icon} onClick={handleRemove}>
                        <img src={X} alt="delete" />
                    </button>
                </div>
            </div>
            <div className={styles.variations}>
                {variations.map(v => <Variation key={v.id} variation={v} setVariations={setVariations} />)}
            </div>
        </li>
    )
}

export default Movement;