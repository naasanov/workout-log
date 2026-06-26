-- User feedback submissions.
-- Optionally mirrored to GitHub Issues (when GITHUB_TOKEN is set).
-- migrate.js tolerates 1050/1060 so re-runs are safe.

CREATE TABLE IF NOT EXISTS feedback (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  user_uuid    BINARY(16)     NOT NULL,
  category     VARCHAR(16)    NULL,
  message      TEXT           NOT NULL,
  created_at   DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP
);
