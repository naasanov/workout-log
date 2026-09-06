-- Tracks which tab keys a user has ever been offered, so a future tab addition
-- can be distinguished from a tab the user deliberately disabled. A key absent
-- from enabled_tabs but present in known_tabs was a deliberate choice, while a
-- key absent from both is new and should be adopted (see services/tabPreferences.ts).
-- migrate.js tolerates errno 1050/1060 so re-running this is safe.

ALTER TABLE tab_preferences ADD COLUMN known_tabs JSON NULL AFTER enabled_tabs;

-- Existing rows predate every tab except these four, so their current
-- enabled/disabled choices are all deliberate -- none of these four should
-- ever be silently re-enabled by the new-tab merge.
UPDATE tab_preferences
SET known_tabs = JSON_ARRAY('workouts', 'body-weight', 'habits', 'nutrition')
WHERE known_tabs IS NULL;

ALTER TABLE tab_preferences MODIFY COLUMN known_tabs JSON NOT NULL;
