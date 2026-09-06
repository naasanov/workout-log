-- Conversations: unlinks chat identity from the calendar day. A conversation
-- can now span months, and "new chat" (formerly "Clear") archives the old
-- conversation instead of destroying it. migrate.js tolerates errno 1050/1060
-- so re-running this file on a partially-applied DB is safe, and the
-- backfill below is additionally idempotent by construction (its own
-- comments explain how).
--
-- title is the truncated first user message (see deriveTitle in
-- services/conversations/store.ts), stored once at write time rather than
-- re-derived on every list read. A later wave may replace this with a
-- generated summary title -- title stays a plain nullable column either way.
--
-- One active conversation per user is enforced at the DB level: active_slot
-- is 1 for the active conversation (archived_at IS NULL) and NULL for every
-- archived one, and MySQL's unique index treats NULL as "doesn't collide"
-- -- exactly one row per user_uuid can have active_slot = 1, while any
-- number can have it NULL.
CREATE TABLE IF NOT EXISTS conversations (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  user_uuid    BINARY(16)   NOT NULL,
  title        VARCHAR(255) NULL COMMENT 'Truncated first user message, NULL until one is appended',
  archived_at  DATETIME     NULL COMMENT 'NULL while this is the active conversation',
  expires_at   DATETIME     NULL COMMENT 'Purge deadline while archived, cleared again on continue',
  active_slot  TINYINT      GENERATED ALWAYS AS (IF(archived_at IS NULL, 1, NULL)) STORED,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_user_active_slot (user_uuid, active_slot),
  KEY idx_user_updated (user_uuid, updated_at)
);

-- chat_messages / proposal_resolutions keep their `date` column (kept
-- nullable, not dropped) so old per-day queries and a rollback both keep
-- working, but it is no longer how a message's conversation is found -- new
-- rows written by a conversation that spans multiple days have no single
-- day to record here. conversation_id is the identity going forward.
-- ADD COLUMN and ADD KEY are combined into one ALTER each so a re-run hits a
-- single tolerated 1060 (duplicate column) for the whole statement, rather
-- than a second, untolerated "duplicate key name" error from a separate
-- ADD KEY statement.
ALTER TABLE chat_messages
  ADD COLUMN conversation_id INT NULL AFTER date,
  ADD KEY idx_conversation (conversation_id);
ALTER TABLE chat_messages MODIFY COLUMN date DATE NULL;

ALTER TABLE proposal_resolutions
  ADD COLUMN conversation_id INT NULL AFTER date,
  ADD KEY idx_conversation (conversation_id);
ALTER TABLE proposal_resolutions MODIFY COLUMN date DATE NULL;

-- --------------------------------------------------------------------------
-- Backfill: one conversation per existing distinct (user_uuid, date) in
-- chat_messages, with every chat_messages / proposal_resolutions row from
-- that user+day re-pointed at it.
--
-- Idempotent: every step below is scoped to conversation_id IS NULL, so a
-- second run (or a resumed partial run after a mid-migration failure) finds
-- nothing left to do and performs no inserts or updates. backfill_key is a
-- temporary staging column dropped at the end of this file -- it exists
-- only to correlate a freshly-inserted conversation row back to the
-- (user_uuid, date) pair it was created for, since INSERT ... SELECT does
-- not return generated ids.
-- --------------------------------------------------------------------------

ALTER TABLE conversations ADD COLUMN backfill_key VARCHAR(48) NULL;

INSERT INTO conversations (user_uuid, title, archived_at, backfill_key, created_at, updated_at)
SELECT
  g.user_uuid,
  (SELECT LEFT(TRIM(JSON_UNQUOTE(JSON_EXTRACT(cm2.parts, '$[0].text'))), 80)
     FROM chat_messages cm2
     WHERE cm2.user_uuid = g.user_uuid AND cm2.date = g.date AND cm2.role = 'user'
     ORDER BY cm2.id ASC LIMIT 1),
  g.max_created,
  CONCAT(HEX(g.user_uuid), '|', g.date),
  g.min_created,
  g.max_created
FROM (
  SELECT user_uuid, date, MIN(created_at) AS min_created, MAX(created_at) AS max_created
  FROM chat_messages
  WHERE conversation_id IS NULL
  GROUP BY user_uuid, date
) g;

UPDATE chat_messages cm
JOIN conversations c ON c.backfill_key = CONCAT(HEX(cm.user_uuid), '|', cm.date)
SET cm.conversation_id = c.id
WHERE cm.conversation_id IS NULL;

-- proposal_resolutions has no rows of its own to group by -- it is
-- re-pointed at whatever conversation chat_messages from the same
-- (user_uuid, date) already landed on, so a day's transcript and its
-- proposal state always agree on which conversation they belong to.
UPDATE proposal_resolutions pr
JOIN conversations c ON c.backfill_key = CONCAT(HEX(pr.user_uuid), '|', pr.date)
SET pr.conversation_id = c.id
WHERE pr.conversation_id IS NULL;

ALTER TABLE conversations DROP COLUMN backfill_key;
