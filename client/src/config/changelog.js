// Entries are added by hand whenever something user-visible ships. This is
// not a dump of PR titles: internal refactors, chores, and dev-tooling
// changes are left out on purpose. Newest entry first.

export const CHANGELOG = [
  {
    date: '2026-08-30',
    title: 'Food search reliability, feedback screenshots, and this changelog',
    items: [
      'Food search now returns real results far more often instead of quietly falling back to a weaker source',
      'Search results that share a name are no longer listed three times over, and store-brand foods now show the brand',
      'You can attach screenshots to feedback',
      'Added a reconnect button to the nutrition chat for when a reply stops mid-stream',
      'Added this What’s New list',
      'The app loads faster on repeat visits',
    ],
  },
  {
    date: '2026-08-26',
    title: 'Nutrition chat and food search improvements',
    items: [
      'Fiber now shows on ingredient cards, with a daily fiber goal you can set',
      'Food search finds more results and shows a clear error instead of failing silently',
      'Ingredient cards now line up cleanly instead of shifting between one and two rows',
      'Swiping through the food search dropdown no longer accidentally selects an item',
    ],
  },
  {
    date: '2026-08-22',
    title: 'Body weight trends and dining menu filters',
    items: [
      'Body weight chart now shows a smoothed trend line alongside your daily entries',
      'UNC dining menu lookup now supports dietary and allergen filters',
    ],
  },
  {
    date: '2026-08-19',
    title: 'Nutrition tracking polish',
    items: [
      'Added a "Today" button to quickly jump back to today’s log',
      'Ingredient entries now show grams alongside servings',
      'Fixed dining hall menu items that showed up with blank names',
      'The feedback form now shows a real error message when your message is too long',
    ],
  },
  {
    date: '2026-08-18',
    title: 'UNC dining hall support in nutrition chat',
    items: [
      'You can now ask the nutrition chat assistant about UNC dining hall food',
      'Chat now recovers automatically if a response stalls partway through',
      'Fixed the barcode scanner’s Cancel button not responding on some devices',
    ],
  },
  {
    date: '2026-08-16',
    title: 'Custom meals and foods fixes',
    items: [
      'Custom meals and foods no longer autosave a draft unless you actually changed something',
      'Custom meals now log as a single row instead of splitting into duplicates',
      'Fixed a layout gap left behind when a row’s delete button is hidden',
    ],
  },
  {
    date: '2026-08-15',
    title: 'Branding refresh and mobile polish',
    items: [
      'Added the new Peak mountain logo and per-page browser tab titles',
      'Icon buttons are now easier to tap on mobile',
      'Fixed the home-screen app icon theme color to match the dark theme',
      'Faster weight-tracking chart animation and a clearer notes modal',
      'Fixed calorie rounding and the default serving size for custom meals',
    ],
  },
  {
    date: '2026-08-11',
    title: 'Nutrition and workout fixes',
    items: [
      'Fixed macro scaling breaking permanently after clearing the grams field',
      'Multi-barcode scanning and barcode-based nutrition lookups are more reliable',
      'Fixed the notes icon and the est. 1RM chart tooltip on the Workouts tab',
    ],
  },
];
