// import styles from "../../styles/Workouts.module.scss";

// function WideHeader({ setHovering, section, handleEditSubmit, handleMovementSubmit}) {
//   return (
//     <>
//       <div className={styles.section} onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)}>
//         <div className={styles.sectionPart}>
//           <Editable
//             className={styles.item}
//             value={section.label}
//             onSubmit={handleEditSubmit}
//           />
//           {((hovering && showItems) || isMobile) && (
//             <div className={styles.addItem} >
//               <button type='button' onClick={handleMovementSubmit}>Add Exercise</button>
//               <img src={plus} alt="plus" />
//             </div>
//           )}
//         </div>
//         <div className={styles.sectionPart}>
//           {(hovering || isMobile) &&
//             <button type='button' onClick={handleRemove} className={styles.icon}>
//               <img src={X} alt="delete" />
//             </button>
//           }
//           {movements.length > 0 &&
//             <button type='button' onClick={() => setShowItems(prev => !prev)} className={styles.icon}>
//               <img src={openDropdown} alt="dropdown" className={showItems ? styles.open : styles.closed} />
//             </button>
//           }
//         </div>
//       </div>
//     </>
//   );
// }

// export default WideHeader;