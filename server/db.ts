import { eq, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  users,
  subscriptionPayments,
  referralCommissions,
  positions,
  trades,
  alerts,
  botHealthLogs,
  weatherSnapshots,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
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

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db
    .select()
    .from(users)
    .where(eq(users.openId, openId))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

/**
 * Trading Bot Database Helpers
 */

export async function getUserPositions(userId: number) {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(positions).where(eq(positions.userId, userId));
}

export async function getActivePositions(userId: number) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(positions)
    .where(and(eq(positions.userId, userId), eq(positions.status, "open")));
}

export async function getUserTrades(userId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(trades)
    .where(eq(trades.userId, userId))
    .orderBy((t) => t.createdAt)
    .limit(limit);
}

export async function getUserAlerts(userId: number, limit = 20) {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(alerts)
    .where(eq(alerts.userId, userId))
    .orderBy((a) => a.createdAt)
    .limit(limit);
}

export async function getLatestBotHealth(userId: number) {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select()
    .from(botHealthLogs)
    .where(eq(botHealthLogs.userId, userId))
    .orderBy((b) => b.createdAt)
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

export async function getWeatherSnapshot(city: string, forecastDate: Date) {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select()
    .from(weatherSnapshots)
    .where(
      and(
        eq(weatherSnapshots.city, city),
        eq(weatherSnapshots.forecastDate, forecastDate)
      )
    )
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

export async function getUserSubscriptionStatus(userId: number) {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (result.length === 0) return null;

  const user = result[0];
  return {
    tier: user.subscriptionTier,
    status: user.subscriptionStatus,
    expiresAt: user.subscriptionExpiresAt,
  };
}

export async function getReferralStats(userId: number) {
  const db = await getDb();
  if (!db)
    return { totalReferrals: 0, totalCommissions: 0, pendingCommissions: 0 };

  const referrals = await db
    .select()
    .from(referralCommissions)
    .where(eq(referralCommissions.referrerId, userId));

  const totalCommissions = referrals.reduce(
    (sum, r) => sum + parseFloat(r.commissionUSDT.toString()),
    0
  );
  const pendingCommissions = referrals
    .filter((r) => r.status === "pending")
    .reduce((sum, r) => sum + parseFloat(r.commissionUSDT.toString()), 0);

  return {
    totalReferrals: referrals.length,
    totalCommissions,
    pendingCommissions,
  };
}
