/**
 * PPR NADI — Voice Recording Session Lifecycle & Audio Collection Module
 *
 * This module is the single source of truth for:
 * 1. Audio recording session state and constants.
 * 2. MediaRecorder lifecycle management with single-handler chunk collection.
 * 3. Bounded, safe stopping with real W3C stop/error event awaiting and controlled timeouts.
 * 4. MediaStream track release and hardware resource cleanup.
 *
 * It is directly imported and executed by VoiceNarrativeModal.tsx in production,
 * and directly tested by tests/voice-recording.test.ts without copy-pasted logic.
 */

export const MAX_RECORDING_SECONDS = 60;
export const MAX_RECORDING_BYTES = 5 * 1024 * 1024; // 5 MB
export const RECORDER_STOP_TIMEOUT_MS = 4000; // 4000ms controlled failure timeout

export interface SpeechRecognitionResultItem {
  transcript: string;
}

export interface SpeechRecognitionResultList {
  [index: number]: {
    [index: number]: SpeechRecognitionResultItem;
    isFinal?: boolean;
  };
  length: number;
}

export interface SpeechRecognitionEventLike {
  results: SpeechRecognitionResultList;
}

export interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
}

export interface WindowWithSpeech extends Window {
  SpeechRecognition?: new () => SpeechRecognitionInstance;
  webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
}

export interface RecordingSession {
  id: number;
  stream: MediaStream;
  recorder: MediaRecorder;
  recognition: SpeechRecognitionInstance | null;
  audioChunks: Blob[];
  totalBytes: number;
  speechText: string;
  timer: NodeJS.Timeout | null;
  durationSeconds: number;
  stopping: boolean;
  stopped: boolean;
}

export type VoiceCapabilityReason =
  | 'ok_speech'
  | 'ok_media_recorder_only'
  | 'insecure_context'
  | 'no_get_user_media'
  | 'no_media_recorder'
  | 'permission_denied'
  | 'device_not_found'
  | 'unsupported';

export interface VoiceCapabilitiesResult {
  isSecureContext: boolean;
  hasGetUserMedia: boolean;
  hasMediaRecorder: boolean;
  hasSpeechRecognition: boolean;
  preferredMode: 'speech_recognition' | 'media_recorder' | 'unsupported';
  reason: VoiceCapabilityReason;
}

export function detectVoiceCapabilities(): VoiceCapabilitiesResult {
  if (typeof window === 'undefined') {
    return {
      isSecureContext: false,
      hasGetUserMedia: false,
      hasMediaRecorder: false,
      hasSpeechRecognition: false,
      preferredMode: 'unsupported',
      reason: 'unsupported',
    };
  }

  const isSecure = window.isSecureContext === true;
  const hasGetUserMedia =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function';
  const hasMediaRecorder = typeof MediaRecorder !== 'undefined';
  const win = window as WindowWithSpeech;
  const hasSpeechRecognition = !!(win.SpeechRecognition || win.webkitSpeechRecognition);

  if (!isSecure) {
    return {
      isSecureContext: false,
      hasGetUserMedia,
      hasMediaRecorder,
      hasSpeechRecognition,
      preferredMode: 'unsupported',
      reason: 'insecure_context',
    };
  }

  if (hasSpeechRecognition) {
    return {
      isSecureContext: true,
      hasGetUserMedia,
      hasMediaRecorder,
      hasSpeechRecognition: true,
      preferredMode: 'speech_recognition',
      reason: 'ok_speech',
    };
  }

  if (hasGetUserMedia && hasMediaRecorder) {
    return {
      isSecureContext: true,
      hasGetUserMedia: true,
      hasMediaRecorder: true,
      hasSpeechRecognition: false,
      preferredMode: 'media_recorder',
      reason: 'ok_media_recorder_only',
    };
  }

  return {
    isSecureContext: true,
    hasGetUserMedia,
    hasMediaRecorder,
    hasSpeechRecognition: false,
    preferredMode: 'unsupported',
    reason: !hasGetUserMedia ? 'no_get_user_media' : 'no_media_recorder',
  };
}

export function getCapabilityMessage(
  reason: VoiceCapabilityReason,
  locale: 'ms' | 'en' = 'ms'
): string {
  switch (reason) {
    case 'insecure_context':
      return locale === 'ms'
        ? 'Sambungan tidak selamat (HTTPS diperlukan). Sila gunakan alamat HTTPS yang dipercayai untuk mengaktifkan mikrofon.'
        : 'Insecure connection (HTTPS required). Please access via a trusted HTTPS address to enable microphone access.';
    case 'permission_denied':
      return locale === 'ms'
        ? 'Kebenaran mikrofon ditolak. Sila benarkan akses mikrofon dalam tetapan pelayar anda.'
        : 'Microphone permission was denied. Please allow microphone access in your browser settings.';
    case 'device_not_found':
      return locale === 'ms'
        ? 'Tiada peranti mikrofon dikesan pada peranti anda.'
        : 'No microphone device was detected on your device.';
    case 'ok_media_recorder_only':
      return locale === 'ms'
        ? 'Pengecaman pertuturan langsung tidak disokong pelayar ini (Safari/iPhone), tetapi rakaman audio boleh digunakan.'
        : 'Live speech recognition is unavailable in this browser (Safari/iPhone), but direct audio recording is supported.';
    case 'no_get_user_media':
    case 'no_media_recorder':
    case 'unsupported':
    default:
      return locale === 'ms'
        ? 'Rakaman audio tidak disokong oleh pelayar ini. Sila gunakan pilihan taip sendiri.'
        : 'Audio recording is not supported by this browser. Please use manual typing.';
  }
}

export function getExtensionFromMime(mimeType: string): string {
  const lower = (mimeType || '').toLowerCase();
  if (lower.includes('mp4') || lower.includes('m4a') || lower.includes('aac')) return 'mp4';
  if (lower.includes('ogg')) return 'ogg';
  if (lower.includes('wav')) return 'wav';
  if (lower.includes('webm')) return 'webm';
  return 'mp4';
}

export function getSupportedAudioMime(): { mimeType: string; extension: string } {
  if (typeof MediaRecorder === 'undefined') {
    return { mimeType: '', extension: 'mp4' };
  }
  if (typeof MediaRecorder.isTypeSupported !== 'function') {
    // Standard Safari/WebKit behavior when isTypeSupported is absent or not used
    return { mimeType: '', extension: 'mp4' };
  }
  const candidates = [
    { mimeType: 'audio/mp4', extension: 'mp4' },
    { mimeType: 'audio/webm;codecs=opus', extension: 'webm' },
    { mimeType: 'audio/webm', extension: 'webm' },
    { mimeType: 'audio/ogg;codecs=opus', extension: 'ogg' },
    { mimeType: 'audio/wav', extension: 'wav' },
  ];
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c.mimeType)) {
        return c;
      }
    } catch {
      // Continue to next candidate
    }
  }
  return { mimeType: '', extension: 'mp4' };
}

/**
 * Attaches the SINGLE, persistent dataavailable handler to the recorder.
 *
 * CRITICAL ARCHITECTURAL GUARANTEE:
 * Exactly ONE handler receives and accumulates audio chunks throughout the entire session lifecycle,
 * including final chunks emitted upon calling recorder.stop().
 * No second handler may be attached via addEventListener('dataavailable', ...) during stopping.
 */
export function setupSessionRecorderListeners(
  session: Pick<RecordingSession, 'recorder' | 'audioChunks' | 'totalBytes' | 'stopped'>,
  onMaxSizeExceeded?: () => void
): void {
  session.recorder.ondataavailable = (e: BlobEvent) => {
    if (session.stopped) return;
    if (e.data && e.data.size > 0) {
      session.audioChunks.push(e.data);
      session.totalBytes += e.data.size;

      if (session.totalBytes >= MAX_RECORDING_BYTES) {
        onMaxSizeExceeded?.();
      }
    }
  };
}

/**
 * Safely stops MediaRecorder and awaits the real 'stop' event and final audio flush.
 *
 * Guarantees:
 * 1. Only listens for 'stop' and 'error' events (does NOT add a duplicate 'dataavailable' listener).
 * 2. Employs a controlled timeout (default 4000ms). If 'stop' does not arrive, fails safely.
 * 3. Never returns unclosed or partial audio on failure or timeout.
 * 4. Correctly assembles final Blob using actual recorder MIME type.
 */
export async function stopMediaRecorderSafely(
  session: Pick<RecordingSession, 'recorder' | 'audioChunks' | 'stopped'>,
  timeoutMs: number = RECORDER_STOP_TIMEOUT_MS
): Promise<{ success: boolean; blob?: Blob }> {
  const recorder = session.recorder;
  if (!recorder || recorder.state === 'inactive') {
    return { success: false };
  }

  return new Promise<{ success: boolean; blob?: Blob }>((resolve) => {
    let settled = false;

    const onStop = () => {
      if (settled) return;
      settled = true;
      cleanup();
      const actualMime = recorder.mimeType || 'audio/webm';
      const blob = new Blob(session.audioChunks, { type: actualMime });
      resolve({ success: true, blob });
    };

    const onError = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ success: false });
    };

    const stopTimeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      // Controlled failure: do not send partial or unclosed audio
      resolve({ success: false });
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(stopTimeout);
      recorder.removeEventListener('stop', onStop);
      recorder.removeEventListener('error', onError);
    };

    recorder.addEventListener('stop', onStop);
    recorder.addEventListener('error', onError);

    try {
      recorder.stop();
    } catch {
      if (!settled) {
        settled = true;
        cleanup();
        resolve({ success: false });
      }
    }
  });
}

/**
 * Stops all media tracks belonging to a session's stream and marks the session stopped.
 */
export function stopSessionMediaTracks(
  session: Pick<RecordingSession, 'stream' | 'stopped'>
): void {
  if (session.stream) {
    session.stream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        // Ignore
      }
    });
  }
  session.stopped = true;
}

/**
 * Completely terminates hardware resources (timer, recognizer, recorder, tracks)
 * belonging to a specific recording session.
 */
export function stopSessionHardware(session: RecordingSession): void {
  session.stopped = true;
  if (session.timer) {
    clearInterval(session.timer);
    session.timer = null;
  }
  if (session.recognition) {
    try {
      session.recognition.abort();
    } catch {
      // Ignore
    }
    session.recognition = null;
  }
  if (session.recorder && session.recorder.state !== 'inactive') {
    try {
      session.recorder.stop();
    } catch {
      // Ignore
    }
  }
  stopSessionMediaTracks(session);
}
