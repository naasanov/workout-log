import { createContext, useContext, useEffect, useState } from "react";
import { isLoggedIn } from '../api/authApi.js';
const UserContext = createContext();

export function useUser() {
  return useContext(UserContext);
}

function UserProvider({ children }) {
  const [user, setUser] = useState(null);
  useEffect(() => {
    const fetchUser = async () => {
      setUser(await isLoggedIn() ? {} : null);
    }
    fetchUser();
  }, [])

  return (
    <UserContext.Provider value={{ user, setUser }}>
      {children}
    </UserContext.Provider>
  )
}

export default UserProvider;