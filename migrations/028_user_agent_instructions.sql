-- #382: per-user free-text instructions folded into the agent's system
-- prompt (see services/agent/prompt/userInstructions.ts). NULL means none
-- set. migrate.js tolerates errno 1050/1060 so re-running this is safe.

ALTER TABLE users ADD COLUMN agent_instructions TEXT NULL;
