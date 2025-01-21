import { useEffect, useState } from "react";
const MOBILE_SCREEN_WIDTH = 885;

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < MOBILE_SCREEN_WIDTH)

  useEffect(() => {
    const update = () => {
      setIsMobile(window.innerWidth < MOBILE_SCREEN_WIDTH);
    }
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('resize', update);
    }
  }, [])

  useEffect(() => {
    console.log("changing isMobile")
  }, [isMobile])
  return { isMobile }
}

export default useIsMobile;