import { createContext, useContext, useState } from "react";

const UserContext = createContext();

export function useUser() {
  return useContext(UserContext);
}

function UserProvider({ children }) {
  const [user, setUser] = useState({
    "uuid": "22b856c2-c610-11ef-9524-581cf8f27efb",
    "email": "test",
    "password": "test"
  });

  return (
    <UserContext.Provider value={{ user, setUser }}>
      {children}
    </UserContext.Provider>
  )
}

export default UserProvider;