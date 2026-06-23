/// <reference types="vite/client" />

// Allow TypeScript to import *.module.scss files in .tsx files.
// The JSX files use allowJs + checkJs:false so they don't need this;
// new .tsx files do.
declare module '*.module.scss' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module '*.scss' {
  const classes: { readonly [key: string]: string };
  export default classes;
}
