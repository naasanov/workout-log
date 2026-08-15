// Brand mark for the header wordmark. Sourced from a single-path mountain
// glyph (mountain-svgrepo-com.svg at the repo root); inlined here as a React
// component — rather than an <img> — so `fill="currentColor"` lets CSS drive
// the color, matching this repo's icon convention (see Icons.jsx).
//
// NOTE: the standalone favicon at client/public/mountain.svg has the same
// path data with the fill hardcoded to $primary's hex, since a favicon file
// can't read a CSS variable. Keep the two colors in sync if $primary changes.
function MountainLogo({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 17 17"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M8.012,1.062 L4.035,8.87 L2.709,7.569 C2.709,7.569 -0.305,14 0.063,14 L15.965,14 L15.965,13.998 L12.627,6.898 L11.644,7.51 L8.012,1.062 L8.012,1.062 Z M5.611,7.521 L8.062,2.77 L10.347,6.851 L9.361,7.521 L8.021,6.233 L5.611,7.521 L5.611,7.521 Z" />
    </svg>
  );
}

export default MountainLogo;
