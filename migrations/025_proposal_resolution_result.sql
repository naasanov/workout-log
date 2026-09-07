-- Lets a resolved proposal report back what it actually did -- e.g. the
-- id(s) a create produced -- so a later chat turn can act on the new
-- record(s) instead of re-deriving them through list_resources. NULL for
-- every existing row and for any resolution the client has no structured
-- output for (a denial, or a write with nothing worth echoing back).
-- migrate.js tolerates errno 1050/1060 so re-running this file is safe.
ALTER TABLE proposal_resolutions ADD COLUMN result JSON NULL AFTER display_name;
