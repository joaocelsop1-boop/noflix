-- Banco de dados para CinePlus WebPlayer + Painel ADM
-- IMPORTANTE (cPanel / hospedagem compartilhada): NÃO crie o banco por aqui.
-- Crie o banco em cPanel > MySQL Databases (o nome fica com prefixo, ex.:
-- storestreaming_minetv), adicione o usuário ao banco com TODOS os privilégios
-- e importe ESTE arquivo dentro desse banco pelo phpMyAdmin.
-- Todas as tabelas usam CREATE TABLE IF NOT EXISTS: reimportar é seguro.

-- 1. Tabela de Configurações Gerais e do Servidor Sigma
CREATE TABLE IF NOT EXISTS `settings` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `sigma_url` VARCHAR(255) NOT NULL DEFAULT 'http://seuservidor.com:8080',
  `sigma_username` VARCHAR(100) NOT NULL DEFAULT '',
  `sigma_password` VARCHAR(100) NOT NULL DEFAULT '',
  `panel_proxy` VARCHAR(255) NOT NULL DEFAULT '',
  `site_name` VARCHAR(100) NOT NULL DEFAULT 'CinePlus',
  `affiliate_percent` INT NOT NULL DEFAULT 10,
  `trial_hours` INT NOT NULL DEFAULT 3,
  `mp_access_token` VARCHAR(255) NOT NULL DEFAULT '',
  `pix_key` VARCHAR(255) NOT NULL DEFAULT '',
  `payment_gateway` VARCHAR(20) NOT NULL DEFAULT 'mp',
  `pix_fixed_code` TEXT NOT NULL,
  `pix_fixed_qr` TEXT NOT NULL,
  `pix_beneficiary` VARCHAR(120) NOT NULL DEFAULT '',
  `lynx_api_key` VARCHAR(255) NOT NULL DEFAULT '',
  `lynx_webhook_secret` VARCHAR(255) NOT NULL DEFAULT '',
  `efi_client_id` VARCHAR(255) NOT NULL DEFAULT '',
  `efi_client_secret` VARCHAR(255) NOT NULL DEFAULT '',
  `efi_cert_path` VARCHAR(255) NOT NULL DEFAULT '',
  `efi_sandbox` TINYINT(1) NOT NULL DEFAULT 0,
  `asaas_api_key` VARCHAR(255) NOT NULL DEFAULT '',
  `asaas_sandbox` TINYINT(1) NOT NULL DEFAULT 0,
  `support_whatsapp` VARCHAR(30) NOT NULL DEFAULT '',
  `support_telegram` VARCHAR(100) NOT NULL DEFAULT '',
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

INSERT INTO `settings` (`id`, `sigma_url`, `sigma_username`, `sigma_password`, `site_name`, `affiliate_percent`, `trial_hours`)
VALUES (1, 'http://seuservidor.com:8080', 'demo_user', 'demo_pass', 'CinePlus', 10, 3)
ON DUPLICATE KEY UPDATE `id`=1;

-- 2. Tabela de Planos
CREATE TABLE IF NOT EXISTS `plans` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(50) NOT NULL,
  `price` DECIMAL(10,2) NOT NULL,
  `duration_days` INT NOT NULL,
  `is_recommended` TINYINT(1) DEFAULT 0,
  `active` TINYINT(1) DEFAULT 1
) ENGINE=InnoDB;

INSERT INTO `plans` (`id`, `name`, `price`, `duration_days`, `is_recommended`, `active`) VALUES
(1, 'Quinzenal', 15.00, 15, 0, 1),
(2, 'Mensal', 25.00, 30, 1, 1),
(3, 'Anual', 70.00, 365, 0, 1)
ON DUPLICATE KEY UPDATE `name`=VALUES(`name`);

-- 3. Tabela de Usuários / Clientes e Administradores
CREATE TABLE IF NOT EXISTS `users` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(100) NOT NULL,
  `email` VARCHAR(150) NOT NULL UNIQUE,
  `password` VARCHAR(255) NOT NULL,
  `whatsapp` VARCHAR(30) DEFAULT NULL,
  `role` ENUM('client', 'admin') DEFAULT 'client',
  `plan_id` INT DEFAULT NULL,
  `expires_at` DATETIME DEFAULT NULL,
  `status` ENUM('active', 'expired', 'trial', 'blocked') DEFAULT 'trial',
  `session_token` VARCHAR(64) NOT NULL DEFAULT '',
  `pix_key` VARCHAR(255) DEFAULT NULL,
  `referral_code` VARCHAR(20) UNIQUE,
  `referred_by` INT DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Trava de login (tudo21): 5 senhas erradas travam o e-mail por 15 min.
-- Fica no banco (não na sessão) para não poder ser burlada limpando o cookie.
CREATE TABLE IF NOT EXISTS `login_attempts` (
  `email` VARCHAR(255) NOT NULL PRIMARY KEY,
  `attempts` INT NOT NULL DEFAULT 0,
  `lock_until` INT NOT NULL DEFAULT 0,
  `updated_at` INT NOT NULL DEFAULT 0
) ENGINE=InnoDB;

-- Usuário Admin padrão (Senha: admin123) — PRIMEIRO ACESSO APENAS.
-- Troque a senha no primeiro login em admin_login.php > Administradores > Trocar minha senha.
INSERT INTO `users` (`id`, `name`, `email`, `password`, `role`, `status`, `referral_code`)
VALUES (1, 'Super Admin', 'admin@minetv.tv', '$2y$10$7T0TWV9kFbc7rhnIAeJ7Pu.UiBeztTbYy278ABilySGaUH4Sscu/2', 'admin', 'active', 'ADMIN01')
ON DUPLICATE KEY UPDATE `role`='admin';

-- 4. Tabela de Vendas / Transações Pix
CREATE TABLE IF NOT EXISTS `orders` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `plan_id` INT NOT NULL,
  `amount` DECIMAL(10,2) NOT NULL,
  `pix_code` TEXT,
  `pix_qr_url` TEXT,
  `gateway` VARCHAR(20) NOT NULL DEFAULT '',
  `status` ENUM('pending', 'approved', 'cancelled') DEFAULT 'pending',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `approved_at` DATETIME DEFAULT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 5. Tabela de Comissões de Afiliados (Indique e Ganhe)
CREATE TABLE IF NOT EXISTS `commissions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `order_id` INT NOT NULL,
  `affiliate_id` INT NOT NULL,
  `referred_id` INT NOT NULL,
  `amount` DECIMAL(10,2) NOT NULL,
  `status` ENUM('pending', 'paid') DEFAULT 'pending',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`affiliate_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`referred_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 6. Tabela de Perfis (máximo 4 por usuário; perfil kids esconde conteúdo adulto)
CREATE TABLE IF NOT EXISTS `profiles` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `name` VARCHAR(50) NOT NULL,
  `is_kids` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 7. Tabela de Avaliações "SUA NOTA" (1 a 5 estrelas por título)
CREATE TABLE IF NOT EXISTS `user_ratings` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `stream_type` VARCHAR(20) NOT NULL,
  `stream_id` INT NOT NULL,
  `rating` TINYINT NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uniq_rating` (`user_id`, `stream_type`, `stream_id`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Colunas do Pix (reimportação por cima de um banco antigo): o CREATE TABLE
-- acima já inclui mp_access_token e pix_key, então estes ALTERs são só uma
-- rede de segurança. Eles ficam NO FIM de propósito: o "ADD COLUMN IF NOT
-- EXISTS" é sintaxe só do MariaDB — no MySQL puro ele dá erro de sintaxe e,
-- se estivesse no meio do arquivo, o phpMyAdmin pararia a importação ali e
-- as tabelas seguintes (plans, users, orders...) nunca seriam criadas.
-- Aqui no fim, mesmo que falhem, todas as tabelas já existem.
ALTER TABLE `settings` ADD COLUMN IF NOT EXISTS `mp_access_token` VARCHAR(255) NOT NULL DEFAULT '';
ALTER TABLE `settings` ADD COLUMN IF NOT EXISTS `pix_key` VARCHAR(255) NOT NULL DEFAULT '';
