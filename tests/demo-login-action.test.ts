import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { demoLoginAction } from '@/app/actions/auth';

describe('demoLoginAction security and constraints', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('rejects execution when ENABLE_DEMO_LOGIN flag is not true', async () => {
    process.env.ENABLE_DEMO_LOGIN = 'false';
    const result = await demoLoginAction('resident');
    expect(result.error).toBe('Log masuk demo dimatikan pada persekitaran ini.');
  });

  it('rejects execution when ENABLE_DEMO_LOGIN flag is undefined', async () => {
    delete process.env.ENABLE_DEMO_LOGIN;
    const result = await demoLoginAction('resident');
    expect(result.error).toBe('Log masuk demo dimatikan pada persekitaran ini.');
  });

  it('rejects invalid or arbitrary role inputs', async () => {
    process.env.ENABLE_DEMO_LOGIN = 'true';
    // @ts-expect-error - testing invalid runtime input
    const result = await demoLoginAction('superadmin');
    expect(result.error).toBe('Pilihan peranan demo tidak sah.');
  });

  it('rejects execution gracefully when password configuration is missing on server', async () => {
    process.env.ENABLE_DEMO_LOGIN = 'true';
    delete process.env.STAGING_RESIDENT_PASSWORD;
    delete process.env.DEMO_RESIDENT_PASSWORD;

    const result = await demoLoginAction('resident');
    expect(result.error).toBe('Konfigurasi kata laluan akaun demo belum ditetapkan pada pelayan.');
  });

  it('triggers rate limiting and rejects further attempts when threshold is reached', async () => {
    process.env.ENABLE_DEMO_LOGIN = 'true';
    delete process.env.STAGING_RESIDENT_PASSWORD;
    delete process.env.DEMO_RESIDENT_PASSWORD;

    // First 5 attempts consume the rate limit window
    for (let i = 0; i < 5; i++) {
      await demoLoginAction('resident');
    }

    // 6th attempt must be rejected by rate limiter
    const rateLimitedResult = await demoLoginAction('resident');
    expect(rateLimitedResult.error).toContain('Had percubaan log masuk demo dicapai');
  });
});
