-- Adds the sections.is_open column that the app code (routes/sections.ts) and the
-- production DB already rely on, but which was missing from the committed migrations
-- (schema drift discovered during the Phase 0 refactor).
-- Safe to re-run: scripts/migrate.js tolerates errno 1060 (duplicate column), so on
-- DBs that already have the column (e.g. production) this is a no-op.
ALTER TABLE sections ADD COLUMN is_open BOOLEAN NOT NULL DEFAULT FALSE;
