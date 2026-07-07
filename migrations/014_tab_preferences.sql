CREATE TABLE tab_preferences (
  user_uuid BINARY(16) PRIMARY KEY,
  enabled_tabs JSON NOT NULL,
  FOREIGN KEY (user_uuid) REFERENCES users(user_uuid) ON DELETE CASCADE
);

INSERT INTO tab_preferences (user_uuid, enabled_tabs)
SELECT user_uuid, JSON_ARRAY('workouts', 'body-weight', 'habits', 'nutrition')
FROM users
