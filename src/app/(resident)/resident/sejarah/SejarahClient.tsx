'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  PlusCircle,
  FileText,
  ChevronRight,
  Copy,
  Check,
  AlertTriangle,
  Droplets,
  ZapOff,
  Image as ImageIcon,
  AlertOctagon,
} from 'lucide-react';
import { useTranslation } from '@/lib/i18n/LanguageContext';
import {
  evaluateReportProgress,
  isReportActive,
} from '@/lib/reports/report-status-resolver';
import type { ReportStatus, FacilityCategory, IncidentStatus } from '@/types/database';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReportHistoryItem {
  id: string;
  category: FacilityCategory;
  description: string;
  status: ReportStatus;
  urgency_hint: string;
  created_at: string;
  updated_at?: string;
  buildingName: string;
  zoneName?: string | null;
  attachments: Array<{
    id: string;
    file_name: string;
    file_size_bytes: number;
    mime_type: string;
    signedUrl?: string;
  }>;
  linkedIncident?: {
    incidentNumber: string;
    title: string;
    status: string;
  } | null;
}

interface SejarahClientProps {
  reports: ReportHistoryItem[];
  reportsError?: string | null;
}

type FilterTab = 'all' | 'active' | 'resolved' | 'dismissed';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDisplayRef(id: string): string {
  return `#LPR-${id.substring(0, 8).toUpperCase()}`;
}

function getCategoryIcon(category: FacilityCategory) {
  switch (category) {
    case 'water_supply':
      return <Droplets className="w-4 h-4" />;
    case 'lift':
      return <AlertOctagon className="w-4 h-4" />;
    case 'corridor_lighting':
      return <ZapOff className="w-4 h-4" />;
    default:
      return <AlertTriangle className="w-4 h-4" />;
  }
}

function getCategoryColor(category: FacilityCategory): string {
  switch (category) {
    case 'water_supply':
      return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'lift':
      return 'bg-orange-50 text-orange-700 border-orange-200';
    case 'corridor_lighting':
      return 'bg-amber-50 text-amber-700 border-amber-200';
    default:
      return 'bg-slate-50 text-slate-700 border-slate-200';
  }
}

interface StatusBadgeProps {
  report: ReportHistoryItem;
}

function StatusBadge({ report }: StatusBadgeProps) {
  const { t } = useTranslation();
  const incidentStatus = report.linkedIncident?.status as IncidentStatus | undefined;
  const progress = evaluateReportProgress(report, incidentStatus ?? null);

  if (report.status === 'dismissed') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-red-50 text-red-700 border border-red-200">
        {t.status.dismissed}
      </span>
    );
  }

  const isActive = isReportActive(report, incidentStatus ?? null);
  const isResolved =
    progress.stepResolved === 'completed' ||
    report.linkedIncident?.status === 'resolved' ||
    report.linkedIncident?.status === 'closed';

  if (isResolved) {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
        {t.history.filterResolved}
      </span>
    );
  }

  if (isActive) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-blue-50 text-[#1554AD] border border-blue-200">
        <span className="w-1.5 h-1.5 rounded-full bg-[#1554AD] animate-pulse" />
        {t.history.filterActive}
      </span>
    );
  }

  // Linked with unknown incident status
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-slate-50 text-slate-600 border border-slate-200">
      {t.status.linked}
    </span>
  );
}

// ─── Progress dots for mini status indicator on cards ─────────────────────────

interface MiniProgressProps {
  report: ReportHistoryItem;
}

function MiniProgress({ report }: MiniProgressProps) {
  const { t } = useTranslation();
  const incidentStatus = report.linkedIncident?.status as IncidentStatus | undefined;
  const progress = evaluateReportProgress(report, incidentStatus ?? null);

  if (report.status === 'dismissed') return null;
  if (!progress.canShowProgress && progress.stepReceived === 'pending') return null;

  const steps = [
    { state: progress.stepReceived, label: t.history.timelineStepReceived },
    { state: progress.stepReview, label: t.history.timelineStepReview },
    { state: progress.stepAction, label: t.history.timelineStepAction },
    { state: progress.stepResolved, label: t.history.timelineStepResolved },
  ];

  return (
    <div className="mt-3 flex items-center gap-0">
      {steps.map((step, i) => (
        <React.Fragment key={i}>
          <div className="flex flex-col items-center">
            <div
              className={`w-3 h-3 rounded-full border-2 transition-colors ${
                step.state === 'completed'
                  ? 'bg-[#1554AD] border-[#1554AD]'
                  : step.state === 'active'
                  ? 'bg-white border-[#1554AD] ring-2 ring-blue-200'
                  : 'bg-slate-100 border-slate-300'
              }`}
            />
          </div>
          {i < steps.length - 1 && (
            <div
              className={`flex-1 h-0.5 mx-0.5 ${
                step.state === 'completed' ? 'bg-[#1554AD]' : 'bg-slate-200'
              }`}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ─── Copy Reference Button ─────────────────────────────────────────────────────

interface CopyRefButtonProps {
  refText: string;
  onManualCopyNeeded?: (text: string) => void;
}

function CopyRefButton({ refText, onManualCopyNeeded }: CopyRefButtonProps) {
  const { t } = useTranslation();
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const handleCopy = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(refText);
          setCopyState('copied');
          setTimeout(() => setCopyState('idle'), 2000);
        } else {
          throw new Error('Clipboard API unavailable');
        }
      } catch {
        setCopyState('failed');
        setTimeout(() => setCopyState('idle'), 2000);
        onManualCopyNeeded?.(refText);
      }
    },
    [refText, onManualCopyNeeded]
  );

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={t.history.copyRef}
      title={t.history.copyRef}
      className="inline-flex items-center gap-1 min-h-[44px] min-w-[44px] px-2 rounded-lg text-[#1554AD] hover:bg-blue-50 transition-colors"
    >
      {copyState === 'copied' ? (
        <>
          <Check className="w-3.5 h-3.5 text-emerald-600" />
          <span className="text-[11px] font-bold text-emerald-600">{t.history.copied}</span>
        </>
      ) : copyState === 'failed' ? (
        <>
          <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
          <span className="text-[11px] font-bold text-red-500">{t.history.copyFailed}</span>
        </>
      ) : (
        <Copy className="w-3.5 h-3.5" />
      )}
    </button>
  );
}

// ─── Report Card ──────────────────────────────────────────────────────────────

interface ReportCardProps {
  report: ReportHistoryItem;
  onManualCopyNeeded?: (text: string) => void;
}

function ReportCard({ report, onManualCopyNeeded }: ReportCardProps) {
  const { t, locale } = useTranslation();
  const displayRef = getDisplayRef(report.id);

  const dateStr = new Date(report.created_at).toLocaleDateString(
    locale === 'ms' ? 'ms-MY' : 'en-MY',
    { day: 'numeric', month: 'short', year: 'numeric' }
  );

  const imageAttachments = report.attachments.filter((a) =>
    a.mime_type.startsWith('image/')
  );

  const isDismissed = report.status === 'dismissed';

  return (
    <Link
      href={`/resident/sejarah/${report.id}`}
      className={`block bg-white rounded-2xl border transition-all hover:shadow-md hover:border-[#1554AD]/40 active:scale-[0.99] ${
        isDismissed ? 'border-slate-200 opacity-80' : 'border-slate-200'
      }`}
    >
      <div className="p-4 sm:p-5">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-1 min-w-0">
            <span className="font-mono text-xs font-extrabold text-[#1554AD] bg-blue-50 px-2 py-1 rounded-md border border-blue-100 shrink-0">
              {displayRef}
            </span>
            <CopyRefButton refText={displayRef} onManualCopyNeeded={onManualCopyNeeded} />
          </div>
          <StatusBadge report={report} />
        </div>

        {/* Category + Location */}
        <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
          <span
            className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-lg border ${getCategoryColor(
              report.category
            )}`}
          >
            {getCategoryIcon(report.category)}
            {t.categories[report.category] || report.category}
          </span>
          <span className="text-xs text-slate-500 font-medium">
            {report.buildingName}
            {report.zoneName ? ` · ${report.zoneName}` : ''}
          </span>
        </div>

        {/* Description snippet */}
        <p className="text-sm text-slate-700 leading-snug line-clamp-2 mb-3">
          {report.description}
        </p>

        {/* Photo thumbnails */}
        {imageAttachments.length > 0 && (
          <div className="flex gap-2 mb-3">
            {imageAttachments.slice(0, 3).map((att, idx) => (
              <div
                key={att.id}
                className="relative w-16 h-16 rounded-xl overflow-hidden border border-slate-200 bg-slate-100 shrink-0"
              >
                {att.signedUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={att.signedUrl}
                    alt={att.file_name}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex items-center justify-center w-full h-full">
                    <ImageIcon className="w-6 h-6 text-slate-400" />
                  </div>
                )}
                {idx === 2 && imageAttachments.length > 3 && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <span className="text-white text-xs font-bold">
                      +{imageAttachments.length - 3}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Mini progress + date row */}
        <div className="flex items-end justify-between gap-2">
          <div className="flex-1">
            <MiniProgress report={report} />
          </div>
          <div className="text-right shrink-0">
            <p className="text-[11px] text-slate-400">{t.history.submittedOn}</p>
            <p className="text-xs font-bold text-slate-600">{dateStr}</p>
          </div>
        </div>
      </div>

      {/* Footer CTA */}
      <div className="border-t border-slate-100 px-4 sm:px-5 py-2.5 flex items-center justify-between">
        <span className="text-xs text-slate-400 font-medium">
          {imageAttachments.length > 0
            ? `${imageAttachments.length} ${t.history.photos}`
            : ''}
        </span>
        <span className="text-xs font-bold text-[#1554AD] flex items-center gap-1">
          {t.history.viewDetails}
          <ChevronRight className="w-3.5 h-3.5" />
        </span>
      </div>
    </Link>
  );
}

// ─── Main SejarahClient ────────────────────────────────────────────────────────

export function SejarahClient({ reports, reportsError }: SejarahClientProps) {
  const { t } = useTranslation();

  // Initialize filter tab from URL query param if present
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
  const [manualCopyText, setManualCopyText] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const filterParam = params.get('filter') as FilterTab | null;
      if (filterParam && ['all', 'active', 'resolved', 'dismissed'].includes(filterParam)) {
        setActiveFilter(filterParam);
      }
    }
  }, []);

  const handleFilterChange = (filter: FilterTab) => {
    setActiveFilter(filter);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (filter === 'all') {
        url.searchParams.delete('filter');
      } else {
        url.searchParams.set('filter', filter);
      }
      window.history.replaceState(null, '', url.pathname + url.search);
    }
  };

  if (reportsError) {
    return (
      <div className="max-w-xl mx-auto px-4 py-6">
        <div className="p-4 bg-red-50 border border-red-200 text-red-800 rounded-2xl text-sm font-semibold">
          {t.residentHome.reportsLoadError}
        </div>
      </div>
    );
  }

  // Filter reports
  const filteredReports = reports.filter((report) => {
    const incidentStatus = report.linkedIncident?.status as IncidentStatus | undefined;
    const isActive = isReportActive(report, incidentStatus ?? null);
    const incProgress = evaluateReportProgress(report, incidentStatus ?? null);
    const isResolved =
      incProgress.stepResolved === 'completed' ||
      report.linkedIncident?.status === 'resolved' ||
      report.linkedIncident?.status === 'closed';

    if (activeFilter === 'all') return true;
    if (activeFilter === 'dismissed') return report.status === 'dismissed';
    if (activeFilter === 'resolved') return isResolved && report.status !== 'dismissed';
    if (activeFilter === 'active') return isActive && !isResolved;
    return true;
  });

  const tabs: Array<{ key: FilterTab; label: string }> = [
    { key: 'all', label: t.history.filterAll },
    { key: 'active', label: t.history.filterActive },
    { key: 'resolved', label: t.history.filterResolved },
    { key: 'dismissed', label: t.history.filterDismissed },
  ];

  return (
    <div className="max-w-xl mx-auto px-0">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-[#17212F] leading-tight">
            {t.history.pageTitle}
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">{t.history.pageSubtitle}</p>
        </div>
        <Link
          href="/resident/lapor"
          className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-[#1554AD] text-white text-xs font-bold hover:bg-[#0E3E85] transition-all shadow-sm shrink-0 min-h-[44px]"
        >
          <PlusCircle className="w-4 h-4" />
          <span>{t.history.newReportBtn}</span>
        </Link>
      </div>

      {/* Filter Tabs */}
      {reports.length > 0 && (
        <div className="px-4 mb-3">
          <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-1">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => handleFilterChange(tab.key)}
                className={`shrink-0 px-3.5 py-2 rounded-full text-xs font-bold transition-all min-h-[40px] ${
                  activeFilter === tab.key
                    ? 'bg-[#1554AD] text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Report List */}
      <div className="px-4 pb-24 space-y-3">
        {reports.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-3">
            <FileText className="w-12 h-12 text-[#1554AD] mx-auto opacity-40" />
            <h2 className="text-base font-bold text-[#17212F]">{t.history.emptyHeading}</h2>
            <p className="text-sm text-slate-500 max-w-xs mx-auto">{t.history.emptyDesc}</p>
            <Link
              href="/resident/lapor"
              className="inline-flex items-center justify-center mt-2 px-5 py-3 bg-[#1554AD] text-white text-sm font-bold rounded-xl hover:bg-[#0E3E85] transition-all min-h-[48px]"
            >
              {t.history.emptyAction}
            </Link>
          </div>
        ) : filteredReports.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-2">
            <FileText className="w-10 h-10 text-slate-300 mx-auto" />
            <h2 className="text-sm font-bold text-slate-600">{t.history.emptyFilteredHeading}</h2>
            <p className="text-xs text-slate-400">{t.history.emptyFilteredDesc}</p>
          </div>
        ) : (
          filteredReports.map((report) => (
            <ReportCard
              key={report.id}
              report={report}
              onManualCopyNeeded={(text) => setManualCopyText(text)}
            />
          ))
        )}
      </div>

      {/* Manual copy fallback modal */}
      {manualCopyText && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-xl border border-slate-200">
            <h3 className="text-sm font-bold text-[#17212F]">{t.history.copyRef}</h3>
            <p className="text-xs text-slate-500">{t.history.copyManualPrompt}</p>
            <input
              type="text"
              readOnly
              value={manualCopyText}
              onFocus={(e) => e.target.select()}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono text-xs text-[#17212F] bg-slate-50 select-all"
            />
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setManualCopyText(null)}
                className="px-4 py-2 bg-[#1554AD] text-white text-xs font-bold rounded-xl hover:bg-[#0E3E85] min-h-[44px]"
              >
                {t.history.closeManualCopy}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
