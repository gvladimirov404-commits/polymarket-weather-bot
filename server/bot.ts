/**
 * Trading Bot Core Logic
 * 24/7 automated weather prediction market trading with fail-safe mechanisms
 */

import { getWeatherConsensus, getTemperatureBin } from "./weather";
import {
  searchWeatherMarkets,
  getOrderBook,
  calculateExecutionPrice,
  isMarketLiquid,
  placeLimitOrder,
  getSpreadPercentage,
} from "./polymarket";

export interface BotConfig {
  userId: number;
  maxDailyDrawdown: number; // percentage
  perTradeBudget: number; // USDT
  slippageProtection: number; // percentage
  cities: string[];
  enabled: boolean;
}

export interface BotState {
  isRunning: boolean;
  lastHealthCheck: Date;
  lastWeatherCheck: Date;
  lastPolymarketCheck: Date;
  activePositions: number;
  dailyPnL: number;
  consecutiveErrors: number;
  lastError?: string;
}

export interface TradeSignal {
  city: string;
  marketId: string;
  outcome: string;
  side: "buy" | "sell";
  price: number;
  quantity: number;
  confidence: number;
  reason: string;
}

const MAX_CONSECUTIVE_ERRORS = 3;
const HEALTH_CHECK_INTERVAL = 60000; // 1 minute
const WEATHER_CHECK_INTERVAL = 300000; // 5 minutes
const POLYMARKET_CHECK_INTERVAL = 120000; // 2 minutes

/**
 * Bot state management
 */
let botState: Map<number, BotState> = new Map();

export function initBotState(userId: number): BotState {
  const state: BotState = {
    isRunning: false,
    lastHealthCheck: new Date(),
    lastWeatherCheck: new Date(),
    lastPolymarketCheck: new Date(),
    activePositions: 0,
    dailyPnL: 0,
    consecutiveErrors: 0,
  };

  botState.set(userId, state);
  return state;
}

export function getBotState(userId: number): BotState | undefined {
  return botState.get(userId);
}

/**
 * Health check: Verify bot connectivity and API status
 */
export async function performHealthCheck(
  userId: number,
  config: BotConfig
): Promise<{ healthy: boolean; message: string }> {
  const state = getBotState(userId);
  if (!state) return { healthy: false, message: "Bot not initialized" };

  try {
    // Check if too many consecutive errors
    if (state.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      return {
        healthy: false,
        message: `Too many consecutive errors (${state.consecutiveErrors}). Bot halted.`,
      };
    }

    // Check time since last checks
    const now = new Date();
    const timeSinceWeatherCheck =
      now.getTime() - state.lastWeatherCheck.getTime();
    const timeSincePolymarketCheck =
      now.getTime() - state.lastPolymarketCheck.getTime();

    if (timeSinceWeatherCheck > WEATHER_CHECK_INTERVAL * 2) {
      return {
        healthy: false,
        message: "Weather API not responding",
      };
    }

    if (timeSincePolymarketCheck > POLYMARKET_CHECK_INTERVAL * 2) {
      return {
        healthy: false,
        message: "Polymarket API not responding",
      };
    }

    state.lastHealthCheck = now;
    state.consecutiveErrors = 0; // Reset error counter on successful check

    return { healthy: true, message: "All systems operational" };
  } catch (error) {
    state.consecutiveErrors++;
    state.lastError = String(error);

    return {
      healthy: false,
      message: `Health check failed: ${error}`,
    };
  }
}

/**
 * Generate trade signals based on weather consensus
 */
export async function generateTradeSignals(
  userId: number,
  config: BotConfig,
  windyApiKey: string,
  polymarketApiKey: string
): Promise<TradeSignal[]> {
  const state = getBotState(userId);
  if (!state) return [];

  const signals: TradeSignal[] = [];

  try {
    for (const city of config.cities) {
      // Get weather consensus
      const consensus = await getWeatherConsensus(
        city,
        40.7128, // TODO: Use actual city coordinates
        -74.006,
        windyApiKey,
        polymarketApiKey
      );

      if (!consensus || !consensus.hasConsensus) {
        console.log(`[Bot] No consensus for ${city}`);
        continue;
      }

      // Search for matching markets
      const markets = await searchWeatherMarkets(city, polymarketApiKey);

      for (const market of markets) {
        // Check liquidity
        if (!isMarketLiquid(market)) {
          console.log(`[Bot] Market ${market.id} lacks liquidity`);
          continue;
        }

        // Get order book
        const orderBook = await getOrderBook(market.id, polymarketApiKey);

        // Find matching temperature bin
        const temperatureBin = getTemperatureBin(consensus.consensusTemperature);

        // Calculate execution price
        try {
          const executionPrice = calculateExecutionPrice("buy", config.perTradeBudget, orderBook);

          // Check slippage protection
          const bestBidPrice = orderBook.bids[0]?.price || 0;
          const slippage = Math.abs(
            (executionPrice - bestBidPrice) / bestBidPrice
          ) * 100;

          if (slippage > config.slippageProtection) {
            console.log(
              `[Bot] Slippage ${slippage.toFixed(2)}% exceeds limit ${config.slippageProtection}%`
            );
            continue;
          }

          // Generate signal
          signals.push({
            city,
            marketId: market.id,
            outcome: temperatureBin,
            side: "buy",
            price: executionPrice,
            quantity: config.perTradeBudget / executionPrice,
            confidence: consensus.consensusConfidence,
            reason: `Multi-model consensus: ${consensus.consensusTemperature}°C (GFS/ECMWF/ICON agreement)`,
          });
        } catch (error) {
          console.log(`[Bot] Insufficient liquidity for ${market.id}`);
        }
      }
    }

    state.lastWeatherCheck = new Date();
    state.lastPolymarketCheck = new Date();

    return signals;
  } catch (error) {
    state.consecutiveErrors++;
    state.lastError = String(error);
    console.error("[Bot] Error generating signals:", error);
    return [];
  }
}

/**
 * Execute trade signal
 */
export async function executeTradeSignal(
  userId: number,
  signal: TradeSignal,
  userAddress: string,
  signature: string,
  polymarketApiKey: string
): Promise<{ success: boolean; orderId?: string; error?: string }> {
  const state = getBotState(userId);
  if (!state) return { success: false, error: "Bot not initialized" };

  try {
    // Check daily drawdown limit
    // TODO: Implement drawdown check

    // Place order
    const order = await placeLimitOrder(
      signal.marketId,
      signal.outcome,
      signal.side,
      signal.price,
      signal.quantity,
      userAddress,
      signature
    );

    state.activePositions++;
    state.consecutiveErrors = 0;

    return { success: true, orderId: order.id };
  } catch (error) {
    state.consecutiveErrors++;
    state.lastError = String(error);

    return {
      success: false,
      error: `Trade execution failed: ${error}`,
    };
  }
}

/**
 * Fail-safe: Stop all trading on connectivity loss
 */
export function activateFailSafe(userId: number): void {
  const state = getBotState(userId);
  if (!state) return;

  state.isRunning = false;
  state.lastError = "Fail-safe activated: Connectivity loss detected";

  console.error(`[Bot] FAIL-SAFE ACTIVATED for user ${userId}`);
  // TODO: Send critical alert to user
}

/**
 * Calculate daily P&L
 */
export function calculateDailyPnL(positions: any[]): number {
  return positions.reduce((sum, pos) => sum + (pos.pnl || 0), 0);
}

/**
 * Check if daily drawdown limit exceeded
 */
export function isDrawdownLimitExceeded(
  dailyPnL: number,
  initialCapital: number,
  maxDrawdownPercent: number
): boolean {
  const drawdownPercent = (Math.abs(dailyPnL) / initialCapital) * 100;
  return dailyPnL < 0 && drawdownPercent > maxDrawdownPercent;
}

/**
 * Dynamic hedging: Close position if forecast changes significantly
 */
export async function evaluateDynamicHedge(
  position: any,
  newConsensus: any,
  config: BotConfig
): Promise<boolean> {
  const oldConsensus = position.weatherConsensus;

  // If consensus changed by more than 1°C, hedge
  const consensusChange = Math.abs(
    newConsensus.consensusTemperature - oldConsensus.consensusTemperature
  );

  if (consensusChange > 1.0) {
    console.log(
      `[Bot] Consensus changed by ${consensusChange.toFixed(2)}°C. Triggering hedge.`
    );
    return true;
  }

  return false;
}
