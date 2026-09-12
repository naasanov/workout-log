-- Per-turn usage details for ai_usage (#325): cached input tokens, model steps,
-- tool calls and web search calls. Re-runs hit the tolerated 1060 error.

ALTER TABLE ai_usage ADD COLUMN cached_input_tokens INT NULL;
ALTER TABLE ai_usage ADD COLUMN steps INT NULL;
ALTER TABLE ai_usage ADD COLUMN tool_calls INT NULL;
ALTER TABLE ai_usage ADD COLUMN web_search_calls INT NULL;
