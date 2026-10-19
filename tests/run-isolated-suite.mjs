#!/usr/bin/env node
/**
 * PPR NADI — Isolated Browser Test Suite Runner
 *
 * Runs browser test suites strictly isolated from preview server (port 3000):
 * - Target App URL: http://127.0.0.1:3001 (rejection guard for port 3000)
 * - Isolated Build Directory: .next-test
 * - Upstream Mock Server: http://127.0.0.1:3928 (no real AI provider / zero billing)
 * - Clean teardown: Only terminates child processes spawned by this runner
 * - Database scope note: Shared local demo PostgreSQL (127.0.0.1:64322) with safe test data cleanup
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startUpstreamMockServer } from './upstream-mock-server.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// Load environment from .env.local if present
try {
  process.loadEnvFile(path.join(ROOT_DIR, '.env.local'));
} catch {
  // Ignored if missing or already loaded
}

const TARGET_URL = process.env.TEST_APP_URL || 'http://127.0.0.1:3001';
const DIST_DIR = process.env.NEXT_DIST_DIR || '.next-test';
const MOCK_UPSTREAM_URL = 'http://127.0.0.1:3928';

// Strict Safety Guard: Never target or interfere with port 3000 preview server
const parsedTarget = new URL(TARGET_URL);
if (parsedTarget.port === '3000' || TARGET_URL.includes(':3000')) {
  console.error('\n[FATAL SAFETY GUARD VIOLATION]');
  console.error(`TARGET_URL is pointing to port 3000 (${TARGET_URL}).`);
  console.error('The preview server on port 3000 must NOT be used for automated testing.');
  console.error('Please specify a different port (e.g. http://127.0.0.1:3001).\n');
  process.exit(1);
}

const spawnedProcesses = [];

function registerChild(proc, name) {
  spawnedProcesses.push({ proc, name });
  return proc;
}

function killSpawnedProcessTree(childRecord) {
  const { proc, name } = childRecord;
  if (!proc || proc.killed || proc.exitCode !== null) return;
  console.log(`[Teardown] Stopping runner-spawned child: ${name} (PID: ${proc.pid})`);
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      proc.kill('SIGTERM');
    }
  } catch (err) {
    console.warn(`[Teardown] Warning stopping ${name}:`, err.message);
  }
}

function cleanupAll() {
  for (const childRecord of spawnedProcesses) {
    killSpawnedProcessTree(childRecord);
  }
}

process.on('SIGINT', () => {
  console.log('\n[Runner] Interrupted (SIGINT). Cleaning up spawned processes...');
  cleanupAll();
  process.exit(130);
});

process.on('SIGTERM', () => {
  console.log('\n[Runner] Terminated (SIGTERM). Cleaning up spawned processes...');
  cleanupAll();
  process.exit(143);
});

async function isHttpReady(url, maxWaitMs = 30000, intervalMs = 500) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch(url);
      if (res.status >= 200 && res.status < 500) {
        return true;
      }
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`\n>> Executing: ${command} ${args.join(' ')}`);
    const child = spawn(command, args, {
      cwd: ROOT_DIR,
      shell: true,
      stdio: 'inherit',
      ...options,
    });

    registerChild(child, `${command} ${args[0] || ''}`);

    child.on('close', (code) => {
      if (code === 0) {
        resolve(code);
      } else {
        const err = new Error(`Command failed with exit code ${code}`);
        err.code = code;
        reject(err);
      }
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

async function main() {
  console.log('==============================================================================');
  console.log('PPR NADI — ISOLATED TEST RUNNER HARNESS');
  console.log('==============================================================================');
  console.log(`[Target URL]          ${TARGET_URL}`);
  console.log(`[Build Dist Dir]      ${DIST_DIR}`);
  console.log(`[Upstream Mock]       ${MOCK_UPSTREAM_URL}`);
  console.log(`[Database Scope]      Local Demo PostgreSQL (127.0.0.1:64322)`);
  console.log(`                      Note: App server runs on isolated port ${parsedTarget.port};`);
  console.log(`                      Database is shared local demo instance with safe test cleanup.`);
  console.log(`[AI Configuration]    Upstream loopback mock (GEMINI_BASE_URL=${MOCK_UPSTREAM_URL})`);
  console.log(`                      AI_RATE_LIMIT_MAX_TOKENS=50 (high limit for 17 test scenarios)`);
  console.log(`                      Zero real API keys used; zero billing charges incurred.`);
  console.log('==============================================================================\n');

  let mockServerInstance = null;
  let testServerProcess = null;

  try {
    // 1. Ensure Upstream Mock Server is running
    console.log('[Step 1/5] Ensuring Upstream Mock AI Server is active...');
    const mockReady = await isHttpReady(`${MOCK_UPSTREAM_URL}/health`, 1500, 300);
    if (mockReady) {
      console.log(`✓ Upstream mock server already responding on ${MOCK_UPSTREAM_URL}`);
    } else {
      console.log(`Starting upstream mock server on ${MOCK_UPSTREAM_URL}...`);
      mockServerInstance = await startUpstreamMockServer();
      console.log(`✓ Upstream mock server started on ${MOCK_UPSTREAM_URL}`);
    }

    // 2. Build isolated Next.js distribution
    console.log(`\n[Step 2/5] Building Next.js into isolated directory: ${DIST_DIR}...`);
    await runCommand('npx', ['next', 'build'], {
      env: {
        ...process.env,
        NEXT_DIST_DIR: DIST_DIR,
      },
    });
    console.log(`✓ Isolated Next.js build completed in ${DIST_DIR}`);

    // 3. Start isolated Next.js server on port 3001
    const testPort = parsedTarget.port || '3001';
    console.log(`\n[Step 3/5] Starting isolated Next.js server on port ${testPort}...`);
    const serverEnv = {
      ...process.env,
      PORT: testPort,
      NEXT_DIST_DIR: DIST_DIR,
      AI_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'test-mock-gemini-key',
      GEMINI_BASE_URL: MOCK_UPSTREAM_URL,
      AI_RATE_LIMIT_MAX_TOKENS: '50',
    };

    testServerProcess = spawn('npx', ['next', 'start', '-p', testPort], {
      cwd: ROOT_DIR,
      shell: true,
      stdio: 'inherit',
      env: serverEnv,
    });

    registerChild(testServerProcess, `Next.js Test Server (port ${testPort})`);

    const serverReady = await isHttpReady(`${TARGET_URL}/resident/lapor`, 30000, 1000);
    if (!serverReady) {
      throw new Error(`Test Next.js server failed to respond on ${TARGET_URL}/resident/lapor within 30s`);
    }
    console.log(`✓ Next.js isolated server is healthy and responding on ${TARGET_URL}`);

    // 4. Run test suites sequentially
    console.log('\n[Step 4/5] Running browser test suites against isolated instance...');
    const suites = [
      { name: 'Browser Voice Lifecycle & Zone Suite', script: 'tests/browser-voice-workflow.mjs' },
      { name: 'Browser Form Submission & Boundary Regression', script: 'tests/browser-workflow.mjs' },
      { name: 'Browser Response Loss & Interruption Recovery', script: 'tests/browser-response-loss.mjs' },
    ];

    const results = [];

    for (const suite of suites) {
      console.log('\n------------------------------------------------------------------------------');
      console.log(`RUNNING: ${suite.name} (${suite.script})`);
      console.log('------------------------------------------------------------------------------');
      const start = Date.now();
      try {
        await runCommand('node', [suite.script], {
          env: {
            ...process.env,
            TEST_APP_URL: TARGET_URL,
          },
        });
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        console.log(`✓ PASSED: ${suite.name} (${elapsed}s)`);
        results.push({ name: suite.name, script: suite.script, status: 'PASSED', exitCode: 0, elapsed });
      } catch (err) {
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        console.error(`✗ FAILED: ${suite.name} (${elapsed}s) - Exit code: ${err.code || 1}`);
        results.push({ name: suite.name, script: suite.script, status: 'FAILED', exitCode: err.code || 1, elapsed });
      }
    }

    // 5. Final Report
    console.log('\n==============================================================================');
    console.log('ISOLATED BROWSER SUITE RUN SUMMARY');
    console.log('==============================================================================');
    console.table(
      results.map((r) => ({
        Suite: r.name,
        Script: r.script,
        Status: r.status,
        ExitCode: r.exitCode,
        Duration: `${r.elapsed}s`,
      }))
    );

    const anyFailed = results.some((r) => r.status !== 'PASSED');
    if (anyFailed) {
      console.error('\nOne or more test suites failed.');
      process.exit(1);
    } else {
      console.log('\nAll isolated browser test suites passed successfully!');
    }
  } finally {
    console.log('\n[Step 5/5] Teardown & cleanup...');
    cleanupAll();
    if (mockServerInstance) {
      try {
        mockServerInstance.close();
        console.log('[Teardown] Upstream mock server closed.');
      } catch {
        // Ignore
      }
    }
  }
}

main().catch((err) => {
  console.error('\n[FATAL RUNNER ERROR]', err);
  cleanupAll();
  process.exit(1);
});
