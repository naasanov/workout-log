import Editable from "./Editable";
import Variation from "./variation/Variation";
import { useEffect, useState } from "react";
import useAuth from '../hooks/useAuth.js';
import clientApi from "../api/clientApi.js";
import styles from "../styles/Movement.module.scss";
import plus from "../assets/plus.svg";
import X from "../assets/delete.svg";
import { v4 as uuid } from "uuid";

function Movement({ movement, setMovements }) {
  const [variations, setVariations] = useState([])
  const [hovering, setHovering] = useState(false);
  const { withAuth } = useAuth();

  useEffect(() => {
    const fetchMovements = async () => {
      const res = await withAuth(() => clientApi.get(`/variations/movement/${movement.id}`));
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
    await withAuth(() => clientApi.delete(`/movements/${movement.id}`))
  }

  async function handleVariationSubmit(e) {
    e.preventDefault();
    const res = await withAuth(() => (
      clientApi.post(`/variations/${movement.id}`, {
        label: "Variation"
      })
    ))

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
    await withAuth(() => (
      clientApi.patch(`/movements/${movement.id}`, {
        label: change
      })
    ))
  }

  return (
    <li className={styles.section}>
      <div className={styles.header} onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)}>
        {/* label */}
        <Editable className={styles.sectionPart} value={movement.label} onSubmit={handleNameEdit} />
        
        {/* add item button */}
        <div className={`${styles.sectionPart} ${styles.addItem}`} style={{ display: hovering ? 'block' : 'none' }}>
          <button onClick={handleVariationSubmit}>Add Variation</button>
          <img src={plus} alt="plus" />
        </div>
        
        {/* remove item button */}
        <div className={styles.sectionPart} style={{ display: hovering ? 'block' : 'none' }}>
          <button className={styles.icon} onClick={handleRemove}>
            <img src={X} alt="delete" />
          </button>
        </div>
      </div>
      
      {/* variations */}
      <div className={styles.variations}>
        {variations.map(v => <Variation key={v.id} variation={v} setVariations={setVariations} />)}
      </div>
    </li>
  )
}

export default Movement;