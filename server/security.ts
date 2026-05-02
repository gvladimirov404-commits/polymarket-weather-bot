/**
 * Security & Rate Limiting Module
 * Implements non-custodial wallet approach, encryption, and DDoS protection
 */

import crypto from "crypto";

/**
 * Rate limiting configuration
 */
export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number; // milliseconds
}

const RATE_LIMITS = {
  api: { maxRequests: 100, windowMs: 60000 }, // 100 requests per minute
  auth: { maxRequests: 5, windowMs: 900000 }, // 5 attempts per 15 minutes
  trade: { maxRequests: 10, windowMs: 60000 }, // 10 trades per minute
} as const;

/**
 * In-memory rate limit store
 * In production, use Redis for distributed rate limiting
 */
const rateLimitStore = new Map<
  string,
  { count: number; resetTime: number }
>();

/**
 * Check if request is rate limited
 */
export function isRateLimited(
  key: string,
  config: RateLimitConfig = RATE_LIMITS.api
): boolean {
  const now = Date.now();
  const record = rateLimitStore.get(key);

  if (!record || now > record.resetTime) {
    // New window
    rateLimitStore.set(key, {
      count: 1,
      resetTime: now + config.windowMs,
    });
    return false;
  }

  record.count++;

  if (record.count > config.maxRequests) {
    return true;
  }

  return false;
}

/**
 * Get remaining rate limit requests
 */
export function getRemainingRequests(
  key: string,
  config: RateLimitConfig = RATE_LIMITS.api
): number {
  const record = rateLimitStore.get(key);
  if (!record) return config.maxRequests;

  return Math.max(0, config.maxRequests - record.count);
}

/**
 * Encrypt sensitive data (API keys, private data)
 * Uses AES-256-GCM for authenticated encryption
 */
export function encryptData(plaintext: string, encryptionKey: string): string {
  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(encryptionKey, "salt", 32);

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  // Combine IV + authTag + encrypted data
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * Decrypt sensitive data
 */
export function decryptData(ciphertext: string, encryptionKey: string): string {
  const parts = ciphertext.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid ciphertext format");
  }

  const iv = Buffer.from(parts[0], "hex");
  const authTag = Buffer.from(parts[1], "hex");
  const encrypted = parts[2];

  const key = crypto.scryptSync(encryptionKey, "salt", 32);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

/**
 * Hash password using bcrypt-like approach
 * In production, use bcrypt library
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .pbkdf2Sync(password, salt, 10000, 64, "sha512")
    .toString("hex");

  return `${salt}:${hash}`;
}

/**
 * Verify password
 */
export function verifyPassword(password: string, hash: string): boolean {
  const parts = hash.split(":");
  if (parts.length !== 2) return false;

  const salt = parts[0];
  const storedHash = parts[1];

  const computedHash = crypto
    .pbkdf2Sync(password, salt, 10000, 64, "sha512")
    .toString("hex");

  return computedHash === storedHash;
}

/**
 * Generate secure random token
 */
export function generateToken(length: number = 32): string {
  return crypto.randomBytes(length).toString("hex");
}

/**
 * Validate Ethereum signature (non-custodial wallet verification)
 * User signs message with their private key, we verify with public address
 */
export function verifyEthereumSignature(
  message: string,
  signature: string,
  address: string
): boolean {
  // TODO: Implement actual signature verification using ethers.js or web3.js
  // This is a placeholder for the security architecture
  console.log(`[Security] Verifying signature for ${address}`);
  return true;
}

/**
 * Validate input to prevent injection attacks
 */
export function sanitizeInput(input: string, maxLength: number = 255): string {
  return input
    .slice(0, maxLength)
    .replace(/[<>\"']/g, "") // Remove HTML/SQL special chars
    .trim();
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate Ethereum address
 */
export function isValidEthereumAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Generate CSRF token
 */
export function generateCSRFToken(): string {
  return generateToken(32);
}

/**
 * Verify CSRF token
 */
export function verifyCSRFToken(token: string, storedToken: string): boolean {
  return crypto.timingSafeEqual(
    Buffer.from(token),
    Buffer.from(storedToken)
  );
}

/**
 * Log security event for audit trail
 */
export interface SecurityEvent {
  userId?: number;
  action: string;
  resource: string;
  ipAddress: string;
  userAgent: string;
  timestamp: Date;
  status: "success" | "failure";
  details?: Record<string, any>;
}

export function logSecurityEvent(event: SecurityEvent): void {
  console.log(`[Security] Event: ${event.action} on ${event.resource}`, {
    userId: event.userId,
    ip: event.ipAddress,
    status: event.status,
    timestamp: event.timestamp.toISOString(),
  });

  // TODO: Persist to audit log table in database
}

/**
 * Brute-force protection: Track failed login attempts
 */
const failedLoginAttempts = new Map<string, { count: number; resetTime: number }>();

export function recordFailedLogin(identifier: string): boolean {
  const now = Date.now();
  const record = failedLoginAttempts.get(identifier);

  if (!record || now > record.resetTime) {
    failedLoginAttempts.set(identifier, {
      count: 1,
      resetTime: now + 15 * 60 * 1000, // 15 minute window
    });
    return false;
  }

  record.count++;

  // Lock account after 5 failed attempts
  return record.count >= 5;
}

export function resetFailedLoginAttempts(identifier: string): void {
  failedLoginAttempts.delete(identifier);
}

export function getFailedLoginCount(identifier: string): number {
  const record = failedLoginAttempts.get(identifier);
  if (!record) return 0;

  if (Date.now() > record.resetTime) {
    failedLoginAttempts.delete(identifier);
    return 0;
  }

  return record.count;
}
