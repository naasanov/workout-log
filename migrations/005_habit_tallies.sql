CREATE TABLE IF NOT EXISTS habit_tallies (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_uuid BINARY(16) NOT NULL,
  habit_name VARCHAR(100) NOT NULL,
  date DATE NOT NULL,
  count INT NOT NULL DEFAULT 0,
  range_start TIME NULL,
  range_end TIME NULL,
  UNIQUE KEY unique_user_habit_date (user_uuid, habit_name, date)
);
