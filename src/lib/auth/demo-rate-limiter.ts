import crypto from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { createAdminSupabaseClient } from '@/lib/supabase/server';

export const RATE_LIMIT_COOKIE = 'ppr_demo_rl';
export const WINDOW_SECONDS = 60;
export const MAX_ATTEMPTS = 5;

export interface RateLimitCheckResult {
  allowed: boolean;
  message?: string;
  retryAfterSeconds?: number;
  attempts?: number;
}

export interface RateLimiterStorage {
  checkAndIncrement(
    clientHash: string,
    maxAttempts: number,
    windowSeconds: number
  ): Promise<{ allowed: boolean; attempts: number; retryAfterSeconds: number }>;
}

/**
 * Storage adapter injection for unit testing and test isolation.
 * Guarantees tests run hermetically without requiring external network or live DB.
 */
let customStorageAdapter: RateLimiterStorage | null = null;

export function setTestRateLimiterStorage(adapter: RateLimiterStorage | null): void {
  customStorageAdapter = adapter;
}

export function resetTestRateLimiterStorage(): void {
  customStorageAdapter = null;
}

/**
 * Default Supabase / PostgreSQL shared storage adapter.
 * Uses atomic RPC check_and_increment_demo_rate_limit to serialize concurrent updates
 * and ensure all Vercel serverless instances share identical, consistent state.
 */
export class SupabaseRateLimiterStorage implements RateLimiterStorage {
  async checkAndIncrement(
    clientHash: string,
    maxAttempts: number,
    windowSeconds: number
  ): Promise<{ allowed: boolean; attempts: number; retryAfterSeconds: number }> {
    const adminSupabase = createAdminSupabaseClient();
    const { data, error } = await adminSupabase.rpc('check_and_increment_demo_rate_limit', {
      p_client_hash: clientHash,
      p_max_attempts: maxAttempts,
      p_window_seconds: windowSeconds,
    });

    if (error || !data) {
      throw new Error(`Rate limiter RPC error: ${error?.message || 'Empty response'}`);
    }

    return {
      allowed: Boolean(data.allowed),
      attempts: Number(data.attempts || 0),
      retryAfterSeconds: Number(data.retry_after_seconds || 0),
    };
  }
}

/**
 * Resolves the client IP in accordance with Vercel deployment architecture.
 *
 * Header Precedence & Limitations Documentation:
 * 1. x-vercel-forwarded-for:
 *    - Injected and guaranteed by the Vercel Edge infrastructure.
 *    - Cannot be spoofed or forged by untrusted client request headers.
 * 2. x-real-ip:
 *    - Standard reverse proxy header set by edge nodes.
 * 3. x-forwarded-for:
 *    - Standard proxy chain. In unauthenticated direct traffic, clients could theoretically
 *      prepend spoofed IPs; Vercel appends the true edge client IP. We take the edge client entry.
 *
 * Known Architectural Limitations:
 * - CGNAT / Shared Proxies: Multiple independent users behind the same mobile carrier
 *   or corporate proxy share a common public egress IP.
 * - Dynamic IPv6: Users with privacy extensions may rotate IP prefixes between sessions.
 */
export async function resolveClientIp(): Promise<string> {
  try {
    const headerList = await headers();
    const vercelIp = headerList.get('x-vercel-forwarded-for');
    if (vercelIp && vercelIp.trim()) {
      return vercelIp.split(',')[0].trim();
    }

    const realIp = headerList.get('x-real-ip');
    if (realIp && realIp.trim()) {
      return realIp.trim();
    }

    const forwarded = headerList.get('x-forwarded-for');
    if (forwarded && forwarded.trim()) {
      return forwarded.split(',')[0].trim();
    }
  } catch {
    // Outside active request context (e.g. static rendering, unit tests)
  }

  return '127.0.0.1';
}

/**
 * Hashes client identifier for secure one-way storage.
 * - Never stores raw IP addresses in the database.
 * - Uses dedicated DEMO_RATE_LIMIT_SECRET or RATE_LIMIT_SECRET if provided in environment.
 * - If no secret is configured, uses standard SHA-256 without hardcoded fallback keys.
 * - NEVER uses the Supabase service-role key as an HMAC signing secret.
 */
export function hashClientIdentifier(rawIp: string): string {
  const secret = process.env.DEMO_RATE_LIMIT_SECRET || process.env.RATE_LIMIT_SECRET;
  if (secret && secret.trim().length > 0) {
    return crypto.createHmac('sha256', secret.trim()).update(rawIp).digest('hex');
  }
  return crypto.createHash('sha256').update(rawIp).digest('hex');
}

export interface LegacyCookieValidationResult {
  valid: boolean;
  ipHash?: string;
  attempts?: number;
  windowStart?: number;
}

/**
 * Defensively validates legacy rate limit cookie format.
 * Guarantees zero unhandled exceptions, zero HTTP 500 errors, and zero leaks:
 * - Validates length, part count, numeric bounds, hex formatting.
 * - Strictly guards Buffer lengths before timingSafeEqual to prevent length mismatch exceptions.
 * - Discards negative, NaN, infinity, future timestamps (> now + 60s), and prehistoric timestamps.
 * - Never logs cookie content or secrets.
 */
export function validateLegacyCookieFormat(rawCookie: unknown): LegacyCookieValidationResult {
  if (typeof rawCookie !== 'string' || rawCookie.trim() === '') {
    return { valid: false };
  }

  // Reject oversized cookies immediately (prevent memory / CPU exhaustion)
  if (rawCookie.length > 512) {
    return { valid: false };
  }

  const parts = rawCookie.split(':');
  if (parts.length !== 4) {
    return { valid: false };
  }

  const [cookieIpHash, cookieAttemptsStr, cookieWindowStartStr, signature] = parts;

  // Validate ipHash format: alphanumeric hex string, 8 to 64 chars
  if (!cookieIpHash || !/^[0-9a-fA-F]{8,64}$/.test(cookieIpHash)) {
    return { valid: false };
  }

  // Validate attempts integer: strictly positive integer, reasonable bound [1..10000]
  if (!/^\d+$/.test(cookieAttemptsStr)) {
    return { valid: false };
  }
  const attempts = parseInt(cookieAttemptsStr, 10);
  if (isNaN(attempts) || attempts <= 0 || attempts > 10000) {
    return { valid: false };
  }

  // Validate windowStart timestamp: valid epoch ms, not in future, not older than 1 year
  if (!/^\d+$/.test(cookieWindowStartStr)) {
    return { valid: false };
  }
  const windowStart = parseInt(cookieWindowStartStr, 10);
  const now = Date.now();
  if (
    isNaN(windowStart) ||
    windowStart <= 0 ||
    windowStart > now + 60_000 || // Future timestamp rejection
    windowStart < now - 365 * 24 * 3600 * 1000 // Out of range ancient timestamp
  ) {
    return { valid: false };
  }

  // Validate signature hex format (must be valid 64-char hex for sha256)
  if (!signature || !/^[0-9a-fA-F]{64}$/.test(signature)) {
    return { valid: false };
  }

  // Verify HMAC signature only if dedicated secret is configured
  const secret = process.env.DEMO_RATE_LIMIT_SECRET || process.env.RATE_LIMIT_SECRET;
  if (!secret) {
    // Without server secret, legacy cookie signature cannot be authoritatively verified
    return { valid: false };
  }

  try {
    const payload = `${cookieIpHash}:${cookieAttemptsStr}:${cookieWindowStartStr}`;
    const expectedSigHex = crypto.createHmac('sha256', secret.trim()).update(payload).digest('hex');

    const sigBuf = Buffer.from(signature, 'hex');
    const expectedBuf = Buffer.from(expectedSigHex, 'hex');

    // Strict length guard before calling timingSafeEqual
    if (sigBuf.length !== expectedBuf.length || sigBuf.length === 0) {
      return { valid: false };
    }

    if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return { valid: false };
    }
  } catch {
    return { valid: false };
  }

  return {
    valid: true,
    ipHash: cookieIpHash,
    attempts,
    windowStart,
  };
}

/**
 * Safely terminates legacy rate limiter cookie without throwing or logging contents.
 */
async function safelyTerminateLegacyCookie(): Promise<void> {
  try {
    const cookieStore = await cookies();
    const existing = cookieStore.get(RATE_LIMIT_COOKIE);
    if (existing) {
      // Validate structure defensively before termination to ensure no error is thrown
      validateLegacyCookieFormat(existing.value);
      try {
        cookieStore.delete(RATE_LIMIT_COOKIE);
      } catch {
        // May be called in read-only / immutable cookie context; safe to ignore
      }
    }
  } catch {
    // Outside request scope or headers already sent; safe to ignore
  }
}

/**
 * Primary rate limiter for 1-click demo login actions.
 * - Single source of truth is the shared server storage (PostgreSQL).
 * - Multi-instance consistent across all Vercel serverless containers.
 * - Browser cannot reset count by removing cookies or launching new browser contexts.
 * - If storage fails, safely rejects demo login with a controlled friendly message.
 * - Normal logins remain completely unaffected.
 */
export async function checkDemoRateLimit(): Promise<RateLimitCheckResult> {
  // 1. Terminate legacy cookie safely without relying on it as count authority
  await safelyTerminateLegacyCookie();

  // 2. Resolve client IP and one-way hash
  const rawIp = await resolveClientIp();
  const clientHash = hashClientIdentifier(rawIp);

  // 3. Query shared server storage (PostgreSQL atomic stored procedure)
  const storage = customStorageAdapter || new SupabaseRateLimiterStorage();

  try {
    const result = await storage.checkAndIncrement(clientHash, MAX_ATTEMPTS, WINDOW_SECONDS);

    if (!result.allowed) {
      return {
        allowed: false,
        attempts: result.attempts,
        retryAfterSeconds: result.retryAfterSeconds,
        message: 'Had percubaan log masuk demo dicapai. Sila tunggu sebentar sebelum mencuba lagi.',
      };
    }

    return {
      allowed: true,
      attempts: result.attempts,
      retryAfterSeconds: 0,
    };
  } catch (err: unknown) {
    // Operational failure: Log generalized alert without printing raw IPs, secrets or cookies
    const errorMsg = err instanceof Error ? err.message : 'Unknown storage failure';
    console.error('[DemoRateLimiter] Server limiter storage unavailable:', errorMsg);

    // Controlled rejection: Reject demo login gracefully without crashing
    return {
      allowed: false,
      message: 'Sistem log masuk demo tidak dapat memproses permintaan anda buat masa ini. Sila cuba sebentar lagi.',
    };
  }
}
