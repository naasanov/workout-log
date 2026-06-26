-- AI usage tracking for the nutrition chat agent.
-- Records per-request token usage and estimated cost per user.
-- OWNER_EMAIL env var gates the all-users breakdown endpoint.
-- migrate.js tolerates 1050/1060 so re-runs are safe.

CREATE TABLE IF NOT EXISTS ai_usage (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  user_uuid    BINARY(16)   NOT NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  model        VARCHAR(64)  NULL,
  input_tokens INT          NULL,
  output_tokens INT         NULL,
  reasoning_tokens INT      NULL,
  total_tokens INT          NULL,
  cost_usd     FLOAT        NULL,
  KEY idx_user (user_uuid)
);
