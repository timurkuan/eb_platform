-- ЭО Платформа MySQL схемасы
-- mysql -u root -p eo_platform < schema.sql

CREATE DATABASE IF NOT EXISTS eo_platform
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE eo_platform;

-- Пайдаланушылар
CREATE TABLE IF NOT EXISTS users (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  email        VARCHAR(255) NOT NULL UNIQUE,
  password     VARCHAR(255) NOT NULL,          -- bcrypt hash
  name         VARCHAR(255) NOT NULL,
  org          VARCHAR(255) DEFAULT '',
  role         ENUM('admin','user') DEFAULT 'user',
  status       ENUM('pending','active','blocked') DEFAULT 'pending',
  eo_limit     INT DEFAULT 0,
  eo_created   INT DEFAULT 0,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_email (email),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Электронды оқулықтар
CREATE TABLE IF NOT EXISTS ebooks (
  id           VARCHAR(64) PRIMARY KEY,         -- 'eo_timestamp_random'
  user_id      INT NOT NULL,
  title        VARCHAR(500) NOT NULL,
  html_content LONGTEXT,                        -- ЭО HTML мазмұны
  form_data    JSON,                            -- форма деректері (өңдеу үшін)
  deleted_at   DATETIME DEFAULT NULL,           -- soft delete (корзина)
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user (user_id),
  INDEX idx_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Бар кестеге deleted_at қосу (миграция):
-- ALTER TABLE ebooks ADD COLUMN deleted_at DATETIME DEFAULT NULL AFTER form_data;

-- Әкімші аккаунты (бірінші іске қосқанда автоматты жасалады)
-- email: admin@eo.kz
-- password: admin123
-- server.js ішінде seedAdmin() функциясы орындайды