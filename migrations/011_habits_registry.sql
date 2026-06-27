-- Adds a per-user habits registry table so habits have an identity beyond
-- just a tally key.  Existing tallies are unaffected: habit_tallies continues
-- to store rows keyed by habit_name. This table simply gives users a named
-- list they can manage (create / rename / delete / reorder).
--
-- Seeding: any user who already has tallies for 'nail-biting' gets that habit
-- inserted automatically so their existing data keeps working after deploy.
--
-- Deploy ordering:
--   1. Run this migration BEFORE deploying new backend code.
--   2. The new CRUD endpoints (/habits registry routes) depend on this table.
--   3. Existing tally endpoints are unaffected and continue to work even if
--      this migration runs first on a fresh DB with no prior tallies.
--
-- Idempotency: CREATE TABLE IF NOT EXISTS is safe on re-runs.
-- scripts/migrate.js tracks applied files in schema_migrations so this file
-- is only ever executed once per DB.

CREATE TABLE IF NOT EXISTS habits (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_uuid   BINARY(16)    NOT NULL,
  name        VARCHAR(100)  NOT NULL,
  ordering    INT           NOT NULL DEFAULT 0,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_user_habit_name (user_uuid, name),
  FOREIGN KEY (user_uuid) REFERENCES users(user_uuid) ON DELETE CASCADE
);

-- Seed: for every user who already has nail-biting tallies, insert the habit
-- into the registry (if it does not already exist).
INSERT IGNORE INTO habits (user_uuid, name, ordering, created_at)
SELECT DISTINCT user_uuid, 'nail-biting', 0, NOW()
FROM habit_tallies
WHERE habit_name = 'nail-biting';
