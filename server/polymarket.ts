/**
 * Polymarket API Integration
 * Handles order placement, market queries, and position management
 */

export interface PolymarketMarket {
  id: string;
  question: string;
  description: string;
  outcomes: string[];
  prices: number[];
  volume: number;
  liquidity: number;
  createdAt: Date;
  expiresAt: Date;
}

export interface PolymarketOrder {
  id: string;
  marketId: string;
  outcome: string;
  side: "buy" | "sell";
  price: number;
  quantity: number;
  status: "pending" | "filled" | "cancelled" | "failed";
  createdAt: Date;
  filledAt?: Date;
}

export interface PolymarketPosition {
  marketId: string;
  outcome: string;
  quantity: number;
  averagePrice: number;
  currentPrice: number;
  pnl: number;
}

const POLYMARKET_API = "https://clob.polymarket.com";

/**
 * Search for weather prediction markets
 */
export async function searchWeatherMarkets(
  city: string,
  apiKey: string
): Promise<PolymarketMarket[]> {
  try {
    const response = await fetch(
      `${POLYMARKET_API}/markets?search=${encodeURIComponent(city)} temperature`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Polymarket API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.markets || [];
  } catch (error) {
    console.error("[Polymarket] Search error:", error);
    throw error;
  }
}

/**
 * Get market details including order book
 */
export async function getMarketDetails(
  marketId: string,
  apiKey: string
): Promise<PolymarketMarket | null> {
  try {
    const response = await fetch(`${POLYMARKET_API}/markets/${marketId}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Polymarket API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("[Polymarket] Market details error:", error);
    throw error;
  }
}

/**
 * Place a limit order on Polymarket
 * Non-custodial: User signs transaction with their wallet
 */
export async function placeLimitOrder(
  marketId: string,
  outcome: string,
  side: "buy" | "sell",
  price: number,
  quantity: number,
  userAddress: string,
  signature: string
): Promise<PolymarketOrder> {
  try {
    const response = await fetch(`${POLYMARKET_API}/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        marketId,
        outcome,
        side,
        price,
        quantity,
        userAddress,
        signature,
      }),
    });

    if (!response.ok) {
      throw new Error(`Polymarket API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("[Polymarket] Order placement error:", error);
    throw error;
  }
}

/**
 * Cancel an existing order
 */
export async function cancelOrder(
  orderId: string,
  userAddress: string,
  signature: string
): Promise<boolean> {
  try {
    const response = await fetch(`${POLYMARKET_API}/orders/${orderId}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userAddress,
        signature,
      }),
    });

    return response.ok;
  } catch (error) {
    console.error("[Polymarket] Order cancellation error:", error);
    throw error;
  }
}

/**
 * Get user positions on a market
 */
export async function getUserPositions(
  userAddress: string,
  marketId: string,
  apiKey: string
): Promise<PolymarketPosition[]> {
  try {
    const response = await fetch(
      `${POLYMARKET_API}/users/${userAddress}/positions?marketId=${marketId}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Polymarket API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.positions || [];
  } catch (error) {
    console.error("[Polymarket] Positions fetch error:", error);
    throw error;
  }
}

/**
 * Get order book for a market
 */
export async function getOrderBook(
  marketId: string,
  apiKey: string
): Promise<{
  bids: Array<{ price: number; quantity: number }>;
  asks: Array<{ price: number; quantity: number }>;
}> {
  try {
    const response = await fetch(
      `${POLYMARKET_API}/markets/${marketId}/orderbook`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Polymarket API error: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      bids: data.bids || [],
      asks: data.asks || [],
    };
  } catch (error) {
    console.error("[Polymarket] Order book fetch error:", error);
    throw error;
  }
}

/**
 * Calculate best execution price for a market order
 * Helps avoid slippage by calculating average fill price
 */
export function calculateExecutionPrice(
  side: "buy" | "sell",
  quantity: number,
  orderBook: {
    bids: Array<{ price: number; quantity: number }>;
    asks: Array<{ price: number; quantity: number }>;
  }
): number {
  const levels = side === "buy" ? orderBook.asks : orderBook.bids;

  let remainingQuantity = quantity;
  let totalCost = 0;

  for (const level of levels) {
    const fillQuantity = Math.min(remainingQuantity, level.quantity);
    totalCost += fillQuantity * level.price;
    remainingQuantity -= fillQuantity;

    if (remainingQuantity === 0) break;
  }

  if (remainingQuantity > 0) {
    throw new Error("Insufficient liquidity in order book");
  }

  return totalCost / quantity;
}

/**
 * Check market liquidity
 * Minimum $5,000 volume recommended for reliable trading
 */
export function isMarketLiquid(market: PolymarketMarket): boolean {
  return market.volume >= 5000 && market.liquidity >= 5000;
}

/**
 * Get spread percentage
 */
export function getSpreadPercentage(
  bidPrice: number,
  askPrice: number
): number {
  if (bidPrice === 0) return 100;
  return ((askPrice - bidPrice) / bidPrice) * 100;
}
