-- UNC campus-dining nutrition (Wave 1). Follows conventions from 013_custom_foods.sql:
-- migrate.js tolerates errno 1050 (table exists) and 1060 (column exists), so
-- CREATE TABLE IF NOT EXISTS and ADD COLUMN re-runs are safe. ALTER ... MODIFY is
-- naturally idempotent (widening an ENUM is accepted on repeated runs without error).

-- Per-account feature flag, toggled at runtime by an owner-only admin endpoint.
ALTER TABLE users ADD COLUMN unc_dining_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- Serving-based ingredients. UNC publishes per-serving nutrition with NO gram weight
-- (e.g. "1/2 cup", "1 each"), and only ~18% of its serving sizes are weight-based, so
-- grams genuinely cannot be derived for most UNC items. Ingredients therefore need to
-- support a serving basis as an alternative to the existing weight (grams) basis.
--
-- Invariant: a row carries EXACTLY ONE basis -- either `grams` (weight) or
-- `serving_qty` + `serving_label` (serving), never both, never neither. This is
-- enforced in application-level zod validation, not by a CHECK constraint, to match
-- how this codebase validates elsewhere.

ALTER TABLE food_entry_ingredients MODIFY grams FLOAT NULL;
ALTER TABLE food_entry_ingredients MODIFY source ENUM('usda','off','manual','custom','unc') NOT NULL;
ALTER TABLE food_entry_ingredients ADD COLUMN serving_qty FLOAT NULL;
ALTER TABLE food_entry_ingredients ADD COLUMN serving_label VARCHAR(64) NULL;

ALTER TABLE custom_food_ingredients MODIFY grams FLOAT NULL;
ALTER TABLE custom_food_ingredients MODIFY source ENUM('usda','off','manual','custom','unc') NOT NULL;
ALTER TABLE custom_food_ingredients ADD COLUMN serving_qty FLOAT NULL;
ALTER TABLE custom_food_ingredients ADD COLUMN serving_label VARCHAR(64) NULL;

-- A custom food/meal composed entirely of serving-basis ingredients (no grams
-- on any row) has no derivable total weight. Storing 0 there would be a lie
-- that reads as a real weight, so total_grams must be able to state "unknown"
-- honestly via NULL instead.
ALTER TABLE custom_foods MODIFY total_grams FLOAT NULL;

-- Cache tables for scraped UNC dining data.

CREATE TABLE IF NOT EXISTS unc_recipes (
  recipe_number INT PRIMARY KEY,          -- UNC's own global recipe id, stable across dates & locations
  name VARCHAR(255) NOT NULL,
  serving_label VARCHAR(64) NULL,         -- "1 each", "1/2 cup" -- display only, no gram equivalent exists
  -- NULL on any nutrient below means UNC omitted it for this recipe -- it does NOT mean zero.
  calories FLOAT NULL, protein_g FLOAT NULL, carbs_g FLOAT NULL, fat_g FLOAT NULL,
  fiber_g FLOAT NULL, sugar_g FLOAT NULL, added_sugar_g FLOAT NULL,
  sodium_mg FLOAT NULL, cholesterol_mg FLOAT NULL,
  sat_fat_g FLOAT NULL, trans_fat_g FLOAT NULL,
  calcium_mg FLOAT NULL, iron_mg FLOAT NULL, potassium_mg FLOAT NULL, vitamin_d_mcg FLOAT NULL,
  allergens VARCHAR(255) NULL,            -- comma-separated
  dietary VARCHAR(255) NULL,              -- comma-separated
  ingredients TEXT NULL,
  fetched_at DATETIME NOT NULL
);

-- Caching policy this table's writer must respect:
--   1. UNC publishes menus only up to today + 31 days.
--   2. UNC purges past menus after ~5-8 days, so once a day is stored here it must be
--      treated as a permanent archive and never re-fetched -- a re-fetch would return
--      zero items. The cache writer must never overwrite a stored non-empty day with an
--      empty result.
CREATE TABLE IF NOT EXISTS unc_menu_days (
  location_slug VARCHAR(64) NOT NULL,
  menu_date DATE NOT NULL,
  fetched_at DATETIME NOT NULL,
  item_count INT NOT NULL,
  PRIMARY KEY (location_slug, menu_date)
);

CREATE TABLE IF NOT EXISTS unc_menu_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  location_slug VARCHAR(64) NOT NULL,
  menu_date DATE NOT NULL,
  meal_period VARCHAR(64) NOT NULL,       -- raw label, e.g. "Dinner (5pm-8:30pm)"
  period_start TIME NULL,
  period_end TIME NULL,
  station VARCHAR(128) NOT NULL,
  recipe_number INT NOT NULL,
  KEY idx_day (location_slug, menu_date),
  KEY idx_recipe (recipe_number)
);
