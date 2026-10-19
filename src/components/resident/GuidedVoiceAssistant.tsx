'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Mic,
  Square,
  Volume2,
  VolumeX,
  Sparkles,
  PenLine,
  X,
  AlertCircle,
  Loader2,
  CheckCircle2,
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
      <div className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden flex flex-col max-h-[92vh]">
        
        {/* Header with Title & Mode Switcher */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 bg-slate-50/80">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#1554AD]/10 text-[#1554AD] flex items-center justify-center shrink-0">
              {assistantMode === 'media_recorder' ? (
                <FileAudio className="w-4 h-4 text-[#1554AD]" />
              ) : (
                <Sparkles className="w-4 h-4 text-[#1554AD]" />
              )}
            </div>
            <div>
              <h2 id="guided-voice-title" className="text-base font-bold text-slate-900 leading-tight">
                {assistantMode === 'media_recorder'
                  ? locale === 'ms'
                    ? 'Rakaman Audio Alternatif'
                    : 'Alternative Audio Recording'
                  : t.reportForm.assistantTitle}
              </h2>
              <p className="text-xs text-slate-500">
                {assistantMode === 'media_recorder'
                  ? locale === 'ms'
                    ? 'Sokongan iPhone & Safari · Sifar AI'
                    : 'iPhone & Safari Support · Zero AI'
                  : t.reportForm.assistantSubtitle}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {assistantMode === 'speech_recognition' && (
              <button
                type="button"
                onClick={() => setIsMuted((prev) => !prev)}
                className="p-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 transition-colors"
                title={isMuted ? t.reportForm.assistantUnmute : t.reportForm.assistantMute}
                aria-label={isMuted ? t.reportForm.assistantUnmute : t.reportForm.assistantMute}
              >
                {isMuted ? <VolumeX className="w-5 h-5 text-slate-400" /> : <Volume2 className="w-5 h-5 text-[#1554AD]" />}
              </button>
            )}
            <button
              type="button"
              onClick={handleClose}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors cursor-pointer"
              aria-label={t.common.close}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Mode Switcher Tabs (Accessible on any device to test alternative recording) */}
        <div className="px-5 pt-3 pb-1 flex items-center justify-between gap-2 border-b border-slate-100 bg-white">
          <div className="inline-flex p-1 bg-slate-100 rounded-xl text-xs font-bold text-slate-600 gap-1 w-full sm:w-auto">
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
              className={`flex-1 sm:flex-initial py-1.5 px-3 rounded-lg transition-all text-center ${
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
              className={`flex-1 sm:flex-initial py-1.5 px-3 rounded-lg transition-all text-center ${
                assistantMode === 'media_recorder'
                  ? 'bg-white text-[#1554AD] shadow-xs'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              {locale === 'ms' ? 'Mod Ujian Rakaman' : 'Test Recording Mode'}
            </button>
          </div>

          <span className="hidden sm:inline-block text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
            {locale === 'ms' ? 'Sifar Panggilan AI' : 'Zero AI Calls'}
          </span>
        </div>

        {/* Conversation / Recording Body */}
        <div className="p-5 sm:p-6 space-y-4 flex-1 overflow-y-auto min-h-[290px] flex flex-col justify-center">

          {/* =============================================================== */}
          {/* VIEW A: MEDIA RECORDER ALTERNATIVE (Record + Playback, Zero AI)  */}
          {/* =============================================================== */}
          {assistantMode === 'media_recorder' ? (
            <div className="space-y-4 text-center">
              
              {/* Status Capsule */}
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-100 border border-slate-200 text-xs font-bold text-slate-700">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    isMediaRecordingActive
                      ? 'bg-red-500 animate-pulse'
                      : mediaRecorderState === 'recorded'
                      ? 'bg-emerald-500'
                      : mediaRecorderState === 'requesting'
                      ? 'bg-amber-500 animate-spin'
                      : 'bg-slate-400'
                  }`}
                />
                <span>
                  {mediaRecorderState === 'recording'
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
                    : 'Ready to record'}
                </span>
              </div>

              {/* Title & Instructions */}
              <div>
                <h3 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
                  {mediaRecorderState === 'recorded'
                    ? locale === 'ms'
                      ? 'Dengar semula audio anda'
                      : 'Listen back to your audio'
                    : locale === 'ms'
                    ? 'Ceritakan masalah anda'
                    : 'Tell us about the issue'}
                </h3>
                <p className="text-sm text-slate-600 mt-1 max-w-sm mx-auto leading-relaxed">
                  {mediaRecorderState === 'recorded'
                    ? locale === 'ms'
                      ? 'Audio disimpan dalam memori telefon. Tekan butang main untuk dengar semula.'
                      : 'Audio stored in memory. Press play to review your voice.'
                    : locale === 'ms'
                    ? 'Beritahu apa yang rosak dan di mana. Cakap seperti biasa.'
                    : 'Tell us what is broken and where. Speak naturally.'}
                </p>
              </div>

              {/* Central Waveform Stage (Static when inactive, animated strictly during live recording) */}
              <div className="py-4 px-4 bg-slate-50 border border-slate-100 rounded-2xl flex flex-col items-center justify-center gap-3">
                <div className="flex items-center justify-center gap-1.5 h-16" aria-hidden="true">
                  {[20, 38, 56, 32, 48, 62, 36, 22].map((height, i) => (
                    <div
                      key={i}
                      style={{
                        height: isMediaRecordingActive ? `${Math.min(60, height * 1.1)}px` : '18px',
                        transition: 'height 0.2s ease, opacity 0.2s ease',
                      }}
                      className={`w-2.5 rounded-full ${
                        isMediaRecordingActive
                          ? 'bg-linear-to-t from-[#1554AD] to-[#60A5FA] animate-pulse'
                          : 'bg-slate-300'
                      }`}
                    />
                  ))}
                </div>

                <div className="text-xs font-mono font-bold text-slate-500 tabular-nums">
                  {formatTimer(mediaSecondsElapsed)} / 01:00 (Maks 60s · 5MB)
                </div>
              </div>

              {/* Audio Playback Element (Available in recorded state, starts strictly upon user pressing play) */}
              {mediaRecorderState === 'recorded' && recordedAudioUrl && (
                <div className="p-4 bg-white border border-blue-200 rounded-2xl shadow-xs text-left space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-[#1554AD] flex items-center gap-1.5">
                      <FileAudio className="w-4 h-4" />
                      {locale === 'ms' ? 'Pratonton Audio Tempatan' : 'Local Audio Preview'}
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
                    className="w-full h-11 focus:outline-hidden"
                  />

                  <div className="text-[11px] text-slate-500 bg-slate-50 p-2 rounded-lg leading-normal">
                    💡{' '}
                    {locale === 'ms'
                      ? 'Ujian rakaman sahaja. Audio tidak dimuat naik atau dihantar ke mana-mana pelayan.'
                      : 'Test recording only. Audio is never uploaded or sent to any server.'}
                  </div>
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
          ) : (
            /* =============================================================== */
            /* VIEW B: SPEECH RECOGNITION CONVERSATION (Desktop / Android)     */
            /* =============================================================== */
            <>
              {/* Assistant Prompt Bubble */}
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-full bg-[#1554AD] text-white flex items-center justify-center shrink-0 shadow-xs font-bold text-sm">
                  AI
                </div>
                <div className="bg-slate-100 rounded-2xl rounded-tl-xs px-4 py-3 text-slate-800 text-base md:text-lg font-medium leading-relaxed max-w-[85%]">
                  {turn === 'followup_floor' || turn === 'processing_floor'
                    ? t.reportForm.assistantFollowUpFloor
                    : turn === 'announcing_ready'
                    ? t.reportForm.assistantDraftReady
                    : t.reportForm.assistantGreeting}
                </div>
              </div>

              {/* User Live Transcript Bubble or Editable Textarea */}
              {(isListening || hasTranscript || turn === 'processing_initial' || turn === 'processing_floor') && (
                <div className="flex items-start gap-3 justify-end">
                  <div className="w-full max-w-[88%] bg-[#1554AD]/10 border border-[#1554AD]/20 rounded-2xl rounded-tr-xs p-3.5 space-y-2">
                    <div className="flex items-center justify-between text-xs text-[#1554AD] font-semibold">
                      <span>
                        {isListening
                          ? t.reportForm.assistantListening
                          : turn === 'processing_initial' || turn === 'processing_floor'
                          ? t.reportForm.assistantProcessing
                          : t.reportForm.assistantTranscriptReady}
                      </span>
                    </div>

                    {isListening ? (
                      <p className="text-[#0E3E85] text-base leading-relaxed break-words min-h-[48px]">
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
                        className="w-full p-2 rounded-xl bg-white border border-slate-200 text-[#0E3E85] text-base font-medium focus:outline-hidden focus:border-[#1554AD] resize-none"
                        placeholder={locale === 'ms' ? 'Taip atau sunting di sini...' : 'Type or edit here...'}
                      />
                    )}
                  </div>
                  <div className="w-9 h-9 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center shrink-0 font-bold text-xs">
                    {locale === 'ms' ? 'Anda' : 'You'}
                  </div>
                </div>
              )}

              {/* Success State Animation */}
              {turn === 'announcing_ready' && (
                <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-center gap-3 animate-in zoom-in-95 duration-200">
                  <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
                  <div className="text-sm font-semibold">
                    {locale === 'ms'
                      ? 'Draf berjaya disediakan! Membuka skrin semakan...'
                      : 'Draft prepared! Opening review screen...'}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Error Message Notice */}
          {errorMessage && (
            <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-red-700 flex items-start gap-2.5 text-sm">
              <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}
        </div>

        {/* Action Controls Area (Minimum 44px touch targets, 54px buttons) */}
        <div className="p-4 sm:p-5 border-t border-slate-100 bg-slate-50/60 flex flex-col gap-2.5">
          
          {/* =============================================================== */}
          {/* CONTROLS: MEDIA RECORDER MODE                                  */}
          {/* =============================================================== */}
          {assistantMode === 'media_recorder' ? (
            <>
              {mediaRecorderState === 'ready' && (
                <button
                  type="button"
                  onClick={startAlternativeRecording}
                  className="w-full min-h-[54px] h-[54px] rounded-2xl bg-[#1554AD] text-white font-bold text-base flex items-center justify-center gap-3 shadow-md hover:bg-[#0E3E85] active:scale-[0.99] transition-all cursor-pointer"
                >
                  <Mic className="w-5 h-5 text-white" />
                  <span>{locale === 'ms' ? 'Mula rakaman' : 'Start recording'}</span>
                </button>
              )}

              {mediaRecorderState === 'requesting' && (
                <div className="w-full min-h-[54px] h-[54px] rounded-2xl bg-slate-200 text-slate-700 font-semibold text-base flex items-center justify-center gap-3">
                  <Loader2 className="w-5 h-5 animate-spin text-[#1554AD]" />
                  <span>{locale === 'ms' ? 'Menunggu kebenaran mikrofon...' : 'Awaiting microphone access...'}</span>
                </div>
              )}

              {mediaRecorderState === 'recording' && (
                <button
                  type="button"
                  onClick={() => stopAlternativeRecording('user')}
                  className="w-full min-h-[54px] h-[54px] rounded-2xl bg-red-600 text-white font-bold text-base flex items-center justify-center gap-3 shadow-md hover:bg-red-700 active:scale-[0.99] transition-all animate-pulse cursor-pointer"
                >
                  <Square className="w-5 h-5 fill-white text-white" />
                  <span>{locale === 'ms' ? 'Selesai bercakap' : 'Done speaking'}</span>
                </button>
              )}

              {mediaRecorderState === 'stopping' && (
                <div className="w-full min-h-[54px] h-[54px] rounded-2xl bg-slate-200 text-slate-700 font-semibold text-base flex items-center justify-center gap-3">
                  <Loader2 className="w-5 h-5 animate-spin text-[#1554AD]" />
                  <span>{locale === 'ms' ? 'Memproses fail audio...' : 'Processing audio...'}</span>
                </div>
              )}

              {mediaRecorderState === 'recorded' && (
                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    type="button"
                    onClick={handleReRecord}
                    className="flex-1 min-h-[54px] h-[54px] px-4 rounded-2xl border-1.5 border-slate-300 bg-white text-slate-800 font-bold text-base hover:bg-slate-50 flex items-center justify-center gap-2 transition-all cursor-pointer"
                  >
                    <RotateCcw className="w-4 h-4 text-slate-600" />
                    <span>{locale === 'ms' ? 'Rakam semula' : 'Record again'}</span>
                  </button>
                </div>
              )}
            </>
          ) : (
            /* =============================================================== */
            /* CONTROLS: SPEECH RECOGNITION MODE                              */
            /* =============================================================== */
            <>
              {/* TURN 1 CONTROLS */}
              {(turn === 'greeting' || turn === 'processing_initial') && (
                <>
                  {isListening ? (
                    <button
                      type="button"
                      onClick={handleStopAndProcessInitial}
                      className="w-full min-h-[54px] h-[54px] rounded-2xl bg-red-600 text-white font-bold text-base flex items-center justify-center gap-3 shadow-md hover:bg-red-700 active:scale-[0.99] transition-all animate-pulse cursor-pointer"
                    >
                      <Square className="w-5 h-5 fill-white text-white" />
                      <span>{t.reportForm.assistantStopSpeaking}</span>
                    </button>
                  ) : turn === 'processing_initial' ? (
                    <div className="w-full min-h-[54px] h-[54px] rounded-2xl bg-slate-200 text-slate-700 font-semibold text-base flex items-center justify-center gap-3">
                      <Loader2 className="w-5 h-5 animate-spin text-[#1554AD]" />
                      <span>{t.reportForm.assistantProcessing}</span>
                    </div>
                  ) : hasTranscript ? (
                    <div className="flex flex-col sm:flex-row gap-2">
                      <button
                        type="button"
                        onClick={() => processInitialTranscript()}
                        className="flex-1 min-h-[54px] h-[54px] rounded-2xl bg-[#1554AD] text-white font-bold text-base flex items-center justify-center gap-2 shadow-md hover:bg-[#0E3E85] active:scale-[0.99] transition-all cursor-pointer"
                      >
                        <span>{t.reportForm.assistantUseTranscriptBtn}</span>
                        <ArrowRight className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => startListening('initial')}
                        className="min-h-[54px] h-[54px] px-4 rounded-2xl border border-slate-300 bg-white text-slate-700 font-semibold text-sm hover:bg-slate-50 flex items-center justify-center gap-2 transition-all cursor-pointer"
                      >
                        <RotateCcw className="w-4 h-4 text-slate-500" />
                        <span>{t.reportForm.assistantReRecordBtn}</span>
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => startListening('initial')}
                      className="w-full min-h-[54px] h-[54px] rounded-2xl bg-[#1554AD] text-white font-bold text-base flex items-center justify-center gap-3 shadow-md hover:bg-[#0E3E85] active:scale-[0.99] transition-all cursor-pointer"
                    >
                      <Mic className="w-5 h-5 text-white" />
                      <span>{t.reportForm.assistantPressToSpeak}</span>
                    </button>
                  )}
                </>
              )}

              {/* TURN 2 (FLOOR FOLLOW-UP) CONTROLS */}
              {(turn === 'followup_floor' || turn === 'processing_floor') && (
                <>
                  {isListening ? (
                    <button
                      type="button"
                      onClick={handleStopAndProcessFloor}
                      className="w-full min-h-[54px] h-[54px] rounded-2xl bg-red-600 text-white font-bold text-base flex items-center justify-center gap-3 shadow-md hover:bg-red-700 active:scale-[0.99] transition-all animate-pulse cursor-pointer"
                    >
                      <Square className="w-5 h-5 fill-white text-white" />
                      <span>{t.reportForm.assistantStopSpeaking}</span>
                    </button>
                  ) : turn === 'processing_floor' ? (
                    <div className="w-full min-h-[54px] h-[54px] rounded-2xl bg-slate-200 text-slate-700 font-semibold text-base flex items-center justify-center gap-3">
                      <Loader2 className="w-5 h-5 animate-spin text-[#1554AD]" />
                      <span>{t.reportForm.assistantProcessing}</span>
                    </div>
                  ) : hasTranscript ? (
                    <div className="flex flex-col sm:flex-row gap-2">
                      <button
                        type="button"
                        onClick={() => processFloorTranscript()}
                        className="flex-1 min-h-[54px] h-[54px] rounded-2xl bg-[#1554AD] text-white font-bold text-base flex items-center justify-center gap-2 shadow-md hover:bg-[#0E3E85] active:scale-[0.99] transition-all cursor-pointer"
                      >
                        <span>{t.reportForm.assistantUseTranscriptBtn}</span>
                        <ArrowRight className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => startListening('floor')}
                        className="min-h-[54px] h-[54px] px-4 rounded-2xl border border-slate-300 bg-white text-slate-700 font-semibold text-sm hover:bg-slate-50 flex items-center justify-center gap-2 transition-all cursor-pointer"
                      >
                        <RotateCcw className="w-4 h-4 text-slate-500" />
                        <span>{t.reportForm.assistantReRecordBtn}</span>
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => startListening('floor')}
                      className="w-full min-h-[54px] h-[54px] rounded-2xl bg-[#1554AD] text-white font-bold text-base flex items-center justify-center gap-3 shadow-md hover:bg-[#0E3E85] active:scale-[0.99] transition-all cursor-pointer"
                    >
                      <Mic className="w-5 h-5 text-white" />
                      <span>{t.reportForm.assistantTapToSpeakFloor}</span>
                    </button>
                  )}
                </>
              )}
            </>
          )}

          {/* Switch to Manual Input Fallback Button (Always Available, preserves draft) */}
          <button
            type="button"
            onClick={() => {
              const textToKeep = transcriptRef.current || transcript || fullRawText;
              handleClose();
              onSwitchToManual(textToKeep);
            }}
            className="w-full min-h-[48px] h-[48px] rounded-xl border border-slate-300 text-slate-700 font-semibold text-sm hover:bg-white active:bg-slate-100 flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <PenLine className="w-4 h-4 text-slate-500" />
            <span>{t.reportForm.assistantSwitchManual}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
