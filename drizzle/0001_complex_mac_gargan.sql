CREATE TABLE `alerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`type` enum('trade_executed','forecast_change','bot_status','risk_threshold','connectivity_lost','drawdown_limit_hit') NOT NULL,
	`title` varchar(255) NOT NULL,
	`message` text NOT NULL,
	`severity` enum('info','warning','critical') NOT NULL DEFAULT 'info',
	`sentToTelegram` boolean DEFAULT false,
	`sentToDiscord` boolean DEFAULT false,
	`sentToEmail` boolean DEFAULT false,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `alerts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `auditLogs` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`userId` int,
	`action` varchar(100) NOT NULL,
	`resource` varchar(100) NOT NULL,
	`details` json,
	`ipAddress` varchar(45),
	`userAgent` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `auditLogs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `backTestResults` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`startDate` timestamp NOT NULL,
	`endDate` timestamp NOT NULL,
	`initialCapital` decimal(10,2) NOT NULL,
	`finalCapital` decimal(10,2) NOT NULL,
	`totalReturn` decimal(8,2),
	`totalTrades` int DEFAULT 0,
	`winningTrades` int DEFAULT 0,
	`winRate` decimal(5,2),
	`maxDrawdown` decimal(5,2),
	`sharpeRatio` decimal(8,4),
	`parameters` json,
	`results` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `backTestResults_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `botHealthLogs` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`status` enum('healthy','degraded','offline') NOT NULL,
	`lastWeatherCheck` timestamp,
	`lastPolymarketCheck` timestamp,
	`weatherApiStatus` enum('ok','slow','error') DEFAULT 'ok',
	`polymarketApiStatus` enum('ok','slow','error') DEFAULT 'ok',
	`activePositions` int DEFAULT 0,
	`dailyPnl` decimal(10,2),
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `botHealthLogs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `positions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`polymarketMarketId` varchar(255) NOT NULL,
	`city` varchar(100) NOT NULL,
	`forecastDate` timestamp NOT NULL,
	`temperatureBin` varchar(50) NOT NULL,
	`entryPrice` decimal(8,4) NOT NULL,
	`quantity` decimal(10,2) NOT NULL,
	`positionSizeUSDT` decimal(10,2) NOT NULL,
	`status` enum('open','closed','hedged') NOT NULL DEFAULT 'open',
	`exitPrice` decimal(8,4),
	`pnl` decimal(10,2),
	`weatherConsensus` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`closedAt` timestamp,
	CONSTRAINT `positions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `referralCommissions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`referrerId` int NOT NULL,
	`referredUserId` int NOT NULL,
	`paymentId` int,
	`commissionUSDT` decimal(10,2) NOT NULL,
	`commissionRate` decimal(5,2) DEFAULT '10.00',
	`status` enum('pending','credited','paid') NOT NULL DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`paidAt` timestamp,
	CONSTRAINT `referralCommissions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `subscriptionPayments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`tier` enum('pro','premium') NOT NULL,
	`amountUSDT` decimal(10,2) NOT NULL,
	`txHash` varchar(255) NOT NULL,
	`chainId` int DEFAULT 137,
	`status` enum('pending','confirmed','failed') NOT NULL DEFAULT 'pending',
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`confirmedAt` timestamp,
	CONSTRAINT `subscriptionPayments_id` PRIMARY KEY(`id`),
	CONSTRAINT `subscriptionPayments_txHash_unique` UNIQUE(`txHash`)
);
--> statement-breakpoint
CREATE TABLE `trades` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`positionId` int,
	`polymarketOrderId` varchar(255) NOT NULL,
	`type` enum('buy','sell','hedge') NOT NULL,
	`price` decimal(8,4) NOT NULL,
	`quantity` decimal(10,2) NOT NULL,
	`totalValue` decimal(10,2) NOT NULL,
	`status` enum('pending','filled','failed','cancelled') NOT NULL DEFAULT 'pending',
	`slippage` decimal(5,2),
	`reason` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`filledAt` timestamp,
	CONSTRAINT `trades_id` PRIMARY KEY(`id`),
	CONSTRAINT `trades_polymarketOrderId_unique` UNIQUE(`polymarketOrderId`)
);
--> statement-breakpoint
CREATE TABLE `weatherSnapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`city` varchar(100) NOT NULL,
	`forecastDate` timestamp NOT NULL,
	`gfsTemperature` decimal(5,2),
	`ecmwfTemperature` decimal(5,2),
	`iconTemperature` decimal(5,2),
	`consensusTemperature` decimal(5,2),
	`consensusConfidence` decimal(5,2),
	`actualTemperature` decimal(5,2),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `weatherSnapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `walletAddress` varchar(255);--> statement-breakpoint
ALTER TABLE `users` ADD `subscriptionTier` enum('free','pro','premium') DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `subscriptionStatus` enum('active','inactive','suspended','cancelled') DEFAULT 'inactive' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `subscriptionExpiresAt` timestamp;--> statement-breakpoint
ALTER TABLE `users` ADD `maxDailyDrawdown` decimal(5,2) DEFAULT '5.00';--> statement-breakpoint
ALTER TABLE `users` ADD `perTradeBudget` decimal(10,2) DEFAULT '100.00';--> statement-breakpoint
ALTER TABLE `users` ADD `slippageProtection` decimal(5,2) DEFAULT '2.00';--> statement-breakpoint
ALTER TABLE `users` ADD `botEnabled` boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE `users` ADD `botLastHealthCheck` timestamp;--> statement-breakpoint
ALTER TABLE `users` ADD `referralCode` varchar(32);--> statement-breakpoint
ALTER TABLE `users` ADD `referredBy` int;--> statement-breakpoint
ALTER TABLE `users` ADD `language` varchar(10) DEFAULT 'en';--> statement-breakpoint
ALTER TABLE `users` ADD `telegramChatId` varchar(255);--> statement-breakpoint
ALTER TABLE `users` ADD `discordWebhookUrl` text;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_email_unique` UNIQUE(`email`);--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_referralCode_unique` UNIQUE(`referralCode`);--> statement-breakpoint
CREATE INDEX `userId_idx` ON `alerts` (`userId`);--> statement-breakpoint
CREATE INDEX `type_idx` ON `alerts` (`type`);--> statement-breakpoint
CREATE INDEX `userId_idx` ON `auditLogs` (`userId`);--> statement-breakpoint
CREATE INDEX `action_idx` ON `auditLogs` (`action`);--> statement-breakpoint
CREATE INDEX `userId_idx` ON `backTestResults` (`userId`);--> statement-breakpoint
CREATE INDEX `userId_idx` ON `botHealthLogs` (`userId`);--> statement-breakpoint
CREATE INDEX `status_idx` ON `botHealthLogs` (`status`);--> statement-breakpoint
CREATE INDEX `userId_idx` ON `positions` (`userId`);--> statement-breakpoint
CREATE INDEX `marketId_idx` ON `positions` (`polymarketMarketId`);--> statement-breakpoint
CREATE INDEX `status_idx` ON `positions` (`status`);--> statement-breakpoint
CREATE INDEX `referrerId_idx` ON `referralCommissions` (`referrerId`);--> statement-breakpoint
CREATE INDEX `referredUserId_idx` ON `referralCommissions` (`referredUserId`);--> statement-breakpoint
CREATE INDEX `userId_idx` ON `subscriptionPayments` (`userId`);--> statement-breakpoint
CREATE INDEX `txHash_idx` ON `subscriptionPayments` (`txHash`);--> statement-breakpoint
CREATE INDEX `userId_idx` ON `trades` (`userId`);--> statement-breakpoint
CREATE INDEX `orderId_idx` ON `trades` (`polymarketOrderId`);--> statement-breakpoint
CREATE INDEX `status_idx` ON `trades` (`status`);--> statement-breakpoint
CREATE INDEX `city_idx` ON `weatherSnapshots` (`city`);--> statement-breakpoint
CREATE INDEX `forecastDate_idx` ON `weatherSnapshots` (`forecastDate`);--> statement-breakpoint
CREATE INDEX `referredBy_idx` ON `users` (`referredBy`);--> statement-breakpoint
CREATE INDEX `wallet_idx` ON `users` (`walletAddress`);