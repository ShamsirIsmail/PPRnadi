'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Mic,
  Square,
  Sparkles,
  X,
  Loader2,
  AlertCircle,
  HelpCircle,
  RotateCcw,
  ArrowRight,
} from 'lucide-react';
import { useTranslation } from '@/lib/i18n/LanguageContext';
import {
  generateReportDraftAction,
  type ReportDraftResult,
  type ExistingDraftContext,
} from '@/app/actions/ai-draft';
import {
  type SpeechRecognitionInstance,
  type SpeechRecognitionEventLike,
  type WindowWithSpeech,
} from '@/lib/voice/recording-session';

interface VoiceCorrectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingDraft: ExistingDraftContext;
  onApplyCorrection: (
    updatedDraft: NonNullable<ReportDraftResult['draft']>,
    summaryMessage: string,
    correctionMs: number
  ) => void;
}

export function VoiceCorrectionModal({
  isOpen,
  onClose,
  existingDraft,
  onApplyCorrection,
}: VoiceCorrectionModalProps) {
  const { t, locale } = useTranslation();

  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [clarificationNotice, setClarificationNotice] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const speechStartTimeRef = useRef<number>(0);
  const transcriptRef = useRef<string>('');
  const sessionIdRef = useRef<number>(0);
  const isProcessingRef = useRef<boolean>(false);

  // Clean stop of microphone and resolve final transcript
  const stopListening = useCallback((): Promise<string> => {
    return new Promise((resolve) => {
      const recognition = recognitionRef.current;
      if (recognition) {
        try {
          recognition.stop();
        } catch {}
      }
      setIsListening(false);
      setTimeout(() => {
        resolve(transcriptRef.current.trim());
      }, 80);
    });
  }, []);

  const handleClose = useCallback(() => {
    sessionIdRef.current = 0;
    isProcessingRef.current = false;
    stopListening();
    setIsListening(false);
    setIsProcessing(false);
    setTranscript('');
    transcriptRef.current = '';
    setErrorMessage(null);
    setClarificationNotice(null);
    onClose();
  }, [stopListening, onClose]);

  useEffect(() => {
    if (isOpen) {
      sessionIdRef.current = Date.now();
      transcriptRef.current = '';

      return () => {
        sessionIdRef.current = 0;
        if (recognitionRef.current) {
          try {
            recognitionRef.current.abort();
          } catch {}
          recognitionRef.current = null;
        }
      };
    }
  }, [isOpen]);

  const startListening = useCallback(() => {
    setErrorMessage(null);
    setClarificationNotice(null);
    setTranscript('');
    transcriptRef.current = '';

    if (typeof window === 'undefined') return;
    const win = window as WindowWithSpeech;
    const SpeechRecognitionClass = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechRecognitionClass) {
      setErrorMessage(t.reportForm.assistantSpeechNotSupported);
      return;
    }

    try {
      const recognition = new SpeechRecognitionClass();
      recognition.lang = locale === 'ms' ? 'ms-MY' : 'en-US';
      recognition.continuous = false;
      recognition.interimResults = true;
      recognitionRef.current = recognition;

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
          setErrorMessage(t.reportForm.assistantMicDenied);
        } else if (errCode !== 'no-speech') {
          setErrorMessage(
            locale === 'ms'
              ? 'Ralat mikrofon dikesan. Sila cuba lagi.'
              : 'Microphone error detected. Please try again.'
          );
        }
        setIsListening(false);
        recognitionRef.current = null;
      };

      recognition.onend = () => {
        setIsListening(false);
        recognitionRef.current = null;
        // transcript remains preserved
      };

      recognition.start();
    } catch {
      setErrorMessage(t.reportForm.assistantMicDenied);
      setIsListening(false);
    }
  }, [locale, t.reportForm.assistantMicDenied, t.reportForm.assistantSpeechNotSupported]);

  // Process correction transcript
  const processCorrection = useCallback(
    async (textToProcess?: string) => {
      if (isProcessingRef.current) return;
      const thisSessionId = sessionIdRef.current;
      if (!thisSessionId) return;

      const spokenCorrection = (textToProcess ?? transcriptRef.current ?? transcript).trim();

      if (!spokenCorrection || spokenCorrection.length < 3) {
        setErrorMessage(
          locale === 'ms'
            ? 'Suara tidak jelas. Sila sebutkan pembetulan, contohnya: "Bukan tingkat 17, tingkat 16".'
            : 'Speech was unclear. Please state the correction, e.g. "Not floor 17, floor 16".'
        );
        return;
      }

      isProcessingRef.current = true;
      setIsProcessing(true);
      setErrorMessage(null);
      setClarificationNotice(null);

      try {
        const corrStart = Date.now();
        const res = await generateReportDraftAction(spokenCorrection, {
          mode: 'correction',
          existingDraft,
        });
        const elapsedCorr = Date.now() - corrStart;

        if (sessionIdRef.current !== thisSessionId) return;

        if (!res.success || !res.draft) {
          setErrorMessage(
            res.error ||
              (locale === 'ms' ? 'Pembetulan tidak berjaya diproses.' : 'Correction failed to process.')
          );
          return;
        }

        // Check if ambiguous clarification is required
        if (res.draft.clarificationPrompt) {
          const msg =
            locale === 'ms' ? res.draft.clarificationPrompt.ms : res.draft.clarificationPrompt.en;
          setClarificationNotice(msg);
          return;
        }

        // Check if floor bounds warning was flagged (e.g. Blok L floor 16)
        if (res.draft.invalidFloorWarning) {
          setClarificationNotice(res.draft.invalidFloorWarning);
          return;
        }

        // Summary confirmation
        const summaryMsg =
          (locale === 'ms' ? res.draft.correctionSummary?.ms : res.draft.correctionSummary?.en) ||
          (locale === 'ms' ? 'Maklumat telah dikemas kini.' : 'Details updated.');

        onApplyCorrection(res.draft, summaryMsg, elapsedCorr);
        handleClose();
      } catch {
        if (sessionIdRef.current !== thisSessionId) return;
        setErrorMessage(
          locale === 'ms'
            ? 'Ralat rangkaian semasa memproses pembetulan suara.'
            : 'Network error while processing voice correction.'
        );
      } finally {
        isProcessingRef.current = false;
        setIsProcessing(false);
      }
    },
    [existingDraft, locale, onApplyCorrection, handleClose, transcript]
  );

  const handleStopAndProcess = useCallback(async () => {
    const finalCaptured = await stopListening();
    await processCorrection(finalCaptured);
  }, [stopListening, processCorrection]);

  if (!isOpen) return null;

  const hasTranscript = transcript.trim().length > 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="voice-correction-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 id="voice-correction-title" className="text-base font-bold text-slate-900 leading-tight">
                {t.reportForm.voiceCorrectionTitle}
              </h2>
              <p className="text-xs text-slate-500">{t.reportForm.voiceCorrectionHint}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors cursor-pointer"
            aria-label={t.common.close}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <p className="text-sm text-slate-600 leading-relaxed">
            {locale === 'ms'
              ? 'Sebutkan pembetulan sahaja tanpa perlu mengulang semula keseluruhan keterangan masalah.'
              : 'State only the correction without re-recording the entire issue description.'}
          </p>

          {/* Transcript preview / Editable Box */}
          <div className="min-h-[84px] p-3 rounded-2xl bg-slate-50 border border-slate-200 text-slate-800 text-sm flex flex-col justify-center">
            {isListening ? (
              <p className="italic text-slate-400 animate-pulse text-center">
                {transcript || t.reportForm.voiceCorrectionListening}
              </p>
            ) : isProcessing ? (
              <span className="flex items-center justify-center gap-2 text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin text-[#1554AD]" />
                {t.reportForm.voiceCorrectionProcessing}
              </span>
            ) : hasTranscript ? (
              <div className="space-y-1">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                  {t.reportForm.assistantTranscriptReady}
                </span>
                <textarea
                  rows={2}
                  value={transcript}
                  onChange={(e) => {
                    setTranscript(e.target.value);
                    transcriptRef.current = e.target.value;
                  }}
                  className="w-full p-2 bg-white rounded-xl border border-slate-200 text-slate-900 text-sm font-medium focus:outline-none focus:border-[#1554AD] resize-none"
                  placeholder={locale === 'ms' ? 'Sunting pembetulan...' : 'Edit correction...'}
                />
              </div>
            ) : (
              <span className="text-slate-400 text-center">{t.reportForm.voiceCorrectionHint}</span>
            )}
          </div>

          {/* Clarification prompt if ambiguous or out-of-bounds */}
          {clarificationNotice && (
            <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-800 flex items-start gap-2.5 text-xs">
              <HelpCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span className="font-medium leading-relaxed">{clarificationNotice}</span>
            </div>
          )}

          {/* Error Message */}
          {errorMessage && (
            <div className="p-3 rounded-2xl bg-red-50 border border-red-200 text-red-700 flex items-start gap-2 text-xs">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}
        </div>

        {/* Action Controls */}
        <div className="p-5 border-t border-slate-100 bg-slate-50/50 flex flex-col gap-2.5">
          {isListening ? (
            <button
              type="button"
              onClick={handleStopAndProcess}
              className="w-full min-h-[50px] rounded-2xl bg-red-600 text-white font-bold text-sm flex items-center justify-center gap-2.5 shadow-md hover:bg-red-700 active:scale-[0.99] transition-all animate-pulse cursor-pointer"
            >
              <Square className="w-4 h-4 fill-white text-white" />
              <span>{t.reportForm.assistantStopSpeaking}</span>
            </button>
          ) : isProcessing ? (
            <div className="w-full min-h-[50px] rounded-2xl bg-slate-200 text-slate-700 font-semibold text-sm flex items-center justify-center gap-2.5">
              <Loader2 className="w-4 h-4 animate-spin text-[#1554AD]" />
              <span>{t.reportForm.voiceCorrectionProcessing}</span>
            </div>
          ) : hasTranscript ? (
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={() => processCorrection()}
                className="flex-1 min-h-[50px] rounded-2xl bg-[#1554AD] text-white font-bold text-sm flex items-center justify-center gap-2 shadow-md hover:bg-[#0E3E85] active:scale-[0.99] transition-all cursor-pointer"
              >
                <span>{t.reportForm.voiceCorrectionUseBtn}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={startListening}
                className="min-h-[50px] px-4 rounded-2xl border border-slate-300 bg-white text-slate-700 font-semibold text-xs hover:bg-slate-50 flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <RotateCcw className="w-4 h-4 text-slate-500" />
                <span>{t.reportForm.voiceCorrectionReRecordBtn}</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={startListening}
              className="w-full min-h-[50px] rounded-2xl bg-[#1554AD] text-white font-bold text-sm flex items-center justify-center gap-2.5 shadow-md hover:bg-[#0E3E85] active:scale-[0.99] transition-all cursor-pointer"
            >
              <Mic className="w-4 h-4 text-white" />
              <span>{t.reportForm.assistantPressToSpeak}</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleClose}
            className="w-full min-h-[44px] rounded-xl border border-slate-300 text-slate-700 font-semibold text-xs hover:bg-white active:bg-slate-100 transition-colors cursor-pointer"
          >
            {t.common.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}
