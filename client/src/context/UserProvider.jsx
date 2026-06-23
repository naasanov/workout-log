import { createContext, useContext, useEffect, useState } from "react";
import { isLoggedIn } from '../api/authApi.js';
const UserContext = createContext();

export function useUser() {
  return useContext(UserContext);
}

function UserProvider({ children }) {
  // undefined = auth check in progress (loading)
  // null     = definitively logged out
  // {}       = logged in
  const [user, setUser] = useState(undefined);
  useEffect(() => {
    const fetchUser = async () => {
      try {
        setUser(await isLoggedIn() ? {} : null);
      } catch {
        setUser(null);
      }
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