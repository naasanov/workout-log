-- Unguessable per-attachment token, so screenshots are served from this app's own DB (#358).
-- One combined ALTER keeps a re-run to a single tolerated 1060 (duplicate column) error.
-- Rows inserted before this migration keep a NULL token.

ALTER TABLE feedback_attachments
  ADD COLUMN public_token CHAR(32) NULL AFTER image_data,
  ADD UNIQUE KEY uniq_public_token (public_token);
