'use client';

import React, { useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Copy,
  Check,
  AlertTriangle,
  Droplets,
  ZapOff,
  Image as ImageIcon,
  AlertOctagon,
  Calendar,
  MapPin,
  Clock,
  ShieldAlert,
  Info,
} from 'lucide-react';
import { useTranslation } from '@/lib/i18n/LanguageContext';
import {
  evaluateReportProgress,
  isReportActive,
} from '@/lib/reports/report-status-resolver';
import type { FacilityCategory, ReportStatus, IncidentStatus } from '@/types/database';
import { PhotoLightboxModal } from './PhotoLightboxModal';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReportDetailData {
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
  publishedBulletins?: Array<{
    update_id: string;
    incident_number: string;
    update_title: string;
    message_bm: string;
    stage: string;
    published_at: string;
  }>;
}

interface ReportDetailViewProps {
  report: ReportDetailData;
}

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

export function ReportDetailView({ report }: ReportDetailViewProps) {
  const { t, locale } = useTranslation();
  const displayRef = getDisplayRef(report.id);

  // Lightbox state
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const activeTriggerRef = useRef<HTMLElement | null>(null);
  const thumbnailRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleOpenLightbox = useCallback((idx: number, e: React.MouseEvent<HTMLButtonElement>) => {
    activeTriggerRef.current = e.currentTarget;
    setLightboxIndex(idx);
    setLightboxOpen(true);
  }, []);

  const handleCloseLightbox = useCallback(() => {
    setLightboxOpen(false);
  }, []);

  const getThumbnailElement = useCallback((idx: number) => {
    return thumbnailRefs.current[idx] || null;
  }, []);

  // Copy states
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [copyFullState, setCopyFullState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [showManualCopyModal, setShowManualCopyModal] = useState(false);
  const [manualCopyValue, setManualCopyValue] = useState('');

  const incidentStatus = report.linkedIncident?.status as IncidentStatus | undefined;
  const progress = evaluateReportProgress(report, incidentStatus ?? null);
  const isActive = isReportActive(report, incidentStatus ?? null);
  const isResolved =
    progress.stepResolved === 'completed' ||
    report.linkedIncident?.status === 'resolved' ||
    report.linkedIncident?.status === 'closed';
  const isDismissed = report.status === 'dismissed';

  const dateLocale = locale === 'ms' ? 'ms-MY' : 'en-MY';

  const formatDateTime = (isoString?: string) => {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString(dateLocale, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoString;
    }
  };

  const formatDateOnly = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString(dateLocale, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return isoString;
    }
  };

  // Safe clipboard handler
  const handleCopy = useCallback(async (text: string, isFull: boolean) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        if (isFull) {
          setCopyFullState('copied');
          setTimeout(() => setCopyFullState('idle'), 2000);
        } else {
          setCopyState('copied');
          setTimeout(() => setCopyState('idle'), 2000);
        }
      } else {
        throw new Error('Clipboard API unavailable');
      }
    } catch {
      if (isFull) {
        setCopyFullState('failed');
      } else {
        setCopyState('failed');
      }
      setManualCopyValue(text);
      setShowManualCopyModal(true);
    }
  }, []);

  const imageAttachments = report.attachments.filter((a) =>
    a.mime_type.startsWith('image/')
  );

  return (
    <div className="max-w-xl mx-auto px-4 pb-28 pt-2 space-y-4">
      {/* Top back navigation & Page Title */}
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/resident/sejarah"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-[#1554AD] hover:underline min-h-[44px] px-2 py-2 -ml-2 rounded-lg hover:bg-blue-50 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>{t.history.backToList}</span>
        </Link>
        <h1 className="text-base font-extrabold text-[#17212F] truncate">
          {t.history.detailPageTitle}
        </h1>
      </div>

      {/* Dismissed Alert Banner */}
      {isDismissed && (
        <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-900 flex items-start gap-3 shadow-xs">
          <ShieldAlert className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h2 className="text-sm font-bold text-red-800">{t.status.dismissed}</h2>
            <p className="text-xs text-red-700 leading-relaxed">
              {t.history.detailDismissedBanner}
            </p>
          </div>
        </div>
      )}

      {/* Main Report Header Card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
        {/* Reference & Status Badges */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-extrabold text-[#1554AD] bg-blue-50 px-2.5 py-1.5 rounded-lg border border-blue-100">
              {displayRef}
            </span>
            <button
              type="button"
              onClick={() => handleCopy(displayRef, false)}
              aria-label={t.history.copyRef}
              title={t.history.copyRef}
              className="min-h-[40px] px-2.5 inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 text-slate-600 hover:text-[#1554AD] hover:bg-blue-50 transition-colors"
            >
              {copyState === 'copied' ? (
                <>
                  <Check className="w-4 h-4 text-emerald-600" />
                  <span className="text-xs font-bold text-emerald-600">{t.history.copied}</span>
                </>
              ) : copyState === 'failed' ? (
                <>
                  <AlertTriangle className="w-4 h-4 text-red-500" />
                  <span className="text-xs font-bold text-red-500">{t.history.copyFailed}</span>
                </>
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </button>
          </div>

          <div>
            {isDismissed ? (
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-red-50 text-red-700 border border-red-200">
                {t.history.filterDismissed}
              </span>
            ) : isResolved ? (
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                {t.history.filterResolved}
              </span>
            ) : isActive ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-blue-50 text-[#1554AD] border border-blue-200">
                <span className="w-1.5 h-1.5 rounded-full bg-[#1554AD] animate-pulse" />
                {t.history.filterActive}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-slate-50 text-slate-600 border border-slate-200">
                {t.status.linked}
              </span>
            )}
          </div>
        </div>

        {/* Copy full UUID option */}
        <div className="pt-1 flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-100">
          <span className="truncate max-w-[200px] font-mono select-all">
            ID: {report.id}
          </span>
          <button
            type="button"
            onClick={() => handleCopy(report.id, true)}
            className="text-[#1554AD] hover:underline font-semibold flex items-center gap-1 p-1 min-h-[36px]"
          >
            {copyFullState === 'copied' ? (
              <span className="text-emerald-600 font-bold">{t.history.fullIdCopied}</span>
            ) : (
              t.history.copyFullId
            )}
          </button>
        </div>

        {/* Category & Location metadata */}
        <div className="space-y-2 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-lg border ${getCategoryColor(
                report.category
              )}`}
            >
              {getCategoryIcon(report.category)}
              {t.categories[report.category] || report.category}
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-slate-600 font-medium">
            <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span>
              {report.buildingName}
              {report.zoneName ? ` · ${report.zoneName}` : ''}
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span>
              {t.history.detailDateLabel}:{' '}
              <strong className="text-slate-700">{formatDateOnly(report.created_at)}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* Description Card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-2">
        <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
          {t.history.detailDescLabel}
        </h2>
        <p className="text-sm text-[#17212F] leading-relaxed whitespace-pre-wrap">
          {report.description}
        </p>
      </div>

      {/* Vertical Timeline Card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-[#1554AD]" />
          <h2 className="text-sm font-bold text-[#17212F]">
            {t.history.detailTimelineTitle}
          </h2>
        </div>

        {/* Timeline steps */}
        {isDismissed ? (
          <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-slate-200">
            {/* Step 1: Diterima */}
            <div className="relative">
              <div className="absolute -left-6 top-1 w-5 h-5 rounded-full bg-[#1554AD] text-white flex items-center justify-center ring-4 ring-white">
                <Check className="w-3 h-3" />
              </div>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-bold text-[#17212F]">
                    {t.history.timelineStepReceived}
                  </h3>
                  <span className="text-[11px] text-slate-400">
                    {formatDateTime(report.created_at)}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {t.history.timelineStepReceivedDesc}
                </p>
              </div>
            </div>

            {/* Step 2: Ditolak */}
            <div className="relative">
              <div className="absolute -left-6 top-1 w-5 h-5 rounded-full bg-red-600 text-white flex items-center justify-center ring-4 ring-white">
                <ShieldAlert className="w-3 h-3" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-red-700">
                  {t.history.filterDismissed}
                </h3>
                <p className="text-xs text-red-600 mt-0.5">
                  {t.history.detailDismissedBanner}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-slate-200">
            {/* Step 1: Diterima */}
            <div className="relative">
              <div className="absolute -left-6 top-1 w-5 h-5 rounded-full bg-[#1554AD] text-white flex items-center justify-center ring-4 ring-white">
                <Check className="w-3 h-3" />
              </div>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-bold text-[#17212F]">
                    {t.history.timelineStepReceived}
                  </h3>
                  <span className="text-[11px] text-slate-400">
                    {formatDateTime(report.created_at)}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {t.history.timelineStepReceivedDesc}
                </p>
              </div>
            </div>

            {/* Step 2: Dalam Semakan */}
            <div className="relative">
              <div
                className={`absolute -left-6 top-1 w-5 h-5 rounded-full flex items-center justify-center ring-4 ring-white ${
                  progress.stepReview === 'completed'
                    ? 'bg-[#1554AD] text-white'
                    : progress.stepReview === 'active'
                    ? 'bg-amber-500 text-white animate-pulse'
                    : 'bg-slate-200 text-slate-400'
                }`}
              >
                {progress.stepReview === 'completed' ? (
                  <Check className="w-3 h-3" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-white" />
                )}
              </div>
              <div>
                <h3 className="text-xs font-bold text-[#17212F]">
                  {t.history.timelineStepReview}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {t.history.timelineStepReviewDesc}
                </p>
              </div>
            </div>

            {/* Step 3: Tindakan diambil / Kemas Kini Rasmi */}
            <div className="relative">
              <div
                className={`absolute -left-6 top-1 w-5 h-5 rounded-full flex items-center justify-center ring-4 ring-white ${
                  progress.stepAction === 'completed'
                    ? 'bg-[#1554AD] text-white'
                    : progress.stepAction === 'active'
                    ? 'bg-blue-600 text-white animate-pulse'
                    : 'bg-slate-200 text-slate-400'
                }`}
              >
                {progress.stepAction === 'completed' ? (
                  <Check className="w-3 h-3" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-white" />
                )}
              </div>
              <div className="space-y-2">
                <h3 className="text-xs font-bold text-[#17212F]">
                  {t.history.timelineStepAction}
                </h3>

                {/* Real published bulletins from database as Official Updates */}
                {report.publishedBulletins && report.publishedBulletins.length > 0 ? (
                  <div className="space-y-2 mt-2">
                    <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                      {t.history.officialUpdatesTitle}
                    </p>
                    {report.publishedBulletins.map((bulletin) => (
                      <div
                        key={bulletin.update_id}
                        className="p-3 rounded-xl bg-blue-50/70 border border-blue-100 text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between gap-1">
                          <strong className="text-[#1554AD]">{bulletin.update_title}</strong>
                          <span className="text-[10px] text-slate-400">
                            {formatDateTime(bulletin.published_at)}
                          </span>
                        </div>
                        <p className="text-slate-600 leading-snug">{bulletin.message_bm}</p>
                      </div>
                    ))}
                  </div>
                ) : report.status === 'linked' ? (
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-start gap-2">
                    <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                    <p>{t.history.detailLinkedNoteNoIncident}</p>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 mt-0.5">
                    {t.history.timelineStepActionDesc}
                  </p>
                )}
              </div>
            </div>

            {/* Step 4: Selesai */}
            <div className="relative">
              <div
                className={`absolute -left-6 top-1 w-5 h-5 rounded-full flex items-center justify-center ring-4 ring-white ${
                  progress.stepResolved === 'completed'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-200 text-slate-400'
                }`}
              >
                {progress.stepResolved === 'completed' ? (
                  <Check className="w-3 h-3" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-white" />
                )}
              </div>
              <div>
                <h3 className="text-xs font-bold text-[#17212F]">
                  {t.history.timelineStepResolved}
                </h3>
                <p
                  className={`text-xs mt-0.5 ${
                    progress.stepResolved === 'completed'
                      ? 'text-emerald-700 font-semibold'
                      : 'text-slate-400'
                  }`}
                >
                  {progress.stepResolved === 'completed'
                    ? t.history.timelineStepResolvedDesc
                    : t.history.timelineStepAwaitingResolution}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Photo Evidence Section */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ImageIcon className="w-4 h-4 text-[#1554AD]" />
            <h2 className="text-sm font-bold text-[#17212F]">
              {t.history.detailEvidenceTitle}
            </h2>
          </div>
          {imageAttachments.length > 0 && (
            <span className="text-xs font-semibold text-slate-400">
              {imageAttachments.length} {t.history.photos}
            </span>
          )}
        </div>

        {imageAttachments.length === 0 ? (
          <p className="text-xs text-slate-400 italic py-2">
            {t.history.noImagesAttached}
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2.5 pt-1">
            {imageAttachments.map((att, idx) => (
              <button
                key={att.id}
                type="button"
                ref={(el) => {
                  thumbnailRefs.current[idx] = el;
                }}
                onClick={(e) => handleOpenLightbox(idx, e)}
                className="relative aspect-square rounded-xl overflow-hidden border border-slate-200 bg-slate-100 hover:opacity-90 active:scale-95 transition-all focus:outline-hidden focus:ring-2 focus:ring-[#1554AD] min-h-[44px]"
                aria-label={`${t.history.detailEvidenceTitle} ${idx + 1}`}
                data-testid={`thumbnail-button-${idx}`}
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
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox Modal */}
      <PhotoLightboxModal
        images={imageAttachments.map((a) => ({
          id: a.id,
          file_name: a.file_name,
          signedUrl: a.signedUrl,
        }))}
        initialIndex={lightboxIndex}
        isOpen={lightboxOpen}
        onClose={handleCloseLightbox}
        triggerRef={activeTriggerRef}
        getTriggerElement={getThumbnailElement}
      />

      {/* Manual Copy Dialog Fallback */}
      {showManualCopyModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-xl border border-slate-200">
            <h3 className="text-sm font-bold text-[#17212F]">
              {t.history.copyRef}
            </h3>
            <p className="text-xs text-slate-500">
              {t.history.copyManualPrompt}
            </p>
            <input
              type="text"
              readOnly
              value={manualCopyValue}
              onFocus={(e) => e.target.select()}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono text-xs text-[#17212F] bg-slate-50 select-all"
            />
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowManualCopyModal(false)}
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
