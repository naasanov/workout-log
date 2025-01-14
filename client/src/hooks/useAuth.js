import { useCallback } from "react";
import { useUser } from "../context/UserProvider";

function useAuth() {
  const { user } = useUser()
  const withAuth = useCallback(
    async (fn) => {
      if (!user) return null;
      else return await fn()
    },
    [user]
  )
  return { withAuth }
}

export default useAuth;