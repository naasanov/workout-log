import { useEffect } from "react";

// #236: sets the browser tab title. No react-helmet in this project (and no
// other document.title handling anywhere) — this is the smallest thing that
// works. Re-runs whenever `title` changes, so callers whose page swaps
// content without a route change (e.g. Workouts' tab param) stay in sync.
function useDocumentTitle(title) {
  useEffect(() => {
    document.title = title;
  }, [title]);
}

export default useDocumentTitle;
