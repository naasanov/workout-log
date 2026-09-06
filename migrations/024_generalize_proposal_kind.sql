-- Generalizes proposal_resolutions.kind beyond nutrition's original
-- ENUM('entry','custom_food') so a proposal from any resource (body weight,
-- habits, sections, movements, variations, nutrition goals, ...) can share
-- the same resolution mechanism (services/conversations/store.ts). A plain
-- VARCHAR is a strict superset of the prior enum's values, so existing rows
-- are read back unchanged.
ALTER TABLE proposal_resolutions MODIFY COLUMN kind VARCHAR(32) NOT NULL;
