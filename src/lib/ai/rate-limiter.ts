/**
 * In-memory Token Bucket rate limiting and concurrency gate for AI and transcription endpoints.
 *
 * RATE LIMITING & REFILL SEMANTICS:
 * 1. Token Bucket Algorithm:
 *    - Burst Capacity: Governed by AI_RATE_LIMIT_MAX_TOKENS (default: 5 tokens, allowed range: 1 to 50).
 *    - Refill Rate: Proportional refill over a 60,000ms (60-second) window:
 *      refillRate = maxTokens / 60,000 tokens/ms (i.e. 1 token every (60 / maxTokens) seconds).
 *    - Token Semantics Note: This is a Token Bucket, NOT a strict sliding window limit. A resident starting
 *      with a full bucket of 5 tokens can exhaust all 5 tokens immediately in an initial burst, and as tokens
 *      refill continuously, can make additional requests over the subsequent 60 seconds (up to 10 total
 *      requests across a continuous 60-second span if consumed immediately upon refill). Therefore, we do
 *      not claim a hard "maximum 5 in any arbitrary 60-second window".
 *
 * 2. Concurrency Lock:
 *    - Strictly enforces MAX_CONCURRENT_REQUESTS = 1 (exactly 1 in-flight request per resident).
 *    - Releasing the lock occurs when the returned `release()` callback is executed in a finally block.
 *
 * 3. Scope of In-Memory Limiter:
 *    - State is tracked in Node.js process memory via a Map.
 *    - In clustered or serverless multi-instance environments (e.g. multi-pod Kubernetes or distributed
 *      edge lambdas), this in-memory state covers only a single server process. For distributed guarantees,
 *      a centralized shared cache (such as Redis or database advisory locks) should back the limiter.
 *
 * CONFIGURATION VALIDATION POLICY:
 * - Environment variable: AI_RATE_LIMIT_MAX_TOKENS
 * - Default: 5
 * - Valid Range: Safe positive integer between MIN_CONFIG_TOKENS (1) and MAX_CONFIG_TOKENS (50) inclusive.
 * - Rejection: Empty strings, whitespace, non-numeric strings ('abc', '5abc'), decimals ('3.14'),
 *   negatives ('-5'), zero ('0'), Infinity, NaN, and values > 50 are strictly rejected.
 * - Fail-Safe: Any invalid configuration safely falls back to DEFAULT_MAX_TOKENS (5).
 *   Under no circumstances is an unlimited or bypassed rate limit permitted.
 */

export const DEFAULT_MAX_TOKENS = 5;
export const MIN_CONFIG_TOKENS = 1;
export const MAX_CONFIG_TOKENS = 50;
export const REFILL_WINDOW_MS = 60 * 1000; // 60-second window
export const MAX_CONCURRENT_REQUESTS = 1; // Exactly 1 in-flight request per resident

/**
 * Validates and resolves the max tokens configuration.
 * Accepts only valid positive integers between 1 and 50.
 * Rejects empty, whitespace, NaN, Infinity, negative, zero, decimal,
 * mixed text (e.g. '5abc'), and values exceeding MAX_CONFIG_TOKENS (50).
 * Safely defaults to DEFAULT_MAX_TOKENS (5) on any invalid or missing input.
 */
export function resolveMaxTokensConfig(rawVal?: string | null): number {
  if (rawVal === undefined || rawVal === null) {
    return DEFAULT_MAX_TOKENS;
  }
  const trimmed = String(rawVal).trim();
  if (trimmed === '') {
    return DEFAULT_MAX_TOKENS;
  }
  // Enforce strict unsigned integer format (digits only: rejects decimals, signs, text)
  if (!/^\d+$/.test(trimmed)) {
    return DEFAULT_MAX_TOKENS;
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < MIN_CONFIG_TOKENS || parsed > MAX_CONFIG_TOKENS) {
    return DEFAULT_MAX_TOKENS;
  }
  return parsed;
}

export function getMaxTokens(): number {
  return resolveMaxTokensConfig(process.env.AI_RATE_LIMIT_MAX_TOKENS);
}

interface UserRateLimitState {
  tokens: number;
  lastRefill: number;
  inFlightCount: number;
}

const userLimits = new Map<string, UserRateLimitState>();

export interface RateLimitCheckResult {
  allowed: boolean;
  code?: 'RATE_LIMITED' | 'CONCURRENT_REQUEST';
  retryAfterSeconds?: number;
  release?: () => void;
}

/**
 * Checks and acquires an execution slot for the given user.
 * Supports an optional controlled clock `now` (default: Date.now()) for deterministic testing.
 * Returns a release function if allowed, which MUST be called in a finally block.
 */
export function acquireAiSlot(userId: string, now: number = Date.now()): RateLimitCheckResult {
  const maxTokens = getMaxTokens();
  let state = userLimits.get(userId);

  if (!state) {
    state = {
      tokens: maxTokens,
      lastRefill: now,
      inFlightCount: 0,
    };
    userLimits.set(userId, state);
  }

  // Refill tokens proportionally over REFILL_WINDOW_MS
  const elapsed = Math.max(0, now - state.lastRefill);
  if (elapsed >= REFILL_WINDOW_MS) {
    state.tokens = maxTokens;
    state.lastRefill = now;
  } else if (elapsed > 0) {
    const refillRatePerMs = maxTokens / REFILL_WINDOW_MS;
    const tokensToAdd = elapsed * refillRatePerMs;
    state.tokens = Math.min(maxTokens, state.tokens + tokensToAdd);
    state.lastRefill = now;
  }

  // Cap tokens if maxTokens was decreased
  if (state.tokens > maxTokens) {
    state.tokens = maxTokens;
  }

  // 1. Check concurrent lock (strictly 1 in-flight request per resident)
  if (state.inFlightCount >= MAX_CONCURRENT_REQUESTS) {
    return {
      allowed: false,
      code: 'CONCURRENT_REQUEST',
      retryAfterSeconds: 5,
    };
  }

  // 2. Check token availability
  if (state.tokens < 1) {
    const tokensNeeded = 1 - state.tokens;
    const refillRatePerMs = maxTokens / REFILL_WINDOW_MS;
    const timeNeededMs = tokensNeeded / refillRatePerMs;
    const retryAfterSeconds = Math.max(1, Math.ceil(timeNeededMs / 1000));
    return {
      allowed: false,
      code: 'RATE_LIMITED',
      retryAfterSeconds,
    };
  }

  // Deduct exactly 1 token and reserve concurrency lock
  state.tokens -= 1;
  state.inFlightCount += 1;

  let released = false;
  const capturedState = state;
  const release = () => {
    if (!released) {
      released = true;
      capturedState.inFlightCount = Math.max(0, capturedState.inFlightCount - 1);
    }
  };

  return {
    allowed: true,
    release,
  };
}

/**
 * Resets state for testing purposes.
 */
export function resetRateLimitsForTesting(): void {
  userLimits.clear();
}
