import { createContext, useContext, useState } from "react";

const ErrorContext = createContext();

export function useError() {
  return useContext(ErrorContext);
}

function ErrorProvider({ children }) {
  const [showError, setShowError] = useState(false);

  return (
    <ErrorContext.Provider value={setShowError}>
      {children}
      {showError && <p className="error">enter at least one character</p>}
    </ErrorContext.Provider>
  )
}

export default ErrorProvider;