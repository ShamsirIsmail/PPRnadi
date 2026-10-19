'use client';

import React, { useState, useTransition, useEffect, useSyncExternalStore } from 'react';
import {
  Sparkles,
  AlertTriangle,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Check,
  Scale,
  RefreshCw,
} from 'lucide-react';
import {
  evaluateReportPriorityAction,
  confirmPriorityDecisionAction,
  getPriorityDataAction,
} from '@/app/actions/priority';
import type {
  PriorityEvaluationRecord,
  PriorityDecisionRecord,
  ManagerDecisionTier,
  PriorityTier,
  PriorityLoadState,
} from '@/types/priority-explainer';
import { useTranslation } from '@/lib/i18n/LanguageContext';

interface PriorityExplainerPanelProps {
  reportId: string;
  reportDescription: string;
  reportCategory: string;
  buildingName?: string;
  initialEvaluation?: PriorityEvaluationRecord | null;
  initialDecision?: PriorityDecisionRecord | null;
  initialLoadState?: PriorityLoadState | null;
}

const emptySubscribe = () => () => {};

export function PriorityExplainerPanel({
  reportId,
  reportDescription,
  buildingName,
  initialEvaluation,
  initialDecision,
  initialLoadState,
}: PriorityExplainerPanelProps) {
  const { locale } = useTranslation();
  const [isPending, startTransition] = useTransition();

  const [loadState, setLoadState] = useState<PriorityLoadState | null>(
    initialLoadState || null
  );

  const [isExpanded, setIsExpanded] = useState(false);
  const [activeStep, setActiveStep] = useState<0 | 1 | 2 | 3>(0);
  const [evaluation, setEvaluation] = useState<PriorityEvaluationRecord | null>(
    initialEvaluation || null
  );
  const [latestDecision, setLatestDecision] = useState<PriorityDecisionRecord | null>(
    initialDecision || null
  );

  // Demo fixture selector
  const [selectedDemoKey, setSelectedDemoKey] = useState<'real' | 'lift' | 'water' | 'light'>('real');
  const [highlightedQuote, setHighlightedQuote] = useState<string | null>(null);

  // Decision form state
  const [selectedDecisionOverride, setSelectedDecisionOverride] = useState<ManagerDecisionTier | null>(null);
  const decisionChoice: ManagerDecisionTier =
    selectedDecisionOverride ??
    latestDecision?.decidedPriority ??
    evaluation?.ruleResult?.recommendedPriority ??
    'standard_review';

  const [overrideReason, setOverrideReason] = useState('');
  const [activeIdempotencyKey, setActiveIdempotencyKey] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [decisionSuccessMsg, setDecisionSuccessMsg] = useState<string | null>(null);
  const [evaluationError, setEvaluationError] = useState<string | null>(null);

  const isHydrated = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  const [currentVersion, setCurrentVersion] = useState<number>(
    initialDecision?.decisionVersion ?? 0
  );

  const hasDataError =
    !latestDecision &&
    (loadState?.decisionStatus === 'error' ||
      loadState?.decisionStatus === 'timeout' ||
      loadState?.evaluationStatus === 'error' ||
      loadState?.evaluationStatus === 'timeout');

  const isVersionKnown = loadState ? loadState.isVersionKnown : true;

  const reloadPriorityData = () => {
    setEvaluationError(null);
    setDecisionError(null);
    startTransition(async () => {
      const res = await getPriorityDataAction(reportId);
      if (res.success) {
        setEvaluation(res.evaluation);
        setLatestDecision(res.latestDecision);
        if (typeof res.currentVersion === 'number') {
          setCurrentVersion(res.currentVersion);
        }
        setLoadState({
          evaluationStatus: 'loaded',
          decisionStatus: 'loaded',
          linkStatus: 'loaded',
          isVersionKnown: true,
        });
      } else {
        setLoadState({
          evaluationStatus: 'error',
          decisionStatus: 'error',
          linkStatus: 'error',
          isVersionKnown: false,
          userMessage: {
            ms: 'Gagal memuatkan data dari pangkalan data. Sila cuba semula.',
            en: 'Failed to load data from database. Please retry.',
          },
        });
      }
    });
  };

  // Load existing priority data on mount if available
  useEffect(() => {
    let mounted = true;
    getPriorityDataAction(reportId).then((res) => {
      if (!mounted) return;
      if (res.success) {
        setEvaluation(res.evaluation);
        setLatestDecision(res.latestDecision);
        if (typeof res.currentVersion === 'number') {
          setCurrentVersion(res.currentVersion);
        }
        setLoadState({
          evaluationStatus: 'loaded',
          decisionStatus: 'loaded',
          linkStatus: 'loaded',
          isVersionKnown: true,
        });
      } else {
        setLoadState((prev) => ({
          evaluationStatus: prev?.evaluationStatus === 'loaded' ? 'loaded' : 'error',
          decisionStatus: prev?.decisionStatus === 'loaded' ? 'loaded' : 'error',
          linkStatus: prev?.linkStatus === 'loaded' ? 'loaded' : 'error',
          isVersionKnown: false,
          userMessage: {
            ms: 'Pangkalan data tidak dapat diakses buat masa ini.',
            en: 'Database is currently inaccessible.',
          },
        }));
      }
    });
    return () => {
      mounted = false;
    };
  }, [reportId]);

  const handleEvaluate = (demoKey?: 'lift' | 'water' | 'light') => {
    console.log('[PriorityExplainerPanel] handleEvaluate initiated', { reportId, demoKey });
    setEvaluationError(null);
    setDecisionSuccessMsg(null);
    startTransition(async () => {
      // Real report evaluation passes no demoKey; demo preview passes demoKey
      const res = await evaluateReportPriorityAction(reportId, demoKey);
      console.log('[PriorityExplainerPanel] handleEvaluate result', res);
      if (res.success && res.evaluation) {
        setEvaluation(res.evaluation);
        setActiveStep(2); // Jump to recommendation view
        setIsExpanded(true);
      } else {
        setEvaluationError(
          res.error ||
            (locale === 'ms'
              ? 'Gagal menjana cadangan keutamaan'
              : 'Failed to evaluate priority')
        );
      }
    });
  };

  const handleDemoSelection = (key: 'real' | 'lift' | 'water' | 'light') => {
    setSelectedDemoKey(key);
    if (key === 'real') {
      handleEvaluate(); // Evaluates real report without fixture
    } else {
      handleEvaluate(key); // Evaluates preview fixture simulation
    }
  };

  const handleConfirmDecision = () => {
    setDecisionError(null);
    setDecisionSuccessMsg(null);

    // Prevent saving simulated demo cases to the real database
    if (selectedDemoKey !== 'real' || evaluation?.aiProvider === 'approved-prototype') {
      setDecisionError(
        locale === 'ms'
          ? 'Contoh simulasi demo tidak boleh disimpan sebagai keputusan rasmi. Sila pilih "Aduan Sebenar".'
          : 'Demo simulation cases cannot be saved as official decisions. Please select "Actual Report".'
      );
      return;
    }

    if (!isVersionKnown) {
      setDecisionError(
        locale === 'ms'
          ? 'Pengesahan disekat: versi keputusan semasa tidak diketahui. Sila cuba semula memuatkan data.'
          : 'Confirmation blocked: current decision version is unknown. Please retry loading data.'
      );
      return;
    }

    if (!evaluation?.id) {
      setDecisionError(
        locale === 'ms'
          ? 'Sila jana cadangan keutamaan terlebih dahulu sebelum membuat pengesahan.'
          : 'Please evaluate priority first before confirming a decision.'
      );
      return;
    }

    const recommended = evaluation?.ruleResult.recommendedPriority;
    const isOverride = !!recommended && decisionChoice !== recommended;

    if (isOverride && (!overrideReason || overrideReason.trim().length < 5)) {
      setDecisionError(
        locale === 'ms'
          ? 'Nyatakan sebab / catatan apabila mengubah cadangan sistem (minimum 5 aksara).'
          : 'Please provide a reason/note when overriding the system recommendation (min 5 characters).'
      );
      return;
    }

    // Reuse active key for retries after timeout/error; generate new one only for fresh actions
    const keyToUse = activeIdempotencyKey || crypto.randomUUID();
    setActiveIdempotencyKey(keyToUse);

    console.log('[PriorityExplainerPanel] handleConfirmDecision called with:', {
      reportId,
      decisionChoice,
      overrideReason,
      evaluationId: evaluation?.id,
      currentVersion,
    });

    startTransition(async () => {
      const res = await confirmPriorityDecisionAction(
        reportId,
        decisionChoice,
        overrideReason,
        evaluation?.id,
        keyToUse,
        currentVersion
      );
      if (res.success && res.decision) {
        setActiveIdempotencyKey(null); // Clean key on success
        setLatestDecision(res.decision);
        if (typeof res.decision.decisionVersion === 'number') {
          setCurrentVersion(res.decision.decisionVersion);
        }
        setDecisionSuccessMsg(
          locale === 'ms'
            ? `Keputusan pengurus berjaya disimpan ke pangkalan data: ${getTierLabel(res.decision.decidedPriority, 'ms')}.`
            : `Manager decision saved to database: ${getTierLabel(res.decision.decidedPriority, 'en')}.`
        );
      } else {
        // Keep activeIdempotencyKey intact so retrying the exact same action resends the identical key!
        // User inputs (decisionChoice & overrideReason) are preserved.
        setDecisionError(
          res.error ||
            (locale === 'ms'
              ? 'Gagal menyimpan keputusan'
              : 'Failed to record decision')
        );
      }
    });
  };

  const getTierLabel = (tier: ManagerDecisionTier | PriorityTier, lang: 'ms' | 'en') => {
    switch (tier) {
      case 'immediate_review':
        return lang === 'ms' ? 'Semak serta-merta' : 'Immediate review';
      case 'high_priority':
        return lang === 'ms' ? 'Keutamaan tinggi' : 'High priority';
      case 'standard_review':
        return lang === 'ms' ? 'Semakan biasa' : 'Standard review';
      case 'needs_more_info':
        return lang === 'ms' ? 'Perlu maklumat lanjut' : 'Needs more info';
      default:
        return tier;
    }
  };

  const getTierBadgeStyle = (tier?: ManagerDecisionTier | PriorityTier | null) => {
    switch (tier) {
      case 'immediate_review':
        return 'bg-red-100 text-red-800 border-red-300';
      case 'high_priority':
        return 'bg-amber-100 text-amber-800 border-amber-300';
      case 'standard_review':
        return 'bg-blue-100 text-[#1554AD] border-blue-300';
      case 'needs_more_info':
        return 'bg-purple-100 text-purple-800 border-purple-300';
      default:
        return 'bg-slate-100 text-slate-700 border-slate-300';
    }
  };

  const currentTier = evaluation?.ruleResult.recommendedPriority;
  const isDemo = evaluation?.aiProvider === 'approved-prototype';

  return (
    <div
      className="rounded-2xl border-2 border-[#CBD5E1] bg-white overflow-hidden shadow-xs"
      data-testid={`priority-explainer-${reportId}`}
      data-hydrated={isHydrated ? 'true' : 'false'}
      data-evaluation-id={evaluation?.id || ''}
      data-decision-id={latestDecision?.id || ''}
      data-decision-version={latestDecision?.decisionVersion !== undefined ? String(latestDecision.decisionVersion) : ''}
      data-decided-priority={latestDecision?.decidedPriority || ''}
      data-decided-by={latestDecision?.decidedById || ''}
      data-override-reason={latestDecision?.overrideReason || ''}
      data-is-override={latestDecision?.isOverride ? 'true' : 'false'}
    >
      {/* 1. Header / Collapsed Summary Bar */}
      <div className="p-4 bg-[#F8FAFC] border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-[#EBF3FC] text-[#1554AD] flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-[#17212F] uppercase tracking-wide">
                {locale === 'ms' ? 'Cadangan Keutamaan Sistem' : 'System Priority Recommendation'}
              </span>
              {buildingName && (
                <span className="text-[11px] font-medium text-slate-500">· {buildingName}</span>
              )}
              {latestDecision ? (
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300"
                  data-testid="decision-confirmed-badge"
                >
                  {locale === 'ms'
                    ? `Disahkan: ${getTierLabel(latestDecision.decidedPriority, 'ms')}`
                    : `Confirmed: ${getTierLabel(latestDecision.decidedPriority, 'en')}`}
                </span>
              ) : hasDataError ? (
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-800 border border-red-300 flex items-center gap-1"
                  data-testid="priority-data-error-badge"
                >
                  <AlertTriangle className="w-3 h-3 text-red-600" />
                  <span>{locale === 'ms' ? 'Ralat Memuat Data' : 'Data Load Error'}</span>
                </span>
              ) : (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700">
                  {locale === 'ms' ? 'Belum disahkan' : 'Unconfirmed'}
                </span>
              )}
              {isDemo && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
                  {locale === 'ms' ? 'Simulasi Demo' : 'Demo Simulation'}
                </span>
              )}
            </div>

            {evaluation ? (
              <div className="flex flex-wrap items-center gap-2 mt-1">
                <span
                  className={`text-xs font-extrabold px-2.5 py-0.5 rounded-lg border ${getTierBadgeStyle(
                    currentTier
                  )}`}
                >
                  {getTierLabel(currentTier!, locale as 'ms' | 'en')}
                </span>
                {evaluation.ruleResult.needsMoreInfo && (
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 flex items-center gap-1">
                    <HelpCircle className="w-3 h-3 text-amber-600" />
                    <span>{locale === 'ms' ? 'Perlu maklumat lanjut' : 'Needs more info'}</span>
                  </span>
                )}
                <span className="text-xs text-slate-600 truncate max-w-[280px]">
                  {locale === 'ms'
                    ? evaluation.ruleResult.primaryReasons.ms
                    : evaluation.ruleResult.primaryReasons.en}
                </span>
              </div>
            ) : hasDataError ? (
              <div className="flex items-center gap-2 mt-1" data-testid="priority-error-summary">
                <span className="text-xs text-red-700 font-medium">
                  {loadState?.userMessage?.[locale as 'ms' | 'en'] ||
                    (locale === 'ms'
                      ? 'Data keutamaan gagal dimuatkan dari pangkalan data.'
                      : 'Priority data failed to load from database.')}
                </span>
                <button
                  type="button"
                  onClick={reloadPriorityData}
                  disabled={isPending}
                  className="text-[11px] font-bold text-[#1554AD] underline hover:text-[#0D3E82] cursor-pointer"
                  data-testid="priority-retry-btn"
                >
                  {locale === 'ms' ? 'Cuba semula' : 'Retry'}
                </button>
              </div>
            ) : (
              <p className="text-xs text-slate-500 mt-0.5">
                {locale === 'ms'
                  ? 'Aduan belum dinilai oleh enjin peraturan. Tekan "Jana cadangan" untuk memulakan.'
                  : 'Report not yet assessed by rules engine. Click "Evaluate priority" to begin.'}
              </p>
            )}
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 shrink-0">
          {!evaluation && (
            hasDataError ? (
              <button
                type="button"
                onClick={reloadPriorityData}
                disabled={isPending}
                className="px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-600 text-white hover:bg-amber-700 transition-all flex items-center gap-1.5 shadow-xs cursor-pointer min-h-[36px]"
                data-testid={`retry-priority-btn-${reportId}`}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isPending ? 'animate-spin' : ''}`} />
                <span>{locale === 'ms' ? 'Cuba Semula' : 'Retry'}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleEvaluate()}
                disabled={isPending}
                className="px-3 py-1.5 rounded-xl text-xs font-bold bg-[#1554AD] text-white hover:bg-[#0E3E85] transition-all flex items-center gap-1.5 shadow-xs cursor-pointer min-h-[36px]"
                data-testid={`generate-priority-btn-${reportId}`}
              >
                {isPending ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>{locale === 'ms' ? 'Menilai...' : 'Evaluating...'}</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{locale === 'ms' ? 'Jana cadangan' : 'Evaluate priority'}</span>
                  </>
                )}
              </button>
            )
          )}

          {evaluation && (
            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              className="px-3 py-1.5 rounded-xl text-xs font-bold border border-slate-300 bg-white hover:bg-slate-50 text-[#17212F] transition-all flex items-center gap-1.5 min-h-[36px] cursor-pointer"
              data-testid={`toggle-explainer-btn-${reportId}`}
            >
              <span>
                {isExpanded
                  ? locale === 'ms'
                    ? 'Tutup perincian'
                    : 'Collapse'
                  : locale === 'ms'
                  ? 'Perincian & Semakan →'
                  : 'Details & Review →'}
              </span>
              {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </div>

      {/* Evaluation Error Banner */}
      {evaluationError && (
        <div className="p-3 bg-red-50 border-b border-red-200 text-xs font-semibold text-red-800 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{evaluationError}</span>
        </div>
      )}

      {/* Manager Decision Recorded Banner */}
      {latestDecision && !isExpanded && (
        <div className="p-3 bg-emerald-50 border-b border-emerald-200 text-xs font-semibold text-emerald-900 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>
              {locale === 'ms' ? 'Keputusan rasmi pengurus:' : 'Manager decision:'}{' '}
              <strong>{getTierLabel(latestDecision.decidedPriority, locale as 'ms' | 'en')}</strong>
              {latestDecision.isOverride && (
                <span className="ml-1 text-slate-600 font-normal">
                  ({locale === 'ms' ? 'Diubah daripada cadangan sistem' : 'Overridden from system'})
                </span>
              )}
            </span>
          </div>
          <span className="text-[11px] text-slate-500 font-mono">
            {new Date(latestDecision.decidedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      )}

      {/* 2. Expanded 4-Step Interactive Explainer */}
      {isExpanded && evaluation && (
        <div className="p-4 sm:p-6 space-y-5 bg-[#FAFCFF]">
          {/* Demo Fixture Switcher (Approved Prototype Reference) */}
          <div className="p-3 bg-white rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-bold text-[#17212F]">
                {locale === 'ms' ? 'Pilih contoh aduan (Pratonton):' : 'Select preview case:'}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleDemoSelection('real')}
                className={`px-2.5 py-1 rounded-lg font-semibold transition-all cursor-pointer ${
                  selectedDemoKey === 'real'
                    ? 'bg-[#1554AD] text-white shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {locale === 'ms' ? 'Aduan Sebenar' : 'Actual Report'}
              </button>
              <button
                type="button"
                onClick={() => handleDemoSelection('lift')}
                className={`px-2.5 py-1 rounded-lg font-semibold transition-all cursor-pointer ${
                  selectedDemoKey === 'lift'
                    ? 'bg-[#1554AD] text-white shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {locale === 'ms' ? 'Lif (Orang terperangkap)' : 'Lift (Trapped person)'}
              </button>
              <button
                type="button"
                onClick={() => handleDemoSelection('water')}
                className={`px-2.5 py-1 rounded-lg font-semibold transition-all cursor-pointer ${
                  selectedDemoKey === 'water'
                    ? 'bg-[#1554AD] text-white shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {locale === 'ms' ? 'Air (Laporan berkait)' : 'Water (Related reports)'}
              </button>
              <button
                type="button"
                onClick={() => handleDemoSelection('light')}
                className={`px-2.5 py-1 rounded-lg font-semibold transition-all cursor-pointer ${
                  selectedDemoKey === 'light'
                    ? 'bg-[#1554AD] text-white shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {locale === 'ms' ? 'Lampu (Satu padam)' : 'Light (Single out)'}
              </button>
            </div>
          </div>

          {/* 4-Step Navigation Tabs */}
          <div className="grid grid-cols-4 gap-1.5 border-b border-slate-200 pb-2">
            {[
              { idx: 0 as const, label: locale === 'ms' ? '1 · Aduan' : '1 · Report' },
              { idx: 1 as const, label: locale === 'ms' ? '2 · Bukti' : '2 · Evidence' },
              { idx: 2 as const, label: locale === 'ms' ? '3 · Cadangan' : '3 · Recommendation' },
              { idx: 3 as const, label: locale === 'ms' ? '4 · Keputusan' : '4 · Decision' },
            ].map((tab) => (
              <button
                key={tab.idx}
                type="button"
                onClick={() => setActiveStep(tab.idx)}
                className={`py-2 px-1 text-center text-xs font-bold rounded-lg transition-all cursor-pointer ${
                  activeStep === tab.idx
                    ? 'bg-[#1554AD] text-white shadow-xs'
                    : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                }`}
                data-testid={`explainer-step-tab-${tab.idx}`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* TAB 0: ADUAN (Original Complaint Quote) */}
          {activeStep === 0 && (
            <div className="space-y-3">
              <h4 className="text-sm font-bold text-[#17212F]">
                {locale === 'ms' ? 'Apa yang penduduk laporkan' : 'What the resident reported'}
              </h4>
              <div className="p-4 rounded-xl bg-white border border-[#CBD5E1] text-sm text-[#17212F] leading-relaxed italic shadow-2xs">
                “{selectedDemoKey === 'real' ? reportDescription : getDemoCaseQuote(selectedDemoKey)}”
              </div>
              <p className="text-xs text-slate-500">
                {locale === 'ms'
                  ? 'Teks asal dikekalkan. Sistem belum mengesahkan kejadian secara fizikal di lokasi.'
                  : 'Original text preserved. The system has not yet verified site events.'}
              </p>
            </div>
          )}

          {/* TAB 1: BUKTI (Extracted Facts & Source Quotes) */}
          {activeStep === 1 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-[#17212F]">
                  {locale === 'ms' ? 'Fakta dan sumber yang diekstrak' : 'Extracted facts & sources'}
                </h4>
                <span className="text-xs text-slate-500">
                  {locale === 'ms' ? 'Klik fakta untuk melihat petikan' : 'Click fact to view quote'}
                </span>
              </div>

              {/* Facts List */}
              <div className="space-y-2.5">
                {evaluation.extractedFacts.factsList.map((fact) => {
                  const isHighlighted = highlightedQuote === fact.sourceQuote;
                  return (
                    <div
                      key={fact.id}
                      onClick={() => setHighlightedQuote(fact.sourceQuote || null)}
                      className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                        isHighlighted
                          ? 'border-[#1554AD] bg-blue-50/40 shadow-xs'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                      data-testid={`fact-item-${fact.id}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <strong className="text-xs font-bold text-[#17212F]">
                          {locale === 'ms' ? fact.label.ms : fact.label.en}
                        </strong>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                            fact.status === 'reported'
                              ? 'bg-blue-50 text-[#1554AD] border border-blue-200'
                              : fact.status === 'verified'
                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {fact.status === 'reported'
                            ? locale === 'ms' ? 'Dilaporkan penduduk' : 'Reported'
                            : fact.status === 'verified'
                            ? locale === 'ms' ? 'Rekod rasmi' : 'Official record'
                            : locale === 'ms' ? 'Belum diketahui' : 'Unknown'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-700 mt-1">
                        {locale === 'ms' ? fact.detail.ms : fact.detail.en}
                      </p>

                      {fact.sourceQuote && (
                        <div className="mt-2 pt-2 border-t border-slate-100 flex items-start gap-1.5 text-[11px] text-slate-500 italic">
                          <span className="font-bold not-italic text-slate-600">
                            {locale === 'ms' ? 'Petikan sumber:' : 'Source quote:'}
                          </span>
                          <span>“{fact.sourceQuote}”</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Unknowns Section */}
              {evaluation.extractedFacts.unknowns.ms.length > 0 && (
                <div className="p-3.5 rounded-xl bg-[#FFF9EB] border border-[#FDE68A] text-xs text-[#92400E] space-y-1">
                  <div className="font-bold flex items-center gap-1.5">
                    <HelpCircle className="w-4 h-4 text-[#D97706]" />
                    <span>{locale === 'ms' ? 'Masih belum diketahui' : 'Currently unknown'}</span>
                  </div>
                  <ul className="list-disc pl-5 space-y-0.5 pt-1">
                    {(locale === 'ms'
                      ? evaluation.extractedFacts.unknowns.ms
                      : evaluation.extractedFacts.unknowns.en
                    ).map((u, i) => (
                      <li key={i}>{u}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: CADANGAN (Rule-Based Recommendation) */}
          {activeStep === 2 && (
            <div className="space-y-4">
              <h4 className="text-sm font-bold text-[#17212F]">
                {locale === 'ms' ? 'Cadangan awal · Belum keputusan rasmi' : 'Preliminary recommendation · Not final'}
              </h4>

              {/* Tier Card */}
              <div className={`p-4 rounded-xl border-l-4 bg-white border border-slate-200 shadow-xs space-y-2 ${
                currentTier === 'immediate_review'
                  ? 'border-l-red-600'
                  : currentTier === 'high_priority'
                  ? 'border-l-amber-500'
                  : 'border-l-blue-600'
              }`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    {locale === 'ms' ? 'Keutamaan dicadangkan' : 'Recommended priority'}
                  </span>
                  <span className="text-[11px] font-mono text-slate-400">
                    {evaluation.policyVersion}
                  </span>
                </div>
                <strong className={`text-xl font-extrabold block ${
                  currentTier === 'immediate_review'
                    ? 'text-red-700'
                    : currentTier === 'high_priority'
                    ? 'text-amber-700'
                    : 'text-[#1554AD]'
                }`}>
                  {getTierLabel(currentTier!, locale as 'ms' | 'en')}
                </strong>
                <p className="text-xs text-slate-700 leading-relaxed pt-1">
                  {locale === 'ms'
                    ? evaluation.ruleResult.primaryReasons.ms
                    : evaluation.ruleResult.primaryReasons.en}
                </p>
              </div>

              {/* Rule Basis */}
              <div className="p-3.5 rounded-xl bg-white border border-slate-200 text-xs space-y-1">
                <span className="font-bold text-slate-500 uppercase tracking-wide text-[10px] block">
                  {locale === 'ms' ? 'Asas Peraturan' : 'Rule Basis'}
                </span>
                <p className="font-bold text-[#17212F]">
                  {locale === 'ms'
                    ? evaluation.ruleResult.ruleBasisExplanation.ms
                    : evaluation.ruleResult.ruleBasisExplanation.en}
                </p>
                <div className="flex gap-1 pt-1">
                  {evaluation.ruleResult.ruleIds.map((rid) => (
                    <span key={rid} className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[10px]">
                      {rid}
                    </span>
                  ))}
                </div>
              </div>

              {/* Verification Questions */}
              {evaluation.ruleResult.verificationQuestions.ms.length > 0 && (
                <div className="p-3.5 rounded-xl bg-blue-50/60 border border-blue-200 text-xs text-[#1554AD] space-y-1.5">
                  <span className="font-bold block flex items-center gap-1.5">
                    <HelpCircle className="w-4 h-4 text-[#1554AD]" />
                    <span>{locale === 'ms' ? 'Soalan pengesahan untuk pengurus:' : 'Verification questions for manager:'}</span>
                  </span>
                  <ul className="list-disc pl-5 space-y-1 text-slate-800">
                    {(locale === 'ms'
                      ? evaluation.ruleResult.verificationQuestions.ms
                      : evaluation.ruleResult.verificationQuestions.en
                    ).map((q, idx) => (
                      <li key={idx} className="font-medium">{q}</li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="text-[11px] text-slate-500 leading-relaxed italic">
                {locale === 'ms'
                  ? 'Polisi contoh untuk prototaip pengurusan, belum diluluskan bagi operasi rasmi. Tiada skor keyakinan rekaan.'
                  : 'Prototype policy for management triage; not yet an official operational standard. No invented confidence scores.'}
              </p>
            </div>
          )}

          {/* TAB 3: KEPUTUSAN (Manager Decision Form) */}
          {activeStep === 3 && (
            <div className="space-y-4">
              <h4 className="text-sm font-bold text-[#17212F]">
                {locale === 'ms' ? 'Pengurus menentukan tindakan' : 'Manager specifies final action'}
              </h4>

              {/* Existing Confirmed Decision Card */}
              {latestDecision && (
                <div
                  className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl space-y-1"
                  data-testid="latest-decision-card"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <span>{locale === 'ms' ? 'Keputusan Semasa Disahkan' : 'Current Confirmed Decision'}</span>
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-200 text-emerald-800">
                      v{latestDecision.decisionVersion ?? currentVersion}
                    </span>
                  </div>
                  <p className="text-xs font-semibold text-emerald-950">
                    {getTierLabel(latestDecision.decidedPriority, locale as 'ms' | 'en')}
                    {latestDecision.isOverride && (
                      <span className="ml-1 text-amber-700 font-medium">
                        ({locale === 'ms' ? 'Mengubah cadangan sistem' : 'Overriding system recommendation'})
                      </span>
                    )}
                  </p>
                  {latestDecision.overrideReason && (
                    <p className="text-[11px] text-emerald-800 italic">
                      &quot;{latestDecision.overrideReason}&quot;
                    </p>
                  )}
                </div>
              )}

              {/* System Recommendation Summary */}
              <div className="p-3 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-between text-xs">
                <span className="text-slate-600 font-medium">
                  {locale === 'ms' ? 'Cadangan sistem asal:' : 'System recommendation:'}
                </span>
                <span className={`font-bold px-2 py-0.5 rounded ${getTierBadgeStyle(currentTier)}`}>
                  {getTierLabel(currentTier!, locale as 'ms' | 'en')}
                </span>
              </div>

              {/* Decision Choice */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#17212F] block">
                  {locale === 'ms' ? 'Pilih keputusan pengurus:' : 'Select manager decision:'}
                </label>
                <select
                  value={decisionChoice}
                  onChange={(e) => {
                    console.log('[PriorityExplainerPanel] select onChange:', e.target.value);
                    setSelectedDecisionOverride(e.target.value as ManagerDecisionTier);
                    setActiveIdempotencyKey(null);
                  }}
                  className="w-full p-2.5 rounded-xl border border-slate-300 text-sm bg-white font-medium text-[#17212F] focus:outline-none focus:border-[#1554AD] min-h-[44px]"
                  data-testid="manager-decision-select"
                >
                  <option value="immediate_review">
                    {locale === 'ms' ? 'Semak serta-merta' : 'Immediate review'}
                  </option>
                  <option value="high_priority">
                    {locale === 'ms' ? 'Keutamaan tinggi' : 'High priority'}
                  </option>
                  <option value="standard_review">
                    {locale === 'ms' ? 'Semakan biasa' : 'Standard review'}
                  </option>
                  <option value="needs_more_info">
                    {locale === 'ms' ? 'Perlu maklumat lanjut' : 'Needs more info'}
                  </option>
                </select>
              </div>

              {/* Override Reason (Required if overriding) */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-[#17212F] flex items-center justify-between">
                  <span>{locale === 'ms' ? 'Catatan / sebab perubahan:' : 'Notes / reason for override:'}</span>
                  {currentTier && decisionChoice !== currentTier && (
                    <span className="text-red-600 font-bold text-[11px]">
                      {locale === 'ms' ? '*Wajib dinyatakan jika mengubah' : '*Required when overriding'}
                    </span>
                  )}
                </label>
                <textarea
                  rows={2}
                  value={overrideReason}
                  onChange={(e) => {
                    setOverrideReason(e.target.value);
                    setActiveIdempotencyKey(null);
                  }}
                  placeholder={
                    locale === 'ms'
                      ? 'Contoh: maklumat baharu daripada pemeriksaan tapak atau kontraktor sedia ada'
                      : 'Example: new information from site inspection or ongoing contractor works'
                  }
                  className="w-full p-2.5 rounded-xl border border-slate-300 text-xs bg-white text-[#17212F] focus:outline-none focus:border-[#1554AD] min-h-[64px]"
                  data-testid="override-reason-textarea"
                />
              </div>

              {/* Feedback messages */}
              {decisionError && (
                <div className="p-3 bg-red-50 border border-red-200 text-xs font-bold text-red-800 rounded-xl">
                  {decisionError}
                </div>
              )}
              {decisionSuccessMsg && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-900 rounded-xl flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-600" />
                  <span>{decisionSuccessMsg}</span>
                </div>
              )}

              {/* Blocked action notice if version is unknown */}
              {!isVersionKnown && (
                <div
                  className="p-3 bg-amber-50 border border-amber-300 rounded-xl text-xs text-amber-900 font-medium flex items-center justify-between"
                  data-testid="decision-blocked-warning"
                >
                  <span>
                    {locale === 'ms'
                      ? 'Pengesahan disekat: status versi keputusan semasa tidak dapat disahkan dari pangkalan data.'
                      : 'Confirmation blocked: current decision version could not be verified from database.'}
                  </span>
                  <button
                    type="button"
                    onClick={reloadPriorityData}
                    className="px-2 py-1 bg-amber-200 hover:bg-amber-300 font-bold rounded text-amber-950 cursor-pointer"
                  >
                    {locale === 'ms' ? 'Muat Semula' : 'Reload'}
                  </button>
                </div>
              )}

              {/* Submit Action */}
              <button
                type="button"
                onClick={handleConfirmDecision}
                disabled={isPending || !isVersionKnown}
                className="w-full py-2.5 px-4 rounded-xl text-xs sm:text-sm font-bold bg-[#1554AD] text-white hover:bg-[#0E3E85] disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-xs cursor-pointer min-h-[44px]"
                data-testid="confirm-decision-btn"
              >
                {isPending ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>{locale === 'ms' ? 'Menyimpan...' : 'Saving...'}</span>
                  </>
                ) : (
                  <>
                    <Scale className="w-4 h-4" />
                    <span>{locale === 'ms' ? 'Sahkan keputusan pengurus' : 'Confirm manager decision'}</span>
                  </>
                )}
              </button>

              <p className="text-[11px] text-slate-500 text-center leading-relaxed">
                {locale === 'ms'
                  ? 'Pengesahan keutamaan tidak menerbitkan notis komuniti atau menghantar kontraktor secara automatik.'
                  : 'Priority confirmation does not publish community notices or auto-dispatch contractors.'}
              </p>
            </div>
          )}

          {/* Bottom Next Step Link */}
          {activeStep < 3 && (
            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setActiveStep((activeStep + 1) as 0 | 1 | 2 | 3)}
                className="text-xs font-bold text-[#1554AD] hover:underline flex items-center gap-1 cursor-pointer"
              >
                <span>
                  {activeStep === 0
                    ? locale === 'ms' ? 'Lihat bukti →' : 'View evidence →'
                    : activeStep === 1
                    ? locale === 'ms' ? 'Lihat cadangan →' : 'View recommendation →'
                    : locale === 'ms' ? 'Tentukan keputusan →' : 'Specify decision →'}
                </span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function getDemoCaseQuote(key: 'lift' | 'water' | 'light'): string {
  if (key === 'lift') {
    return 'Lif Blok A berhenti antara tingkat. Saya dengar orang di dalam meminta bantuan.';
  }
  if (key === 'water') {
    return 'Air tiada di rumah saya di Blok B sejak pagi.';
  }
  return 'Satu lampu koridor tingkat 4 Blok C padam. Lampu lain masih menyala.';
}
