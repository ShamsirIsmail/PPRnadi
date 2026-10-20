import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { demoLoginAction, loginAction } from '@/app/actions/auth';
import {
  setTestRateLimiterStorage,
  resetTestRateLimiterStorage,
  RateLimiterStorage,
  RATE_LIMIT_COOKIE,
} from '@/lib/auth/demo-rate-limiter';
import type { User } from '@supabase/supabase-js';

// In-memory cookie store mock
const mockCookieMap = new Map<string, string>();

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockImplementation(async () => ({
    get: (name: string) => {
      const val = mockCookieMap.get(name);
      return val ? { name, value: val } : undefined;
    },
    set: (name: string, value: string) => {
      mockCookieMap.set(name, value);
    },
    delete: (name: string) => {
      mockCookieMap.delete(name);
    },
    getAll: () => Array.from(mockCookieMap.entries()).map(([name, value]) => ({ name, value })),
  })),
  headers: vi.fn().mockImplementation(async () => ({
    get: (name: string) => {
      if (name.toLowerCase() === 'x-vercel-forwarded-for') return '203.0.113.195';
      if (name.toLowerCase() === 'x-real-ip') return '203.0.113.195';
      return null;
    },
  })),
}));

// Mock Supabase client
let mockAuthUser: User | null = null;
let mockAuthError: Error | null = null;
let mockProfileRole: string = 'resident';

// In-Memory Simulated Server Rate Limit Storage (Atomic simulation)
let mockCurrentTime = 1_000_000;
let shouldSimulateStorageFailure = false;

class InMemoryServerStorage implements RateLimiterStorage {
  private records = new Map<string, { attempts: number; windowStart: number }>();
  private nowFn: () => number;

  constructor(nowFn = () => Date.now()) {
    this.nowFn = nowFn;
  }

  async checkAndIncrement(
    clientHash: string,
    maxAttempts: number,
    windowSeconds: number
  ): Promise<{ allowed: boolean; attempts: number; retryAfterSeconds: number }> {
    const now = this.nowFn();
    const windowMs = windowSeconds * 1000;
    let entry = this.records.get(clientHash);

    if (!entry || now - entry.windowStart >= windowMs) {
      entry = { attempts: 1, windowStart: now };
    } else {
      entry.attempts += 1;
    }
    this.records.set(clientHash, entry);

    if (entry.attempts <= maxAttempts) {
      return { allowed: true, attempts: entry.attempts, retryAfterSeconds: 0 };
    } else {
      const remainingSecs = Math.max(1, Math.ceil((entry.windowStart + windowMs - now) / 1000));
      return { allowed: false, attempts: entry.attempts, retryAfterSeconds: remainingSecs };
    }
  }

  clear(): void {
    this.records.clear();
  }
}

const testStorage = new InMemoryServerStorage(() => mockCurrentTime);

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn().mockImplementation(async () => ({
    auth: {
      signInWithPassword: vi.fn().mockImplementation(async ({ email, password }) => {
        if (mockAuthError || !password) {
          return { data: { user: null, session: null }, error: new Error('Invalid credentials') };
        }
        mockAuthUser = { id: 'test-user-uuid', email } as User;
        return { data: { user: mockAuthUser, session: {} }, error: null };
      }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { role: mockProfileRole, assigned_estate_id: 'ppr-sentosa-demo' },
            error: null,
          }),
        }),
      }),
    }),
  })),
  createAdminSupabaseClient: vi.fn().mockImplementation(() => ({
    rpc: vi.fn().mockImplementation(async (fnName, args) => {
      if (shouldSimulateStorageFailure) {
        throw new Error('Simulated database RPC failure');
      }
      if (fnName === 'check_and_increment_demo_rate_limit') {
        const res = await testStorage.checkAndIncrement(args.p_client_hash, args.p_max_attempts, args.p_window_seconds);
        return { data: res, error: null };
      }
      return { data: null, error: null };
    }),
  })),
}));

describe('demoLoginAction security, concurrency, and rate limiting', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    mockCookieMap.clear();
    mockAuthUser = null;
    mockAuthError = null;
    mockProfileRole = 'resident';
    mockCurrentTime = 1_000_000;
    shouldSimulateStorageFailure = false;
    testStorage.clear();
    setTestRateLimiterStorage(testStorage);

    // Standard valid server configuration
    process.env.ENABLE_DEMO_LOGIN = 'true';
    process.env.DEMO_RESIDENT_PASSWORD = 'ValidResidentPass123!';
    process.env.DEMO_MANAGER_PASSWORD = 'ValidManagerPass123!';
  });

  afterEach(() => {
    process.env = originalEnv;
    resetTestRateLimiterStorage();
  });

  // 1. Flag demo dimatikan -> tindakan ditolak
  it('1. rejects execution when ENABLE_DEMO_LOGIN flag is not true or undefined', async () => {
    process.env.ENABLE_DEMO_LOGIN = 'false';
    const res1 = await demoLoginAction('resident');
    expect(res1.error).toBe('Log masuk demo dimatikan pada persekitaran ini.');

    delete process.env.ENABLE_DEMO_LOGIN;
    const res2 = await demoLoginAction('resident');
    expect(res2.error).toBe('Log masuk demo dimatikan pada persekitaran ini.');
  });

  // 2. Role tidak sah -> ditolak
  it('2. rejects invalid or arbitrary role inputs', async () => {
    // @ts-expect-error - testing invalid runtime input
    const result = await demoLoginAction('superadmin');
    expect(result.error).toBe('Pilihan peranan demo tidak sah.');
  });

  // 3. Kredensial server tiada -> ralat terkawal
  it('3. rejects execution gracefully when password configuration is missing on server', async () => {
    delete process.env.STAGING_RESIDENT_PASSWORD;
    delete process.env.DEMO_RESIDENT_PASSWORD;

    const result = await demoLoginAction('resident');
    expect(result.error).toBe('Konfigurasi kata laluan akaun demo belum ditetapkan pada pelayan.');
  });

  // 4. Percubaan 1–5 dibenarkan; percubaan ke-6 ditolak
  it('4. permits attempts 1 to 5, and strictly rejects the 6th attempt', async () => {
    for (let i = 1; i <= 5; i++) {
      const res = await demoLoginAction('resident');
      // Should succeed or redirect (redirect throws NEXT_REDIRECT or returns success)
      expect(res.error).toBeUndefined();
    }

    const sixthAttempt = await demoLoginAction('resident');
    expect(sixthAttempt.error).toContain('Had percubaan log masuk demo dicapai');
    expect(sixthAttempt.code).toBe('DEMO_RATE_LIMITED');
    expect(sixthAttempt.code).not.toBe('DEMO_LIMITER_UNAVAILABLE');
  });

  // 5. Window tamat -> percubaan dibenarkan semula
  it('5. allows attempts again once the rate limit window has expired', async () => {
    // Consume quota
    for (let i = 1; i <= 5; i++) {
      await demoLoginAction('resident');
    }
    const blockedRes = await demoLoginAction('resident');
    expect(blockedRes.error).toContain('Had percubaan log masuk demo dicapai');

    // Advance clock past 60-second window
    mockCurrentTime += 61_000;

    // Next attempt must now be permitted
    const afterExpiryRes = await demoLoginAction('resident');
    expect(afterExpiryRes.error).toBeUndefined();
    expect(afterExpiryRes.success).toBe(true);
  });

  // 6. Permintaan serentak tidak melepasi had
  it('6. ensures concurrent requests do not bypass the 5-attempt limit', async () => {
    // Send 10 concurrent requests simultaneously
    const requests = Array.from({ length: 10 }).map(() => demoLoginAction('resident'));
    const results = await Promise.all(requests);

    const successful = results.filter((r) => !r.error);
    const rateLimited = results.filter((r) => r.error && r.error.includes('Had percubaan log masuk demo dicapai'));

    expect(successful.length).toBe(5);
    expect(rateLimited.length).toBe(5);
  });

  // 7. Instance berbeza menggunakan kiraan bersama
  it('7. demonstrates multiple separate instances share consistent count state', async () => {
    // Instance 1 records 3 attempts
    for (let i = 0; i < 3; i++) {
      const res = await demoLoginAction('resident');
      expect(res.error).toBeUndefined();
    }

    // Instance 2 (simulated separate serverless execution context sharing testStorage)
    const inst2Attempt4 = await demoLoginAction('resident');
    expect(inst2Attempt4.error).toBeUndefined();

    const inst2Attempt5 = await demoLoginAction('resident');
    expect(inst2Attempt5.error).toBeUndefined();

    // Instance 1 attempt 6 -> must be rejected because shared total reached 5
    const inst1Attempt6 = await demoLoginAction('resident');
    expect(inst1Attempt6.error).toContain('Had percubaan log masuk demo dicapai');
  });

  // 8. Cookie dibuang/dirosakkan tidak memintas kiraan
  it('8. clearing or tampering with cookies does not reset the server count', async () => {
    // Perform 4 attempts
    for (let i = 0; i < 4; i++) {
      await demoLoginAction('resident');
    }

    // Client maliciously deletes all cookies
    mockCookieMap.clear();

    // 5th attempt is permitted
    const fifth = await demoLoginAction('resident');
    expect(fifth.error).toBeUndefined();

    // Client deletes cookies again, hoping to bypass the limit
    mockCookieMap.clear();

    // 6th attempt MUST STILL BE REJECTED by shared server count
    const sixth = await demoLoginAction('resident');
    expect(sixth.error).toContain('Had percubaan log masuk demo dicapai');
  });

  // 9. Semua bentuk cookie rosak tidak menyebabkan exception
  it('9. ensures corrupted cookie variations never cause 500 exceptions', async () => {
    const corruptedValues = [
      '',
      'garbage-non-colon',
      'a:b:c',
      'a:b:c:d:e',
      'hash:-1:1000:sig',
      'hash:0:1000:sig',
      'hash:NaN:1000:sig',
      'hash:9999999999:1000:sig',
      `hash:2:${Date.now() + 100_000}:sig`, // future timestamp
      'hash:2:not-a-number:sig',
      'hash:2:1000:short-sig', // mismatched buffer length
      'a'.repeat(600), // oversized
    ];

    for (const val of corruptedValues) {
      mockCookieMap.set(RATE_LIMIT_COOKIE, val);
      expect(async () => {
        const res = await demoLoginAction('resident');
        expect(res).toBeDefined();
      }).not.toThrow();
    }
  });

  // 10. Storan limiter gagal -> demo ditolak dengan selamat
  it('10. safely and gracefully rejects demo login when storage fails', async () => {
    const brokenStorage: RateLimiterStorage = {
      checkAndIncrement: vi.fn().mockRejectedValue(new Error('Database connection lost')),
    };
    setTestRateLimiterStorage(brokenStorage);

    const result = await demoLoginAction('resident');
    expect(result.error).toContain('Sistem log masuk demo tidak dapat memproses');
    expect(result.code).toBe('DEMO_LIMITER_UNAVAILABLE');
    expect(result.code).not.toBe('DEMO_RATE_LIMITED');
  });

  // 11. Login biasa tidak melalui limiter demo
  it('11. regular login action is never throttled or affected by the demo limiter', async () => {
    // Squeeze demo limit to exhaustion
    for (let i = 0; i < 5; i++) {
      await demoLoginAction('resident');
    }
    const demoBlocked = await demoLoginAction('resident');
    expect(demoBlocked.error).toContain('Had percubaan log masuk demo dicapai');

    // Regular login form submission with valid credentials
    const formData = new FormData();
    formData.set('email', 'resident@sentosa.local');
    formData.set('password', 'ValidRegularPassword123!');

    const regularResult = await loginAction(null, formData);
    // Regular login must succeed without being rate-limited by demo limiter
    expect(regularResult.error).toBeUndefined();
    expect(regularResult.success).toBe(true);
  });
});
