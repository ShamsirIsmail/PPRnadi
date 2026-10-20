import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import {
  validateLegacyCookieFormat,
  hashClientIdentifier,
  resolveClientIp,
  checkDemoRateLimit,
  setTestRateLimiterStorage,
  resetTestRateLimiterStorage,
  RateLimiterStorage,
} from '@/lib/auth/demo-rate-limiter';

describe('Demo Rate Limiter — Defensive Cookie & IP Hashing Suite', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetTestRateLimiterStorage();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetTestRateLimiterStorage();
  });

  describe('IP Hashing & Secret Protection', () => {
    it('uses standard SHA-256 when no secret is configured, without hardcoded fallback', () => {
      delete process.env.DEMO_RATE_LIMIT_SECRET;
      delete process.env.RATE_LIMIT_SECRET;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;

      const hash = hashClientIdentifier('192.168.1.100');
      const expected = crypto.createHash('sha256').update('192.168.1.100').digest('hex');
      expect(hash).toBe(expected);
      expect(hash).toHaveLength(64);
    });

    it('uses HMAC-SHA256 with server-only DEMO_RATE_LIMIT_SECRET when configured', () => {
      process.env.DEMO_RATE_LIMIT_SECRET = 'super-secret-server-key-12345';
      const hash = hashClientIdentifier('192.168.1.100');
      const expected = crypto
        .createHmac('sha256', 'super-secret-server-key-12345')
        .update('192.168.1.100')
        .digest('hex');
      expect(hash).toBe(expected);
    });

    it('never uses SUPABASE_SERVICE_ROLE_KEY as HMAC signing secret', () => {
      delete process.env.DEMO_RATE_LIMIT_SECRET;
      delete process.env.RATE_LIMIT_SECRET;
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-should-never-be-used-as-secret';

      const hash = hashClientIdentifier('10.0.0.1');
      // Must be plain SHA-256, NOT HMAC of service role key
      const shaExpected = crypto.createHash('sha256').update('10.0.0.1').digest('hex');
      expect(hash).toBe(shaExpected);
    });
  });

  describe('Corrupted Cookie Handling (Zero Exception / Zero HTTP 500)', () => {
    it('returns invalid on empty string or null/undefined', () => {
      expect(validateLegacyCookieFormat('')).toEqual({ valid: false });
      expect(validateLegacyCookieFormat(null)).toEqual({ valid: false });
      expect(validateLegacyCookieFormat(undefined)).toEqual({ valid: false });
      expect(validateLegacyCookieFormat('   ')).toEqual({ valid: false });
    });

    it('returns invalid on oversized string (>512 chars) to prevent ReDoS / CPU spike', () => {
      const oversized = 'a'.repeat(600);
      expect(validateLegacyCookieFormat(oversized)).toEqual({ valid: false });
    });

    it('returns invalid on malformed part counts (not 4 colon-separated parts)', () => {
      expect(validateLegacyCookieFormat('part1:part2')).toEqual({ valid: false });
      expect(validateLegacyCookieFormat('a:b:c:d:e')).toEqual({ valid: false });
      expect(validateLegacyCookieFormat('single-string')).toEqual({ valid: false });
    });

    it('returns invalid on non-hex or corrupted ipHash', () => {
      expect(validateLegacyCookieFormat('not-hex-hash!:1:1000:sig')).toEqual({ valid: false });
      expect(validateLegacyCookieFormat('short:1:1000:sig')).toEqual({ valid: false });
    });

    it('returns invalid on negative, zero, NaN, or non-integer attempts', () => {
      const validHash = 'a'.repeat(32);
      const validSig = 'b'.repeat(64);
      expect(validateLegacyCookieFormat(`${validHash}:-1:1000:${validSig}`)).toEqual({ valid: false });
      expect(validateLegacyCookieFormat(`${validHash}:0:1000:${validSig}`)).toEqual({ valid: false });
      expect(validateLegacyCookieFormat(`${validHash}:NaN:1000:${validSig}`)).toEqual({ valid: false });
      expect(validateLegacyCookieFormat(`${validHash}:1.5:1000:${validSig}`)).toEqual({ valid: false });
      expect(validateLegacyCookieFormat(`${validHash}:99999999999999999999999:${validSig}`)).toEqual({ valid: false });
    });

    it('returns invalid on future timestamp or out of range windowStart', () => {
      const validHash = 'a'.repeat(32);
      const validSig = 'b'.repeat(64);
      const futureTimestamp = Date.now() + 100_000;
      expect(validateLegacyCookieFormat(`${validHash}:2:${futureTimestamp}:${validSig}`)).toEqual({ valid: false });

      const ancientTimestamp = Date.now() - 500 * 24 * 3600 * 1000;
      expect(validateLegacyCookieFormat(`${validHash}:2:${ancientTimestamp}:${validSig}`)).toEqual({ valid: false });
      expect(validateLegacyCookieFormat(`${validHash}:2:-500:${validSig}`)).toEqual({ valid: false });
    });

    it('strictly guards buffer length: never calls timingSafeEqual on mismatched length buffers', () => {
      process.env.DEMO_RATE_LIMIT_SECRET = 'test-secret';
      const validHash = 'a'.repeat(32);
      // Valid hex but wrong length (e.g. 10 chars instead of 64 chars)
      const shortSig = 'abcdef1234';
      const res = validateLegacyCookieFormat(`${validHash}:2:${Date.now()}:${shortSig}`);
      expect(res.valid).toBe(false);
    });

    it('returns invalid when signature is corrupted or forged', () => {
      process.env.DEMO_RATE_LIMIT_SECRET = 'test-secret';
      const validHash = 'a'.repeat(32);
      const forgedSig = 'c'.repeat(64);
      const res = validateLegacyCookieFormat(`${validHash}:2:${Date.now()}:${forgedSig}`);
      expect(res.valid).toBe(false);
    });

    it('safely validates an authentic legacy cookie when secret is provided', () => {
      const secret = 'valid-test-secret-key-123';
      process.env.DEMO_RATE_LIMIT_SECRET = secret;

      const ipHash = 'a'.repeat(32);
      const attempts = 3;
      const windowStart = Date.now() - 5000;
      const payload = `${ipHash}:${attempts}:${windowStart}`;
      const validSig = crypto.createHmac('sha256', secret).update(payload).digest('hex');

      const rawCookie = `${payload}:${validSig}`;
      const res = validateLegacyCookieFormat(rawCookie);

      expect(res.valid).toBe(true);
      expect(res.ipHash).toBe(ipHash);
      expect(res.attempts).toBe(3);
      expect(res.windowStart).toBe(windowStart);
    });
  });

  describe('Storage Failure Handling', () => {
    it('gracefully rejects demo login with a friendly message when server storage fails', async () => {
      const failingStorage: RateLimiterStorage = {
        checkAndIncrement: vi.fn().mockRejectedValue(new Error('Connection terminated unexpectedly')),
      };
      setTestRateLimiterStorage(failingStorage);

      const result = await checkDemoRateLimit();
      expect(result.allowed).toBe(false);
      expect(result.message).toContain('Sistem log masuk demo tidak dapat memproses');
    });
  });
});
