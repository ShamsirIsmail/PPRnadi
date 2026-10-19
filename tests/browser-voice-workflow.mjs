#!/usr/bin/env node
/**
 * PPR NADI — Voice Narrative & AI Drafting Lifecycle Browser Suite
 *
 * Simulates real browser user workflows with deterministic, instrumented mock
 * implementations of MediaDevices, MediaRecorder, and SpeechRecognition.
 *
 * Test Matrix:
 * 1. Close via X while recording stops all media tracks immediately
 * 2. Close via Escape key while recording stops all media tracks immediately
 * 3. Permission Race Order 1: Permission A arrives while B is still waiting; A stopped immediately, B proceeds
 * 4. Permission Race Order 2: Permission B arrives first, then A resolves/fails; A stopped immediately, B unaffected
 * 5. Audio Completion (>500ms chunk): waits for final chunk and real stop event, transcribes without premature cutoff
 * 6. Audio Completion (Missing Stop Event): controlled timeout failure, clear error message, mic closed, no transcription
 * 7. Second recording (draft preserved, empty recognition triggers audio transcription fallback, no duplicate text)
 * 8. Auto-stop at 60s with deterministic interval control (tracks ended, timer cleared, single stop call)
 * 9. Audio size cutoff at 5MB stops recording immediately, displays size limit notice
 * 10. Session overlap: late stop event from old session released after session 2 starts does NOT kill session 2 mic
 * 11. Stale AI response discarded cleanly on reset / modal close
 * 12. Form inputs and photo fixture preserved; network inspection proves ZERO unintended report submissions
 * 13. Zone handling: raw text (undefined zoneId) preserves existing selected zone
 * 14. Zone handling: null zoneId clears existing zone and prompts location review
 * 15. Zone handling: valid zone ID suggested by AI draft updates zone field
 * 16. Zone handling: block mismatch clears old zone, warns user, flags location review
 * 17. Bilingual UX: switching language preserves form data; modal displays properly in BM and EN
 */

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { startUpstreamMockServer } from './upstream-mock-server.mjs';

// Load local environment
try {
  process.loadEnvFile('.env.local');
} catch {
  // Already loaded
}

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE_URL = process.env.TEST_APP_URL || 'http://127.0.0.1:3001';
const DEMO_RESIDENT_EMAIL = 'resident@sentosa.local';
const DEMO_RESIDENT_PASS = process.env.DEMO_RESIDENT_PASSWORD;

if (!DEMO_RESIDENT_PASS) {
  console.error('\n[FATAL CONFIG ERROR] DEMO_RESIDENT_PASSWORD is not set in environment or .env.local.');
  console.error('Please configure DEMO_RESIDENT_PASSWORD to run browser integration tests.\n');
  process.exit(1);
}

// Prepare tiny valid PNG fixture for photo attachment tests
const FIXTURE_DIR = path.resolve('tests/fixtures');
if (!fs.existsSync(FIXTURE_DIR)) {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
}
const FIXTURE_PNG_PATH = path.join(FIXTURE_DIR, 'voice-test-evidence.png');
const TINY_PNG_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);
fs.writeFileSync(FIXTURE_PNG_PATH, TINY_PNG_BUFFER);

async function runBrowserVoiceSuite() {
  console.log('==============================================================================');
  console.log('PPR NADI — VOICE AI FINAL REMEDIATION LIFECYCLE BROWSER TEST SUITE');
  console.log('==============================================================================');
  console.log(`[Target URL] ${BASE_URL}`);

  // Start upstream mock server on port 3928 if not already running
  let mockServer;
  try {
    mockServer = await startUpstreamMockServer();
    console.log('[Test Harness] Upstream mock AI server listening on http://127.0.0.1:3928');
  } catch (err) {
    if (err.code === 'EADDRINUSE') {
      console.log('[Test Harness] Upstream mock AI server already running on port 3928');
    } else {
      throw err;
    }
  }

  async function getUpstreamMockStats() {
    const res = await fetch('http://127.0.0.1:3928/mock-stats');
    return res.json();
  }

  async function resetUpstreamMockStats() {
    await fetch('http://127.0.0.1:3928/mock-reset', { method: 'POST' });
  }

  // Ensure clean baseline before test suite starts
  await resetUpstreamMockStats();

  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME_PATH,
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });

  // Inject instrumented browser API mocks before any script loads
  await context.addInitScript(() => {
    window.__mockVoiceSpy = {
      tracksCreated: [],
      tracksStopped: [],
      recorderInstances: [],
      speechRecognitionInstances: [],
      delayPermissionMs: 0,
      permissionMode: 'auto', // 'auto' | 'manual'
      permissionQueue: [],
      activeSpeechText: 'Paip air di tingkat 1 Blok A pecah melimpah',
      delayStopEvent: false,
      delayedStopResolvers: [],
      delayFinalChunkMs: 0,
      omitStopEvent: false,
      emitOversizedChunk: false,
      mockChunks: [
        // Genuine WebM EBML header
        new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81]),
        new Uint8Array(2000),
      ],
      releaseDelayedStops() {
        const resolvers = [...this.delayedStopResolvers];
        this.delayedStopResolvers = [];
        for (const fn of resolvers) {
          try {
            fn();
          } catch {
            // Ignore
          }
        }
      },
      resolvePermission(index) {
        const item = this.permissionQueue[index];
        if (item) {
          item.resolve();
        }
      },
      rejectPermission(index, err) {
        const item = this.permissionQueue[index];
        if (item) {
          item.reject(err);
        }
      },
      reset() {
        this.tracksCreated = [];
        this.tracksStopped = [];
        this.recorderInstances = [];
        this.speechRecognitionInstances = [];
        this.delayPermissionMs = 0;
        this.permissionMode = 'auto';
        this.permissionQueue = [];
        this.activeSpeechText = 'Paip air di tingkat 1 Blok A pecah melimpah';
        this.delayStopEvent = false;
        this.delayedStopResolvers = [];
        this.delayFinalChunkMs = 0;
        this.omitStopEvent = false;
        this.emitOversizedChunk = false;
      },
    };

    // Deterministic interval tracking & stepping
    const origSetInterval = window.setInterval;
    const origClearInterval = window.clearInterval;
    window.__voiceIntervals = new Set();

    window.setInterval = function (fn, ms, ...args) {
      const item = { id: 0, fn, ms };
      item.id = origSetInterval(fn, ms, ...args);
      window.__voiceIntervals.add(item);
      return item.id;
    };

    window.clearInterval = function (id) {
      for (const item of window.__voiceIntervals) {
        if (item.id === id) {
          window.__voiceIntervals.delete(item);
          break;
        }
      }
      return origClearInterval(id);
    };

    window.__advanceTimersBy = function (seconds) {
      for (const item of Array.from(window.__voiceIntervals)) {
        if (item.ms === 1000) {
          for (let i = 0; i < seconds; i++) {
            if (!window.__voiceIntervals.has(item)) break;
            item.fn();
          }
        }
      }
    };

    // 1. Mock MediaStreamTrack
    class MockAudioTrack {
      constructor() {
        this.kind = 'audio';
        this.id = 'track-' + Math.random().toString(36).substring(2, 9);
        this.label = 'Mock Noise-Cancelling Microphone';
        this.enabled = true;
        this.readyState = 'live';
        window.__mockVoiceSpy.tracksCreated.push(this);
      }
      stop() {
        this.readyState = 'ended';
        window.__mockVoiceSpy.tracksStopped.push(this.id);
      }
    }

    // 2. Mock MediaStream
    class MockMediaStream {
      constructor() {
        this.id = 'stream-' + Math.random().toString(36).substring(2, 9);
        this.tracks = [new MockAudioTrack()];
      }
      getTracks() {
        return this.tracks;
      }
      getAudioTracks() {
        return this.tracks;
      }
    }

    // 3. Mock getUserMedia with queueable / manual control
    if (!navigator.mediaDevices) {
      navigator.mediaDevices = {};
    }
    navigator.mediaDevices.getUserMedia = async function () {
      if (window.__mockVoiceSpy.permissionMode === 'manual') {
        return new Promise((resolve, reject) => {
          const stream = new MockMediaStream();
          window.__mockVoiceSpy.permissionQueue.push({
            id: window.__mockVoiceSpy.permissionQueue.length + 1,
            resolve: () => resolve(stream),
            reject: (err) => reject(err || new Error('NotAllowedError: Permission denied')),
          });
        });
      }

      if (window.__mockVoiceSpy.delayPermissionMs > 0) {
        await new Promise((r) => setTimeout(r, window.__mockVoiceSpy.delayPermissionMs));
      }
      return new MockMediaStream();
    };

    // 4. Mock MediaRecorder
    class MockMediaRecorder extends EventTarget {
      constructor(stream, options = {}) {
        super();
        this.stream = stream;
        this.mimeType = options.mimeType || 'audio/webm;codecs=opus';
        this.state = 'inactive';
        this.stopCallCount = 0;
        this.ondataavailable = null;
        this.onstop = null;
        this.onerror = null;
        this.delayStop = window.__mockVoiceSpy.delayStopEvent;
        this.delayFinalChunkMs = window.__mockVoiceSpy.delayFinalChunkMs || 0;
        this.omitStopEvent = window.__mockVoiceSpy.omitStopEvent || false;
        window.__mockVoiceSpy.recorderInstances.push(this);
      }

      start() {
        this.state = 'recording';
        if (window.__mockVoiceSpy.emitOversizedChunk) {
          setTimeout(() => {
            if (this.state !== 'recording') return;
            const largeBuf = new Uint8Array(5.2 * 1024 * 1024);
            largeBuf.set([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81]);
            const blob = new Blob([largeBuf], { type: this.mimeType });
            const dataEvt = new Event('dataavailable');
            dataEvt.data = blob;
            if (typeof this.ondataavailable === 'function') {
              this.ondataavailable(dataEvt);
            }
            this.dispatchEvent(dataEvt);
          }, 30);
        }
      }

      stop() {
        this.stopCallCount++;
        if (this.state === 'inactive') return;
        this.state = 'inactive';

        // Check if test instructs recorder to drop stop event entirely
        if (this.omitStopEvent) {
          // Never emit stop event; let controlled timeout trigger
          return;
        }

        const emit = () => {
          const chunkDelay = this.delayFinalChunkMs;

          setTimeout(() => {
            const blob = new Blob(window.__mockVoiceSpy.mockChunks, { type: this.mimeType });
            const dataEvt = new Event('dataavailable');
            dataEvt.data = blob;
            if (typeof this.ondataavailable === 'function') {
              this.ondataavailable(dataEvt);
            }
            this.dispatchEvent(dataEvt);

            setTimeout(() => {
              const stopEvt = new Event('stop');
              if (typeof this.onstop === 'function') {
                this.onstop(stopEvt);
              }
              this.dispatchEvent(stopEvt);
            }, 30);
          }, chunkDelay);
        };

        if (this.delayStop) {
          window.__mockVoiceSpy.delayedStopResolvers.push(emit);
        } else {
          emit();
        }
      }

      static isTypeSupported() {
        return true;
      }
    }

    window.MediaRecorder = MockMediaRecorder;

    // 5. Mock SpeechRecognition
    class MockSpeechRecognition extends EventTarget {
      constructor() {
        super();
        this.continuous = false;
        this.interimResults = false;
        this.lang = 'ms-MY';
        this.onresult = null;
        this.onerror = null;
        this.onend = null;
        this.onstart = null;
        this.isStarted = false;
        window.__mockVoiceSpy.speechRecognitionInstances.push(this);
      }

      start() {
        this.isStarted = true;
        if (typeof this.onstart === 'function') {
          this.onstart(new Event('start'));
        }

        setTimeout(() => {
          if (!this.isStarted) return;
          const text = window.__mockVoiceSpy.activeSpeechText;
          if (text && typeof this.onresult === 'function') {
            const event = {
              resultIndex: 0,
              results: [
                [
                  {
                    transcript: text,
                    confidence: 0.95,
                  },
                ],
              ],
            };
            this.onresult(event);
          }
        }, 40);
      }

      stop() {
        this.isStarted = false;
        setTimeout(() => {
          if (typeof this.onend === 'function') {
            this.onend(new Event('end'));
          }
        }, 10);
      }

      abort() {
        this.isStarted = false;
        setTimeout(() => {
          if (typeof this.onend === 'function') {
            this.onend(new Event('end'));
          }
        }, 10);
      }
    }

    window.SpeechRecognition = MockSpeechRecognition;
    window.webkitSpeechRecognition = MockSpeechRecognition;
  });

  const page = await context.newPage();
  let testCount = 0;
  let passCount = 0;

  function recordPass(testName) {
    testCount++;
    passCount++;
    console.log(`  ✓ ${testName}`);
  }

  function recordFail(testName, err) {
    testCount++;
    console.error(`  ✗ ${testName}: ${err.message}`);
  }

  // Helper to ensure clean form state
  async function resetToCleanForm() {
    await page.goto(`${BASE_URL}/resident/lapor`);
    await page.waitForSelector('[data-testid="trigger-voice-narrative-button"]', { timeout: 10000 });
    await page.evaluate(() => {
      window.__mockVoiceSpy.reset();
      const descInput = document.querySelector('#report-description');
      if (descInput) {
        descInput.value = '';
        descInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const zoneSelect = document.querySelector('#report-zone');
      if (zoneSelect) {
        zoneSelect.value = '';
        zoneSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  }

  try {
    // -------------------------------------------------------------------------
    // Setup: Log in as permanent Resident
    // -------------------------------------------------------------------------
    console.log('\n[Setup] Logging in as permanent demo resident...');
    await page.goto(`${BASE_URL}/login`);
    await page.waitForSelector('#login-email', { timeout: 10000 });
    await page.fill('#login-email', DEMO_RESIDENT_EMAIL);
    await page.fill('#login-password', DEMO_RESIDENT_PASS);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/resident', { timeout: 15000 });
    console.log('  ✓ Resident authenticated on dashboard');

    // -------------------------------------------------------------------------
    // TEST 1: Close via X while recording stops all media tracks immediately
    // -------------------------------------------------------------------------
    console.log('\n[Test 1] Close via X button while recording stops all audio tracks...');
    try {
      await resetToCleanForm();
      const statsBefore = await getUpstreamMockStats();

      await page.click('[data-testid="trigger-voice-narrative-button"]');
      await page.waitForSelector('[data-testid="voice-narrative-modal"]', { timeout: 5000 });
      await page.click('[data-testid="start-voice-record-button"]');
      await page.waitForSelector('[data-testid="stop-voice-record-button"]', { timeout: 5000 });

      const tracksBefore = await page.evaluate(() => window.__mockVoiceSpy.tracksCreated.length);
      if (tracksBefore === 0) throw new Error('No audio tracks created');

      await page.click('[data-testid="voice-modal-close-button"]');
      await page.waitForSelector('[data-testid="voice-narrative-modal"]', { state: 'detached', timeout: 5000 });

      const allTracksEnded = await page.evaluate(() =>
        window.__mockVoiceSpy.tracksCreated.every((t) => t.readyState === 'ended')
      );
      if (!allTracksEnded) throw new Error('Tracks not stopped on close');

      const statsAfter = await getUpstreamMockStats();
      if (statsAfter.transcriptionRequestCount - statsBefore.transcriptionRequestCount !== 0) {
        throw new Error('Close via X triggered unexpected transcription request');
      }

      recordPass('Closing modal via X stopped all MediaStream tracks (0 upstream transcriptions)');
    } catch (err) {
      recordFail('Closing modal via X stopped all MediaStream tracks', err);
    }

    // -------------------------------------------------------------------------
    // TEST 2: Close via Escape key while recording stops all tracks
    // -------------------------------------------------------------------------
    console.log('\n[Test 2] Close via Escape key while recording stops all audio tracks...');
    try {
      await resetToCleanForm();
      const statsBefore = await getUpstreamMockStats();

      await page.click('[data-testid="trigger-voice-narrative-button"]');
      await page.waitForSelector('[data-testid="start-voice-record-button"]', { timeout: 5000 });
      await page.click('[data-testid="start-voice-record-button"]');
      await page.waitForSelector('[data-testid="stop-voice-record-button"]', { timeout: 5000 });

      await page.keyboard.press('Escape');
      await page.waitForSelector('[data-testid="voice-narrative-modal"]', { state: 'detached', timeout: 5000 });

      const allTracksEnded = await page.evaluate(() =>
        window.__mockVoiceSpy.tracksCreated.every((t) => t.readyState === 'ended')
      );
      if (!allTracksEnded) throw new Error('Tracks remained live after Escape key');

      const statsAfter = await getUpstreamMockStats();
      if (statsAfter.transcriptionRequestCount - statsBefore.transcriptionRequestCount !== 0) {
        throw new Error('Close via Escape triggered unexpected transcription request');
      }

      recordPass('Closing modal via Escape key stopped all tracks (0 upstream transcriptions)');
    } catch (err) {
      recordFail('Closing modal via Escape key stopped all tracks', err);
    }

    // -------------------------------------------------------------------------
    // TEST 3 (Permission Race Order 1):
    // Request A starts -> modal closed -> modal reopened & Request B starts.
    // Permission A arrives while B is still waiting in getUserMedia.
    // Expected: Stream A is stopped immediately; Session B proceeds to record cleanly.
    // -------------------------------------------------------------------------
    console.log('\n[Test 3] Permission Race Order 1: Permission A arrives while B is still waiting...');
    try {
      await resetToCleanForm();
      await page.evaluate(() => {
        window.__mockVoiceSpy.permissionMode = 'manual';
      });

      // 1. Open modal and trigger Request A
      await page.click('[data-testid="trigger-voice-narrative-button"]');
      await page.waitForSelector('[data-testid="start-voice-record-button"]', { timeout: 5000 });
      await page.click('[data-testid="start-voice-record-button"]');

      // Verify Request A is queued
      const queueLenA = await page.evaluate(() => window.__mockVoiceSpy.permissionQueue.length);
      if (queueLenA !== 1) throw new Error(`Expected 1 permission request in queue, got ${queueLenA}`);

      // 2. Close modal before A resolves
      await page.click('[data-testid="voice-modal-close-button"]');
      await page.waitForSelector('[data-testid="voice-narrative-modal"]', { state: 'detached', timeout: 5000 });

      // 3. Reopen modal and trigger Request B
      await page.click('[data-testid="trigger-voice-narrative-button"]');
      await page.waitForSelector('[data-testid="start-voice-record-button"]', { timeout: 5000 });
      await page.click('[data-testid="start-voice-record-button"]');

      // Verify Request B is queued
      const queueLenB = await page.evaluate(() => window.__mockVoiceSpy.permissionQueue.length);
      if (queueLenB !== 2) throw new Error(`Expected 2 permission requests in queue, got ${queueLenB}`);

      // 4. Resolve Request A first (while B is still waiting)
      await page.evaluate(() => {
        window.__mockVoiceSpy.resolvePermission(0);
      });
      await page.waitForTimeout(100);

      // Verify Stream A was stopped immediately
      const streamAStopped = await page.evaluate(() => {
        const trackA = window.__mockVoiceSpy.tracksCreated[0];
        return trackA && trackA.readyState === 'ended';
      });
      if (!streamAStopped) throw new Error('Stream A was not stopped when resolving during Session B wait');

      // Verify modal did NOT crash or show permission error from Session A
      const hasErrorBanner = await page.isVisible('[data-testid="voice-error-banner"]');
      if (hasErrorBanner) throw new Error('Stale permission A triggered error in Session B modal');

      // 5. Now resolve Request B
      await page.evaluate(() => {
        window.__mockVoiceSpy.resolvePermission(1);
      });

      // Session B transitions cleanly to recording
      await page.waitForSelector('[data-testid="stop-voice-record-button"]', { timeout: 5000 });

      // Verify Stream B is live
      const streamBLive = await page.evaluate(() => {
        const trackB = window.__mockVoiceSpy.tracksCreated[1];
        return trackB && trackB.readyState === 'live';
      });
      if (!streamBLive) throw new Error('Stream B is not live after Session B resolved');

      await page.click('[data-testid="voice-modal-close-button"]');
      recordPass('Permission Race Order 1: Stream A stopped immediately without interrupting Session B');
    } catch (err) {
      recordFail('Permission Race Order 1 check', err);
    }

    // -------------------------------------------------------------------------
    // TEST 4 (Permission Race Order 2):
    // Request A starts -> modal closed -> modal reopened & Request B starts.
    // Permission B resolves first and starts recording; Permission A arrives afterwards (success or fail).
    // Expected: Session B active recording is NOT disrupted; Stream A is stopped immediately.
    // -------------------------------------------------------------------------
    console.log('\n[Test 4] Permission Race Order 2: Permission B arrives first, then A resolves late...');
    try {
      await resetToCleanForm();
      await page.evaluate(() => {
        window.__mockVoiceSpy.permissionMode = 'manual';
      });

      // 1. Open modal and trigger Request A
      await page.click('[data-testid="trigger-voice-narrative-button"]');
      await page.waitForSelector('[data-testid="start-voice-record-button"]', { timeout: 5000 });
      await page.click('[data-testid="start-voice-record-button"]');

      // 2. Close modal before A resolves
      await page.click('[data-testid="voice-modal-close-button"]');
      await page.waitForSelector('[data-testid="voice-narrative-modal"]', { state: 'detached', timeout: 5000 });

      // 3. Reopen modal and trigger Request B
      await page.click('[data-testid="trigger-voice-narrative-button"]');
      await page.waitForSelector('[data-testid="start-voice-record-button"]', { timeout: 5000 });
      await page.click('[data-testid="start-voice-record-button"]');

      // 4. Resolve Request B FIRST
      await page.evaluate(() => {
        window.__mockVoiceSpy.resolvePermission(1);
      });

      // Session B enters active recording
      await page.waitForSelector('[data-testid="stop-voice-record-button"]', { timeout: 5000 });
      const streamBLive = await page.evaluate(() => {
        const trackB = window.__mockVoiceSpy.tracksCreated[1];
        return trackB && trackB.readyState === 'live';
      });
      if (!streamBLive) throw new Error('Session B track is not live');

      // 5. Now Request A resolves LATER
      await page.evaluate(() => {
        window.__mockVoiceSpy.resolvePermission(0);
      });
      await page.waitForTimeout(100);

      // Verify Stream A is terminated immediately
      const streamATerminated = await page.evaluate(() => {
        const trackA = window.__mockVoiceSpy.tracksCreated[0];
        return trackA && trackA.readyState === 'ended';
      });
      if (!streamATerminated) throw new Error('Late Stream A was not ended');

      // CRITICAL ASSERTION: Session B MUST STILL BE IN RECORDING STATE AND TRACK LIVE!
      const isStillRecording = await page.isVisible('[data-testid="stop-voice-record-button"]');
      if (!isStillRecording) throw new Error('Session B recording was interrupted by late Session A resolution');

      const streamBStillLive = await page.evaluate(() => {
        const trackB = window.__mockVoiceSpy.tracksCreated[1];
        return trackB && trackB.readyState === 'live';
      });
      if (!streamBStillLive) throw new Error('Session B microphone was killed by late Session A');

      await page.click('[data-testid="voice-modal-close-button"]');
      recordPass('Permission Race Order 2: Late resolution of A did not disrupt active Session B');
    } catch (err) {
      recordFail('Permission Race Order 2 check', err);
    }

    // -------------------------------------------------------------------------
    // TEST 5: Audio Completion - Final chunk arrives after >500ms
    // Modal properly awaits final chunk & real stop event without premature cutoff
    // -------------------------------------------------------------------------
    console.log('\n[Test 5] Audio Completion: final chunk arrives after >500ms (waits for real stop event)...');
    try {
      await resetToCleanForm();
      const statsBefore = await getUpstreamMockStats();

      await page.evaluate(() => {
        window.__mockVoiceSpy.delayFinalChunkMs = 600; // >500ms
        window.__mockVoiceSpy.activeSpeechText = ''; // triggers audio transcription path
      });

      await page.click('[data-testid="trigger-voice-narrative-button"]');
      await page.waitForSelector('[data-testid="start-voice-record-button"]', { timeout: 5000 });
      await page.click('[data-testid="start-voice-record-button"]');
      await page.waitForSelector('[data-testid="stop-voice-record-button"]', { timeout: 5000 });

      // Click Stop Recording: final chunk will take 600ms to arrive
      await page.click('[data-testid="stop-voice-record-button"]');

      // Modal should wait properly and transition through transcribing to review_text
      await page.waitForSelector('[data-testid="voice-transcript-textarea"]', { timeout: 10000 });

      const transcript = await page.inputValue('[data-testid="voice-transcript-textarea"]');
      if (!transcript.includes('Bahagian koridor basah')) {
        throw new Error(`Audio transcription missing expected content: ${transcript}`);
      }

      // Verify audio byte count without duplicate chunk accumulation
      const statsAfter = await getUpstreamMockStats();
      const delta = statsAfter.transcriptionRequestCount - statsBefore.transcriptionRequestCount;
      if (delta !== 1) {
        throw new Error(`Expected exactly 1 upstream transcription request, got delta of ${delta}`);
      }
      // Total source chunks: 12 + 2000 = 2012 bytes
      if (statsAfter.lastReceivedAudioBytes !== 2012) {
        throw new Error(`Duplicate audio chunks detected! Expected 2012 bytes, got ${statsAfter.lastReceivedAudioBytes} bytes`);
      }

      await page.click('[data-testid="voice-modal-close-button"]');
      recordPass('Audio transcription waited for delayed (>500ms) final chunk with exact bytes (no duplication)');
    } catch (err) {
      recordFail('Delayed final chunk check', err);
    }

    // -------------------------------------------------------------------------
    // TEST 6: Audio Completion - Stop event never arrives
    // Controlled failure timeout fires, mic closed, clear error, NO transcription call
    // -------------------------------------------------------------------------
    console.log('\n[Test 6] Audio Completion: stop event never arrives -> controlled failure...');
    try {
      await resetToCleanForm();
      const statsBefore = await getUpstreamMockStats();

      await page.evaluate(() => {
        window.__mockVoiceSpy.omitStopEvent = true; // Recorder hangs / fails to emit stop
        window.__mockVoiceSpy.activeSpeechText = '';
      });

      await page.click('[data-testid="trigger-voice-narrative-button"]');
      await page.waitForSelector('[data-testid="start-voice-record-button"]', { timeout: 5000 });
      await page.click('[data-testid="start-voice-record-button"]');
      await page.waitForSelector('[data-testid="stop-voice-record-button"]', { timeout: 5000 });

      // Click stop: stop event will NOT arrive
      await page.click('[data-testid="stop-voice-record-button"]');

      // Controlled timeout in VoiceNarrativeModal is 4000ms; wait for error banner
      await page.waitForSelector('[data-testid="voice-error-banner"]', { timeout: 8000 });

      const errorText = await page.innerText('[data-testid="voice-error-banner"]');
      if (!errorText.includes('Perakam audio menghadapi ralat') && !errorText.includes('Failed to finalize')) {
        throw new Error(`Expected recorderStopFailed error message, got: ${errorText}`);
      }

      // Check mic tracks were ended
      const allTracksEnded = await page.evaluate(() =>
        window.__mockVoiceSpy.tracksCreated.every((t) => t.readyState === 'ended')
      );
      if (!allTracksEnded) {
        throw new Error('Microphone tracks remained active after recorder stop failure');
      }

      // Verify ZERO upstream transcription requests were made during timeout
      const statsAfter = await getUpstreamMockStats();
      const transcriptionDelta = statsAfter.transcriptionRequestCount - statsBefore.transcriptionRequestCount;
      if (transcriptionDelta !== 0) {
        throw new Error(`CRITICAL: Timeout triggered ${transcriptionDelta} unexpected upstream transcription request(s)!`);
      }

      await page.click('[data-testid="voice-modal-close-button"]');
      recordPass('Missing stop event triggered controlled failure, stopped mic, and produced exactly 0 upstream transcriptions');
    } catch (err) {
      recordFail('Missing stop event check', err);
    }

    // -------------------------------------------------------------------------
    // TEST 7: Second recording preserves draft 1 and merges without duplication
    // -------------------------------------------------------------------------
    console.log('\n[Test 7] Second recording workflow with transcription fallback and merge...');
    try {
      await resetToCleanForm();
      const firstText = 'Draf pertama paip bocor di tingkat 1 Blok A';
      await page.evaluate((text) => {
        window.__mockVoiceSpy.activeSpeechText = text;
      }, firstText);

      // Session 1: Record first text
      await page.click('[data-testid="trigger-voice-narrative-button"]');
      await page.waitForSelector('[data-testid="start-voice-record-button"]', { timeout: 5000 });
      await page.click('[data-testid="start-voice-record-button"]');
      await page.waitForSelector('[data-testid="stop-voice-record-button"]', { timeout: 5000 });
      await page.waitForTimeout(100);
      await page.click('[data-testid="stop-voice-record-button"]');

      await page.waitForSelector('[data-testid="voice-transcript-textarea"]', { timeout: 10000 });
      const textAfterS1 = await page.inputValue('[data-testid="voice-transcript-textarea"]');
      if (!textAfterS1.includes(firstText)) {
        throw new Error(`First recording text missing: ${textAfterS1}`);
      }

      // Re-record: empty speech text for session 2 (triggers audio fallback)
      await page.evaluate(() => {
        window.__mockVoiceSpy.activeSpeechText = '';
      });

      await page.click('button:has-text("Rakam Semula")');
      await page.waitForSelector('[data-testid="stop-voice-record-button"]', { timeout: 5000 });
      await page.waitForTimeout(100);
      await page.click('[data-testid="stop-voice-record-button"]');

      await page.waitForSelector('[data-testid="voice-transcript-textarea"]', { timeout: 10000 });
      const mergedText = await page.inputValue('[data-testid="voice-transcript-textarea"]');

      if (!mergedText.includes(firstText)) {
        throw new Error(`Draft 1 was wiped! Value: ${mergedText}`);
      }
      if (!mergedText.includes('Bahagian koridor basah lecun')) {
        throw new Error(`Second audio transcription text was not merged! Value: ${mergedText}`);
      }
      const occurrences = mergedText.split(firstText).length - 1;
      if (occurrences !== 1) {
        throw new Error(`Text 1 duplicated! Occurrences: ${occurrences}`);
      }

      await page.click('[data-testid="voice-modal-close-button"]');
      recordPass('Second recording preserved draft 1, merged fallback audio transcription without duplication');
    } catch (err) {
      recordFail('Second recording workflow', err);
    }

    // -------------------------------------------------------------------------
    // TEST 8: Auto-stop at 60 seconds using deterministic timer stepper
    // -------------------------------------------------------------------------
    console.log('\n[Test 8] Auto-stop at 60 seconds with deterministic timer control...');
    try {
      await resetToCleanForm();

      await page.click('[data-testid="trigger-voice-narrative-button"]');
      await page.waitForSelector('[data-testid="start-voice-record-button"]', { timeout: 5000 });
      await page.click('[data-testid="start-voice-record-button"]');
      await page.waitForSelector('[data-testid="stop-voice-record-button"]', { timeout: 5000 });

      // Deterministically step the 1-second interval 60 times
      await page.evaluate(() => {
        window.__advanceTimersBy(60);
      });

      await page.waitForSelector('[data-testid="voice-transcript-textarea"]', { timeout: 10000 });

      const recorderStopped = await page.evaluate(() => {
        const r = window.__mockVoiceSpy.recorderInstances[0];
        return r && r.state === 'inactive' && r.stopCallCount === 1;
      });
      if (!recorderStopped) {
        throw new Error('Recorder did not stop or stopped multiple times on 60s timeout');
      }

      const allTracksEnded = await page.evaluate(() =>
        window.__mockVoiceSpy.tracksCreated.every((t) => t.readyState === 'ended')
      );
      if (!allTracksEnded) {
        throw new Error('Microphone tracks remained active after 60s timeout');
      }

      const activeIntervals = await page.evaluate(() => window.__voiceIntervals.size);
      if (activeIntervals !== 0) {
        throw new Error(`Timer was not cleared! Active intervals: ${activeIntervals}`);
      }

      await page.click('[data-testid="voice-modal-close-button"]');
      recordPass('Auto-stop stopped recorder at 60s, ended all tracks, cleared timer, and ran once');
    } catch (err) {
      recordFail('Auto-stop 60s check', err);
    }

    // -------------------------------------------------------------------------
    // TEST 9: Audio size limit (5 MB) triggers immediate auto-stop
    // -------------------------------------------------------------------------
    console.log('\n[Test 9] Audio size cutoff at 5 MB stops recording immediately...');
    try {
      await resetToCleanForm();
      const statsBefore = await getUpstreamMockStats();

      await page.evaluate(() => {
        window.__mockVoiceSpy.emitOversizedChunk = true;
      });

      await page.click('[data-testid="trigger-voice-narrative-button"]');
      await page.waitForSelector('[data-testid="start-voice-record-button"]', { timeout: 5000 });
      await page.click('[data-testid="start-voice-record-button"]');

      await page.waitForSelector('[data-testid="voice-error-banner"]', { timeout: 10000 });
      const errorText = await page.innerText('[data-testid="voice-error-banner"]');
      if (!errorText.includes('5 MB')) {
        throw new Error(`Expected 5MB size limit warning, got: ${errorText}`);
      }

      const allTracksEnded = await page.evaluate(() =>
        window.__mockVoiceSpy.tracksCreated.every((t) => t.readyState === 'ended')
      );
      if (!allTracksEnded) {
        throw new Error('Microphone tracks remained active after size limit exceeded');
      }

      const statsAfter = await getUpstreamMockStats();
      const delta = statsAfter.transcriptionRequestCount - statsBefore.transcriptionRequestCount;
      if (delta !== 0) {
        throw new Error(`CRITICAL: 5MB size limit violation triggered ${delta} unexpected transcription request(s)!`);
      }

      await page.click('[data-testid="voice-modal-close-button"]');
      recordPass('5MB audio limit triggered immediate stop, ended tracks, and produced 0 upstream transcriptions');
    } catch (err) {
      recordFail('Audio size cutoff check', err);
    }

    // -------------------------------------------------------------------------
    // TEST 10: Session overlap - delayed stop from session 1 does not affect session 2
    // -------------------------------------------------------------------------
    console.log('\n[Test 10] Session overlap: delayed stop of session 1 does not affect session 2...');
    try {
      await resetToCleanForm();
      const statsBefore = await getUpstreamMockStats();

      await page.evaluate(() => {
        window.__mockVoiceSpy.delayStopEvent = true;
      });

      // Session 1: start recording
      await page.click('[data-testid="trigger-voice-narrative-button"]');
      await page.waitForSelector('[data-testid="start-voice-record-button"]', { timeout: 5000 });
      await page.click('[data-testid="start-voice-record-button"]');
      await page.waitForSelector('[data-testid="stop-voice-record-button"]', { timeout: 5000 });

      // Close modal while session 1 is active
      await page.click('[data-testid="voice-modal-close-button"]');
      await page.waitForSelector('[data-testid="voice-narrative-modal"]', { state: 'detached', timeout: 5000 });

      // Disable delayed stop for session 2
      await page.evaluate(() => {
        window.__mockVoiceSpy.delayStopEvent = false;
        window.__mockVoiceSpy.activeSpeechText = 'Sesi kedua teks unik';
      });

      // Reopen modal and start Session 2
      await page.click('[data-testid="trigger-voice-narrative-button"]');
      await page.waitForSelector('[data-testid="start-voice-record-button"]', { timeout: 5000 });
      await page.click('[data-testid="start-voice-record-button"]');
      await page.waitForSelector('[data-testid="stop-voice-record-button"]', { timeout: 5000 });

      // Release delayed stop of Session 1
      await page.evaluate(() => {
        window.__mockVoiceSpy.releaseDelayedStops();
      });
      await page.waitForTimeout(200);

      // Verify no transcription call was made for session 1 when its delayed stop fired
      const statsAfterS1Release = await getUpstreamMockStats();
      const deltaS1 = statsAfterS1Release.transcriptionRequestCount - statsBefore.transcriptionRequestCount;
      if (deltaS1 !== 0) {
        throw new Error(`CRITICAL: Delayed stop of Session 1 triggered ${deltaS1} unintended transcription request(s)!`);
      }

      // Verify Session 2 track is still live
      const s2TrackLiveAfter = await page.evaluate(() => {
        const last = window.__mockVoiceSpy.tracksCreated[window.__mockVoiceSpy.tracksCreated.length - 1];
        return last && last.readyState === 'live';
      });
      if (!s2TrackLiveAfter) {
        throw new Error('BUG: Late stop event from Session 1 terminated Session 2 microphone track!');
      }

      await page.click('[data-testid="stop-voice-record-button"]');
      await page.waitForSelector('[data-testid="voice-transcript-textarea"]', { timeout: 10000 });

      const finalVal = await page.inputValue('[data-testid="voice-transcript-textarea"]');
      if (!finalVal.includes('Sesi kedua teks unik')) {
        throw new Error(`Session 2 speech text corrupted: ${finalVal}`);
      }

      await page.click('[data-testid="voice-modal-close-button"]');
      recordPass('Delayed stop from session 1 triggered 0 transcriptions and did not kill session 2 mic');
    } catch (err) {
      recordFail('Session overlap check', err);
    }

    // -------------------------------------------------------------------------
    // TEST 11: Stale AI response discarded after reset
    // -------------------------------------------------------------------------
    console.log('\n[Test 11] Stale AI response discarded cleanly on modal close...');
    try {
      await resetToCleanForm();

      await page.click('[data-testid="trigger-voice-narrative-button"]');
      await page.waitForSelector('[data-testid="start-voice-record-button"]', { timeout: 5000 });
      await page.click('[data-testid="start-voice-record-button"]');
      await page.waitForSelector('[data-testid="stop-voice-record-button"]', { timeout: 5000 });
      await page.waitForTimeout(100);
      await page.click('[data-testid="stop-voice-record-button"]');
      await page.waitForSelector('[data-testid="voice-transcript-textarea"]', { timeout: 10000 });

      await page.click('[data-testid="generate-ai-draft-button"]');
      await page.click('[data-testid="voice-modal-close-button"]');
      await page.waitForSelector('[data-testid="voice-narrative-modal"]', { state: 'detached', timeout: 5000 });

      await page.click('[data-testid="trigger-voice-narrative-button"]');
      await page.waitForSelector('[data-testid="voice-narrative-modal"]', { timeout: 5000 });

      const draftCardVisible = await page.isVisible('[data-testid="voice-draft-ready-view"]');
      if (draftCardVisible) {
        throw new Error('BUG: Stale AI response resurrected draft after close!');
      }

      await page.click('[data-testid="voice-modal-close-button"]');
      recordPass('Stale AI response discarded cleanly on modal close');
    } catch (err) {
      recordFail('Stale AI response discard check', err);
    }

    // -------------------------------------------------------------------------
    // TEST 12: Form inputs and photo fixture preserved; ZERO report submissions
    // -------------------------------------------------------------------------
    console.log('\n[Test 12] Form inputs and photo fixture preserved; ZERO unintended submissions...');
    try {
      await resetToCleanForm();

      await page.setInputFiles('input[data-testid="file-picker-input"]', FIXTURE_PNG_PATH);
      await page.waitForSelector('[data-testid="remove-file-0"]', { timeout: 5000 });

      const prefilledDesc = 'Pemerhatian awal: Paip air berkarat di koridor tingkat 4';
      await page.fill('#report-description', prefilledDesc);
      await page.click('button:has-text("Lif Penumpang")');

      let reportSubmissionRequests = 0;
      const requestListener = (req) => {
        if (req.method() === 'POST' && req.url().includes('/resident/lapor')) {
          const body = req.postData() || '';
          if (body.includes('client_report_id') || body.includes('description')) {
            reportSubmissionRequests++;
          }
        }
      };
      page.on('request', requestListener);

      await page.click('[data-testid="trigger-voice-narrative-button"]');
      await page.waitForSelector('[data-testid="start-voice-record-button"]', { timeout: 5000 });
      await page.click('[data-testid="start-voice-record-button"]');
      await page.waitForSelector('[data-testid="stop-voice-record-button"]', { timeout: 5000 });
      await page.click('button:has-text("Batal")');
      await page.click('[data-testid="voice-modal-close-button"]');
      await page.waitForSelector('[data-testid="voice-narrative-modal"]', { state: 'detached', timeout: 5000 });

      page.off('request', requestListener);

      if (reportSubmissionRequests !== 0) {
        throw new Error(`CRITICAL BUG: ${reportSubmissionRequests} unintended report submission requests observed!`);
      }

      const descVal = await page.inputValue('#report-description');
      if (descVal !== prefilledDesc) {
        throw new Error(`Description input altered! Value: ${descVal}`);
      }

      const photoRetained = await page.isVisible('text=1 daripada 3 gambar');
      if (!photoRetained) {
        throw new Error('Photo fixture was wiped from form!');
      }

      recordPass('Form inputs and photo fixture preserved; network inspection proved ZERO submissions occurred');
    } catch (err) {
      recordFail('Form preservation check', err);
    }

    // -------------------------------------------------------------------------
    // TEST 13: Zone handling - undefined zoneId retains zone
    // -------------------------------------------------------------------------
    console.log('\n[Test 13] Raw text (undefined zoneId) preserves existing selected zone...');
    try {
      await resetToCleanForm();

      const firstZoneVal = await page.evaluate(() => {
        const select = document.querySelector('#report-zone');
        if (select && select.options.length > 1) {
          select.selectedIndex = 1;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          return select.value;
        }
        return '';
      });

      await page.click('[data-testid="trigger-voice-narrative-button"]');
      await page.waitForSelector('[data-testid="start-voice-record-button"]', { timeout: 5000 });
      await page.click('[data-testid="start-voice-record-button"]');
      await page.waitForSelector('[data-testid="stop-voice-record-button"]', { timeout: 5000 });
      await page.waitForTimeout(100);
      await page.click('[data-testid="stop-voice-record-button"]');

      await page.waitForSelector('[data-testid="use-raw-text-button"]', { timeout: 10000 });
      await page.click('[data-testid="use-raw-text-button"]');
      await page.waitForSelector('[data-testid="voice-narrative-modal"]', { state: 'detached', timeout: 5000 });

      const currentZone = await page.inputValue('#report-zone');
      if (currentZone !== firstZoneVal) {
        throw new Error(`Expected zone ${firstZoneVal} to be preserved, but got: ${currentZone}`);
      }

      recordPass('Raw text with undefined zoneId preserved existing zone selection');
    } catch (err) {
      recordFail('Undefined zoneId preservation check', err);
    }

    // -------------------------------------------------------------------------
    // TEST 14: Zone handling - null zoneId clears zone & requests location review
    // -------------------------------------------------------------------------
    console.log('\n[Test 14] Null zoneId clears existing zone and requests location review...');
    try {
      await resetToCleanForm();

      await page.evaluate(() => {
        const select = document.querySelector('#report-zone');
        if (select && select.options.length > 1) {
          select.selectedIndex = 1;
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });

      await page.evaluate(() => {
        window.__mockVoiceSpy.activeSpeechText = 'Kerosakan am tiada aras tertentu';
      });

      await page.click('[data-testid="trigger-voice-narrative-button"]');
      await page.waitForSelector('[data-testid="start-voice-record-button"]', { timeout: 5000 });
      await page.click('[data-testid="start-voice-record-button"]');
      await page.waitForSelector('[data-testid="stop-voice-record-button"]', { timeout: 5000 });
      await page.waitForTimeout(100);
      await page.click('[data-testid="stop-voice-record-button"]');

      await page.waitForSelector('[data-testid="generate-ai-draft-button"]', { timeout: 10000 });
      await page.click('[data-testid="generate-ai-draft-button"]');

      await page.waitForSelector('[data-testid="apply-ai-draft-button"]', { timeout: 10000 });

      const clearBtn = page.locator('button:has-text("Kosongkan Pilihan Zon")');
      if (await clearBtn.isVisible()) {
        await clearBtn.click();
      }

      await page.click('[data-testid="apply-ai-draft-button"]');
      await page.waitForSelector('[data-testid="voice-narrative-modal"]', { state: 'detached', timeout: 5000 });

      const currentZone = await page.inputValue('#report-zone');
      if (currentZone !== '') {
        throw new Error(`Expected zone to be cleared, but remained: ${currentZone}`);
      }

      const noticeVisible = await page.isVisible('[data-testid="zone-location-notice"]');
      if (!noticeVisible) {
        throw new Error('Location review notice was not shown when zone was cleared');
      }

      recordPass('Null zoneId cleared previous selection and prompted location review');
    } catch (err) {
      recordFail('Null zoneId clearing check', err);
    }

    // -------------------------------------------------------------------------
    // TEST 15: Zone handling - valid zone ID applied from AI draft
    // -------------------------------------------------------------------------
    console.log('\n[Test 15] Valid zone ID suggested by AI draft updates zone field...');
    try {
      await resetToCleanForm();

      await page.evaluate(() => {
        window.__mockVoiceSpy.activeSpeechText = 'Paip air di Tingkat 1 pecah melimpah ke tangga';
      });

      await page.click('[data-testid="trigger-voice-narrative-button"]');
      await page.waitForSelector('[data-testid="start-voice-record-button"]', { timeout: 5000 });
      await page.click('[data-testid="start-voice-record-button"]');
      await page.waitForSelector('[data-testid="stop-voice-record-button"]', { timeout: 5000 });
      await page.waitForTimeout(100);
      await page.click('[data-testid="stop-voice-record-button"]');

      await page.waitForSelector('[data-testid="generate-ai-draft-button"]', { timeout: 10000 });
      await page.click('[data-testid="generate-ai-draft-button"]');

      await page.waitForSelector('[data-testid="apply-ai-draft-button"]', { timeout: 10000 });
      await page.click('[data-testid="apply-ai-draft-button"]');
      await page.waitForSelector('[data-testid="voice-narrative-modal"]', { state: 'detached', timeout: 5000 });

      const currentZone = await page.inputValue('#report-zone');
      if (!currentZone) {
        throw new Error('Valid zone ID was not applied to zone dropdown');
      }

      recordPass('Valid zone ID from AI draft applied successfully to zone select');
    } catch (err) {
      recordFail('Valid zone ID application check', err);
    }

    // -------------------------------------------------------------------------
    // TEST 16: Zone handling - block mismatch clears old zone selection and displays alert
    // -------------------------------------------------------------------------
    console.log('\n[Test 16] Block mismatch clears old zone selection and alerts resident...');
    try {
      await resetToCleanForm();

      await page.evaluate(() => {
        const select = document.querySelector('#report-zone');
        if (select && select.options.length > 1) {
          select.selectedIndex = 1;
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });

      await page.evaluate(() => {
        window.__mockVoiceSpy.activeSpeechText = 'Lif di Blok C rosak teruk pintu tidak boleh tutup';
      });

      await page.click('[data-testid="trigger-voice-narrative-button"]');
      await page.waitForSelector('[data-testid="start-voice-record-button"]', { timeout: 5000 });
      await page.click('[data-testid="start-voice-record-button"]');
      await page.waitForSelector('[data-testid="stop-voice-record-button"]', { timeout: 5000 });
      await page.waitForTimeout(100);
      await page.click('[data-testid="stop-voice-record-button"]');

      await page.waitForSelector('[data-testid="generate-ai-draft-button"]', { timeout: 10000 });
      await page.click('[data-testid="generate-ai-draft-button"]');

      await page.waitForSelector('[data-testid="block-mismatch-alert"]', { timeout: 10000 });

      await page.click('[data-testid="apply-ai-draft-button"]');
      await page.waitForSelector('[data-testid="voice-narrative-modal"]', { state: 'detached', timeout: 5000 });

      const currentZone = await page.inputValue('#report-zone');
      if (currentZone !== '') {
        throw new Error(`Old Blok A zone silently kept after Blok C mismatch! Value: ${currentZone}`);
      }

      const noticeVisible = await page.isVisible('[data-testid="zone-location-notice"]');
      if (!noticeVisible) {
        throw new Error('Location notice not displayed after block mismatch');
      }

      const noticeText = await page.innerText('[data-testid="zone-location-notice"]');
      if (!noticeText.includes('Blok C') && !noticeText.includes('percanggahan blok')) {
        throw new Error(`Notice text does not mention block mismatch: ${noticeText}`);
      }

      recordPass('Block mismatch displayed warning, cleared old zone, and set location review banner');
    } catch (err) {
      recordFail('Block mismatch check', err);
    }

    // -------------------------------------------------------------------------
    // TEST 17: Bilingual UX (BM / EN) - Language toggle preserves form data
    // -------------------------------------------------------------------------
    console.log('\n[Test 17] Bilingual Experience: Language toggle preserves form data & updates UI...');
    try {
      await resetToCleanForm();

      const testDesc = 'Teks ujian pengesahan bahasa dwi-bahasa';
      await page.fill('#report-description', testDesc);

      // Switch language to English (click EN button in LanguageSwitcher)
      const enBtn = page.locator('[role="group"][aria-label*="bahasa"] button:has-text("EN")');
      await enBtn.click();
      await page.waitForTimeout(100);

      // Verify description is PRESERVED after language switch
      const descAfterEn = await page.inputValue('#report-description');
      if (descAfterEn !== testDesc) {
        throw new Error(`Description was cleared when switching language to EN! Value: ${descAfterEn}`);
      }

      // Open Voice Narrative modal and verify English text is rendered
      await page.click('[data-testid="trigger-voice-narrative-button"]');
      await page.waitForSelector('[data-testid="voice-narrative-modal"]', { timeout: 5000 });

      const modalTitleEn = await page.innerText('h2');
      if (!modalTitleEn.includes('Voice Report')) {
        throw new Error(`Modal title not translated to English: ${modalTitleEn}`);
      }

      await page.click('[data-testid="voice-modal-close-button"]');
      await page.waitForSelector('[data-testid="voice-narrative-modal"]', { state: 'detached', timeout: 5000 });

      // Switch back to BM
      const msBtn = page.locator('[role="group"][aria-label*="bahasa"] button:has-text("BM")');
      await msBtn.click();
      await page.waitForTimeout(100);

      // Verify description is STILL preserved
      const descAfterMs = await page.inputValue('#report-description');
      if (descAfterMs !== testDesc) {
        throw new Error(`Description was cleared when switching back to BM! Value: ${descAfterMs}`);
      }

      recordPass('Language toggle (BM/EN) preserved form data and rendered localized modal copy');
    } catch (err) {
      recordFail('Bilingual experience check', err);
    }
  } finally {
    await browser.close();
    if (mockServer) {
      mockServer.close();
    }
  }

  console.log('\n==============================================================================');
  console.log(`FINAL VOICE BROWSER SIMULATION RESULTS: ${passCount}/${testCount} PASSED`);
  console.log('==============================================================================');

  if (passCount !== testCount) {
    process.exit(1);
  }
}

runBrowserVoiceSuite().catch((err) => {
  console.error('\n[FATAL ERROR IN SUITE]', err);
  process.exit(1);
});
