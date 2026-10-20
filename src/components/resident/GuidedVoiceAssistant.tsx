'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Mic,
  Square,
  Volume2,
  VolumeX,
  X,
  AlertCircle,
  Loader2,
  RotateCcw,
  ArrowRight,
  FileAudio,
} from 'lucide-react';
import { useTranslation } from '@/lib/i18n/LanguageContext';
import {
  generateReportDraftAction,
  type ReportDraftResult,
} from '@/app/actions/ai-draft';

import {
  type SpeechRecognitionInstance,
  type SpeechRecognitionEventLike,
  type WindowWithSpeech,
  type RecordingSession,
  detectVoiceCapabilities,
  getCapabilityMessage,
  getSupportedAudioMime,
  getExtensionFromMime,
  setupSessionRecorderListeners,
  stopMediaRecorderSafely,
  stopSessionMediaTracks,
  stopSessionHardware,
  MAX_RECORDING_SECONDS,
} from '@/lib/voice/recording-session';

interface GuidedVoiceAssistantProps {
  isOpen: boolean;
  onClose: () => void;
  onDraftReady: (
    draft: NonNullable<ReportDraftResult['draft']>,
    rawText: string,
    metrics: { transcriptionMs?: number; draftMs?: number; correctionMs?: number }
  ) => void;
  onSwitchToManual: (currentTranscript?: string) => void;
  assignedBuildingName?: string;
}

type TurnState =
  | 'greeting'
  | 'processing_initial'
  | 'followup_floor'
  | 'processing_floor'
  | 'announcing_ready';

type AssistantMode = 'speech_recognition' | 'media_recorder';
type MediaRecorderState = 'ready' | 'requesting' | 'recording' | 'stopping' | 'recorded';

export function GuidedVoiceAssistant({
  isOpen,
  onClose,
  onDraftReady,
  onSwitchToManual,
}: GuidedVoiceAssistantProps) {
  const { t, locale } = useTranslation();

  // Mode & Capabilities (Computed purely from window / environment)
  const capabilities = useMemo(() => {
    return typeof window !== 'undefined' ? detectVoiceCapabilities() : null;
  }, []);

  const [selectedMode, setSelectedMode] = useState<AssistantMode | null>(null);
  const assistantMode: AssistantMode =
    selectedMode ?? (capabilities?.preferredMode === 'media_recorder' ? 'media_recorder' : 'speech_recognition');

  // Turn-based speech state
  const [turn, setTurn] = useState<TurnState>('greeting');
  const [isListening, setIsListening] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  // Partial draft accumulator
  const [currentDraft, setCurrentDraft] = useState<ReportDraftResult['draft'] | null>(null);
  const [fullRawText, setFullRawText] = useState('');

  // Performance metrics tracking
  const [transcriptionMs, setTranscriptionMs] = useState(0);
  const [draftMs, setDraftMs] = useState(0);

  // Alternative MediaRecorder State (Phase: Record & Playback only, Zero AI)
  const [mediaRecorderState, setMediaRecorderState] = useState<MediaRecorderState>('ready');
  const [mediaSecondsElapsed, setMediaSecondsElapsed] = useState(0);
  const [mediaRecordedBytes, setMediaRecordedBytes] = useState(0);
  const [recordedAudioUrl, setRecordedAudioUrl] = useState<string | null>(null);
  const [recordedMimeType, setRecordedMimeType] = useState<string>('audio/mp4');
  const [mediaNotice, setMediaNotice] = useState<string | null>(null);

  // Lifecycle & Concurrency Guards
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const speechStartTimeRef = useRef<number>(0);
  const transcriptRef = useRef<string>('');
  const sessionIdRef = useRef<number>(0);
  const isProcessingRef = useRef<boolean>(false);
  const activeListeningTurnRef = useRef<'initial' | 'floor' | null>(null);

  // MediaRecorder Refs
  const mediaSessionRef = useRef<RecordingSession | null>(null);
  const permissionRequestIdRef = useRef<number>(0);
  const mediaTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isOpenRef = useRef<boolean>(isOpen);

  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  // Browser TTS Helper (Web Speech API)
  const speakText = useCallback(
    (text: string) => {
      if (isMuted || typeof window === 'undefined' || !window.speechSynthesis) return;
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = locale === 'ms' ? 'ms-MY' : 'en-US';
        utterance.rate = 0.95; // Friendly and accessible for elderly
        window.speechSynthesis.speak(utterance);
      } catch {
        // Ignore synthesis errors
      }
    },
    [isMuted, locale]
  );

  // Clean stop of microphone for speech recognition
  const stopListening = useCallback((): Promise<string> => {
    return new Promise((resolve) => {
      const recognition = recognitionRef.current;
      if (recognition) {
        try {
          recognition.stop();
        } catch {}
      }
      setIsListening(false);
      activeListeningTurnRef.current = null;
      setTimeout(() => {
        resolve(transcriptRef.current.trim());
      }, 80);
    });
  }, []);

  // Cleanup MediaRecorder state & object URL safely
  const cleanupMediaRecording = useCallback(() => {
    if (mediaTimerRef.current) {
      clearInterval(mediaTimerRef.current);
      mediaTimerRef.current = null;
    }
    if (mediaSessionRef.current) {
      stopSessionHardware(mediaSessionRef.current);
      mediaSessionRef.current = null;
    }
    if (recordedAudioUrl) {
      try {
        URL.revokeObjectURL(recordedAudioUrl);
      } catch {}
      setRecordedAudioUrl(null);
    }
    setMediaSecondsElapsed(0);
    setMediaRecordedBytes(0);
    setMediaRecorderState('ready');
    setMediaNotice(null);
  }, [recordedAudioUrl]);

  // Cleanup on unmount or close
  const handleClose = useCallback(() => {
    sessionIdRef.current = 0; // Invalidate current session
    permissionRequestIdRef.current = 0;
    isProcessingRef.current = false;
    stopListening();
    cleanupMediaRecording();

    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setTurn('greeting');
    setIsListening(false);
    setTranscript('');
    transcriptRef.current = '';
    setErrorMessage(null);
    setRetryCount(0);
    setCurrentDraft(null);
    setFullRawText('');
    setTranscriptionMs(0);
    setDraftMs(0);
    onClose();
  }, [stopListening, cleanupMediaRecording, onClose]);

  // Greeting trigger when modal opens
  useEffect(() => {
    if (!isOpen) return;

    const thisSessionId = Date.now();
    sessionIdRef.current = thisSessionId;
    isProcessingRef.current = false;
    transcriptRef.current = '';

    // Only speak greeting in speech recognition mode if secure
    if (capabilities?.preferredMode === 'speech_recognition' && capabilities.isSecureContext) {
      const greetingText = t.reportForm.assistantGreeting;
      const timer = setTimeout(() => {
        if (sessionIdRef.current === thisSessionId) {
          speakText(greetingText);
        }
      }, 50);

      return () => clearTimeout(timer);
    }
  }, [isOpen, capabilities, speakText, t.reportForm.assistantGreeting]);

  // Listen for visibility / backgrounding on mobile (e.g. iPhone switching apps or phone call)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        // Stop speech recognition if listening
        if (recognitionRef.current) {
          try {
            recognitionRef.current.abort();
          } catch {}
          recognitionRef.current = null;
          setIsListening(false);
        }
        // Stop media recorder if recording
        if (mediaSessionRef.current && mediaSessionRef.current.recorder.state === 'recording') {
          if (mediaTimerRef.current) {
            clearInterval(mediaTimerRef.current);
            mediaTimerRef.current = null;
          }
          stopSessionHardware(mediaSessionRef.current);
          mediaSessionRef.current = null;
          setMediaRecorderState('ready');
          setMediaNotice(
            locale === 'ms'
              ? 'Rakaman dihentikan kerana pelayar dipindahkan ke latar belakang.'
              : 'Recording stopped because the browser was moved to background.'
          );
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [locale]);

  // =========================================================================
  // ALTERNATIVE AUDIO RECORDING FLOW (MediaRecorder - Zero AI, Record + Playback)
  // =========================================================================

  const stopAlternativeRecording = useCallback(
    async (triggerReason: 'user' | 'max_time' | 'max_size' = 'user') => {
      const session = mediaSessionRef.current;
      if (!session || session.stopping || session.stopped) return;
      session.stopping = true;
      setMediaRecorderState('stopping');

      if (mediaTimerRef.current) {
        clearInterval(mediaTimerRef.current);
        mediaTimerRef.current = null;
      }

      const res = await stopMediaRecorderSafely(session);
      stopSessionMediaTracks(session);

      if (!res.success || !res.blob || res.blob.size === 0) {
        setErrorMessage(
          locale === 'ms'
            ? 'Rakaman audio kosong atau gagal diproses. Sila cuba rakam sekali lagi.'
            : 'Audio recording is empty or failed to process. Please record again.'
        );
        setMediaRecorderState('ready');
        mediaSessionRef.current = null;
        return;
      }

      // Check empty audio boundary
      if (session.durationSeconds === 0 && res.blob.size < 200) {
        setErrorMessage(
          locale === 'ms'
            ? 'Rakaman terlalu singkat. Sila bercakap sekurang-kurangnya 2 saat.'
            : 'Recording too short. Please speak for at least 2 seconds.'
        );
        setMediaRecorderState('ready');
        mediaSessionRef.current = null;
        return;
      }

      const mime = res.blob.type || session.recorder.mimeType || 'audio/mp4';
      const audioUrl = URL.createObjectURL(res.blob);

      setRecordedAudioUrl(audioUrl);
      setRecordedMimeType(mime);
      setMediaRecordedBytes(res.blob.size);
      setMediaRecorderState('recorded');
      mediaSessionRef.current = null;

      if (triggerReason === 'max_time') {
        setMediaNotice(
          locale === 'ms'
            ? `Had masa maksimum ${MAX_RECORDING_SECONDS} saat dicapai. Rakaman disimpan untuk semakan.`
            : `Maximum ${MAX_RECORDING_SECONDS}s limit reached. Recording saved for review.`
        );
      } else if (triggerReason === 'max_size') {
        setMediaNotice(
          locale === 'ms'
            ? 'Had saiz maksimum 5MB dicapai. Rakaman disimpan untuk semakan.'
            : 'Maximum 5MB size limit reached. Recording saved for review.'
        );
      } else {
        setMediaNotice(null);
      }
    },
    [locale]
  );

  const startAlternativeRecording = useCallback(async () => {
    setErrorMessage(null);
    setMediaNotice(null);

    // Context check
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      setErrorMessage(getCapabilityMessage('insecure_context', locale));
      return;
    }

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      setErrorMessage(getCapabilityMessage('no_get_user_media', locale));
      return;
    }

    // Stop any speech synthesis utterance so NADI instruction voice is NOT recorded
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    // Revoke previous audio URL if any
    if (recordedAudioUrl) {
      try {
        URL.revokeObjectURL(recordedAudioUrl);
      } catch {}
      setRecordedAudioUrl(null);
    }

    const currentReqId = ++permissionRequestIdRef.current;
    setMediaRecorderState('requesting');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // Verify modal is still open and request is not stale
      if (!isOpenRef.current || permissionRequestIdRef.current !== currentReqId) {
        stream.getTracks().forEach((tr) => tr.stop());
        return;
      }

      const { mimeType } = getSupportedAudioMime();
      let recorder: MediaRecorder;
      try {
        recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      } catch {
        // Fallback to default options if requested mime fails
        recorder = new MediaRecorder(stream);
      }

      const session: RecordingSession = {
        id: Date.now(),
        stream,
        recorder,
        recognition: null,
        audioChunks: [],
        totalBytes: 0,
        speechText: '',
        timer: null,
        durationSeconds: 0,
        stopping: false,
        stopped: false,
      };

      mediaSessionRef.current = session;
      setMediaSecondsElapsed(0);
      setMediaRecordedBytes(0);

      setupSessionRecorderListeners(session, () => {
        // 5MB max size reached callback
        stopAlternativeRecording('max_size');
      });

      // Start recording with 250ms chunk emission
      recorder.start(250);
      setMediaRecorderState('recording');

      // 1-second interval timer
      const startTime = Date.now();
      mediaTimerRef.current = setInterval(() => {
        const elapsedSecs = Math.floor((Date.now() - startTime) / 1000);
        setMediaSecondsElapsed(elapsedSecs);
        if (session) {
          session.durationSeconds = elapsedSecs;
        }

        if (elapsedSecs >= MAX_RECORDING_SECONDS) {
          stopAlternativeRecording('max_time');
        }
      }, 1000);
    } catch (err: unknown) {
      if (!isOpenRef.current || permissionRequestIdRef.current !== currentReqId) return;

      const errorName = (err as { name?: string })?.name || '';
      if (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError') {
        setErrorMessage(getCapabilityMessage('permission_denied', locale));
      } else if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') {
        setErrorMessage(getCapabilityMessage('device_not_found', locale));
      } else {
        setErrorMessage(
          locale === 'ms'
            ? 'Gagal memulakan mikrofon. Sila pastikan kebenaran diberikan atau gunakan taip sendiri.'
            : 'Failed to access microphone. Please ensure permission is granted or use manual typing.'
        );
      }
      setMediaRecorderState('ready');
    }
  }, [locale, recordedAudioUrl, stopAlternativeRecording]);

  const handleReRecord = useCallback(() => {
    if (recordedAudioUrl) {
      try {
        URL.revokeObjectURL(recordedAudioUrl);
      } catch {}
      setRecordedAudioUrl(null);
    }
    setMediaSecondsElapsed(0);
    setMediaRecordedBytes(0);
    setMediaNotice(null);
    setErrorMessage(null);
    setMediaRecorderState('ready');
  }, [recordedAudioUrl]);

  // =========================================================================
  // SPEECH RECOGNITION FLOW (Standard Turn-Based Assistant)
  // =========================================================================

  const startListening = useCallback(
    (targetTurn: 'initial' | 'floor') => {
      setErrorMessage(null);
      transcriptRef.current = '';
      setTranscript('');

      if (typeof window === 'undefined') return;

      if (!window.isSecureContext) {
        setErrorMessage(getCapabilityMessage('insecure_context', locale));
        return;
      }

      const win = window as WindowWithSpeech;
      const SpeechRecognitionClass = win.SpeechRecognition || win.webkitSpeechRecognition;

      if (!SpeechRecognitionClass) {
        // Fallback directly to alternative recording
        setSelectedMode('media_recorder');
        setMediaNotice(getCapabilityMessage('ok_media_recorder_only', locale));
        return;
      }

      try {
        if (window.speechSynthesis) {
          window.speechSynthesis.cancel();
        }

        const recognition = new SpeechRecognitionClass();
        recognition.lang = locale === 'ms' ? 'ms-MY' : 'en-US';
        recognition.continuous = false;
        recognition.interimResults = true;
        recognitionRef.current = recognition;
        activeListeningTurnRef.current = targetTurn;

        speechStartTimeRef.current = Date.now();
        setIsListening(true);

        recognition.onresult = (event: SpeechRecognitionEventLike) => {
          let currentTranscript = '';
          for (let i = 0; i < event.results.length; i++) {
            currentTranscript += event.results[i][0]?.transcript || '';
          }
          transcriptRef.current = currentTranscript;
          setTranscript(currentTranscript);
        };

        recognition.onerror = (event: unknown) => {
          const errCode = (event as { error?: string })?.error;
          if (errCode === 'not-allowed') {
            setErrorMessage(getCapabilityMessage('permission_denied', locale));
          } else if (errCode !== 'no-speech') {
            setErrorMessage(
              locale === 'ms'
                ? 'Ralat mikrofon dikesan. Anda boleh cuba mod rakaman audio atau taip sendiri.'
                : 'Microphone error detected. You can try audio recording mode or manual typing.'
            );
          }
          setIsListening(false);
          recognitionRef.current = null;
        };

        recognition.onend = () => {
          const duration = Date.now() - speechStartTimeRef.current;
          setTranscriptionMs((prev) => prev + duration);
          setIsListening(false);
          recognitionRef.current = null;
        };

        recognition.start();
      } catch {
        setErrorMessage(getCapabilityMessage('permission_denied', locale));
        setIsListening(false);
      }
    },
    [locale]
  );

  // Process turn 1 transcript
  const processInitialTranscript = useCallback(
    async (textToProcess?: string) => {
      if (isProcessingRef.current) return;
      const thisSessionId = sessionIdRef.current;
      if (!thisSessionId) return;

      const finalText = (textToProcess ?? transcriptRef.current ?? transcript).trim();

      if (!finalText || finalText.length < 3) {
        const nextRetries = retryCount + 1;
        setRetryCount(nextRetries);
        if (nextRetries >= 2) {
          setErrorMessage(t.reportForm.assistantRetryExceeded);
        } else {
          setErrorMessage(
            locale === 'ms'
              ? 'Suara tidak jelas atau terlalu pendek. Sila tekan butang dan cuba bercakap lagi.'
              : 'Speech was unclear or too short. Please tap the button and try again.'
          );
        }
        return;
      }

      isProcessingRef.current = true;
      setTurn('processing_initial');
      setFullRawText(finalText);
      setErrorMessage(null);

      try {
        const draftStartTime = Date.now();
        const res = await generateReportDraftAction(finalText, { mode: 'initial' });
        const elapsedDraft = Date.now() - draftStartTime;

        if (sessionIdRef.current !== thisSessionId) return;
        setDraftMs(elapsedDraft);

        if (!res.success || !res.draft) {
          const nextRetries = retryCount + 1;
          setRetryCount(nextRetries);
          setErrorMessage(
            res.error ||
              (locale === 'ms'
                ? 'Penyediaan draf tidak berjaya. Sila cuba sekali lagi atau sunting teks.'
                : 'Draft preparation unsuccessful. Please try again or edit text.')
          );
          setTurn('greeting');
          return;
        }

        setCurrentDraft(res.draft);
        const isFloorMissing = res.draft.mentionedFloor === null;

        if (isFloorMissing) {
          setTurn('followup_floor');
          setTranscript('');
          transcriptRef.current = '';
          const promptText = res.draft.clarificationPrompt
            ? locale === 'ms'
              ? res.draft.clarificationPrompt.ms
              : res.draft.clarificationPrompt.en
            : t.reportForm.assistantFollowUpFloor;
          speakText(promptText);
        } else {
          setTurn('announcing_ready');
          const readyText = t.reportForm.assistantDraftReady;
          speakText(readyText);
          setTimeout(() => {
            if (sessionIdRef.current !== thisSessionId) return;
            onDraftReady(res.draft!, finalText, {
              transcriptionMs,
              draftMs: elapsedDraft,
            });
          }, 1000);
        }
      } catch {
        if (sessionIdRef.current !== thisSessionId) return;
        setErrorMessage(
          locale === 'ms'
            ? 'Ralat rangkaian semasa memproses draf. Anda boleh cuba lagi atau taip sendiri.'
            : 'Network error while processing draft. You can try again or type manually.'
        );
        setTurn('greeting');
      } finally {
        isProcessingRef.current = false;
      }
    },
    [
      transcript,
      retryCount,
      locale,
      t.reportForm.assistantRetryExceeded,
      t.reportForm.assistantFollowUpFloor,
      t.reportForm.assistantDraftReady,
      speakText,
      onDraftReady,
      transcriptionMs,
    ]
  );

  const handleStopAndProcessInitial = useCallback(async () => {
    const finalCaptured = await stopListening();
    await processInitialTranscript(finalCaptured);
  }, [stopListening, processInitialTranscript]);

  const processFloorTranscript = useCallback(
    async (textToProcess?: string) => {
      if (isProcessingRef.current) return;
      const thisSessionId = sessionIdRef.current;
      if (!thisSessionId) return;

      const spokenFloor = (textToProcess ?? transcriptRef.current ?? transcript).trim();

      if (!spokenFloor) {
        if (currentDraft) {
          setTurn('announcing_ready');
          onDraftReady(currentDraft, fullRawText, {
            transcriptionMs,
            draftMs,
          });
        }
        return;
      }

      isProcessingRef.current = true;
      setTurn('processing_floor');
      const combinedText = `${fullRawText}. Tingkat: ${spokenFloor}`;
      setFullRawText(combinedText);
      setErrorMessage(null);

      try {
        const corrStart = Date.now();
        const res = await generateReportDraftAction(spokenFloor, {
          mode: 'correction',
          existingDraft: {
            title: currentDraft?.title,
            description: currentDraft?.description,
            category: currentDraft?.category,
            buildingId: currentDraft?.buildingId,
            mentionedBlock: currentDraft?.mentionedBlock,
            mentionedFloor: currentDraft?.mentionedFloor,
            matchedZoneId: currentDraft?.matchedZoneId,
          },
        });
        const elapsedCorr = Date.now() - corrStart;

        if (sessionIdRef.current !== thisSessionId) return;

        if (!res.success || !res.draft) {
          setErrorMessage(
            res.error ||
              (locale === 'ms'
                ? 'Gagal memproses nombor tingkat. Sila cuba lagi atau taip sendiri.'
                : 'Failed to process floor number. Please try again or type manually.')
          );
          setTurn('followup_floor');
          return;
        }

        if (res.draft.invalidFloorWarning) {
          setErrorMessage(res.draft.invalidFloorWarning);
          speakText(res.draft.invalidFloorWarning);
          setTurn('followup_floor');
          return;
        }

        if (res.draft.clarificationPrompt) {
          const promptMsg =
            locale === 'ms' ? res.draft.clarificationPrompt.ms : res.draft.clarificationPrompt.en;
          setErrorMessage(promptMsg);
          speakText(promptMsg);
          setTurn('followup_floor');
          return;
        }

        setCurrentDraft(res.draft);
        setTurn('announcing_ready');
        const readyText = t.reportForm.assistantDraftReady;
        speakText(readyText);

        setTimeout(() => {
          if (sessionIdRef.current !== thisSessionId) return;
          onDraftReady(res.draft!, combinedText, {
            transcriptionMs,
            draftMs,
            correctionMs: elapsedCorr,
          });
        }, 1000);
      } catch {
        if (sessionIdRef.current !== thisSessionId) return;
        setErrorMessage(
          locale === 'ms'
            ? 'Ralat rangkaian semasa memproses tingkat. Sila cuba lagi.'
            : 'Network error while processing floor. Please try again.'
        );
        setTurn('followup_floor');
      } finally {
        isProcessingRef.current = false;
      }
    },
    [
      transcript,
      currentDraft,
      fullRawText,
      locale,
      speakText,
      t.reportForm.assistantDraftReady,
      onDraftReady,
      transcriptionMs,
      draftMs,
    ]
  );

  const handleStopAndProcessFloor = useCallback(async () => {
    const finalCaptured = await stopListening();
    await processFloorTranscript(finalCaptured);
  }, [stopListening, processFloorTranscript]);

  if (!isOpen) return null;

  const hasTranscript = transcript.trim().length > 0;
  const isMediaRecordingActive = mediaRecorderState === 'recording';

  // Format seconds to mm:ss
  const formatTimer = (totalSecs: number) => {
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="guided-voice-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden flex flex-col max-h-[92vh]">
        
        {/* Top Header Bar */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 bg-slate-50/70">
          <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl text-xs font-bold text-slate-600">
            <button
              type="button"
              onClick={() => {
                if (capabilities?.hasSpeechRecognition) {
                  setSelectedMode('speech_recognition');
                  setErrorMessage(null);
                } else {
                  setErrorMessage(getCapabilityMessage('ok_media_recorder_only', locale));
                }
              }}
              className={`py-1 px-2.5 rounded-lg transition-all text-center cursor-pointer ${
                assistantMode === 'speech_recognition'
                  ? 'bg-white text-[#1554AD] shadow-xs'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              {locale === 'ms' ? 'Pengecaman Suara' : 'Speech Recognition'}
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedMode('media_recorder');
                setErrorMessage(null);
              }}
              className={`py-1 px-2.5 rounded-lg transition-all text-center cursor-pointer ${
                assistantMode === 'media_recorder'
                  ? 'bg-white text-[#1554AD] shadow-xs'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              {locale === 'ms' ? 'Mod Ujian Rakaman' : 'Test Recording Mode'}
            </button>
          </div>

          <div className="flex items-center gap-1">
            {assistantMode === 'speech_recognition' && (
              <button
                type="button"
                onClick={() => setIsMuted((prev) => !prev)}
                className="p-2 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-200/60 transition-colors cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center"
                title={isMuted ? t.reportForm.assistantUnmute : t.reportForm.assistantMute}
                aria-label={isMuted ? t.reportForm.assistantUnmute : t.reportForm.assistantMute}
              >
                {isMuted ? <VolumeX className="w-5 h-5 text-slate-400" /> : <Volume2 className="w-5 h-5 text-[#1554AD]" />}
              </button>
            )}
            <button
              type="button"
              onClick={handleClose}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label={locale === 'ms' ? 'Tutup' : 'Close'}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 flex-1 overflow-y-auto space-y-3.5 text-center flex flex-col justify-center">
          {/* Eyebrow, Title & Subtitle */}
          <div>
            <span className="text-[11px] font-extrabold tracking-widest text-[#1554AD] uppercase block mb-1">
              {t.reportForm.eyebrowVoiceReport}
            </span>
            <h2 id="guided-voice-title" className="text-2xl sm:text-[26px] font-extrabold text-slate-900 tracking-tight leading-snug">
              {t.reportForm.voiceReportTitle}
            </h2>
            <p className="text-sm text-slate-600 mt-1 max-w-xs mx-auto leading-relaxed">
              {t.reportForm.voiceReportInstruction}
            </p>
          </div>

          {/* Status Capsule */}
          <div>
            <div
              role="status"
              aria-live="polite"
              className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#F1F6FD] border border-[#E5EEF9] text-xs font-semibold text-[#456A9D]"
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  isMediaRecordingActive || isListening
                    ? 'bg-red-500 animate-pulse'
                    : mediaRecorderState === 'recorded'
                    ? 'bg-emerald-500'
                    : mediaRecorderState === 'requesting'
                    ? 'bg-amber-500 animate-spin'
                    : 'bg-[#7DA1CC]'
                }`}
              />
              <span>
                {assistantMode === 'media_recorder'
                  ? mediaRecorderState === 'recording'
                    ? locale === 'ms'
                      ? `Sedang merakam... (${formatTimer(mediaSecondsElapsed)} / 01:00)`
                      : `Recording now... (${formatTimer(mediaSecondsElapsed)} / 01:00)`
                    : mediaRecorderState === 'requesting'
                    ? locale === 'ms'
                      ? 'Meminta kebenaran mikrofon...'
                      : 'Requesting microphone permission...'
                    : mediaRecorderState === 'stopping'
                    ? locale === 'ms'
                      ? 'Menyediakan audio...'
                      : 'Finalizing audio...'
                    : mediaRecorderState === 'recorded'
                    ? locale === 'ms'
                      ? 'Rakaman sedia dimainkan'
                      : 'Recording ready to play'
                    : locale === 'ms'
                    ? 'Sedia untuk merakam'
                    : 'Ready to record'
                  : isListening
                  ? t.reportForm.assistantListening
                  : turn === 'processing_initial' || turn === 'processing_floor'
                  ? t.reportForm.assistantProcessing
                  : hasTranscript
                  ? t.reportForm.assistantTranscriptReady
                  : locale === 'ms'
                  ? 'Sedia untuk merakam'
                  : 'Ready to record'}
              </span>
            </div>
          </div>

          {/* Central Blue Wave Stage (Animated only during live recording) */}
          <div
            className="w-full py-2 my-1 flex items-center justify-center gap-2 h-24 sm:h-28 rounded-2xl"
            style={{ background: 'radial-gradient(ellipse at center, #EAF3FF 0%, #FFFFFF 70%)' }}
            aria-hidden="true"
          >
            {[16, 38, 66, 88, 66, 38, 16].map((baseHeight, idx) => {
              const activeAnim = isMediaRecordingActive || isListening;
              return (
                <span
                  key={idx}
                  style={{ height: `${baseHeight}px` }}
                  className={`w-3 sm:w-3.5 rounded-full bg-linear-to-t from-[#1558B7] to-[#8DC2FF] transition-all origin-center shadow-xs ${
                    activeAnim ? `wave-bar-${idx + 1}` : ''
                  }`}
                />
              );
            })}
          </div>

          {/* Real Recording Timer */}
          <div className="text-xs font-mono font-bold text-slate-500 tracking-wider tabular-nums">
            {assistantMode === 'media_recorder'
              ? `${formatTimer(mediaSecondsElapsed)} / 01:00`
              : '00:00 / 01:00'}
          </div>

          {/* Media Recorder - Recorded Audio Preview Stage */}
          {assistantMode === 'media_recorder' && mediaRecorderState === 'recorded' && recordedAudioUrl && (
            <div className="p-3.5 bg-[#F8FAFC] border border-blue-200 rounded-2xl shadow-xs text-left space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-[#1554AD] flex items-center gap-1.5">
                  <FileAudio className="w-4 h-4" />
                  {locale === 'ms' ? 'Pratonton Audio' : 'Audio Preview'}
                </span>
                <span className="text-slate-500 font-mono">
                  {mediaRecordedBytes > 0 ? `${(mediaRecordedBytes / 1024).toFixed(1)} KB` : ''} ·{' '}
                  {getExtensionFromMime(recordedMimeType).toUpperCase()}
                </span>
              </div>

              {/* Native HTML5 Audio with User Controls - NO Autoplay */}
              <audio
                controls
                preload="none"
                src={recordedAudioUrl}
                className="w-full h-11 focus:outline-none"
              />

              <div className="text-[11px] text-slate-600 bg-white border border-slate-200 p-2 rounded-lg text-center font-medium">
                {t.reportForm.testRecordingNotice}
              </div>
            </div>
          )}

          {/* Speech Recognition Mode: Assistant Speech bubble / User Transcript Textarea */}
          {assistantMode === 'speech_recognition' && (
            <div className="space-y-3 text-left">
              {/* AI prompt message */}
              <div className="bg-[#EFF4FB] rounded-2xl rounded-tl-xs p-3.5 text-slate-800 text-sm font-medium leading-relaxed">
                <strong className="block text-[11px] text-[#1554AD] uppercase tracking-wider mb-1">
                  NADI
                </strong>
                {turn === 'followup_floor' || turn === 'processing_floor'
                  ? t.reportForm.assistantFollowUpFloor
                  : turn === 'announcing_ready'
                  ? t.reportForm.assistantDraftReady
                  : t.reportForm.assistantGreeting}
              </div>

              {/* Editable Transcript */}
              {(isListening || hasTranscript || turn === 'processing_initial' || turn === 'processing_floor') && (
                <div className="bg-white border border-[#C8DCF5] rounded-2xl p-3 space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-[#1554AD] font-semibold">
                    <span>{t.reportForm.assistantTranscriptReady}</span>
                  </div>
                  {isListening ? (
                    <p className="text-slate-800 text-sm leading-relaxed min-h-[44px]">
                      {transcript || <span className="italic text-slate-400">{t.reportForm.assistantListening}</span>}
                    </p>
                  ) : (
                    <textarea
                      rows={2}
                      value={transcript}
                      onChange={(e) => {
                        setTranscript(e.target.value);
                        transcriptRef.current = e.target.value;
                      }}
                      disabled={turn === 'processing_initial' || turn === 'processing_floor'}
                      className="w-full p-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-sm font-medium focus:outline-none focus:border-[#1554AD] resize-none"
                      placeholder={locale === 'ms' ? 'Sunting teks di sini...' : 'Edit text here...'}
                    />
                  )}
                </div>
              )}
            </div>
          )}

          {/* Error Message Notice */}
          {errorMessage && (
            <div role="alert" className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs sm:text-sm flex items-start gap-2 text-left">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Informational notices */}
          {mediaNotice && (
            <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-xs text-left flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
              <span>{mediaNotice}</span>
            </div>
          )}
        </div>

        {/* Action Controls Area (Minimum 44px touch targets, 54px buttons) */}
        <div className="p-4 sm:p-5 border-t border-slate-100 bg-white flex flex-col gap-2.5">
          {assistantMode === 'media_recorder' ? (
            <>
              {mediaRecorderState === 'ready' && (
                <button
                  type="button"
                  onClick={startAlternativeRecording}
                  className="w-full min-h-[54px] h-[54px] rounded-xl bg-[#1554AD] text-white font-bold text-base flex items-center justify-center gap-2.5 shadow-xs hover:bg-[#0E3E85] active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-[#1554AD] focus-visible:outline-offset-2 transition-all cursor-pointer"
                >
                  <Mic className="w-5 h-5 text-white shrink-0 stroke-[2]" />
                  <span>{locale === 'ms' ? 'Mula rakaman' : 'Start recording'}</span>
                </button>
              )}

              {mediaRecorderState === 'requesting' && (
                <div className="w-full min-h-[54px] h-[54px] rounded-xl bg-slate-100 text-slate-700 font-semibold text-base flex items-center justify-center gap-2.5">
                  <Loader2 className="w-5 h-5 animate-spin text-[#1554AD]" />
                  <span>{locale === 'ms' ? 'Menunggu kebenaran mikrofon...' : 'Awaiting microphone access...'}</span>
                </div>
              )}

              {mediaRecorderState === 'recording' && (
                <button
                  type="button"
                  onClick={() => stopAlternativeRecording('user')}
                  className="w-full min-h-[54px] h-[54px] rounded-xl bg-[#DC2626] text-white font-bold text-base flex items-center justify-center gap-2.5 shadow-xs hover:bg-[#B91C1C] active:scale-[0.99] transition-all cursor-pointer"
                >
                  <Square className="w-5 h-5 fill-white text-white" />
                  <span>{locale === 'ms' ? 'Selesai bercakap' : 'Done speaking'}</span>
                </button>
              )}

              {mediaRecorderState === 'stopping' && (
                <div className="w-full min-h-[54px] h-[54px] rounded-xl bg-slate-100 text-slate-700 font-semibold text-base flex items-center justify-center gap-2.5">
                  <Loader2 className="w-5 h-5 animate-spin text-[#1554AD]" />
                  <span>{locale === 'ms' ? 'Memproses fail audio...' : 'Processing audio...'}</span>
                </div>
              )}

              {mediaRecorderState === 'recorded' && (
                <button
                  type="button"
                  onClick={handleReRecord}
                  className="w-full min-h-[54px] h-[54px] px-4 rounded-xl border-1.5 border-slate-300 bg-white text-slate-800 font-bold text-base hover:bg-slate-50 flex items-center justify-center gap-2 active:scale-[0.99] transition-all cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4 text-slate-600" />
                  <span>{locale === 'ms' ? 'Rakam semula' : 'Record again'}</span>
                </button>
              )}
            </>
          ) : (
            <>
              {/* Speech Recognition Controls */}
              {(turn === 'greeting' || turn === 'processing_initial') && (
                <>
                  {isListening ? (
                    <button
                      type="button"
                      onClick={handleStopAndProcessInitial}
                      className="w-full min-h-[54px] h-[54px] rounded-xl bg-[#DC2626] text-white font-bold text-base flex items-center justify-center gap-2.5 shadow-xs hover:bg-[#B91C1C] active:scale-[0.99] transition-all cursor-pointer"
                    >
                      <Square className="w-5 h-5 fill-white text-white" />
                      <span>{t.reportForm.assistantStopSpeaking}</span>
                    </button>
                  ) : turn === 'processing_initial' ? (
                    <div className="w-full min-h-[54px] h-[54px] rounded-xl bg-slate-100 text-slate-700 font-semibold text-base flex items-center justify-center gap-2.5">
                      <Loader2 className="w-5 h-5 animate-spin text-[#1554AD]" />
                      <span>{t.reportForm.assistantProcessing}</span>
                    </div>
                  ) : hasTranscript ? (
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => processInitialTranscript()}
                        className="w-full min-h-[54px] h-[54px] rounded-xl bg-[#1554AD] text-white font-bold text-base flex items-center justify-center gap-2 shadow-xs hover:bg-[#0E3E85] active:scale-[0.99] transition-all cursor-pointer"
                      >
                        <span>{t.reportForm.assistantUseTranscriptBtn}</span>
                        <ArrowRight className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => startListening('initial')}
                        className="w-full min-h-[46px] h-[46px] px-4 rounded-xl border-1.5 border-slate-300 bg-white text-slate-700 font-semibold text-sm hover:bg-slate-50 flex items-center justify-center gap-2 transition-all cursor-pointer"
                      >
                        <RotateCcw className="w-4 h-4 text-slate-500" />
                        <span>{t.reportForm.assistantReRecordBtn}</span>
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => startListening('initial')}
                      className="w-full min-h-[54px] h-[54px] rounded-xl bg-[#1554AD] text-white font-bold text-base flex items-center justify-center gap-2.5 shadow-xs hover:bg-[#0E3E85] active:scale-[0.99] transition-all cursor-pointer"
                    >
                      <Mic className="w-5 h-5 text-white stroke-[2]" />
                      <span>{t.reportForm.assistantPressToSpeak}</span>
                    </button>
                  )}
                </>
              )}

              {(turn === 'followup_floor' || turn === 'processing_floor') && (
                <>
                  {isListening ? (
                    <button
                      type="button"
                      onClick={handleStopAndProcessFloor}
                      className="w-full min-h-[54px] h-[54px] rounded-xl bg-[#DC2626] text-white font-bold text-base flex items-center justify-center gap-2.5 shadow-xs hover:bg-[#B91C1C] active:scale-[0.99] transition-all cursor-pointer"
                    >
                      <Square className="w-5 h-5 fill-white text-white" />
                      <span>{t.reportForm.assistantStopSpeaking}</span>
                    </button>
                  ) : turn === 'processing_floor' ? (
                    <div className="w-full min-h-[54px] h-[54px] rounded-xl bg-slate-100 text-slate-700 font-semibold text-base flex items-center justify-center gap-2.5">
                      <Loader2 className="w-5 h-5 animate-spin text-[#1554AD]" />
                      <span>{t.reportForm.assistantProcessing}</span>
                    </div>
                  ) : hasTranscript ? (
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => processFloorTranscript()}
                        className="w-full min-h-[54px] h-[54px] rounded-xl bg-[#1554AD] text-white font-bold text-base flex items-center justify-center gap-2 shadow-xs hover:bg-[#0E3E85] active:scale-[0.99] transition-all cursor-pointer"
                      >
                        <span>{t.reportForm.assistantUseTranscriptBtn}</span>
                        <ArrowRight className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => startListening('floor')}
                        className="w-full min-h-[46px] h-[46px] px-4 rounded-xl border-1.5 border-slate-300 bg-white text-slate-700 font-semibold text-sm hover:bg-slate-50 flex items-center justify-center gap-2 transition-all cursor-pointer"
                      >
                        <RotateCcw className="w-4 h-4 text-slate-500" />
                        <span>{t.reportForm.assistantReRecordBtn}</span>
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => startListening('floor')}
                      className="w-full min-h-[54px] h-[54px] rounded-xl bg-[#1554AD] text-white font-bold text-base flex items-center justify-center gap-2.5 shadow-xs hover:bg-[#0E3E85] active:scale-[0.99] transition-all cursor-pointer"
                    >
                      <Mic className="w-5 h-5 text-white stroke-[2]" />
                      <span>{t.reportForm.assistantTapToSpeakFloor}</span>
                    </button>
                  )}
                </>
              )}
            </>
          )}

          {/* Secondary Action: "Saya mahu taip sahaja" / "Taip sahaja" (Always Available, Preserves Draft) */}
          <button
            type="button"
            onClick={() => {
              const textToKeep = transcriptRef.current || transcript || fullRawText;
              handleClose();
              onSwitchToManual(textToKeep);
            }}
            className="w-full py-2 text-center text-sm font-semibold text-slate-500 hover:text-[#1554AD] min-h-[44px] flex items-center justify-center transition-colors cursor-pointer"
          >
            {locale === 'ms' ? 'Saya mahu taip sahaja' : 'I’d rather type'}
          </button>
        </div>
      </div>
    </div>
  );
}
