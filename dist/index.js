// server/_core/index.ts
import "dotenv/config";
import express2 from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

// shared/const.ts
var COOKIE_NAME = "app_session_id";
var ONE_YEAR_MS = 1e3 * 60 * 60 * 24 * 365;
var AXIOS_TIMEOUT_MS = 3e4;
var UNAUTHED_ERR_MSG = "Please login (10001)";
var NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";

// server/db.ts
import { eq, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";

// drizzle/schema.ts
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
  index
} from "drizzle-orm/mysql-core";
var users = mysqlTable(
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
    subscriptionTier: mysqlEnum("subscriptionTier", ["free", "pro", "premium"]).default("free").notNull(),
    subscriptionStatus: mysqlEnum("subscriptionStatus", ["active", "inactive", "suspended", "cancelled"]).default("inactive").notNull(),
    subscriptionExpiresAt: timestamp("subscriptionExpiresAt"),
    // Risk Management Settings
    maxDailyDrawdown: decimal("maxDailyDrawdown", { precision: 5, scale: 2 }).default("5.00"),
    // percentage
    perTradeBudget: decimal("perTradeBudget", { precision: 10, scale: 2 }).default("100.00"),
    // USDT
    slippageProtection: decimal("slippageProtection", { precision: 5, scale: 2 }).default("2.00"),
    // percentage
    // Bot Status
    botEnabled: boolean("botEnabled").default(false),
    botLastHealthCheck: timestamp("botLastHealthCheck"),
    // Referral
    referralCode: varchar("referralCode", { length: 32 }).unique(),
    referredBy: int("referredBy"),
    // Preferences
    language: varchar("language", { length: 10 }).default("en"),
    telegramChatId: varchar("telegramChatId", { length: 255 }),
    discordWebhookUrl: text("discordWebhookUrl"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
    lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull()
  },
  (table) => ({
    referredByIdx: index("referredBy_idx").on(table.referredBy),
    walletIdx: index("wallet_idx").on(table.walletAddress)
  })
);
var subscriptionPayments = mysqlTable(
  "subscriptionPayments",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    tier: mysqlEnum("tier", ["pro", "premium"]).notNull(),
    amountUSDT: decimal("amountUSDT", { precision: 10, scale: 2 }).notNull(),
    txHash: varchar("txHash", { length: 255 }).notNull().unique(),
    chainId: int("chainId").default(137),
    // Polygon mainnet
    status: mysqlEnum("status", ["pending", "confirmed", "failed"]).default("pending").notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    confirmedAt: timestamp("confirmedAt")
  },
  (table) => ({
    userIdx: index("userId_idx").on(table.userId),
    txIdx: index("txHash_idx").on(table.txHash)
  })
);
var referralCommissions = mysqlTable(
  "referralCommissions",
  {
    id: int("id").autoincrement().primaryKey(),
    referrerId: int("referrerId").notNull(),
    referredUserId: int("referredUserId").notNull(),
    paymentId: int("paymentId"),
    commissionUSDT: decimal("commissionUSDT", { precision: 10, scale: 2 }).notNull(),
    commissionRate: decimal("commissionRate", { precision: 5, scale: 2 }).default("10.00"),
    // percentage
    status: mysqlEnum("status", ["pending", "credited", "paid"]).default("pending").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    paidAt: timestamp("paidAt")
  },
  (table) => ({
    referrerIdx: index("referrerId_idx").on(table.referrerId),
    referredIdx: index("referredUserId_idx").on(table.referredUserId)
  })
);
var positions = mysqlTable(
  "positions",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    polymarketMarketId: varchar("polymarketMarketId", { length: 255 }).notNull(),
    city: varchar("city", { length: 100 }).notNull(),
    forecastDate: timestamp("forecastDate").notNull(),
    temperatureBin: varchar("temperatureBin", { length: 50 }).notNull(),
    // e.g., "15-16°C"
    // Position Details
    entryPrice: decimal("entryPrice", { precision: 8, scale: 4 }).notNull(),
    quantity: decimal("quantity", { precision: 10, scale: 2 }).notNull(),
    positionSizeUSDT: decimal("positionSizeUSDT", { precision: 10, scale: 2 }).notNull(),
    // Status
    status: mysqlEnum("status", ["open", "closed", "hedged"]).default("open").notNull(),
    exitPrice: decimal("exitPrice", { precision: 8, scale: 4 }),
    pnl: decimal("pnl", { precision: 10, scale: 2 }),
    // Weather Data at Entry
    weatherConsensus: json("weatherConsensus"),
    // { gfs: 15.2, ecmwf: 15.1, icon: 15.3, consensus: 15.2 }
    // Metadata
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    closedAt: timestamp("closedAt")
  },
  (table) => ({
    userIdx: index("userId_idx").on(table.userId),
    marketIdx: index("marketId_idx").on(table.polymarketMarketId),
    statusIdx: index("status_idx").on(table.status)
  })
);
var trades = mysqlTable(
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
    reason: text("reason"),
    // e.g., "multi-model consensus", "dynamic hedge"
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    filledAt: timestamp("filledAt")
  },
  (table) => ({
    userIdx: index("userId_idx").on(table.userId),
    orderIdx: index("orderId_idx").on(table.polymarketOrderId),
    statusIdx: index("status_idx").on(table.status)
  })
);
var weatherSnapshots = mysqlTable(
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
    consensusConfidence: decimal("consensusConfidence", { precision: 5, scale: 2 }),
    // 0-100
    actualTemperature: decimal("actualTemperature", { precision: 5, scale: 2 }),
    createdAt: timestamp("createdAt").defaultNow().notNull()
  },
  (table) => ({
    cityIdx: index("city_idx").on(table.city),
    dateIdx: index("forecastDate_idx").on(table.forecastDate)
  })
);
var alerts = mysqlTable(
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
      "drawdown_limit_hit"
    ]).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    message: text("message").notNull(),
    severity: mysqlEnum("severity", ["info", "warning", "critical"]).default("info").notNull(),
    // Delivery Status
    sentToTelegram: boolean("sentToTelegram").default(false),
    sentToDiscord: boolean("sentToDiscord").default(false),
    sentToEmail: boolean("sentToEmail").default(false),
    metadata: json("metadata"),
    // Additional context
    createdAt: timestamp("createdAt").defaultNow().notNull()
  },
  (table) => ({
    userIdx: index("userId_idx").on(table.userId),
    typeIdx: index("type_idx").on(table.type)
  })
);
var botHealthLogs = mysqlTable(
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
    createdAt: timestamp("createdAt").defaultNow().notNull()
  },
  (table) => ({
    userIdx: index("userId_idx").on(table.userId),
    statusIdx: index("status_idx").on(table.status)
  })
);
var backTestResults = mysqlTable(
  "backTestResults",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    startDate: timestamp("startDate").notNull(),
    endDate: timestamp("endDate").notNull(),
    initialCapital: decimal("initialCapital", { precision: 10, scale: 2 }).notNull(),
    finalCapital: decimal("finalCapital", { precision: 10, scale: 2 }).notNull(),
    totalReturn: decimal("totalReturn", { precision: 8, scale: 2 }),
    // percentage
    totalTrades: int("totalTrades").default(0),
    winningTrades: int("winningTrades").default(0),
    winRate: decimal("winRate", { precision: 5, scale: 2 }),
    // percentage
    maxDrawdown: decimal("maxDrawdown", { precision: 5, scale: 2 }),
    // percentage
    sharpeRatio: decimal("sharpeRatio", { precision: 8, scale: 4 }),
    parameters: json("parameters"),
    // Strategy parameters used
    results: json("results"),
    // Detailed results
    createdAt: timestamp("createdAt").defaultNow().notNull()
  },
  (table) => ({
    userIdx: index("userId_idx").on(table.userId)
  })
);
var auditLogs = mysqlTable(
  "auditLogs",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    userId: int("userId"),
    action: varchar("action", { length: 100 }).notNull(),
    resource: varchar("resource", { length: 100 }).notNull(),
    details: json("details"),
    ipAddress: varchar("ipAddress", { length: 45 }),
    userAgent: text("userAgent"),
    createdAt: timestamp("createdAt").defaultNow().notNull()
  },
  (table) => ({
    userIdx: index("userId_idx").on(table.userId),
    actionIdx: index("action_idx").on(table.action)
  })
);

// server/_core/env.ts
var ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? ""
};

// server/db.ts
var _db = null;
async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}
async function upsertUser(user) {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }
  try {
    const values = {
      openId: user.openId
    };
    const updateSet = {};
    const textFields = ["name", "email", "loginMethod"];
    const assignNullable = (field) => {
      const value = user[field];
      if (value === void 0) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== void 0) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== void 0) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }
    if (!values.lastSignedIn) {
      values.lastSignedIn = /* @__PURE__ */ new Date();
    }
    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = /* @__PURE__ */ new Date();
    }
    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}
async function getUserByOpenId(openId) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return void 0;
  }
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : void 0;
}
async function getUserPositions(userId) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(positions).where(eq(positions.userId, userId));
}
async function getActivePositions(userId) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(positions).where(and(eq(positions.userId, userId), eq(positions.status, "open")));
}
async function getUserTrades(userId, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(trades).where(eq(trades.userId, userId)).orderBy((t2) => t2.createdAt).limit(limit);
}
async function getUserAlerts(userId, limit = 20) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(alerts).where(eq(alerts.userId, userId)).orderBy((a) => a.createdAt).limit(limit);
}
async function getLatestBotHealth(userId) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(botHealthLogs).where(eq(botHealthLogs.userId, userId)).orderBy((b) => b.createdAt).limit(1);
  return result.length > 0 ? result[0] : null;
}
async function getUserSubscriptionStatus(userId) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (result.length === 0) return null;
  const user = result[0];
  return {
    tier: user.subscriptionTier,
    status: user.subscriptionStatus,
    expiresAt: user.subscriptionExpiresAt
  };
}
async function getReferralStats(userId) {
  const db = await getDb();
  if (!db)
    return { totalReferrals: 0, totalCommissions: 0, pendingCommissions: 0 };
  const referrals = await db.select().from(referralCommissions).where(eq(referralCommissions.referrerId, userId));
  const totalCommissions = referrals.reduce(
    (sum, r) => sum + parseFloat(r.commissionUSDT.toString()),
    0
  );
  const pendingCommissions = referrals.filter((r) => r.status === "pending").reduce((sum, r) => sum + parseFloat(r.commissionUSDT.toString()), 0);
  return {
    totalReferrals: referrals.length,
    totalCommissions,
    pendingCommissions
  };
}

// server/_core/cookies.ts
function isSecureRequest(req) {
  if (req.protocol === "https") return true;
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;
  const protoList = Array.isArray(forwardedProto) ? forwardedProto : forwardedProto.split(",");
  return protoList.some((proto) => proto.trim().toLowerCase() === "https");
}
function getSessionCookieOptions(req) {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "none",
    secure: isSecureRequest(req)
  };
}

// shared/_core/errors.ts
var HttpError = class extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.name = "HttpError";
  }
};
var ForbiddenError = (msg) => new HttpError(403, msg);

// server/_core/sdk.ts
import axios from "axios";
import { parse as parseCookieHeader } from "cookie";
import { SignJWT, jwtVerify } from "jose";
var isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
var EXCHANGE_TOKEN_PATH = `/webdev.v1.WebDevAuthPublicService/ExchangeToken`;
var GET_USER_INFO_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfo`;
var GET_USER_INFO_WITH_JWT_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`;
var OAuthService = class {
  constructor(client) {
    this.client = client;
    console.log("[OAuth] Initialized with baseURL:", ENV.oAuthServerUrl);
    if (!ENV.oAuthServerUrl) {
      console.error(
        "[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable."
      );
    }
  }
  decodeState(state) {
    const redirectUri = atob(state);
    return redirectUri;
  }
  async getTokenByCode(code, state) {
    const payload = {
      clientId: ENV.appId,
      grantType: "authorization_code",
      code,
      redirectUri: this.decodeState(state)
    };
    const { data } = await this.client.post(
      EXCHANGE_TOKEN_PATH,
      payload
    );
    return data;
  }
  async getUserInfoByToken(token) {
    const { data } = await this.client.post(
      GET_USER_INFO_PATH,
      {
        accessToken: token.accessToken
      }
    );
    return data;
  }
};
var createOAuthHttpClient = () => axios.create({
  baseURL: ENV.oAuthServerUrl,
  timeout: AXIOS_TIMEOUT_MS
});
var SDKServer = class {
  client;
  oauthService;
  constructor(client = createOAuthHttpClient()) {
    this.client = client;
    this.oauthService = new OAuthService(this.client);
  }
  deriveLoginMethod(platforms, fallback) {
    if (fallback && fallback.length > 0) return fallback;
    if (!Array.isArray(platforms) || platforms.length === 0) return null;
    const set = new Set(
      platforms.filter((p) => typeof p === "string")
    );
    if (set.has("REGISTERED_PLATFORM_EMAIL")) return "email";
    if (set.has("REGISTERED_PLATFORM_GOOGLE")) return "google";
    if (set.has("REGISTERED_PLATFORM_APPLE")) return "apple";
    if (set.has("REGISTERED_PLATFORM_MICROSOFT") || set.has("REGISTERED_PLATFORM_AZURE"))
      return "microsoft";
    if (set.has("REGISTERED_PLATFORM_GITHUB")) return "github";
    const first = Array.from(set)[0];
    return first ? first.toLowerCase() : null;
  }
  /**
   * Exchange OAuth authorization code for access token
   * @example
   * const tokenResponse = await sdk.exchangeCodeForToken(code, state);
   */
  async exchangeCodeForToken(code, state) {
    return this.oauthService.getTokenByCode(code, state);
  }
  /**
   * Get user information using access token
   * @example
   * const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
   */
  async getUserInfo(accessToken) {
    const data = await this.oauthService.getUserInfoByToken({
      accessToken
    });
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  parseCookies(cookieHeader) {
    if (!cookieHeader) {
      return /* @__PURE__ */ new Map();
    }
    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }
  getSessionSecret() {
    const secret = ENV.cookieSecret;
    return new TextEncoder().encode(secret);
  }
  /**
   * Create a session token for a Manus user openId
   * @example
   * const sessionToken = await sdk.createSessionToken(userInfo.openId);
   */
  async createSessionToken(openId, options = {}) {
    return this.signSession(
      {
        openId,
        appId: ENV.appId,
        name: options.name || ""
      },
      options
    );
  }
  async signSession(payload, options = {}) {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1e3);
    const secretKey = this.getSessionSecret();
    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name
    }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime(expirationSeconds).sign(secretKey);
  }
  async verifySession(cookieValue) {
    if (!cookieValue) {
      console.warn("[Auth] Missing session cookie");
      return null;
    }
    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"]
      });
      const { openId, appId, name } = payload;
      if (!isNonEmptyString(openId) || !isNonEmptyString(appId) || !isNonEmptyString(name)) {
        console.warn("[Auth] Session payload missing required fields");
        return null;
      }
      return {
        openId,
        appId,
        name
      };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }
  async getUserInfoWithJwt(jwtToken) {
    const payload = {
      jwtToken,
      projectId: ENV.appId
    };
    const { data } = await this.client.post(
      GET_USER_INFO_WITH_JWT_PATH,
      payload
    );
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  async authenticateRequest(req) {
    const cookies = this.parseCookies(req.headers.cookie);
    const sessionCookie = cookies.get(COOKIE_NAME);
    const session = await this.verifySession(sessionCookie);
    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }
    const sessionUserId = session.openId;
    const signedInAt = /* @__PURE__ */ new Date();
    let user = await getUserByOpenId(sessionUserId);
    if (!user) {
      try {
        const userInfo = await this.getUserInfoWithJwt(sessionCookie ?? "");
        await upsertUser({
          openId: userInfo.openId,
          name: userInfo.name || null,
          email: userInfo.email ?? null,
          loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
          lastSignedIn: signedInAt
        });
        user = await getUserByOpenId(userInfo.openId);
      } catch (error) {
        console.error("[Auth] Failed to sync user from OAuth:", error);
        throw ForbiddenError("Failed to sync user info");
      }
    }
    if (!user) {
      throw ForbiddenError("User not found");
    }
    await upsertUser({
      openId: user.openId,
      lastSignedIn: signedInAt
    });
    return user;
  }
};
var sdk = new SDKServer();

// server/_core/oauth.ts
function getQueryParam(req, key) {
  const value = req.query[key];
  return typeof value === "string" ? value : void 0;
}
function registerOAuthRoutes(app) {
  app.get("/api/oauth/callback", async (req, res) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }
    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }
      await upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: /* @__PURE__ */ new Date()
      });
      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS
      });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}

// server/_core/storageProxy.ts
function registerStorageProxy(app) {
  app.get("/manus-storage/*", async (req, res) => {
    const key = req.params[0];
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }
    if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
      res.status(500).send("Storage proxy not configured");
      return;
    }
    try {
      const forgeUrl = new URL(
        "v1/storage/presign/get",
        ENV.forgeApiUrl.replace(/\/+$/, "") + "/"
      );
      forgeUrl.searchParams.set("path", key);
      const forgeResp = await fetch(forgeUrl, {
        headers: { Authorization: `Bearer ${ENV.forgeApiKey}` }
      });
      if (!forgeResp.ok) {
        const body = await forgeResp.text().catch(() => "");
        console.error(`[StorageProxy] forge error: ${forgeResp.status} ${body}`);
        res.status(502).send("Storage backend error");
        return;
      }
      const { url } = await forgeResp.json();
      if (!url) {
        res.status(502).send("Empty signed URL from backend");
        return;
      }
      res.set("Cache-Control", "no-store");
      res.redirect(307, url);
    } catch (err) {
      console.error("[StorageProxy] failed:", err);
      res.status(502).send("Storage proxy error");
    }
  });
}

// server/_core/systemRouter.ts
import { z } from "zod";

// server/_core/notification.ts
import { TRPCError } from "@trpc/server";
var TITLE_MAX_LENGTH = 1200;
var CONTENT_MAX_LENGTH = 2e4;
var trimValue = (value) => value.trim();
var isNonEmptyString2 = (value) => typeof value === "string" && value.trim().length > 0;
var buildEndpointUrl = (baseUrl) => {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(
    "webdevtoken.v1.WebDevService/SendNotification",
    normalizedBase
  ).toString();
};
var validatePayload = (input) => {
  if (!isNonEmptyString2(input.title)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification title is required."
    });
  }
  if (!isNonEmptyString2(input.content)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification content is required."
    });
  }
  const title = trimValue(input.title);
  const content = trimValue(input.content);
  if (title.length > TITLE_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification title must be at most ${TITLE_MAX_LENGTH} characters.`
    });
  }
  if (content.length > CONTENT_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification content must be at most ${CONTENT_MAX_LENGTH} characters.`
    });
  }
  return { title, content };
};
async function notifyOwner(payload) {
  const { title, content } = validatePayload(payload);
  if (!ENV.forgeApiUrl) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service URL is not configured."
    });
  }
  if (!ENV.forgeApiKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service API key is not configured."
    });
  }
  const endpoint = buildEndpointUrl(ENV.forgeApiUrl);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${ENV.forgeApiKey}`,
        "content-type": "application/json",
        "connect-protocol-version": "1"
      },
      body: JSON.stringify({ title, content })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(
        `[Notification] Failed to notify owner (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
      );
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[Notification] Error calling notification service:", error);
    return false;
  }
}

// server/_core/trpc.ts
import { initTRPC, TRPCError as TRPCError2 } from "@trpc/server";
import superjson from "superjson";
var t = initTRPC.context().create({
  transformer: superjson
});
var router = t.router;
var publicProcedure = t.procedure;
var requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError2({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user
    }
  });
});
var protectedProcedure = t.procedure.use(requireUser);
var adminProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;
    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError2({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    return next({
      ctx: {
        ...ctx,
        user: ctx.user
      }
    });
  })
);

// server/_core/systemRouter.ts
var systemRouter = router({
  health: publicProcedure.input(
    z.object({
      timestamp: z.number().min(0, "timestamp cannot be negative")
    })
  ).query(() => ({
    ok: true
  })),
  notifyOwner: adminProcedure.input(
    z.object({
      title: z.string().min(1, "title is required"),
      content: z.string().min(1, "content is required")
    })
  ).mutation(async ({ input }) => {
    const delivered = await notifyOwner(input);
    return {
      success: delivered
    };
  })
});

// server/routers.ts
import { z as z2 } from "zod";
var appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true
      };
    })
  }),
  /**
   * Trading Bot - Positions
   */
  positions: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return getUserPositions(ctx.user.id);
    }),
    active: protectedProcedure.query(async ({ ctx }) => {
      return getActivePositions(ctx.user.id);
    }),
    create: protectedProcedure.input(
      z2.object({
        polymarketMarketId: z2.string(),
        city: z2.string(),
        forecastDate: z2.date(),
        temperatureBin: z2.string(),
        entryPrice: z2.number(),
        quantity: z2.number(),
        positionSizeUSDT: z2.number()
      })
    ).mutation(async ({ input, ctx }) => {
      return {
        success: true,
        message: "Position creation not yet implemented"
      };
    })
  }),
  /**
   * Trading Bot - Trades
   */
  trades: router({
    list: protectedProcedure.input(z2.object({ limit: z2.number().default(50) }).optional()).query(async ({ input, ctx }) => {
      return getUserTrades(ctx.user.id, input?.limit);
    }),
    create: protectedProcedure.input(
      z2.object({
        polymarketOrderId: z2.string(),
        type: z2.enum(["buy", "sell", "hedge"]),
        price: z2.number(),
        quantity: z2.number(),
        totalValue: z2.number(),
        reason: z2.string().optional()
      })
    ).mutation(async ({ input, ctx }) => {
      return {
        success: true,
        message: "Trade creation not yet implemented"
      };
    })
  }),
  /**
   * Trading Bot - Alerts & Notifications
   */
  alerts: router({
    list: protectedProcedure.input(z2.object({ limit: z2.number().default(20) }).optional()).query(async ({ input, ctx }) => {
      return getUserAlerts(ctx.user.id, input?.limit);
    }),
    create: protectedProcedure.input(
      z2.object({
        type: z2.enum([
          "trade_executed",
          "forecast_change",
          "bot_status",
          "risk_threshold",
          "connectivity_lost",
          "drawdown_limit_hit"
        ]),
        title: z2.string(),
        message: z2.string(),
        severity: z2.enum(["info", "warning", "critical"]).default("info")
      })
    ).mutation(async ({ input, ctx }) => {
      return {
        success: true,
        message: "Alert creation not yet implemented"
      };
    })
  }),
  /**
   * Trading Bot - Health & Status
   */
  botHealth: router({
    status: protectedProcedure.query(async ({ ctx }) => {
      const health = await getLatestBotHealth(ctx.user.id);
      return health || {
        status: "offline",
        message: "No health data available"
      };
    }),
    updateSettings: protectedProcedure.input(
      z2.object({
        maxDailyDrawdown: z2.number().optional(),
        perTradeBudget: z2.number().optional(),
        slippageProtection: z2.number().optional(),
        botEnabled: z2.boolean().optional()
      })
    ).mutation(async ({ input, ctx }) => {
      return {
        success: true,
        message: "Settings updated"
      };
    })
  }),
  /**
   * Subscription & Payments
   */
  subscription: router({
    status: protectedProcedure.query(async ({ ctx }) => {
      return getUserSubscriptionStatus(ctx.user.id);
    }),
    verifyPayment: protectedProcedure.input(
      z2.object({
        txHash: z2.string(),
        tier: z2.enum(["pro", "premium"]),
        amountUSDT: z2.number()
      })
    ).mutation(async ({ input, ctx }) => {
      return {
        success: true,
        message: "Payment verification not yet implemented"
      };
    })
  }),
  /**
   * Referral System
   */
  referrals: router({
    stats: protectedProcedure.query(async ({ ctx }) => {
      return getReferralStats(ctx.user.id);
    }),
    generateCode: protectedProcedure.mutation(async ({ ctx }) => {
      const code = `REF_${ctx.user.id}_${Date.now()}`;
      return {
        referralCode: code,
        referralUrl: `https://polyweather.app?ref=${code}`
      };
    })
  }),
  /**
   * Admin Panel
   */
  admin: router({
    users: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new Error("Unauthorized: Admin access required");
      }
      return [];
    }),
    updateUserTier: protectedProcedure.input(
      z2.object({
        userId: z2.number(),
        tier: z2.enum(["free", "pro", "premium"])
      })
    ).mutation(async ({ input, ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new Error("Unauthorized: Admin access required");
      }
      return { success: true };
    }),
    analytics: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new Error("Unauthorized: Admin access required");
      }
      return {
        totalUsers: 0,
        activeSubscriptions: 0,
        totalVolume: 0,
        platformPnL: 0
      };
    })
  })
});

// server/_core/context.ts
async function createContext(opts) {
  let user = null;
  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    user = null;
  }
  return {
    req: opts.req,
    res: opts.res,
    user
  };
}

// server/_core/vite.ts
import express from "express";
import fs2 from "fs";
import { nanoid } from "nanoid";
import path2 from "path";
import { createServer as createViteServer } from "vite";

// vite.config.ts
import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import { vitePluginManusRuntime } from "vite-plugin-manus-runtime";
var PROJECT_ROOT = import.meta.dirname;
var LOG_DIR = path.join(PROJECT_ROOT, ".manus-logs");
var MAX_LOG_SIZE_BYTES = 1 * 1024 * 1024;
var TRIM_TARGET_BYTES = Math.floor(MAX_LOG_SIZE_BYTES * 0.6);
function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}
function trimLogFile(logPath, maxSize) {
  try {
    if (!fs.existsSync(logPath) || fs.statSync(logPath).size <= maxSize) {
      return;
    }
    const lines = fs.readFileSync(logPath, "utf-8").split("\n");
    const keptLines = [];
    let keptBytes = 0;
    const targetSize = TRIM_TARGET_BYTES;
    for (let i = lines.length - 1; i >= 0; i--) {
      const lineBytes = Buffer.byteLength(`${lines[i]}
`, "utf-8");
      if (keptBytes + lineBytes > targetSize) break;
      keptLines.unshift(lines[i]);
      keptBytes += lineBytes;
    }
    fs.writeFileSync(logPath, keptLines.join("\n"), "utf-8");
  } catch {
  }
}
function writeToLogFile(source, entries) {
  if (entries.length === 0) return;
  ensureLogDir();
  const logPath = path.join(LOG_DIR, `${source}.log`);
  const lines = entries.map((entry) => {
    const ts = (/* @__PURE__ */ new Date()).toISOString();
    return `[${ts}] ${JSON.stringify(entry)}`;
  });
  fs.appendFileSync(logPath, `${lines.join("\n")}
`, "utf-8");
  trimLogFile(logPath, MAX_LOG_SIZE_BYTES);
}
function vitePluginManusDebugCollector() {
  return {
    name: "manus-debug-collector",
    transformIndexHtml(html) {
      if (process.env.NODE_ENV === "production") {
        return html;
      }
      return {
        html,
        tags: [
          {
            tag: "script",
            attrs: {
              src: "/__manus__/debug-collector.js",
              defer: true
            },
            injectTo: "head"
          }
        ]
      };
    },
    configureServer(server) {
      server.middlewares.use("/__manus__/logs", (req, res, next) => {
        if (req.method !== "POST") {
          return next();
        }
        const handlePayload = (payload) => {
          if (payload.consoleLogs?.length > 0) {
            writeToLogFile("browserConsole", payload.consoleLogs);
          }
          if (payload.networkRequests?.length > 0) {
            writeToLogFile("networkRequests", payload.networkRequests);
          }
          if (payload.sessionEvents?.length > 0) {
            writeToLogFile("sessionReplay", payload.sessionEvents);
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        };
        const reqBody = req.body;
        if (reqBody && typeof reqBody === "object") {
          try {
            handlePayload(reqBody);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
          return;
        }
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          try {
            const payload = JSON.parse(body);
            handlePayload(payload);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
        });
      });
    }
  };
}
var plugins = [react(), tailwindcss(), jsxLocPlugin(), vitePluginManusRuntime(), vitePluginManusDebugCollector()];
var vite_config_default = defineConfig({
  plugins,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets")
    }
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true
  },
  server: {
    host: true,
    allowedHosts: [
      ".manuspre.computer",
      ".manus.computer",
      ".manus-asia.computer",
      ".manuscomputer.ai",
      ".manusvm.computer",
      "localhost",
      "127.0.0.1"
    ],
    fs: {
      strict: true,
      deny: ["**/.*"]
    }
  }
});

// server/_core/vite.ts
async function setupVite(app, server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true
  };
  const vite = await createViteServer({
    ...vite_config_default,
    configFile: false,
    server: serverOptions,
    appType: "custom"
  });
  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    try {
      const clientTemplate = path2.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );
      let template = await fs2.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}
function serveStatic(app) {
  const distPath = process.env.NODE_ENV === "development" ? path2.resolve(import.meta.dirname, "../..", "dist", "public") : path2.resolve(import.meta.dirname, "public");
  if (!fs2.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }
  app.use(express.static(distPath));
  app.use("*", (_req, res) => {
    res.sendFile(path2.resolve(distPath, "index.html"));
  });
}

// server/_core/index.ts
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}
async function findAvailablePort(startPort = 3e3) {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}
async function startServer() {
  const app = express2();
  const server = createServer(app);
  app.use(express2.json({ limit: "50mb" }));
  app.use(express2.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext
    })
  );
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }
  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);
  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }
  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
startServer().catch(console.error);
