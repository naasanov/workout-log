import { createContext, useContext, useState } from "react";
import styles from '../styles/Error.module.scss';

const ErrorContext = createContext();

export function useError() {
  return useContext(ErrorContext);
}

function ErrorProvider({ children }) {
  const [showError, setShowError] = useState(false);

  return (
    <ErrorContext.Provider value={setShowError}>
      {children}
      {showError && <p className={styles.error}>Enter at least one character</p>}
    </ErrorContext.Provider>
  )
}

export default ErrorProvider;