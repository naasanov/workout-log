import { createContext, useContext, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import styles from '../styles/Error.module.scss';

type SetShowError = Dispatch<SetStateAction<boolean>>;

const ErrorContext = createContext<SetShowError | undefined>(undefined);

export function useError() {
  return useContext(ErrorContext);
}

type ErrorProviderProps = {
  children: ReactNode;
};

function ErrorProvider({ children }: ErrorProviderProps) {
  const [showError, setShowError] = useState(false);

  return (
    <ErrorContext.Provider value={setShowError}>
      {children}
      {showError && <p className={styles.error}>Enter at least one character</p>}
    </ErrorContext.Provider>
  )
}

export default ErrorProvider;
