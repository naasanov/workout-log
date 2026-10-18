-- Adds 'fatsecret' as an ingredient source. ALTER ... MODIFY is idempotent when re-run.
ALTER TABLE food_entry_ingredients MODIFY source ENUM('usda','off','manual','custom','unc','fatsecret') NOT NULL;
ALTER TABLE custom_food_ingredients MODIFY source ENUM('usda','off','manual','custom','unc','fatsecret') NOT NULL;
