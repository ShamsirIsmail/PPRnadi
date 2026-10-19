import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isAiBlocked, recordBlockedAiAttempt, getBlockedAiStats, resetBlockedAiStats } from '@/lib/ai/ai-guard';
import { resolveAiConfig } from '@/lib/ai/provider-config';
import fs from 'node:fs';
import path from 'node:path';

describe('Server-Side AI Guard Unit Verification (No Network)', () => {
  const origEnv = process.env.TEST_DISABLE_AI_CALLS;
  const statsPath = path.resolve('.ai-guard-stats.json');

  beforeEach(() => {
    resetBlockedAiStats();
  });

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env.TEST_DISABLE_AI_CALLS = origEnv;
    } else {
      delete process.env.TEST_DISABLE_AI_CALLS;
    }
    if (fs.existsSync(statsPath)) {
      try {
        fs.unlinkSync(statsPath);
      } catch {}
    }
  });

  it('reports false when TEST_DISABLE_AI_CALLS is not set', () => {
    delete process.env.TEST_DISABLE_AI_CALLS;
    delete process.env.BLOCK_AI_NETWORK;
    expect(isAiBlocked()).toBe(false);
  });

  it('reports true when TEST_DISABLE_AI_CALLS is set to true', () => {
    process.env.TEST_DISABLE_AI_CALLS = 'true';
    expect(isAiBlocked()).toBe(true);
  });

  it('rejects resolveAiConfig immediately and increments blocked attempts when guard is active', () => {
    process.env.TEST_DISABLE_AI_CALLS = 'true';
    const initialStats = getBlockedAiStats();
    expect(initialStats.count).toBe(0);

    const res = resolveAiConfig();
    expect(res.isConfigured).toBe(false);
    expect(res.error).toContain('TEST_GUARD_BLOCKED');

    const updatedStats = getBlockedAiStats();
    expect(updatedStats.count).toBe(1);
    expect(updatedStats.attempts[0].caller).toBe('resolveAiConfig');
  });

  it('records blocked calls accurately without making any HTTP requests', () => {
    process.env.TEST_DISABLE_AI_CALLS = 'true';
    recordBlockedAiAttempt('unit-test-caller');
    recordBlockedAiAttempt('another-caller');

    const stats = getBlockedAiStats();
    expect(stats.count).toBe(2);
    expect(stats.attempts.map((a) => a.caller)).toEqual(['unit-test-caller', 'another-caller']);
  });
});
