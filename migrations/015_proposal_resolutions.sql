-- Proposal resolution persistence for the nutrition chat (#186).
-- Accept/deny state for propose_entry / propose_custom_food cards was only
-- kept in localStorage, so an accepted proposal came back as "pending" after
-- a reload or on a different device (the DB transcript is source of truth
-- for messages, but nothing recorded whether a proposal had been resolved).
-- Stores one row per user + date + toolCallId. UNIQUE key makes an upsert-style
-- write idempotent (a re-confirm/re-deny of the same toolCallId overwrites).
-- migrate.js tolerates 1050/1060 so re-runs are safe.

CREATE TABLE IF NOT EXISTS proposal_resolutions (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  user_uuid    BINARY(16)     NOT NULL,
  date         DATE           NOT NULL,
  tool_call_id VARCHAR(64)    NOT NULL,
  kind         ENUM('entry','custom_food') NOT NULL,
  status       ENUM('confirmed','denied') NOT NULL,
  display_name VARCHAR(255)   NULL COMMENT 'entry/food name recorded at confirm time, for "Logged: <name>"',
  created_at   DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_user_date_toolcall (user_uuid, date, tool_call_id),
  KEY idx_user_date (user_uuid, date)
);
