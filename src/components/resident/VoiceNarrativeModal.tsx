'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Mic,
  Square,
  Sparkles,
  AlertTriangle,
  RotateCcw,
  Check,
  X,
  Loader2,
  FileText,
  Volume2,
  Trash2,
  ShieldCheck,
} from 'lucide-react';
import { useTranslation } from '@/lib/i18n/LanguageContext';
import {
  generateReportDraftAction,
  type ReportDraftResult,
} from '@/app/actions/ai-draft';
import {
  transcribeAudioAction,
} from '@/app/actions/voice-transcribe';
import type { FacilityCategory } from '@/types/database';

export interface AppliedDraftData {
  title?: string;
  description: string;
  category?: FacilityCategory | null;
  zoneId?: string | null;
  locationWarning?: string | null;
  replaceDescriptionMode?: 'replace' | 'keep' | 'append';
  replaceZoneMode?: 'apply' | 'keep_existing';
}

interface VoiceNarrativeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyDraft: (draft: AppliedDraftData) => void;
  existingDescription?: string;
  existingZoneId?: string;
  zones: Array<{ id: string; name: string; zone_code: string }>;
}

type ModalStep =
  | 'idle'
  | 'recording'
  | 'transcribing'
  | 'review_text'
  | 'generating_draft'
  | 'draft_ready';

import {
  RecordingSession,
  SpeechRecognitionEventLike,
  SpeechRecognitionInstance,
  WindowWithSpeech,
  MAX_RECORDING_SECONDS,
  MAX_RECORDING_BYTES,
  getExtensionFromMime,
  getSupportedAudioMime,
  setupSessionRecorderListeners,
  stopMediaRecorderSafely,
  stopSessionMediaTracks,
  stopSessionHardware,
} from '@/lib/voice/recording-session';

export function VoiceNarrativeModal({
  isOpen,
  onClose,
  onApplyDraft,
  existingDescription = '',
  existingZoneId = '',
  zones,
}: VoiceNarrativeModalProps) {
  const { t, locale } = useTranslation();

  const [step, setStep] = useState<ModalStep>('idle');
  const [secondsElapsed, setSecondsElapsed] = useState(0);
  const [savedTranscript, setSavedTranscript] = useState('');
  const [liveStreamSpeech, setLiveStreamSpeech] = useState('');
  const [micError, setMicError] = useState<string | null>(null);
  const [apiNotice, setApiNotice] = useState<string | null>(null);
  const [draftResult, setDraftResult] = useState<ReportDraftResult | null>(null);
  const [descConflictChoice, setDescConflictChoice] = useState<'replace' | 'keep' | 'append'>('replace');
  const [zoneConflictChoice, setZoneConflictChoice] = useState<'apply' | 'keep_existing'>('apply');

  // Session tracking & race guards
  const currentSessionRef = useRef<RecordingSession | null>(null);
  const recordingSessionCounterRef = useRef<number>(0);
  const permissionRequestCounterRef = useRef<number>(0);
  const activePermissionRequestIdRef = useRef<number>(0);
  const activeRequestIdRef = useRef<number>(0);
  const isStartingRef = useRef<boolean>(false);
  const isGeneratingDraftRef = useRef<boolean>(false);
  const recognitionEndResolverRef = useRef<(() => void) | null>(null);
  const prevIsOpenRef = useRef<boolean>(isOpen);
  const isOpenRef = useRef<boolean>(isOpen);
  const modalContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  // Unified termination for active recording hardware (stream, recorder, recognizer, timer)
  const terminateActiveRecordingSession = useCallback(() => {
    activePermissionRequestIdRef.current = 0;
    activeRequestIdRef.current++;
    isStartingRef.current = false;
    isGeneratingDraftRef.current = false;
    const session = currentSessionRef.current;
    if (session) {
      currentSessionRef.current = null;
      stopSessionHardware(session);
    }
    if (recognitionEndResolverRef.current) {
      recognitionEndResolverRef.current();
      recognitionEndResolverRef.current = null;
    }
    setLiveStreamSpeech('');
    setSecondsElapsed(0);
  }, []);

  // Synchronize modal open/close: if isOpen becomes false by any means, terminate recording!
  useEffect(() => {
    if (prevIsOpenRef.current && !isOpen) {
      activePermissionRequestIdRef.current = 0;
      terminateActiveRecordingSession();
      setStep((curr) => (curr === 'recording' || curr === 'transcribing' ? (savedTranscript ? 'review_text' : 'idle') : curr));
    }
    prevIsOpenRef.current = isOpen;

    if (isOpen) {
      // Focus modal for accessibility
      setTimeout(() => {
        modalContainerRef.current?.focus();
      }, 50);
    }
  }, [isOpen, terminateActiveRecordingSession, savedTranscript]);

  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      activePermissionRequestIdRef.current = 0;
      terminateActiveRecordingSession();
    };
  }, [terminateActiveRecordingSession]);

  // Handle closing modal
  const handleCloseModal = useCallback(() => {
    activePermissionRequestIdRef.current = 0;
    terminateActiveRecordingSession();
    setStep(savedTranscript ? 'review_text' : 'idle');
    setMicError(null);
    setApiNotice(null);
    onClose();
  }, [terminateActiveRecordingSession, savedTranscript, onClose]);

  // Helper to translate structured error codes
  const resolveErrorMessage = useCallback(
    (code: string | undefined, defaultFallback: string) => {
      if (code && t.voiceErrors && code in t.voiceErrors) {
        return t.voiceErrors[code as keyof typeof t.voiceErrors];
      }
      return defaultFallback;
    },
    [t]
  );

  // Stop recording for a specific session deterministically
  const handleStopRecordingSession = useCallback(
    async (session: RecordingSession, reason?: 'user' | 'max_duration' | 'max_size') => {
      if (session.stopping || session.stopped) return;
      session.stopping = true;

      // 1. Immediately stop duration timer for this session
      if (session.timer) {
        clearInterval(session.timer);
        session.timer = null;
      }

      const currentRequestId = ++activeRequestIdRef.current;

      // 2. Stop speech recognition and wait for onend with a bounded 300ms race
      if (session.recognition) {
        const waitForEndPromise = new Promise<void>((resolve) => {
          recognitionEndResolverRef.current = resolve;
        });
        try {
          session.recognition.stop();
        } catch {
          // Ignore
        }
        await Promise.race([
          waitForEndPromise,
          new Promise<void>((res) => setTimeout(res, 300)),
        ]);
        session.recognition = null;
        recognitionEndResolverRef.current = null;
      }

      // 3. Stop MediaRecorder and wait for the real onstop event and final chunks
      let finalAudioBlob: Blob | null = null;
      let recorderSucceeded = false;

      const recorderResult = await stopMediaRecorderSafely(session);
      if (recorderResult.success && recorderResult.blob) {
        finalAudioBlob = recorderResult.blob;
        recorderSucceeded = true;
      }

      // 4. Release media hardware tracks belonging to THIS session
      stopSessionMediaTracks(session);

      // 5. CRITICAL POST-AWAIT GUARD: Check session validity!
      // If modal was closed or a new recording session was started while stopping, DO NOT touch shared state!
      if (currentSessionRef.current !== session) {
        return;
      }

      // Session is still active; mark as completed
      currentSessionRef.current = null;

      if (reason === 'max_size' || session.totalBytes >= MAX_RECORDING_BYTES) {
        setMicError(t.voiceReport.maxSizeNotice);
      }

      // If recorder failed to finish cleanly (e.g. stop event never arrived or threw error)
      if (!recorderSucceeded) {
        setMicError(t.voiceReport.recorderStopFailed);
        setStep(savedTranscript ? 'review_text' : 'idle');
        return;
      }

      // 6. Evaluate speech text from THIS session only
      const freshSpeechText = session.speechText.trim();
      if (freshSpeechText.length >= 5) {
        const merged = savedTranscript ? `${savedTranscript}\n${freshSpeechText}` : freshSpeechText;
        setSavedTranscript(merged);
        setLiveStreamSpeech('');
        setDraftResult(null);
        setStep('review_text');
        return;
      }

      // 7. If SpeechRecognition returned nothing in this session, transcribe recorded audio
      if (finalAudioBlob && finalAudioBlob.size >= 1000) {
        if (finalAudioBlob.size > MAX_RECORDING_BYTES) {
          setMicError(t.voiceReport.maxSizeNotice);
          setStep(savedTranscript ? 'review_text' : 'idle');
          return;
        }

        setStep('transcribing');
        try {
          const fd = new FormData();
          const ext = getExtensionFromMime(finalAudioBlob.type || session.recorder.mimeType);
          fd.append('audio', finalAudioBlob, `recording.${ext}`);

          const res = await transcribeAudioAction(fd);

          // Check if request was cancelled or superseded
          if (currentRequestId !== activeRequestIdRef.current) return;

          if (res.success && res.text) {
            const freshText = res.text.trim();
            const merged = savedTranscript ? `${savedTranscript}\n${freshText}` : freshText;
            setSavedTranscript(merged);
            setDraftResult(null);
            setStep('review_text');
            return;
          }

          if (res.code === 'API_NOT_AVAILABLE') {
            setApiNotice(t.voiceReport.apiMissingNotice);
            setStep(savedTranscript ? 'review_text' : 'idle');
            return;
          }

          const msg = resolveErrorMessage(res.code, res.error || t.voiceReport.transcriptionFailed);
          setMicError(msg);
        } catch {
          if (currentRequestId !== activeRequestIdRef.current) return;
          setMicError(t.voiceReport.transcriptionFailed);
        }
      }

      // If still no speech was captured
      if (!savedTranscript.trim()) {
        setMicError(t.voiceReport.transcriptionFailed);
        setStep('idle');
      } else {
        setStep('review_text');
      }
    },
    [savedTranscript, t, resolveErrorMessage]
  );

  // Handle Stop Recording triggered by user click (reads current session directly, not stale state)
  const handleStopRecording = useCallback(() => {
    const session = currentSessionRef.current;
    if (!session || session.stopping || session.stopped) return;
    handleStopRecordingSession(session, 'user');
  }, [handleStopRecordingSession]);

  // Handle Starting Recording with double-start guard and race-proof permission handling
  const handleStartRecording = async () => {
    if (isStartingRef.current || currentSessionRef.current !== null) return;

    // Terminate any previous session if lingering before flagging start in-flight
    terminateActiveRecordingSession();
    isStartingRef.current = true;

    const myPermissionId = ++permissionRequestCounterRef.current;
    activePermissionRequestIdRef.current = myPermissionId;
    const sessionId = ++recordingSessionCounterRef.current;
    activeRequestIdRef.current++;

    setMicError(null);
    setApiNotice(null);
    setLiveStreamSpeech('');
    setSecondsElapsed(0);

    // Verify browser media support
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      if (activePermissionRequestIdRef.current === myPermissionId && isOpenRef.current) {
        setMicError(t.voiceReport.browserUnsupported);
        isStartingRef.current = false;
        activePermissionRequestIdRef.current = 0;
      }
      return;
    }

    if (typeof MediaRecorder === 'undefined') {
      if (activePermissionRequestIdRef.current === myPermissionId && isOpenRef.current) {
        setMicError(t.voiceReport.mediaApiUnsupported);
        isStartingRef.current = false;
        activePermissionRequestIdRef.current = 0;
      }
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      // If this request is no longer the active permission request or modal closed, discard silently
      if (activePermissionRequestIdRef.current !== myPermissionId || !isOpenRef.current) {
        return;
      }
      isStartingRef.current = false;
      activePermissionRequestIdRef.current = 0;
      setMicError(t.voiceReport.micPermissionDenied);
      setStep(savedTranscript ? 'review_text' : 'idle');
      return;
    }

    // CRITICAL GUARD: After await getUserMedia(), check if this permission request is STILL active and modal is open!
    if (activePermissionRequestIdRef.current !== myPermissionId || !isOpenRef.current) {
      // Stale or cancelled permission stream! Stop all tracks immediately!
      stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // Ignore
        }
      });
      return;
    }

    isStartingRef.current = false;
    activePermissionRequestIdRef.current = 0;

    const chosenFormat = getSupportedAudioMime();
    const recorderOptions: MediaRecorderOptions = {};
    if (chosenFormat.mimeType) {
      recorderOptions.mimeType = chosenFormat.mimeType;
    }

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, recorderOptions);
    } catch {
      stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // Ignore
        }
      });
      setMicError(t.voiceReport.recorderStartFailed);
      setStep(savedTranscript ? 'review_text' : 'idle');
      return;
    }

      // Initialize Web Speech Recognition if available
      let recognition: SpeechRecognitionInstance | null = null;
      const win = typeof window !== 'undefined' ? (window as WindowWithSpeech) : null;
      const SpeechRecognitionClass = win?.SpeechRecognition || win?.webkitSpeechRecognition;

      if (SpeechRecognitionClass) {
        try {
          const rec = new SpeechRecognitionClass();
          rec.continuous = true;
          rec.interimResults = true;
          rec.lang = locale === 'ms' ? 'ms-MY' : 'en-US';
          recognition = rec;
        } catch {
          recognition = null;
        }
      }

      // Create discrete session instance
      const session: RecordingSession = {
        id: sessionId,
        stream,
        recorder,
        recognition,
        audioChunks: [],
        totalBytes: 0,
        speechText: '',
        timer: null,
        durationSeconds: 0,
        stopping: false,
        stopped: false,
      };

      currentSessionRef.current = session;

      setupSessionRecorderListeners(session, () => {
        handleStopRecordingSession(session, 'max_size');
      });

      if (recognition) {
        recognition.onresult = (event: SpeechRecognitionEventLike) => {
          if (session.stopped || currentSessionRef.current !== session) return;
          let full = '';
          for (let i = 0; i < event.results.length; i++) {
            full += event.results[i][0].transcript + ' ';
          }
          const clean = full.trim();
          if (clean) {
            session.speechText = clean;
            setLiveStreamSpeech(clean);
          }
        };

        recognition.onend = () => {
          if (recognitionEndResolverRef.current) {
            recognitionEndResolverRef.current();
            recognitionEndResolverRef.current = null;
          }
        };

        recognition.onerror = () => {
          // Non-fatal: fallback to audio blob transcription
        };

        try {
          recognition.start();
        } catch {
          session.recognition = null;
        }
      }

      try {
        recorder.start(400); // 400ms chunk emission
      } catch {
        stopSessionHardware(session);
        currentSessionRef.current = null;
        isStartingRef.current = false;
        activePermissionRequestIdRef.current = 0;
        setMicError(t.voiceReport.recorderStartFailed);
        setStep(savedTranscript ? 'review_text' : 'idle');
        return;
      }

      setStep('recording');
      isStartingRef.current = false;

      // Start duration countdown timer (60s max) WITHOUT side effects in React state setter
      session.timer = setInterval(() => {
        session.durationSeconds += 1;
        if (currentSessionRef.current === session) {
          setSecondsElapsed(session.durationSeconds);
        }

        if (session.durationSeconds >= MAX_RECORDING_SECONDS) {
          handleStopRecordingSession(session, 'max_duration');
        }
      }, 1000);
  };

  // Handle Cancel Current Recording without clearing previously saved transcript or draft
  const handleCancelRecording = () => {
    activePermissionRequestIdRef.current = 0;
    isStartingRef.current = false;
    terminateActiveRecordingSession();
    setStep(savedTranscript ? 'review_text' : 'idle');
  };

  // Reset all state intentionally
  const handleResetAll = () => {
    activePermissionRequestIdRef.current = 0;
    isStartingRef.current = false;
    terminateActiveRecordingSession();
    setStep('idle');
    setSavedTranscript('');
    setLiveStreamSpeech('');
    setDraftResult(null);
    setMicError(null);
    setApiNotice(null);
  };

  // When user edits the text in textarea, update state and invalidate old AI draft
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setSavedTranscript(e.target.value);
    if (draftResult) {
      setDraftResult(null); // Invalidate old AI draft when transcript text changes
    }
  };

  // Generate AI Draft from current text with cancellation and double-click protection
  const handleGenerateDraft = async () => {
    const textToProcess = savedTranscript.trim();
    if (textToProcess.length < 5 || isGeneratingDraftRef.current || step === 'generating_draft') return;

    isGeneratingDraftRef.current = true;
    setStep('generating_draft');
    setMicError(null);
    setApiNotice(null);

    const requestId = ++activeRequestIdRef.current;

    try {
      const res = await generateReportDraftAction(textToProcess);

      // Discard stale response if request was superseded or cancelled
      if (requestId !== activeRequestIdRef.current) return;

      setDraftResult(res);

      if (res.success && res.draft) {
        setStep('draft_ready');
      } else if (res.code === 'API_NOT_AVAILABLE') {
        setApiNotice(t.voiceReport.apiMissingNotice);
        setStep('review_text');
      } else {
        const msg = resolveErrorMessage(res.code, res.error || t.voiceReport.transcriptionFailed);
        setMicError(msg);
        setStep('review_text');
      }
    } catch (err: unknown) {
      if (requestId !== activeRequestIdRef.current) return;
      setMicError((err as Error)?.message || 'Ralat semasa menjana draf.');
      setStep('review_text');
    } finally {
      isGeneratingDraftRef.current = false;
    }
  };

  // Apply raw text directly to form
  const handleUseRawText = () => {
    const text = savedTranscript.trim();
    if (!text) return;

    onApplyDraft({
      description: text,
      replaceDescriptionMode: existingDescription.trim() ? descConflictChoice : 'replace',
      replaceZoneMode: zoneConflictChoice,
    });
    handleCloseModal();
  };

  // Apply structured AI draft to form
  const handleApplyAIDraft = () => {
    if (!draftResult?.draft) return;
    const draft = draftResult.draft;

    let locationWarning: string | null = null;
    if (draft.blockMismatchWarning) {
      locationWarning = draft.blockMismatchWarning;
    } else if (!draft.matchedZoneId) {
      locationWarning = 'Lokasi spesifik tidak dikenal pasti dalam blok ini. Sila semak pilihan zon.';
    }

    onApplyDraft({
      title: draft.title,
      description: draft.description,
      category: draft.category,
      zoneId: draft.matchedZoneId, // Can be null if unknown/mismatched
      locationWarning,
      replaceDescriptionMode: existingDescription.trim() ? descConflictChoice : 'replace',
      replaceZoneMode: zoneConflictChoice,
    });
    handleCloseModal();
  };

  // Unified Escape key handling: window-level listener so Escape works regardless of which element has focus
  useEffect(() => {
    if (!isOpen) return;
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCloseModal();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isOpen, handleCloseModal]);

  // Dialog keydown handler for container
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      handleCloseModal();
    }
  };

  if (!isOpen) return null;

  const formatTimer = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const categoryLabels: Record<FacilityCategory, string> = {
    water_supply: t.reportForm.catWater,
    lift: t.reportForm.catLift,
    corridor_lighting: t.reportForm.catLighting,
  };

  const hasExistingDescription = Boolean(existingDescription.trim());
  const hasExistingZone = Boolean(existingZoneId);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="voice-modal-title"
      tabIndex={-1}
      ref={modalContainerRef}
      onKeyDown={handleKeyDown}
      data-testid="voice-narrative-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150 outline-hidden"
    >
      <div className="relative w-full max-w-lg bg-white rounded-2xl border-2 border-[#CBD5E1] shadow-2xl p-6 sm:p-7 space-y-5 max-h-[90vh] overflow-y-auto">
        {/* Modal Header */}
        <div className="flex items-start justify-between border-b border-[#CBD5E1] pb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-[#EBF3FC] text-[#1554AD] flex items-center justify-center border border-[#CBD5E1] shadow-xs">
              <Mic className="w-5 h-5 text-[#1554AD]" />
            </div>
            <div>
              <h2 id="voice-modal-title" className="text-lg font-bold text-[#17212F]">
                {t.voiceReport.modalTitle}
              </h2>
              <p className="text-xs text-[#374151]">
                {t.voiceReport.modalSubtitle}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCloseModal}
            className="p-2 text-[#374151] hover:text-[#17212F] hover:bg-[#F8F9FA] rounded-lg transition-colors min-w-[40px] min-h-[40px] flex items-center justify-center cursor-pointer"
            aria-label={t.common.close}
            data-testid="voice-modal-close-button"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Status / Error Alerts with polite live announcements */}
        <div aria-live="polite" className="space-y-2">
          {micError && (
            <div
              className="p-3.5 bg-[#FEF2F2] border-2 border-[#DC2626] rounded-xl text-xs text-[#991B1B] flex items-start gap-2.5"
              data-testid="voice-error-banner"
            >
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-[#DC2626]" />
              <span className="font-semibold leading-relaxed">{micError}</span>
            </div>
          )}

          {apiNotice && (
            <div
              className="p-3.5 bg-[#FEF9C3] border-2 border-[#CA8A04] rounded-xl text-xs text-[#713F12] space-y-1.5"
              data-testid="api-notice-banner"
            >
              <div className="font-bold flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-[#CA8A04]" />
                <span>{t.voiceReport.apiMissingNotice}</span>
              </div>
            </div>
          )}
        </div>

        {/* ------------------------------------------------------------------ */}
        {/* STEP 1: IDLE / READY TO RECORD */}
        {/* ------------------------------------------------------------------ */}
        {step === 'idle' && (
          <div className="text-center py-4 space-y-5">
            <div className="space-y-1.5">
              <p className="text-sm font-semibold text-[#17212F]">
                {t.voiceReport.micPermissionNeeded}
              </p>
              <p className="text-xs text-[#374151] max-w-sm mx-auto leading-relaxed">
                {t.voiceReport.micPermissionDesc}
              </p>
            </div>

            {/* Accessible Record Action */}
            <button
              type="button"
              onClick={handleStartRecording}
              className="mx-auto w-24 h-24 rounded-full bg-[#1554AD] text-white hover:bg-[#0E3E85] active:scale-95 transition-all shadow-md flex flex-col items-center justify-center gap-1 min-h-[48px] cursor-pointer"
              data-testid="start-voice-record-button"
            >
              <Mic className="w-8 h-8" />
              <span className="text-[11px] font-bold uppercase tracking-wider">
                {t.voiceReport.startRecording}
              </span>
            </button>

            {/* Narrative Guidelines & Truthful Privacy Notice */}
            <div className="space-y-2 text-left">
              <div className="p-3 bg-[#F0F5FC] border border-[#CBD5E1] rounded-xl text-xs text-[#374151] space-y-1">
                <div className="font-bold text-[#1554AD] flex items-center gap-1.5">
                  <Volume2 className="w-4 h-4 text-[#1554AD]" />
                  <span>{t.voiceReport.narrativeTipsTitle}</span>
                </div>
                <p className="leading-relaxed">{t.voiceReport.narrativeTipsBody}</p>
              </div>

              <div className="p-2.5 bg-[#F8F9FA] border border-[#CBD5E1] rounded-lg text-[11px] text-[#374151] flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#1554AD] shrink-0" />
                <span>{t.voiceReport.privacyDisclosure}</span>
              </div>
            </div>

            {savedTranscript && (
              <div className="pt-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setStep('review_text')}
                  className="text-xs font-bold text-[#1554AD] hover:underline flex items-center gap-1"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>
                    {t.voiceReport.viewSavedText} ({savedTranscript.length}{' '}
                    {locale === 'ms' ? 'aksara' : 'chars'})
                  </span>
                </button>
                <button
                  type="button"
                  onClick={handleResetAll}
                  className="text-xs text-[#DC2626] hover:underline flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>{t.voiceReport.resetDraftBtn}</span>
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={handleCloseModal}
              className="w-full py-2 text-xs font-bold text-[#374151] hover:text-[#17212F] underline min-h-[40px]"
            >
              {t.voiceReport.continueWithManualForm}
            </button>
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* STEP 2: RECORDING ACTIVE */}
        {/* ------------------------------------------------------------------ */}
        {step === 'recording' && (
          <div className="text-center py-4 space-y-5" data-testid="recording-active-view">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#FEF2F2] border border-[#DC2626] text-[#DC2626] text-xs font-bold animate-pulse">
                <span className="w-2.5 h-2.5 rounded-full bg-[#DC2626]" />
                <span>{t.voiceReport.recordingStatus}</span>
              </div>

              <div className="text-3xl font-mono font-extrabold text-[#17212F]">
                {formatTimer(secondsElapsed)}
                <span className="text-xs text-[#374151] font-normal ml-1">/ 01:00</span>
              </div>

              <div className="w-full bg-[#CBD5E1] h-2 rounded-full overflow-hidden">
                <div
                  className="bg-[#DC2626] h-full transition-all duration-1000"
                  style={{ width: `${(secondsElapsed / MAX_RECORDING_SECONDS) * 100}%` }}
                />
              </div>
            </div>

            {/* Live Streaming Speech Preview */}
            <div className="p-3.5 bg-[#F8F9FA] border border-[#CBD5E1] rounded-xl text-left min-h-[85px] max-h-[130px] overflow-y-auto">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#374151] block mb-1">
                {t.voiceReport.liveTranscriptLabel}
              </span>
              <p className="text-sm text-[#17212F] leading-relaxed italic">
                {liveStreamSpeech ? `"${liveStreamSpeech}"` : t.voiceReport.liveTranscriptPlaceholder}
              </p>
            </div>

            {/* Controls */}
            <div className="flex flex-col sm:flex-row gap-2.5">
              <button
                type="button"
                onClick={handleStopRecording}
                className="flex-1 py-3 px-5 rounded-xl font-bold text-sm bg-[#1554AD] text-white hover:bg-[#0E3E85] flex items-center justify-center gap-2 min-h-[48px] shadow-xs cursor-pointer"
                data-testid="stop-voice-record-button"
              >
                <Square className="w-4 h-4 fill-current" />
                <span>{t.voiceReport.stopRecording}</span>
              </button>

              <button
                type="button"
                onClick={handleCancelRecording}
                className="py-3 px-4 rounded-xl font-bold text-sm border-2 border-[#CBD5E1] bg-white text-[#374151] hover:bg-[#F8F9FA] min-h-[48px] cursor-pointer"
              >
                {t.voiceReport.cancelRecording}
              </button>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* STEP 3: TRANSCRIBING / GENERATING SPINNER */}
        {/* ------------------------------------------------------------------ */}
        {(step === 'transcribing' || step === 'generating_draft') && (
          <div className="text-center py-10 space-y-4" data-testid="voice-generating-draft-spinner">
            <Loader2 className="w-10 h-10 text-[#1554AD] animate-spin mx-auto" />
            <div className="space-y-1">
              <p className="text-sm font-bold text-[#17212F]">
                {step === 'transcribing' ? t.voiceReport.processingAudio : t.voiceReport.generatingDraft}
              </p>
              <p className="text-xs text-[#374151]">
                {step === 'transcribing'
                  ? t.voiceReport.processingAudio
                  : t.voiceReport.extractingDraft}
              </p>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* STEP 4: REVIEW & EDIT TRANSCRIPTION */}
        {/* ------------------------------------------------------------------ */}
        {step === 'review_text' && (
          <div className="space-y-4" data-testid="voice-review-text-view">
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-[#17212F] flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-[#1554AD]" />
                <span>{t.voiceReport.reviewStepTitle}</span>
              </h3>
              <p className="text-xs text-[#374151]">
                {t.voiceReport.reviewStepDesc}
              </p>
            </div>

            <textarea
              rows={4}
              value={savedTranscript}
              onChange={handleTextareaChange}
              placeholder={t.voiceReport.rawTextPlaceholder}
              className="w-full p-3.5 rounded-xl border-2 border-[#CBD5E1] text-sm text-[#17212F] bg-white focus:outline-none focus:border-[#1554AD] leading-relaxed resize-y"
              data-testid="voice-transcript-textarea"
            />

            {/* Description Conflict Strategy if existing description present in form */}
            {hasExistingDescription && (
              <div className="p-3 bg-[#F0F5FC] border border-[#CBD5E1] rounded-xl text-xs space-y-2">
                <div className="font-bold text-[#17212F]">
                  {t.voiceReport.existingDescConflictTitle}
                </div>
                <p className="text-[#374151]">{t.voiceReport.existingDescConflictBody}</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 pt-1">
                  {(['replace', 'keep', 'append'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setDescConflictChoice(mode)}
                      className={`p-2 rounded-lg border text-xs font-semibold transition-all ${
                        descConflictChoice === mode
                          ? 'border-[#1554AD] bg-white text-[#1554AD] shadow-xs'
                          : 'border-[#CBD5E1] bg-[#F8F9FA] text-[#374151]'
                      }`}
                    >
                      {mode === 'replace' && t.voiceReport.replaceDescAction}
                      {mode === 'keep' && t.voiceReport.keepDescAction}
                      {mode === 'append' && t.voiceReport.appendDescAction}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2 pt-1">
              {/* Primary: Structure with AI */}
              <button
                type="button"
                onClick={handleGenerateDraft}
                disabled={savedTranscript.trim().length < 5}
                className="w-full py-3 px-4 rounded-xl font-bold text-sm bg-[#1554AD] text-white hover:bg-[#0E3E85] disabled:opacity-50 flex items-center justify-center gap-2 min-h-[48px] shadow-xs cursor-pointer"
                data-testid="generate-ai-draft-button"
              >
                <Sparkles className="w-4 h-4 text-yellow-300" />
                <span>{t.voiceReport.generateDraftBtn}</span>
              </button>

              {/* Secondary: Use Text Directly in Form without AI */}
              <button
                type="button"
                onClick={handleUseRawText}
                disabled={savedTranscript.trim().length < 5}
                className="w-full py-3 px-4 rounded-xl font-bold text-sm border-2 border-[#CBD5E1] bg-white text-[#17212F] hover:bg-[#F0F5FC] flex items-center justify-center gap-2 min-h-[48px] cursor-pointer"
                data-testid="use-raw-text-button"
              >
                <Check className="w-4 h-4 text-[#1554AD]" />
                <span>{t.voiceReport.useRawTextBtn}</span>
              </button>

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => handleStartRecording()}
                  className="text-xs font-bold text-[#374151] hover:text-[#17212F] flex items-center gap-1"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>{t.voiceReport.reRecordBtn}</span>
                </button>
                <button
                  type="button"
                  onClick={handleResetAll}
                  className="text-xs text-[#DC2626] hover:underline flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>{t.voiceReport.resetDraftBtn}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* STEP 5: AI DRAFT READY */}
        {/* ------------------------------------------------------------------ */}
        {step === 'draft_ready' && draftResult?.draft && (
          <div className="space-y-4" data-testid="voice-draft-ready-view">
            <div className="space-y-1 border-b border-[#CBD5E1] pb-3">
              <h3 className="text-sm font-bold text-[#17212F] flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-[#1554AD]" />
                <span>{t.voiceReport.draftResultTitle}</span>
              </h3>
              <p className="text-xs text-[#374151]">
                {t.voiceReport.draftResultDesc}
              </p>
            </div>

            {/* Structured Card */}
            <div className="p-4 bg-[#F8F9FA] border-2 border-[#CBD5E1] rounded-xl space-y-3 text-xs">
              {draftResult.draft.title && (
                <div>
                  <span className="font-bold text-[#374151] block uppercase tracking-wider text-[11px]">
                    {t.voiceReport.suggestedTitle}:
                  </span>
                  <p className="text-sm font-extrabold text-[#17212F] mt-0.5">
                    {draftResult.draft.title}
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 pt-1 border-t border-[#CBD5E1]">
                <div>
                  <span className="font-bold text-[#374151] block uppercase tracking-wider text-[11px]">
                    {t.voiceReport.suggestedCategory}:
                  </span>
                  <span className="inline-block mt-0.5 px-2.5 py-1 rounded-md font-bold bg-[#EBF3FC] text-[#1554AD] border border-[#CBD5E1]">
                    {draftResult.draft.category
                      ? categoryLabels[draftResult.draft.category]
                      : t.voiceReport.unidentifiedCategory}
                  </span>
                </div>

                <div>
                  <span className="font-bold text-[#374151] block uppercase tracking-wider text-[11px]">
                    {t.voiceReport.suggestedZone}:
                  </span>
                  <span className="inline-block mt-0.5 px-2.5 py-1 rounded-md font-semibold text-[#17212F] bg-white border border-[#CBD5E1]">
                    {draftResult.draft.matchedZoneId
                      ? zones.find((z) => z.id === draftResult?.draft?.matchedZoneId)?.name || 'Zon Disahkan'
                      : t.voiceReport.unidentifiedZone}
                  </span>
                </div>
              </div>

              {draftResult.draft.mentionedFloor !== null && (
                <div className="pt-1 border-t border-[#CBD5E1]">
                  <span className="font-bold text-[#374151] block uppercase tracking-wider text-[11px]">
                    Aras Dikenalpasti:
                  </span>
                  <span className="font-bold text-[#17212F]">
                    Tingkat {draftResult.draft.mentionedFloor}
                  </span>
                </div>
              )}

              <div className="pt-1 border-t border-[#CBD5E1]">
                <span className="font-bold text-[#374151] block uppercase tracking-wider text-[11px] mb-1">
                  {t.voiceReport.suggestedDesc}:
                </span>
                <p className="text-xs text-[#17212F] bg-white p-3 rounded-lg border border-[#CBD5E1] leading-relaxed">
                  {draftResult.draft.description}
                </p>
              </div>
            </div>

            {/* Block Mismatch Alert */}
            {draftResult.draft.blockMismatchWarning && (
              <div
                className="p-3 bg-[#FEF2F2] border-2 border-[#DC2626] rounded-xl text-xs text-[#991B1B] space-y-1"
                data-testid="block-mismatch-alert"
              >
                <div className="font-bold flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-[#DC2626]" />
                  <span>{t.voiceReport.blockMismatchAlert}</span>
                </div>
                <p className="leading-relaxed">{draftResult.draft.blockMismatchWarning}</p>
              </div>
            )}

            {/* Missing Info Warning */}
            {draftResult.draft.missingFields.length > 0 && (
              <div
                className="p-3 bg-[#FEF9C3] border-2 border-[#CA8A04] rounded-xl text-xs text-[#713F12] space-y-1"
                data-testid="missing-info-box"
              >
                <div className="font-bold flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-[#CA8A04]" />
                  <span>{t.voiceReport.missingInfoTitle}</span>
                </div>
                <ul className="list-disc pl-5 space-y-0.5">
                  {draftResult.draft.missingFields.map((field, i) => (
                    <li key={i}>{field}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Conflict Option for Description */}
            {hasExistingDescription && (
              <div className="p-3 bg-[#F0F5FC] border border-[#CBD5E1] rounded-xl text-xs space-y-2">
                <div className="font-bold text-[#17212F]">
                  {t.voiceReport.existingDescConflictTitle}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                  {(['replace', 'keep', 'append'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setDescConflictChoice(mode)}
                      className={`p-2 rounded-lg border text-xs font-semibold transition-all ${
                        descConflictChoice === mode
                          ? 'border-[#1554AD] bg-white text-[#1554AD] shadow-xs'
                          : 'border-[#CBD5E1] bg-[#F8F9FA] text-[#374151]'
                      }`}
                    >
                      {mode === 'replace' && t.voiceReport.replaceDescAction}
                      {mode === 'keep' && t.voiceReport.keepDescAction}
                      {mode === 'append' && t.voiceReport.appendDescAction}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Conflict Option for Zone (when draft has no matched zone but user already selected one) */}
            {hasExistingZone && !draftResult.draft.matchedZoneId && (
              <div className="p-3 bg-[#F0F5FC] border border-[#CBD5E1] rounded-xl text-xs space-y-2">
                <div className="font-bold text-[#17212F]">
                  Pilihan Zon / Aras
                </div>
                <p className="text-[#374151]">
                  {draftResult.draft.blockMismatchWarning
                    ? 'Terdapat percanggahan blok dalam rakaman anda. Anda boleh mengekalkan zon sedia ada atau mengosongkannya untuk semakan semula.'
                    : 'Draf AI tidak mengenal pasti zon khusus. Adakah anda ingin mengekalkan zon yang telah dipilih sebelum ini?'}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setZoneConflictChoice('keep_existing')}
                    className={`p-2 rounded-lg border text-xs font-semibold ${
                      zoneConflictChoice === 'keep_existing'
                        ? 'border-[#1554AD] bg-white text-[#1554AD] shadow-xs'
                        : 'border-[#CBD5E1] bg-[#F8F9FA] text-[#374151]'
                    }`}
                  >
                    Kekalkan Zon Sedia Ada
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoneConflictChoice('apply')}
                    className={`p-2 rounded-lg border text-xs font-semibold ${
                      zoneConflictChoice === 'apply'
                        ? 'border-[#1554AD] bg-white text-[#1554AD] shadow-xs'
                        : 'border-[#CBD5E1] bg-[#F8F9FA] text-[#374151]'
                    }`}
                  >
                    Kosongkan Pilihan Zon
                  </button>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-2.5 pt-2">
              <button
                type="button"
                onClick={handleApplyAIDraft}
                className="flex-1 py-3 px-5 rounded-xl font-bold text-sm bg-[#1554AD] text-white hover:bg-[#0E3E85] flex items-center justify-center gap-2 min-h-[48px] shadow-xs cursor-pointer"
                data-testid="apply-ai-draft-button"
              >
                <Check className="w-4 h-4" />
                <span>{t.voiceReport.applyDraftBtn}</span>
              </button>

              <button
                type="button"
                onClick={() => setStep('review_text')}
                className="py-3 px-4 rounded-xl font-bold text-sm border-2 border-[#CBD5E1] bg-white text-[#374151] hover:bg-[#F8F9FA] min-h-[48px] cursor-pointer"
              >
                {t.voiceReport.editFurtherBtn}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
