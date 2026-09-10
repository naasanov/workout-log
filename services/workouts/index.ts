// Public surface of the workouts domain: sections -> movements -> variations
// (-> variation_history). Routes and the AI agent feature both call through
// here rather than reaching into the per-table modules directly.
export * from './sections';
export * from './movements';
export * from './variations';
export * from './tree';
