-- Unguessable per-attachment token so images are served straight from this
-- app's own DB instead of GitHub's Contents API (#358) -- that upload never
-- worked because the token lacks Contents:write, so every screenshot showed
-- up as "(1 attachment failed to upload)". NULL for rows inserted earlier.
-- ADD COLUMN and ADD UNIQUE KEY are combined into one ALTER so a re-run hits
-- a single tolerated 1060 (duplicate column), not an untolerated "duplicate
-- key name" from a separate ADD KEY statement. migrate.js tolerates 1050/1060.

ALTER TABLE feedback_attachments
  ADD COLUMN public_token CHAR(32) NULL AFTER image_data,
  ADD UNIQUE KEY uniq_public_token (public_token);
