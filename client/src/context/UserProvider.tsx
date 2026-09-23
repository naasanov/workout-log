import { createContext, useContext, useEffect, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { isLoggedIn } from '../api/authApi';
import type { User } from '../api/authApi';

export type { User };

// undefined = auth check in progress (loading), null = signed out, User = signed in.
type UserContextValue = {
  user: User | null | undefined;
  setUser: Dispatch<SetStateAction<User | null | undefined>>;
};

const UserContext = createContext<UserContextValue | undefined>(undefined);

export function useUser(): UserContextValue {
  // Always mounted under UserProvider (see App.tsx), so the context is never
  // actually undefined here; this cast keeps that contract explicit instead
  // of forcing every caller to guard against a case that can't happen.
  return useContext(UserContext) as UserContextValue;
}

// #312: delays between retries of a transient /auth/logged-in failure
const RETRY_DELAYS_MS = [500, 1500, 3500];

type UserProviderProps = {
  children: ReactNode;
};

function UserProvider({ children }: UserProviderProps) {
  // undefined = auth check in progress (loading)
  // null     = definitively logged out
  // {}       = logged in (a placeholder until login/signup populate the real user)
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    // #312: a thrown error is a transient failure (5xx/network), not a
    // definitive sign-out, so retry with backoff before giving up.
    const attempt = async (attemptIndex: number) => {
      try {
        const signedIn = await isLoggedIn();
        if (!cancelled) setUser(signedIn ? ({} as User) : null);
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
