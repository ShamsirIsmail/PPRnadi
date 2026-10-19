import fs from 'node:fs';
import path from 'node:path';

const STATS_FILE = path.resolve('.ai-guard-stats.json');

export interface AiGuardStats {
  count: number;
  attempts: Array<{ timestamp: string; caller: string }>;
}

let inMemoryStats: AiGuardStats = { count: 0, attempts: [] };

export function isAiBlocked(): boolean {
  return (
    process.env.TEST_DISABLE_AI_CALLS === 'true' ||
    process.env.BLOCK_AI_NETWORK === 'true' ||
    process.env.AI_CALLS_DISABLED === 'true' ||
    process.env.STAGING_DISABLE_AI === 'true' ||
    process.env.NEXT_PUBLIC_STAGING_DISABLE_AI === 'true'
  );
}

export function recordBlockedAiAttempt(caller: string): void {
  const attempt = {
    timestamp: new Date().toISOString(),
    caller,
  };
  inMemoryStats.count++;
  inMemoryStats.attempts.push(attempt);

  try {
    let current: AiGuardStats = { count: 0, attempts: [] };
    if (fs.existsSync(STATS_FILE)) {
      try {
        const raw = fs.readFileSync(STATS_FILE, 'utf8');
        current = JSON.parse(raw);
      } catch {}
    }
    current.count = (current.count || 0) + 1;
    if (!Array.isArray(current.attempts)) current.attempts = [];
    current.attempts.push(attempt);
    fs.writeFileSync(STATS_FILE, JSON.stringify(current, null, 2), 'utf8');
  } catch {
    // In serverless / read-only ephemeral hosting runtimes, filesystem writes may fail.
    // In-memory stats track attempts safely.
  }
}

export function getBlockedAiStats(): AiGuardStats {
  try {
    if (fs.existsSync(STATS_FILE)) {
      const raw = fs.readFileSync(STATS_FILE, 'utf8');
      const data = JSON.parse(raw);
      return {
        count: typeof data.count === 'number' ? data.count : inMemoryStats.count,
        attempts: Array.isArray(data.attempts) ? data.attempts : inMemoryStats.attempts,
      };
    }
  } catch {}
  return inMemoryStats;
}

export function resetBlockedAiStats(): void {
  inMemoryStats = { count: 0, attempts: [] };
  try {
    fs.writeFileSync(STATS_FILE, JSON.stringify({ count: 0, attempts: [] }, null, 2), 'utf8');
  } catch {}
}
