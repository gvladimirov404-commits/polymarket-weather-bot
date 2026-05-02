/**
 * Wallet Integration Utilities
 * Non-custodial wallet connection via WalletConnect and MetaMask
 */

export interface WalletConnectConfig {
  projectId: string;
  chains: number[];
  appName: string;
  appDescription: string;
  appUrl: string;
  appIcon: string;
}

export const POLYGON_CHAIN_ID = 137;
export const POLYGON_RPC = "https://polygon-rpc.com";
export const USDT_CONTRACT_ADDRESS = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";

/**
 * Get wallet connection config for Web3Modal
 */
export function getWalletConfig(): WalletConnectConfig {
  return {
    projectId: process.env.VITE_WALLET_CONNECT_PROJECT_ID || "",
    chains: [POLYGON_CHAIN_ID],
    appName: "PolyWeather Trading Bot",
    appDescription: "Automated weather prediction market trading on Polymarket",
    appUrl: window.location.origin,
    appIcon: "/logo.png",
  };
}

/**
 * Validate Ethereum address format
 */
export function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Format address for display (0x1234...5678)
 */
export function formatAddress(address: string): string {
  if (!isValidAddress(address)) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Convert USDT amount to wei (6 decimals for USDT)
 */
export function usdtToWei(amount: number): string {
  return (amount * 1e6).toString();
}

/**
 * Convert wei to USDT amount
 */
export function weiToUsdt(wei: string): number {
  return parseInt(wei) / 1e6;
}

/**
 * Subscription tier pricing in USDT
 */
export const SUBSCRIPTION_PRICING = {
  free: 0,
  pro: 29.99,
  premium: 99.99,
} as const;

/**
 * Subscription tier features
 */
export const SUBSCRIPTION_FEATURES = {
  free: {
    maxPositions: 1,
    maxDailyVolume: 1000,
    botEnabled: false,
    alerts: false,
    backtesting: false,
  },
  pro: {
    maxPositions: 10,
    maxDailyVolume: 50000,
    botEnabled: true,
    alerts: true,
    backtesting: true,
  },
  premium: {
    maxPositions: 100,
    maxDailyVolume: 500000,
    botEnabled: true,
    alerts: true,
    backtesting: true,
  },
} as const;

/**
 * Generate referral link
 */
export function generateReferralLink(code: string): string {
  return `${window.location.origin}?ref=${code}`;
}

/**
 * Extract referral code from URL
 */
export function getReferralCodeFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("ref");
}
