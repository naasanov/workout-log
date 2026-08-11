-- #215: track which tab/tool the feedback is about.
-- migrate.js tolerates duplicate-column error 1060 so re-runs are safe.

ALTER TABLE feedback ADD COLUMN tool VARCHAR(32) NULL AFTER category;
