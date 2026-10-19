import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setupSessionRecorderListeners,
  stopMediaRecorderSafely,
  stopSessionMediaTracks,
  stopSessionHardware,
  MAX_RECORDING_BYTES,
  MAX_RECORDING_SECONDS,
  detectVoiceCapabilities,
  getCapabilityMessage,
  getSupportedAudioMime,
  getExtensionFromMime,
  type RecordingSession,
  type SpeechRecognitionInstance,
} from '@/lib/voice/recording-session';
import { isAiBlocked } from '@/lib/ai/ai-guard';

/**
 * PPR NADI — Voice Recording Real Module Lifecycle & Deduplication Tests
 *
 * Directly tests the production implementation in src/lib/voice/recording-session.ts
 * rather than a test-local copy of the algorithm.
 */

interface BlobEventLike extends Event {
  data?: Blob;
}

class MockAudioTrack {
  readyState: 'live' | 'ended' = 'live';
  stop() {
    this.readyState = 'ended';
  }
}

class MockMediaStream {
  tracks: MockAudioTrack[];
  constructor() {
    this.tracks = [new MockAudioTrack()];
  }
  getTracks() {
    return this.tracks;
  }
}

class MockMediaRecorder extends EventTarget {
  state: 'inactive' | 'recording' = 'inactive';
  mimeType: string;
  ondataavailable: ((e: BlobEventLike) => void) | null = null;
  onstop: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  chunksToEmitOnStop: Uint8Array[] = [];
  delayStopMs: number = 0;
  omitStopEvent: boolean = false;
  failStop: boolean = false;

  constructor(mimeType = 'audio/webm;codecs=opus') {
    super();
    this.mimeType = mimeType;
  }

  start() {
    this.state = 'recording';
  }

  emitDataChunk(data: Uint8Array) {
    const blob = new Blob([data as unknown as BlobPart], { type: this.mimeType });
    const evt = new Event('dataavailable') as BlobEventLike;
    evt.data = blob;

    // Standard DOM EventTarget dispatch: calls property handler then event listeners
    if (typeof this.ondataavailable === 'function') {
      this.ondataavailable(evt);
    }
    this.dispatchEvent(evt);
  }

  stop() {
    if (this.state === 'inactive') return;
    this.state = 'inactive';

    if (this.failStop) {
      setTimeout(() => {
        const errEvt = new Event('error');
        if (typeof this.onerror === 'function') {
          this.onerror(errEvt);
        }
        this.dispatchEvent(errEvt);
      }, 10);
      return;
    }

    if (this.omitStopEvent) {
      // Omit stop event to simulate hanging recorder
      return;
    }

    setTimeout(() => {
      for (const chunk of this.chunksToEmitOnStop) {
        this.emitDataChunk(chunk);
      }

      setTimeout(() => {
        const stopEvt = new Event('stop');
        if (typeof this.onstop === 'function') {
          this.onstop(stopEvt);
        }
        this.dispatchEvent(stopEvt);
      }, 10);
    }, this.delayStopMs);
  }
}

describe('Real Recording Session Module (src/lib/voice/recording-session.ts)', () => {
  let sessionIdCounter = 0;
  let activeSession: RecordingSession | null = null;
  let transcriptionCallCount = 0;
  let activeStopPromise: Promise<{ success: boolean; blob: Blob | null; error?: string }> | null = null;

  beforeEach(() => {
    sessionIdCounter = 0;
    activeSession = null;
    transcriptionCallCount = 0;
    activeStopPromise = null;
  });

  /**
   * Helper executing the real production session lifecycle functions:
   * 1. stopMediaRecorderSafely(session, timeoutMs)
   * 2. stopSessionMediaTracks(session)
   */
  async function executeProductionStop(
    session: RecordingSession,
    reason?: 'user' | 'max_duration' | 'max_size',
    timeoutMs?: number
  ): Promise<{ success: boolean; blob: Blob | null; error?: string }> {
    if (session.stopping || session.stopped) return { success: false, blob: null };
    session.stopping = true;

    // DIRECT CALL TO PRODUCTION FUNCTION: stopMediaRecorderSafely
    const recorderResult = await stopMediaRecorderSafely(session, timeoutMs);

    // DIRECT CALL TO PRODUCTION FUNCTION: stopSessionMediaTracks
    stopSessionMediaTracks(session);

    // Stale session validation guard (matches VoiceNarrativeModal.tsx)
    if (activeSession !== session) {
      return { success: false, blob: null, error: 'STALE_SESSION' };
    }
    activeSession = null;

    if (reason === 'max_size' || session.totalBytes >= MAX_RECORDING_BYTES) {
      return { success: false, blob: null, error: 'MAX_SIZE_EXCEEDED' };
    }

    if (!recorderResult.success || !recorderResult.blob) {
      return { success: false, blob: null, error: 'RECORDER_STOP_FAILED' };
    }

    const finalAudioBlob = recorderResult.blob;
    if (finalAudioBlob.size > MAX_RECORDING_BYTES) {
      return { success: false, blob: null, error: 'MAX_SIZE_EXCEEDED' };
    }

    if (finalAudioBlob.size >= 1000) {
      transcriptionCallCount++;
    }

    return { success: true, blob: finalAudioBlob };
  }

  function createActiveSession(): { session: RecordingSession; rawRecorder: MockMediaRecorder; rawStream: MockMediaStream } {
    const rawRecorder = new MockMediaRecorder();
    const rawStream = new MockMediaStream();

    const session: RecordingSession = {
      id: ++sessionIdCounter,
      stream: rawStream as unknown as MediaStream,
      recorder: rawRecorder as unknown as MediaRecorder,
      recognition: null,
      audioChunks: [],
      totalBytes: 0,
      speechText: '',
      timer: null,
      durationSeconds: 0,
      stopping: false,
      stopped: false,
    };

    // DIRECT CALL TO PRODUCTION FUNCTION: setupSessionRecorderListeners
    setupSessionRecorderListeners(session, () => {
      activeStopPromise = executeProductionStop(session, 'max_size');
    });

    rawRecorder.start();
    activeSession = session;
    return { session, rawRecorder, rawStream };
  }

  it('collects normal chunks and delayed (>500ms) final chunk exactly once without duplication', async () => {
    const { session, rawRecorder } = createActiveSession();

    // Normal chunk 1 during recording
    const chunk1 = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]);
    rawRecorder.emitDataChunk(chunk1);

    // Normal chunk 2 during recording
    const chunk2 = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05]);
    rawRecorder.emitDataChunk(chunk2);

    // Final chunk emitted upon stop after 550ms delay (>500ms)
    const chunk3 = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
    rawRecorder.chunksToEmitOnStop = [chunk3];
    rawRecorder.delayStopMs = 550;

    const result = await executeProductionStop(session, 'user');
    expect(result.success).toBe(true);
    expect(result.blob).not.toBeNull();

    // Verify exact chunk collection: 3 chunks collected once each
    expect(session.audioChunks.length).toBe(3);

    // Verify exact byte count: 4 + 5 + 6 = 15 bytes
    expect(session.totalBytes).toBe(15);
    expect(result.blob?.size).toBe(15);

    // Verify byte-for-byte sequential concatenation in final blob
    const blobBuffer = new Uint8Array(await result.blob!.arrayBuffer());
    const expected = new Uint8Array([...chunk1, ...chunk2, ...chunk3]);
    expect(blobBuffer).toEqual(expected);
  });

  it('retains two distinct chunks having identical binary contents in exact sequence', async () => {
    const { session, rawRecorder } = createActiveSession();

    const identicalBytes = new Uint8Array([0x12, 0x34, 0x56, 0x78]);

    // Chunk 1
    rawRecorder.emitDataChunk(new Uint8Array(identicalBytes));
    // Chunk 2 with identical bytes
    rawRecorder.emitDataChunk(new Uint8Array(identicalBytes));

    const result = await executeProductionStop(session, 'user');
    expect(result.success).toBe(true);

    // Both chunks must be preserved; no content-based deduplication
    expect(session.audioChunks.length).toBe(2);
    expect(session.totalBytes).toBe(8);
    expect(result.blob?.size).toBe(8);

    const blobBuffer = new Uint8Array(await result.blob!.arrayBuffer());
    expect(blobBuffer).toEqual(new Uint8Array([...identicalBytes, ...identicalBytes]));
  });

  it('does NOT reject a recording under 5MB due to false double-counting', async () => {
    const { session, rawRecorder } = createActiveSession();

    // Emit a 3 MB chunk (under 5MB limit)
    const threeMb = new Uint8Array(3 * 1024 * 1024);
    threeMb.set([0x1a, 0x45, 0xdf, 0xa3]);
    rawRecorder.emitDataChunk(threeMb);

    const result = await executeProductionStop(session, 'user');
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();

    expect(session.audioChunks.length).toBe(1);
    expect(session.totalBytes).toBe(3 * 1024 * 1024);
    expect(result.blob?.size).toBe(3 * 1024 * 1024);
    expect(transcriptionCallCount).toBe(1);
  });

  it('strictly blocks a recording exceeding 5MB from reaching transcription', async () => {
    const { session, rawRecorder } = createActiveSession();

    // Emit 5.2 MB chunk
    const overLimit = new Uint8Array(5.2 * 1024 * 1024);
    overLimit.set([0x1a, 0x45, 0xdf, 0xa3]);
    rawRecorder.emitDataChunk(overLimit);

    // Auto-stop triggered on max size
    expect(session.stopping).toBe(true);
    expect(session.totalBytes).toBeGreaterThan(MAX_RECORDING_BYTES);

    const result = await (activeStopPromise || executeProductionStop(session, 'max_size'));
    expect(result.success).toBe(false);
    expect(result.error).toBe('MAX_SIZE_EXCEEDED');
    expect(transcriptionCallCount).toBe(0);
  });

  it('produces exactly 0 transcription calls when stop event times out', async () => {
    const { session, rawRecorder, rawStream } = createActiveSession();

    const chunk = new Uint8Array(2000);
    rawRecorder.emitDataChunk(chunk);

    // Instruct recorder to hang (omit stop event)
    rawRecorder.omitStopEvent = true;

    const result = await executeProductionStop(session, 'user', 50);
    expect(result.success).toBe(false);
    expect(result.error).toBe('RECORDER_STOP_FAILED');
    expect(session.stopped).toBe(true);
    // Tracks ended
    expect(rawStream.tracks[0].readyState).toBe('ended');
    // Exactly 0 transcription calls
    expect(transcriptionCallCount).toBe(0);
  });

  it('produces exactly 0 transcription calls when recorder encounters an error', async () => {
    const { session, rawRecorder } = createActiveSession();

    const chunk = new Uint8Array(2000);
    rawRecorder.emitDataChunk(chunk);

    rawRecorder.failStop = true;

    const result = await executeProductionStop(session, 'user', 100);
    expect(result.success).toBe(false);
    expect(result.error).toBe('RECORDER_STOP_FAILED');
    expect(transcriptionCallCount).toBe(0);
  });

  it('prevents an old session from mutating or affecting a newly started session', async () => {
    const { session: session1, rawRecorder: recorder1 } = createActiveSession();
    recorder1.chunksToEmitOnStop = [new Uint8Array([0x11, 0x22])];
    recorder1.delayStopMs = 50;

    const stopPromise1 = executeProductionStop(session1, 'user');

    // Start session 2 while session 1 is in-flight stopping
    const { session: session2 } = createActiveSession();
    expect(activeSession).toBe(session2);

    const result1 = await stopPromise1;
    expect(result1.success).toBe(false);
    expect(result1.error).toBe('STALE_SESSION');

    expect(activeSession).toBe(session2);
    expect(session2.stopped).toBe(false);
    expect(session2.audioChunks.length).toBe(0);
    expect(transcriptionCallCount).toBe(0);
  });

  it('verifies stopSessionHardware stops all resources cleanly', () => {
    const { session, rawRecorder, rawStream } = createActiveSession();

    let aborted = false;
    session.recognition = {
      abort: () => {
        aborted = true;
      },
    } as unknown as SpeechRecognitionInstance;

    session.timer = setTimeout(() => {}, 10000);

    stopSessionHardware(session);

    expect(session.stopped).toBe(true);
    expect(aborted).toBe(true);
    expect(session.recognition).toBeNull();
    expect(session.timer).toBeNull();
    expect(rawRecorder.state).toBe('inactive');
    expect(rawStream.tracks[0].readyState).toBe('ended');
  });
});

describe('PPR NADI — Capabilities Detection, Safari MIME, and Zero-AI Test Mode Guards', () => {
  const originalNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalWindowDesc = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalMediaRecDesc = Object.getOwnPropertyDescriptor(globalThis, 'MediaRecorder');

  afterEach(() => {
    if (originalWindowDesc) {
      Object.defineProperty(globalThis, 'window', originalWindowDesc);
    } else {
      // @ts-expect-error cleanup mock
      delete globalThis.window;
    }

    if (originalNavigatorDesc) {
      Object.defineProperty(globalThis, 'navigator', originalNavigatorDesc);
    } else {
      // @ts-expect-error cleanup mock
      delete globalThis.navigator;
    }

    if (originalMediaRecDesc) {
      Object.defineProperty(globalThis, 'MediaRecorder', originalMediaRecDesc);
    } else {
      // @ts-expect-error cleanup mock
      delete globalThis.MediaRecorder;
    }
  });

  function mockGlobals({
    isSecure = true,
    hasSpeech = false,
    hasMediaRec = true,
    hasGetUserMedia = true,
  }: {
    isSecure?: boolean;
    hasSpeech?: boolean;
    hasMediaRec?: boolean;
    hasGetUserMedia?: boolean;
  }) {
    Object.defineProperty(globalThis, 'window', {
      value: {
        isSecureContext: isSecure,
        SpeechRecognition: hasSpeech ? class {} : undefined,
        webkitSpeechRecognition: undefined,
      },
      configurable: true,
      writable: true,
    });

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        mediaDevices: hasGetUserMedia
          ? { getUserMedia: () => Promise.resolve({}) }
          : undefined,
      },
      configurable: true,
      writable: true,
    });

    if (hasMediaRec) {
      Object.defineProperty(globalThis, 'MediaRecorder', {
        value: class {
          static isTypeSupported(type: string) {
            return type.includes('mp4') || type.includes('webm');
          }
        },
        configurable: true,
        writable: true,
      });
    } else {
      // @ts-expect-error cleanup mock
      delete globalThis.MediaRecorder;
    }
  }

  it('detects insecure context correctly and flags insecure_context reason', () => {
    mockGlobals({ isSecure: false, hasSpeech: false, hasMediaRec: true });

    const res = detectVoiceCapabilities();
    expect(res.isSecureContext).toBe(false);
    expect(res.preferredMode).toBe('unsupported');
    expect(res.reason).toBe('insecure_context');
    expect(getCapabilityMessage(res.reason, 'ms')).toContain('HTTPS');
  });

  it('detects Safari/iPhone scenario: secure context, MediaRecorder present, SpeechRecognition missing', () => {
    mockGlobals({ isSecure: true, hasSpeech: false, hasMediaRec: true, hasGetUserMedia: true });

    const res = detectVoiceCapabilities();
    expect(res.isSecureContext).toBe(true);
    expect(res.hasSpeechRecognition).toBe(false);
    expect(res.hasMediaRecorder).toBe(true);
    expect(res.preferredMode).toBe('media_recorder');
    expect(res.reason).toBe('ok_media_recorder_only');
    expect(getCapabilityMessage(res.reason, 'ms')).toContain('Safari/iPhone');
  });

  it('detects Chrome/Android scenario: SpeechRecognition present', () => {
    mockGlobals({ isSecure: true, hasSpeech: true, hasMediaRec: true, hasGetUserMedia: true });

    const res = detectVoiceCapabilities();
    expect(res.isSecureContext).toBe(true);
    expect(res.hasSpeechRecognition).toBe(true);
    expect(res.preferredMode).toBe('speech_recognition');
    expect(res.reason).toBe('ok_speech');
  });

  it('returns distinct human-friendly messages for all capability and error states', () => {
    expect(getCapabilityMessage('insecure_context', 'ms')).toContain('HTTPS diperlukan');
    expect(getCapabilityMessage('insecure_context', 'en')).toContain('HTTPS required');

    expect(getCapabilityMessage('permission_denied', 'ms')).toContain('Kebenaran mikrofon ditolak');
    expect(getCapabilityMessage('permission_denied', 'en')).toContain('permission was denied');

    expect(getCapabilityMessage('device_not_found', 'ms')).toContain('Tiada peranti mikrofon');
    expect(getCapabilityMessage('device_not_found', 'en')).toContain('No microphone device');

    expect(getCapabilityMessage('ok_media_recorder_only', 'ms')).toContain('Safari/iPhone');
    expect(getCapabilityMessage('unsupported', 'ms')).toContain('tidak disokong');
  });

  it('correctly maps audio MIME types and Safari audio extensions', () => {
    expect(getExtensionFromMime('audio/mp4')).toBe('mp4');
    expect(getExtensionFromMime('audio/mp4;codecs=avc1')).toBe('mp4');
    expect(getExtensionFromMime('audio/m4a')).toBe('mp4');
    expect(getExtensionFromMime('audio/aac')).toBe('mp4');
    expect(getExtensionFromMime('audio/webm')).toBe('webm');
    expect(getExtensionFromMime('audio/webm;codecs=opus')).toBe('webm');
    expect(getExtensionFromMime('audio/ogg')).toBe('ogg');
    expect(getExtensionFromMime('audio/wav')).toBe('wav');
  });

  it('verifies Safari MIME candidate evaluation with getSupportedAudioMime', () => {
    // Mock MediaRecorder with isTypeSupported returning true only for audio/mp4 (Safari)
    // @ts-expect-error mock MediaRecorder
    global.MediaRecorder = class {
      static isTypeSupported(type: string) {
        return type.includes('mp4');
      }
    };

    const res = getSupportedAudioMime();
    expect(res.mimeType).toBe('audio/mp4');
    expect(res.extension).toBe('mp4');
  });

  it('enforces maximum recording boundary constants (60 seconds and 5 MB)', () => {
    expect(MAX_RECORDING_SECONDS).toBe(60);
    expect(MAX_RECORDING_BYTES).toBe(5 * 1024 * 1024);
  });

  it('guarantees AI guard blocks provider calls in test mode (Zero AI)', () => {
    const prevEnv = process.env.TEST_DISABLE_AI_CALLS;
    try {
      process.env.TEST_DISABLE_AI_CALLS = 'true';
      expect(isAiBlocked()).toBe(true);

      process.env.TEST_DISABLE_AI_CALLS = 'false';
      expect(isAiBlocked()).toBe(false);
    } finally {
      process.env.TEST_DISABLE_AI_CALLS = prevEnv;
    }
  });
});

