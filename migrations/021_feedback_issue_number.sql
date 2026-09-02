-- Records the GitHub issue number a feedback row's mirrored issue got, so a
-- changelog bullet can be badged "you submitted this" for its reporter. Null
-- until issue creation succeeds (best-effort, see routes/feedback.ts) and for
-- rows predating this column (see scripts/backfillFeedbackIssueNumbers.js).
-- migrate.js tolerates errno 1050/1060 so re-running this is safe.

ALTER TABLE feedback ADD COLUMN issue_number INT NULL AFTER message;
