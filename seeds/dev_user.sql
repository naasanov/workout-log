-- Dev user seed: dev@dev.com / dev (bcrypt cost 10)
INSERT IGNORE INTO users (user_uuid, email, `password`)
VALUES (UUID_TO_BIN(UUID()), 'dev@dev.com', '$2b$10$qwCxH0klBbY/lgiAqNhQ6uk7tdG7SkdczY12gQL2.TXkwU2iHqR.S');
