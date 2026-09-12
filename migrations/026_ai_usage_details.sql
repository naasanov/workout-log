-- Adds usage-detail columns to ai_usage: cached input tokens, reasoning
-- was already recorded but under a bugged field name (fixed in code, not
-- schema), plus step count, tool-call count, and web-search call count (#325).
-- migrate.js tolerates 1050/1060 so re-runs are safe.

ALTER TABLE ai_usage ADD COLUMN cached_input_tokens INT NULL;
ALTER TABLE ai_usage ADD COLUMN steps INT NULL;
ALTER TABLE ai_usage ADD COLUMN tool_calls INT NULL;
ALTER TABLE ai_usage ADD COLUMN web_search_calls INT NULL;
