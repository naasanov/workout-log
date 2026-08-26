-- #285 Adds a settable fiber goal alongside the existing calorie/protein/carb/fat goals.
-- migrate.js tolerates errno 1050/1060 so re-running this on a DB that already has the
-- column is safe.

ALTER TABLE nutrition_goals ADD COLUMN fiber_g FLOAT NULL;
