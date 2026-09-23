import { useCallback } from "react";
import { useUser } from "../context/UserProvider";

function useAuth() {
  const { user } = useUser()
  const withAuth = useCallback(
    async function run<T>(fn: () => Promise<T>): Promise<T | null> {
      if (!user) return null;
      try {
        return await fn();
      } catch (error) {
        console.error('[withAuth] request failed:', error);
        return null;
      }
    },
    [user]
  )
  return { withAuth, user }
}

export default useAuth;
