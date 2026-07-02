-- Custom Foods & Meals (issue #109). Follows conventions from 007_nutrition.sql:
-- INT AUTO_INCREMENT PK, BINARY(16) user_uuid, no FK, FULLTEXT on name.
-- migrate.js tolerates errno 1050 (table exists) and 1060 (column exists),
-- so CREATE TABLE IF NOT EXISTS and ADD COLUMN re-runs are safe.
-- ALTER ... MODIFY is naturally idempotent (widening an ENUM is accepted on
-- repeated runs without error).

CREATE TABLE IF NOT EXISTS custom_foods (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_uuid BINARY(16) NOT NULL,
  kind ENUM('food','meal') NOT NULL,
  status ENUM('draft','saved') NOT NULL DEFAULT 'saved',
  name VARCHAR(255) NOT NULL,
  notes VARCHAR(1000) NULL,
  total_grams FLOAT NOT NULL DEFAULT 0,
  calories FLOAT NOT NULL DEFAULT 0,
  protein_g FLOAT NOT NULL DEFAULT 0,
  carbs_g FLOAT NOT NULL DEFAULT 0,
  fat_g FLOAT NOT NULL DEFAULT 0,
  fiber_g FLOAT NULL, sugar_g FLOAT NULL, sodium_mg FLOAT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_user_status (user_uuid, status),
  FULLTEXT KEY ft_name (name)
);

CREATE TABLE IF NOT EXISTS custom_food_ingredients (
  id INT AUTO_INCREMENT PRIMARY KEY,
  custom_food_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  grams FLOAT NOT NULL,
  source ENUM('usda','off','manual','custom') NOT NULL,
  source_ref VARCHAR(64) NULL,
  calories FLOAT NOT NULL DEFAULT 0,
  protein_g FLOAT NOT NULL DEFAULT 0,
  carbs_g FLOAT NOT NULL DEFAULT 0,
  fat_g FLOAT NOT NULL DEFAULT 0,
  fiber_g FLOAT NULL, sugar_g FLOAT NULL, sodium_mg FLOAT NULL,
  KEY idx_parent (custom_food_id)
);

CREATE TABLE IF NOT EXISTS custom_food_servings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  custom_food_id INT NOT NULL,
  label VARCHAR(64) NOT NULL,
  def_type ENUM('grams','fraction') NOT NULL,
  def_value FLOAT NOT NULL,
  grams FLOAT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  KEY idx_parent (custom_food_id)
);

ALTER TABLE food_entry_ingredients MODIFY source ENUM('usda','off','manual','custom') NOT NULL;
ALTER TABLE food_entry_ingredients ADD COLUMN fiber_g FLOAT NULL;
ALTER TABLE food_entry_ingredients ADD COLUMN sugar_g FLOAT NULL;
ALTER TABLE food_entry_ingredients ADD COLUMN sodium_mg FLOAT NULL;
ALTER TABLE food_entries MODIFY source ENUM('manual','text','photo','barcode','mixed','custom') NOT NULL;
ALTER TABLE food_entries ADD COLUMN from_custom_food_id INT NULL;
