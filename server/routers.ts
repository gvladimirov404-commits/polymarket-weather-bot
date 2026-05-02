import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router, protectedProcedure } from "./_core/trpc";
import { z } from "zod";
import {
  getUserPositions,
  getActivePositions,
  getUserTrades,
  getUserAlerts,
  getLatestBotHealth,
  getUserSubscriptionStatus,
  getReferralStats,
} from "./db";

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
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

    create: protectedProcedure
      .input(
        z.object({
          polymarketMarketId: z.string(),
          city: z.string(),
          forecastDate: z.date(),
          temperatureBin: z.string(),
          entryPrice: z.number(),
          quantity: z.number(),
          positionSizeUSDT: z.number(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        // TODO: Implement position creation with validation
        return {
          success: true,
          message: "Position creation not yet implemented",
        };
      }),
  }),

  /**
   * Trading Bot - Trades
   */
  trades: router({
    list: protectedProcedure
      .input(z.object({ limit: z.number().default(50) }).optional())
      .query(async ({ input, ctx }) => {
        return getUserTrades(ctx.user.id, input?.limit);
      }),

    create: protectedProcedure
      .input(
        z.object({
          polymarketOrderId: z.string(),
          type: z.enum(["buy", "sell", "hedge"]),
          price: z.number(),
          quantity: z.number(),
          totalValue: z.number(),
          reason: z.string().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        // TODO: Implement trade creation with Polymarket API
        return {
          success: true,
          message: "Trade creation not yet implemented",
        };
      }),
  }),

  /**
   * Trading Bot - Alerts & Notifications
   */
  alerts: router({
    list: protectedProcedure
      .input(z.object({ limit: z.number().default(20) }).optional())
      .query(async ({ input, ctx }) => {
        return getUserAlerts(ctx.user.id, input?.limit);
      }),

    create: protectedProcedure
      .input(
        z.object({
          type: z.enum([
            "trade_executed",
            "forecast_change",
            "bot_status",
            "risk_threshold",
            "connectivity_lost",
            "drawdown_limit_hit",
          ]),
          title: z.string(),
          message: z.string(),
          severity: z.enum(["info", "warning", "critical"]).default("info"),
        })
      )
      .mutation(async ({ input, ctx }) => {
        // TODO: Implement alert creation and delivery (Telegram, Discord)
        return {
          success: true,
          message: "Alert creation not yet implemented",
        };
      }),
  }),

  /**
   * Trading Bot - Health & Status
   */
  botHealth: router({
    status: protectedProcedure.query(async ({ ctx }) => {
      const health = await getLatestBotHealth(ctx.user.id);
      return (
        health || {
          status: "offline",
          message: "No health data available",
        }
      );
    }),

    updateSettings: protectedProcedure
      .input(
        z.object({
          maxDailyDrawdown: z.number().optional(),
          perTradeBudget: z.number().optional(),
          slippageProtection: z.number().optional(),
          botEnabled: z.boolean().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        // TODO: Update user risk management settings
        return {
          success: true,
          message: "Settings updated",
        };
      }),
  }),

  /**
   * Subscription & Payments
   */
  subscription: router({
    status: protectedProcedure.query(async ({ ctx }) => {
      return getUserSubscriptionStatus(ctx.user.id);
    }),

    verifyPayment: protectedProcedure
      .input(
        z.object({
          txHash: z.string(),
          tier: z.enum(["pro", "premium"]),
          amountUSDT: z.number(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        // TODO: Verify on-chain payment on Polygon
        return {
          success: true,
          message: "Payment verification not yet implemented",
        };
      }),
  }),

  /**
   * Referral System
   */
  referrals: router({
    stats: protectedProcedure.query(async ({ ctx }) => {
      return getReferralStats(ctx.user.id);
    }),

    generateCode: protectedProcedure.mutation(async ({ ctx }) => {
      // TODO: Generate unique referral code
      const code = `REF_${ctx.user.id}_${Date.now()}`;
      return {
        referralCode: code,
        referralUrl: `https://polyweather.app?ref=${code}`,
      };
    }),
  }),

  /**
   * Admin Panel
   */
  admin: router({
    users: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new Error("Unauthorized: Admin access required");
      }
      // TODO: Fetch all users with stats
      return [];
    }),

    updateUserTier: protectedProcedure
      .input(
        z.object({
          userId: z.number(),
          tier: z.enum(["free", "pro", "premium"]),
        })
      )
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== "admin") {
          throw new Error("Unauthorized: Admin access required");
        }
        // TODO: Update user subscription tier
        return { success: true };
      }),

    analytics: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new Error("Unauthorized: Admin access required");
      }
      // TODO: Fetch platform analytics
      return {
        totalUsers: 0,
        activeSubscriptions: 0,
        totalVolume: 0,
        platformPnL: 0,
      };
    }),
  }),
});

export type AppRouter = typeof appRouter;
