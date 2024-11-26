CREATE TABLE `workout_log`.`users` (
  `user_id` INT NOT NULL AUTO_INCREMENT,
  `uuid` CHAR(36) NOT NULL DEFAULT (UUID()),
  `email` VARCHAR(254) NOT NULL,
  `password` VARCHAR(60) NOT NULL,
  PRIMARY KEY (`user_id`),
  UNIQUE INDEX `user_id_UNIQUE` (`user_id` ASC) VISIBLE,
  UNIQUE INDEX `uuid_UNIQUE` (`uuid` ASC) VISIBLE,
  UNIQUE INDEX `email_UNIQUE` (`email` ASC) VISIBLE);

CREATE TABLE `workout_log`.`sections` (
  `section_id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `label` VARCHAR(255) NOT NULL,
  PRIMARY KEY (`section_id`),
  FOREIGN KEY (user_id) REFERENCES users(user_id),
  UNIQUE INDEX `section_id_UNIQUE` (`section_id` ASC) VISIBLE);

CREATE TABLE `workout_log`.`movements` (
  `movement_id` INT NOT NULL AUTO_INCREMENT,
  `section_id` INT NOT NULL,
  `label` VARCHAR(255) NOT NULL,
  PRIMARY KEY (`movement_id`),
  FOREIGN KEY (section_id) REFERENCES sections(section_id),
  UNIQUE INDEX `movement_id_UNIQUE` (`movement_id` ASC) VISIBLE);

CREATE TABLE `workout_log`.`variations` (
  `variation_id` INT NOT NULL AUTO_INCREMENT,
  `movement_id` INT NOT NULL,
  `label` VARCHAR(255) NULL,
  `weight` VARCHAR(255) NULL,
  `reps` VARCHAR(255) NULL,
  `date` DATETIME NULL,
  FOREIGN KEY (movement_id) REFERENCES movements(movement_id),
  PRIMARY KEY (`variation_id`),
  UNIQUE INDEX `variation_id_UNIQUE` (`variation_id` ASC) VISIBLE);
