import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  decimal,
  boolean,
  json,
  bigint,
  index,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extended with trading bot specific fields.
 */
export const users = mysqlTable(
  "users",
  {
    id: int("id").autoincrement().primaryKey(),
    openId: varchar("openId", { length: 64 }).notNull().unique(),
    name: text("name"),
    email: varchar("email", { length: 320 }).unique(),
    loginMethod: varchar("loginMethod", { length: 64 }),
    role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
    
    // Wallet & Subscription
    walletAddress: varchar("walletAddress", { length: 255 }),
    subscriptionTier: mysqlEnum("subscriptionTier", ["free", "premium"]).default("free").notNull(),
    subscriptionStatus: mysqlEnum("subscriptionStatus", ["active", "inactive", "suspended", "cancelled"]).default("inactive").notNull(),
    subscriptionExpiresAt: timestamp("subscriptionExpiresAt"),
    
    // Risk Management Settings
    maxDailyDrawdown: decimal("maxDailyDrawdown", { precision: 5, scale: 2 }).default("5.00"), // percentage
    perTradeBudget: decimal("perTradeBudget", { precision: 10, scale: 2 }).default("100.00"), // USDT
    slippageProtection: decimal("slippageProtection", { precision: 5, scale: 2 }).default("2.00"), // percentage
    
    // Bot Status
    botEnabled: boolean("botEnabled").default(false),
    botLastHealthCheck: timestamp("botLastHealthCheck"),
    
    // Referral
    referralCode: varchar("referralCode", { length: 32 }).unique(),
    referredBy: int("referredBy"),
    
    // Freemium Features
    citiesAllowed: int("citiesAllowed").default(1), // Free tier: 1 city, Premium: unlimited
    advancedFeaturesEnabled: boolean("advancedFeaturesEnabled").default(false), // Free: false, Premium: true
    
    // Preferences
    language: varchar("language", { length: 10 }).default("en"),
    telegramChatId: varchar("telegramChatId", { length: 255 }),
    discordWebhookUrl: text("discordWebhookUrl"),
    
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
    lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
  },
  (table) => ({
    referredByIdx: index("referredBy_idx").on(table.referredBy),
    walletIdx: index("wallet_idx").on(table.walletAddress),
  })
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Subscription payments tracking
 */
export const subscriptionPayments = mysqlTable(
  "subscriptionPayments",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    tier: mysqlEnum("tier", ["premium"]).default("premium").notNull(),
    amountUSDT: decimal("amountUSDT", { precision: 10, scale: 2 }).notNull(),
    referralDiscount: decimal("referralDiscount", { precision: 10, scale: 2 }).default("0"),
    referralCommission: decimal("referralCommission", { precision: 10, scale: 2 }).default("0"),
    txHash: varchar("txHash", { length: 255 }).notNull().unique(),
    chainId: int("chainId").default(137), // Polygon mainnet
    status: mysqlEnum("status", ["pending", "confirmed", "failed"]).default("pending").notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    confirmedAt: timestamp("confirmedAt"),
  },
  (table) => ({
    userIdx: index("userId_idx").on(table.userId),
    txIdx: index("txHash_idx").on(table.txHash),
  })
);

export type SubscriptionPayment = typeof subscriptionPayments.$inferSelect;
export type InsertSubscriptionPayment = typeof subscriptionPayments.$inferInsert;

/**
 * Referral commissions tracking
 */
export const referralCommissions = mysqlTable(
  "referralCommissions",
  {
    id: int("id").autoincrement().primaryKey(),
    referrerId: int("referrerId").notNull(),
    referredUserId: int("referredUserId").notNull(),
    paymentId: int("paymentId"),
    discountAmount: decimal("discountAmount", { precision: 10, scale: 2 }).notNull(), // 2 USDT (20% of 10 USDT)
    commissionUSDT: decimal("commissionUSDT", { precision: 10, scale: 2 }).notNull(), // 2 USDT (100% of discount)
    status: mysqlEnum("status", ["pending", "credited", "paid"]).default("pending").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    paidAt: timestamp("paidAt"),
  },
  (table) => ({
    referrerIdx: index("referrerId_idx").on(table.referrerId),
    referredIdx: index("referredUserId_idx").on(table.referredUserId),
  })
);

export type ReferralCommission = typeof referralCommissions.$inferSelect;
export type InsertReferralCommission = typeof referralCommissions.$inferInsert;

/**
 * Trading positions on Polymarket
 */
export const positions = mysqlTable(
  "positions",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    polymarketMarketId: varchar("polymarketMarketId", { length: 255 }).notNull(),
    city: varchar("city", { length: 100 }).notNull(),
    forecastDate: timestamp("forecastDate").notNull(),
    temperatureBin: varchar("temperatureBin", { length: 50 }).notNull(), // e.g., "15-16°C"
    
    // Position Details
    entryPrice: decimal("entryPrice", { precision: 8, scale: 4 }).notNull(),
    quantity: decimal("quantity", { precision: 10, scale: 2 }).notNull(),
    positionSizeUSDT: decimal("positionSizeUSDT", { precision: 10, scale: 2 }).notNull(),
    
    // Status
    status: mysqlEnum("status", ["open", "closed", "hedged"]).default("open").notNull(),
    exitPrice: decimal("exitPrice", { precision: 8, scale: 4 }),
    pnl: decimal("pnl", { precision: 10, scale: 2 }),
    
    // Weather Data at Entry
    weatherConsensus: json("weatherConsensus"), // { gfs: 15.2, ecmwf: 15.1, icon: 15.3, consensus: 15.2 }
    
    // Metadata
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    closedAt: timestamp("closedAt"),
  },
  (table) => ({
    userIdx: index("userId_idx").on(table.userId),
    marketIdx: index("marketId_idx").on(table.polymarketMarketId),
    statusIdx: index("status_idx").on(table.status),
  })
);

export type Position = typeof positions.$inferSelect;
export type InsertPosition = typeof positions.$inferInsert;

/**
 * Trade execution history
 */
export const trades = mysqlTable(
  "trades",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    positionId: int("positionId"),
    polymarketOrderId: varchar("polymarketOrderId", { length: 255 }).notNull().unique(),
    
    type: mysqlEnum("type", ["buy", "sell", "hedge"]).notNull(),
    price: decimal("price", { precision: 8, scale: 4 }).notNull(),
    quantity: decimal("quantity", { precision: 10, scale: 2 }).notNull(),
    totalValue: decimal("totalValue", { precision: 10, scale: 2 }).notNull(),
    
    status: mysqlEnum("status", ["pending", "filled", "failed", "cancelled"]).default("pending").notNull(),
    slippage: decimal("slippage", { precision: 5, scale: 2 }),
    
    reason: text("reason"), // e.g., "multi-model consensus", "dynamic hedge"
    
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    filledAt: timestamp("filledAt"),
  },
  (table) => ({
    userIdx: index("userId_idx").on(table.userId),
    orderIdx: index("orderId_idx").on(table.polymarketOrderId),
    statusIdx: index("status_idx").on(table.status),
  })
);

export type Trade = typeof trades.$inferSelect;
export type InsertTrade = typeof trades.$inferInsert;

/**
 * Weather data snapshots for backtesting and audit
 */
export const weatherSnapshots = mysqlTable(
  "weatherSnapshots",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId"),
    city: varchar("city", { length: 100 }).notNull(),
    forecastDate: timestamp("forecastDate").notNull(),
    
    gfsTemperature: decimal("gfsTemperature", { precision: 5, scale: 2 }),
    ecmwfTemperature: decimal("ecmwfTemperature", { precision: 5, scale: 2 }),
    iconTemperature: decimal("iconTemperature", { precision: 5, scale: 2 }),
    
    consensusTemperature: decimal("consensusTemperature", { precision: 5, scale: 2 }),
    consensusConfidence: decimal("consensusConfidence", { precision: 5, scale: 2 }), // 0-100
    
    actualTemperature: decimal("actualTemperature", { precision: 5, scale: 2 }),
    
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    cityIdx: index("city_idx").on(table.city),
    dateIdx: index("forecastDate_idx").on(table.forecastDate),
  })
);

export type WeatherSnapshot = typeof weatherSnapshots.$inferSelect;
export type InsertWeatherSnapshot = typeof weatherSnapshots.$inferInsert;

/**
 * Bot alerts and notifications
 */
export const alerts = mysqlTable(
  "alerts",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    
    type: mysqlEnum("type", [
      "trade_executed",
      "forecast_change",
      "bot_status",
      "risk_threshold",
      "connectivity_lost",
      "drawdown_limit_hit",
    ]).notNull(),
    
    title: varchar("title", { length: 255 }).notNull(),
    message: text("message").notNull(),
    severity: mysqlEnum("severity", ["info", "warning", "critical"]).default("info").notNull(),
    
    // Delivery Status
    sentToTelegram: boolean("sentToTelegram").default(false),
    sentToDiscord: boolean("sentToDiscord").default(false),
    sentToEmail: boolean("sentToEmail").default(false),
    
    metadata: json("metadata"), // Additional context
    
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index("userId_idx").on(table.userId),
    typeIdx: index("type_idx").on(table.type),
  })
);

export type Alert = typeof alerts.$inferSelect;
export type InsertAlert = typeof alerts.$inferInsert;

/**
 * Bot health and status logs
 */
export const botHealthLogs = mysqlTable(
  "botHealthLogs",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    
    status: mysqlEnum("status", ["healthy", "degraded", "offline"]).notNull(),
    lastWeatherCheck: timestamp("lastWeatherCheck"),
    lastPolymarketCheck: timestamp("lastPolymarketCheck"),
    
    weatherApiStatus: mysqlEnum("weatherApiStatus", ["ok", "slow", "error"]).default("ok"),
    polymarketApiStatus: mysqlEnum("polymarketApiStatus", ["ok", "slow", "error"]).default("ok"),
    
    activePositions: int("activePositions").default(0),
    dailyPnl: decimal("dailyPnl", { precision: 10, scale: 2 }),
    
    errorMessage: text("errorMessage"),
    
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index("userId_idx").on(table.userId),
    statusIdx: index("status_idx").on(table.status),
  })
);

export type BotHealthLog = typeof botHealthLogs.$inferSelect;
export type InsertBotHealthLog = typeof botHealthLogs.$inferInsert;

/**
 * Backtesting results
 */
export const backTestResults = mysqlTable(
  "backTestResults",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    
    name: varchar("name", { length: 255 }).notNull(),
    startDate: timestamp("startDate").notNull(),
    endDate: timestamp("endDate").notNull(),
    
    initialCapital: decimal("initialCapital", { precision: 10, scale: 2 }).notNull(),
    finalCapital: decimal("finalCapital", { precision: 10, scale: 2 }).notNull(),
    totalReturn: decimal("totalReturn", { precision: 8, scale: 2 }), // percentage
    
    totalTrades: int("totalTrades").default(0),
    winningTrades: int("winningTrades").default(0),
    winRate: decimal("winRate", { precision: 5, scale: 2 }), // percentage
    
    maxDrawdown: decimal("maxDrawdown", { precision: 5, scale: 2 }), // percentage
    sharpeRatio: decimal("sharpeRatio", { precision: 8, scale: 4 }),
    
    parameters: json("parameters"), // Strategy parameters used
    results: json("results"), // Detailed results
    
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index("userId_idx").on(table.userId),
  })
);

export type BackTestResult = typeof backTestResults.$inferSelect;
export type InsertBackTestResult = typeof backTestResults.$inferInsert;

/**
 * Audit log for security and compliance
 */
export const auditLogs = mysqlTable(
  "auditLogs",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    userId: int("userId"),
    
    action: varchar("action", { length: 100 }).notNull(),
    resource: varchar("resource", { length: 100 }).notNull(),
    
    details: json("details"),
    ipAddress: varchar("ipAddress", { length: 45 }),
    userAgent: text("userAgent"),
    
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index("userId_idx").on(table.userId),
    actionIdx: index("action_idx").on(table.action),
  })
);

export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = typeof auditLogs.$inferInsert;
