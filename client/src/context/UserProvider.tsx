import { createContext, useContext, useEffect, useState } from "react";
import { isLoggedIn } from '../api/authApi.js';
const UserContext = createContext();

export function useUser() {
  return useContext(UserContext);
}

// #312: delays between retries of a transient /auth/logged-in failure
const RETRY_DELAYS_MS = [500, 1500, 3500];

function UserProvider({ children }) {
  // undefined = auth check in progress (loading)
  // null     = definitively logged out
  // {}       = logged in
  const [user, setUser] = useState(undefined);
  useEffect(() => {
    let cancelled = false;
    let timeoutId;

    // #312: a thrown error is a transient failure (5xx/network), not a
    // definitive sign-out, so retry with backoff before giving up.
    const attempt = async (attemptIndex) => {
      try {
        const signedIn = await isLoggedIn();
        if (!cancelled) setUser(signedIn ? {} : null);
      } catch {
        if (cancelled) return;
        if (attemptIndex < RETRY_DELAYS_MS.length) {
          timeoutId = setTimeout(() => attempt(attemptIndex + 1), RETRY_DELAYS_MS[attemptIndex]);
        } else {
          setUser(null);
        }
      }
    }
    attempt(0);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    }
  }, [])

  return (
    <UserContext.Provider value={{ user, setUser }}>
      {children}
    </UserContext.Provider>
  )
}

export default UserProvider;