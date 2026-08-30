-- #296: image attachments for feedback submissions, uploaded best-effort to
-- GitHub via the Contents API. github_url is nullable since that upload can
-- fail without blocking the feedback submission itself.
-- migrate.js tolerates errno 1050/1060 so re-running this is safe.

CREATE TABLE IF NOT EXISTS feedback_attachments (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  feedback_id  INT            NOT NULL,
  mime_type    VARCHAR(32)    NOT NULL,
  image_data   MEDIUMBLOB     NOT NULL,
  github_url   VARCHAR(512)   NULL,
  created_at   DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (feedback_id) REFERENCES feedback(id)
);
