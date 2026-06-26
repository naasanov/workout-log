-- Chat transcript storage for the nutrition AI agent.
-- Stores UIMessage objects (parts-based) keyed by user + date.
-- migrate.js tolerates 1050/1060 so re-runs are safe.

CREATE TABLE IF NOT EXISTS chat_messages (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  user_uuid    BINARY(16)     NOT NULL,
  date         DATE           NOT NULL,
  message_id   VARCHAR(64)    NOT NULL,
  role         ENUM('user','assistant','system') NOT NULL,
  parts        LONGTEXT       NOT NULL COMMENT 'JSON-serialized AI SDK UIMessage parts array',
  interrupted  TINYINT(1)     NOT NULL DEFAULT 0,
  created_at   DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_user_date (user_uuid, date)
);
