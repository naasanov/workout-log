import useIsMobile from "../../hooks/useIsMobile";
import ThinHeader from "./ThinHeader";
import WideHeader from "./WideHeader";

function SectionHeader() {
  const { isMobile } = useIsMobile();
  return ( 
    isMobile
    ? <ThinHeader />
    : <WideHeader />
  );
}

export default SectionHeader;