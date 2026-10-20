import crypto from 'node:crypto';
import { cookies, headers } from 'next/headers';

const RATE_LIMIT_COOKIE = 'ppr_demo_rl';
const WINDOW_MS = 60_000; // 60 seconds
const MAX_ATTEMPTS = 5;

// In-memory sliding window cache as secondary shield
interface RateLimitEntry {
  attempts: number;
  windowStart: number;
}
const inMemoryCache = new Map<string, RateLimitEntry>();

function getSecretKey(): string {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.STAGING_SERVICE_ROLE_KEY ||
    'ppr-nadi-demo-rate-limiter-secret-key-fallback'
  );
}

function computeSignature(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

export interface RateLimitCheckResult {
  allowed: boolean;
  message?: string;
}

/**
 * Multi-layer rate limiter for demo login actions.
 * Does not depend on single-process memory only:
 * - Uses an HMAC-signed HTTP-only cookie tracking attempts across serverless invocations.
 * - Complemented by an in-process memory cache.
 */
export async function checkDemoRateLimit(): Promise<RateLimitCheckResult> {
  const now = Date.now();
  let rawIp = 'unknown';
  try {
    const headerList = await headers();
    const forwardedFor = headerList.get('x-forwarded-for');
    rawIp = forwardedFor
      ? forwardedFor.split(',')[0].trim()
      : headerList.get('x-real-ip') || 'unknown';
  } catch {
    rawIp = 'unknown-context';
  }
  const ipHash = crypto.createHash('sha256').update(rawIp).digest('hex').substring(0, 16);

  // 1. Check in-memory cache first (same container fast path)
  const memEntry = inMemoryCache.get(ipHash);
  if (memEntry && now - memEntry.windowStart < WINDOW_MS) {
    if (memEntry.attempts >= MAX_ATTEMPTS) {
      return {
        allowed: false,
        message: 'Had percubaan log masuk demo dicapai. Sila tunggu sebentar sebelum mencuba lagi.',
      };
    }
  }

  // 2. Base initial attempts on in-memory count if active
  let attempts = memEntry && now - memEntry.windowStart < WINDOW_MS ? memEntry.attempts + 1 : 1;
  let windowStart = memEntry && now - memEntry.windowStart < WINDOW_MS ? memEntry.windowStart : now;

  // 3. Check signed cookie (cross-container distributed state)
  let cookieStore: Awaited<ReturnType<typeof cookies>> | null = null;
  try {
    cookieStore = await cookies();
  } catch {
    cookieStore = null;
  }

  const existingCookie = cookieStore?.get(RATE_LIMIT_COOKIE)?.value;
  const secret = getSecretKey();

  if (existingCookie) {
    const parts = existingCookie.split(':');
    if (parts.length === 4) {
      const [cookieIpHash, cookieAttemptsStr, cookieWindowStartStr, signature] = parts;
      const payload = `${cookieIpHash}:${cookieAttemptsStr}:${cookieWindowStartStr}`;
      const expectedSig = computeSignature(payload, secret);

      // Verify HMAC signature to prevent client tampering
      if (
        crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expectedSig, 'hex')) &&
        cookieIpHash === ipHash
      ) {
        const parsedAttempts = parseInt(cookieAttemptsStr, 10);
        const parsedWindowStart = parseInt(cookieWindowStartStr, 10);

        if (!isNaN(parsedAttempts) && !isNaN(parsedWindowStart)) {
          if (now - parsedWindowStart < WINDOW_MS) {
            if (parsedAttempts >= MAX_ATTEMPTS) {
              return {
                allowed: false,
                message: 'Had percubaan log masuk demo dicapai. Sila tunggu sebentar sebelum mencuba lagi.',
              };
            }
            attempts = Math.max(attempts, parsedAttempts + 1);
            windowStart = parsedWindowStart;
          } else {
            // Window expired, start new window
            attempts = 1;
            windowStart = now;
          }
        }
      }
    }
  }

  // Update in-memory entry
  inMemoryCache.set(ipHash, { attempts, windowStart });

  // Clean old entries periodically
  if (inMemoryCache.size > 1000) {
    for (const [key, val] of inMemoryCache.entries()) {
      if (now - val.windowStart >= WINDOW_MS) {
        inMemoryCache.delete(key);
      }
    }
  }

  // Set updated signed cookie
  const newPayload = `${ipHash}:${attempts}:${windowStart}`;
  const newSignature = computeSignature(newPayload, secret);
  const cookieValue = `${newPayload}:${newSignature}`;

  try {
    cookieStore.set(RATE_LIMIT_COOKIE, cookieValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 120, // 2 minutes
    });
  } catch {
    // If called outside mutable cookie scope, in-memory cache remains active
  }

  return { allowed: true };
}
