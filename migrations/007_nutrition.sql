-- Nutrition tracker (Peak 4th tab). Mirrors existing table conventions:
-- INT AUTO_INCREMENT PK, user_uuid BINARY(16), no FK (ownership enforced in SQL),
-- user's LOCAL date stored as DATE. migrate.js tolerates 1050/1060 so re-runs are safe.

CREATE TABLE IF NOT EXISTS food_entries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_uuid BINARY(16) NOT NULL,
  date DATE NOT NULL,                       -- user's LOCAL date (client localDate)
  logged_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  meal ENUM('breakfast','lunch','dinner','snack') NOT NULL,
  name VARCHAR(255) NOT NULL,
  source ENUM('manual','text','photo','barcode','mixed') NOT NULL,
  calories FLOAT NOT NULL DEFAULT 0,
  protein_g FLOAT NOT NULL DEFAULT 0,
  carbs_g FLOAT NOT NULL DEFAULT 0,
  fat_g FLOAT NOT NULL DEFAULT 0,
  fiber_g FLOAT NULL,
  sugar_g FLOAT NULL,
  sodium_mg FLOAT NULL,
  barcode VARCHAR(32) NULL,
  raw_llm_json JSON NULL,                    -- only set for agent-created entries
  KEY idx_user_date (user_uuid, date),
  FULLTEXT KEY ft_name (name)                -- memory: search past meals by name
);

CREATE TABLE IF NOT EXISTS food_entry_ingredients (
  id INT AUTO_INCREMENT PRIMARY KEY,
  entry_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  grams FLOAT NOT NULL,
  source ENUM('usda','off','manual') NOT NULL,
  source_ref VARCHAR(64) NULL,              -- USDA fdcId or OFF barcode
  calories FLOAT NOT NULL DEFAULT 0,        -- contribution of THIS row at its grams
  protein_g FLOAT NOT NULL DEFAULT 0,
  carbs_g FLOAT NOT NULL DEFAULT 0,
  fat_g FLOAT NOT NULL DEFAULT 0,
  KEY idx_entry (entry_id)
);

CREATE TABLE IF NOT EXISTS nutrition_goals (
  user_uuid BINARY(16) NOT NULL PRIMARY KEY,
  calories FLOAT NULL,
  protein_g FLOAT NULL,
  carbs_g FLOAT NULL,
  fat_g FLOAT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
