import Editable from "./Editable";
import Variation from "./Variation";
import { useEffect, useState } from "react";
import useApi from "../api/api.js";
import styles from "../styles/Movement.module.scss";
import plus from "../assets/plus.svg";
import X from "../assets/delete.svg";
import { v4 as uuid } from "uuid";

function Movement({ movement, setMovements }) {
    const [variations, setVariations] = useState([])
    const [hovering, setHovering] = useState(false);
    const { api } = useApi();

    useEffect(() => {
        const fetchMovements = async () => {
            let res;
            try {
                res = await api.get(`/variations/movement/${movement.id}`);
            } catch (error) {
                return console.error(error)
            }
            setVariations(res?.data.data ?? [{
                id: uuid(),
                label: "Variation",
                date: new Date()
            }])
        }
        fetchMovements();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [movement.id])

    async function handleRemove() {
        setMovements(prevMovements => (
            prevMovements.filter(m => m.id !== movement.id)
        ));
        try {
            await api.delete(`/movements/${movement.id}`);
        } catch (error) {
            console.error(error.response?.data.message, error);
        }
    }

    async function handleVariationSubmit(e) {
        e.preventDefault();
        let res;
        try {
            res = await api.post(`/variations/${movement.id}`, {
                label: "Variation"
            })
        } catch (error) {
            return console.error(error)
        }
        const key = res?.data.data.variationId ?? uuid();
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
            await api.patch(`/movements/${movement.id}`, {
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