#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';

// ==============================================================================
// PPR NADI — PHASE 02B: REAL APPLICATION WORKFLOW SUITE RUNNER
// ==============================================================================
// Executes the comprehensive Phase 02B end-to-end application workflow suite
// (tests/app-workflow.test.ts) covering authenticated Next.js mutations,
// photo uploads, transport limits, partial recovery, and sanitized rendering.
// Zero hardcoded secrets; credentials loaded from local environment only.
// ==============================================================================

const vitestBin = path.join(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs');
const proc = spawn(process.execPath, [vitestBin, 'run', 'tests/app-workflow.test.ts'], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: process.env,
});

proc.on('close', (code) => {
  process.exit(code ?? 0);
});
