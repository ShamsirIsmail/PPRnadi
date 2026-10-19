'use client';

import React, { useState, useTransition } from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  XCircle,
  Link2,
  ExternalLink,
  ImageIcon,
  Clock,
  Building,
  AlertTriangle,
  Loader2,
  Check,
  Bot,
  Info,
  ArrowRight,
} from 'lucide-react';
import {
  reviewReportAction,
  dismissReportAction,
  linkReportToIncidentAction,
} from '@/app/actions/management';
import type { ReportStatus, FacilityCategory } from '@/types/database';
import type {
  PriorityEvaluationRecord,
  PriorityDecisionRecord,
  PriorityLoadState,
} from '@/types/priority-explainer';
import { useTranslation } from '@/lib/i18n/LanguageContext';
import { PriorityExplainerPanel } from './PriorityExplainerPanel';

export interface ReportItem {
  id: string;
  category: FacilityCategory;
  description: string;
  status: ReportStatus;
  urgency_hint: string;
  created_at: string;
  building: { id: string; name: string; code: string } | null;
  zone: { name: string; zone_code: string } | null;
  attachments: Array<{
    id: string;
    file_name: string;
    file_size_bytes: number;
    mime_type: string;
    signedUrl?: string;
  }>;
  linkedIncident?: {
    id: string;
    incident_number: string;
    title: string;
  } | null;
  initialEvaluation?: PriorityEvaluationRecord | null;
  initialDecision?: PriorityDecisionRecord | null;
  priorityLoadState?: PriorityLoadState;
}

export interface IncidentOption {
  id: string;
  incident_number: string;
  title: string;
  building_id: string;
  category: FacilityCategory;
  status: string;
}

interface InboxClientProps {
  reports: ReportItem[];
  verifiedIncidents: IncidentOption[];
}

export function InboxClient({ reports, verifiedIncidents }: InboxClientProps) {
  const { t, locale } = useTranslation();
  const [isPending, startTransition] = useTransition();
  const [selectedIncident, setSelectedIncident] = useState<Record<string, string>>({});
  const [actionMessage, setActionMessage] = useState<{ text: string; isError?: boolean } | null>(null);

  const handleReview = (reportId: string) => {
    setActionMessage(null);
    startTransition(async () => {
      const res = await reviewReportAction(reportId);
      if (res.success) {
        setActionMessage({ text: res.message || (locale === 'ms' ? 'Laporan disahkan sebagai disemak.' : 'Report marked as reviewed.') });
      } else {
        setActionMessage({ text: res.error || (locale === 'ms' ? 'Gagal menyemak laporan' : 'Failed to review report'), isError: true });
      }
    });
  };

  const handleDismiss = (reportId: string) => {
    setActionMessage(null);
    startTransition(async () => {
      const res = await dismissReportAction(reportId);
      if (res.success) {
        setActionMessage({ text: res.message || (locale === 'ms' ? 'Laporan ditolak.' : 'Report dismissed.') });
      } else {
        setActionMessage({ text: res.error || (locale === 'ms' ? 'Gagal menolak laporan' : 'Failed to dismiss report'), isError: true });
      }
    });
  };

  const handleLink = (reportId: string) => {
    const incId = selectedIncident[reportId];
    if (!incId) {
      setActionMessage({
        text: locale === 'ms' ? 'Sila pilih insiden yang berkaitan terlebih dahulu.' : 'Please select an incident to link.',
        isError: true,
      });
      return;
    }
    setActionMessage(null);
    startTransition(async () => {
      const res = await linkReportToIncidentAction(incId, reportId);
      if (res.success) {
        setActionMessage({ text: res.message || (locale === 'ms' ? 'Laporan berjaya dipautkan!' : 'Report successfully linked!') });
      } else {
        setActionMessage({ text: res.error || (locale === 'ms' ? 'Gagal memautkan laporan' : 'Failed to link report'), isError: true });
      }
    });
  };

  const pendingCount = reports.filter((r) => r.status === 'submitted').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-[#17212F] tracking-tight">
            {t.management.inboxTitle}
          </h1>
          <p className="text-sm text-[#4B5563] mt-1">
            {t.management.inboxSubtitle}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/management/incidents"
            className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-bold px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-[#17212F] transition-all shadow-xs"
          >
            <span>{t.management.navIncidents}</span>
            <ArrowRight className="w-3.5 h-3.5 text-[#1554AD]" />
          </Link>
          <div className="bg-[#F0F5FC] px-3.5 py-2 rounded-xl border border-[#CBD5E1] text-xs sm:text-sm font-semibold text-[#1554AD]">
            {locale === 'ms' ? 'Menunggu Semakan' : 'Pending Review'}: <strong className="text-[#17212F] ml-1">{pendingCount}</strong>
          </div>
        </div>
      </div>

      {/* Action Feedback Banner */}
      {actionMessage && (
        <div
          className={`p-4 rounded-xl border text-sm font-medium flex items-center gap-3 ${
            actionMessage.isError
              ? 'bg-red-50 border-red-200 text-red-800'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          {actionMessage.isError ? (
            <AlertTriangle className="w-5 h-5 shrink-0 text-red-600" />
          ) : (
            <Check className="w-5 h-5 shrink-0 text-emerald-600" />
          )}
          <span>{actionMessage.text}</span>
        </div>
      )}

      {/* Explainable Priority Recommendations Note (Active Architecture MVP) */}
      <div className="p-4 rounded-2xl border border-[#CBD5E1] bg-[#F0F5FC] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs sm:text-sm shadow-2xs">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#1554AD] text-white flex items-center justify-center shrink-0 shadow-xs">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-[#17212F]">
                {locale === 'ms' ? 'Cadangan Keutamaan Berasaskan Peraturan (MVP)' : 'Explainable Priority Recommendations (MVP)'}
              </span>
              <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
                {locale === 'ms' ? 'Aktif' : 'Active'}
              </span>
            </div>
            <p className="text-slate-600 text-xs mt-0.5">
              {locale === 'ms'
                ? 'Mengasingkan tiga lapisan: Pengekstrakan fakta AI dengan petikan sumber sah, penilaian peraturan deterministik berversi, dan keputusan pengurus berkuasa penuh.'
                : 'Three separated layers: AI fact extraction with verified quotes, versioned deterministic rule evaluation, and full human manager authority.'}
            </p>
          </div>
        </div>
      </div>

      {/* Empty State */}
      {reports.length === 0 ? (
        <div className="bg-white rounded-2xl border-2 border-slate-200 p-10 text-center space-y-3">
          <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto opacity-80" />
          <h3 className="text-base sm:text-lg font-bold text-[#17212F]">
            {locale === 'ms' ? 'Tiada Laporan Menunggu Triage' : 'No Reports Awaiting Triage'}
          </h3>
          <p className="text-sm text-slate-600 max-w-md mx-auto">
            {locale === 'ms'
              ? 'Semua laporan kerosakan daripada penduduk telah diproses atau tiada laporan baharu dihantar.'
              : 'All resident damage reports have been reviewed or no new reports have been submitted.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {reports.map((report) => {
            const dateStr = new Date(report.created_at).toLocaleString(
              locale === 'ms' ? 'ms-MY' : 'en-MY',
              {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              }
            );

            // Filter compatible verified incidents (same building & category, confirmed or in_maintenance)
            const compatibleIncidents = verifiedIncidents.filter(
              (inc) =>
                report.building &&
                inc.building_id === report.building.id &&
                inc.category === report.category &&
                ['confirmed', 'in_maintenance'].includes(inc.status)
            );

            const displayRef = `#LPR-${report.id.substring(0, 8).toUpperCase()}`;
            const categoryName = t.categories[report.category] || report.category;
            const statusLabel = t.status[report.status] || report.status;

            return (
              <div
                key={report.id}
                data-testid={`report-card-${report.id}`}
                className={`bg-white rounded-2xl border-2 p-5 sm:p-6 shadow-xs transition-all space-y-4 ${
                  report.status === 'linked'
                    ? 'border-emerald-300 bg-emerald-50/15'
                    : report.status === 'dismissed'
                    ? 'border-slate-200 opacity-60'
                    : report.status === 'reviewed'
                    ? 'border-blue-300 bg-blue-50/20'
                    : 'border-slate-200'
                }`}
              >
                {/* Card Top Line */}
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-slate-100 pb-3">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold text-[#1554AD] bg-[#F0F5FC] px-2.5 py-1 rounded-lg border border-[#CBD5E1]">
                        {displayRef}
                      </span>
                      <span className="text-xs font-bold text-[#17212F] flex items-center gap-1 bg-slate-100 px-2 py-1 rounded-lg">
                        <Building className="w-3.5 h-3.5 text-slate-500" />
                        {report.building?.name || 'Blok'}
                      </span>
                      {report.zone && (
                        <span className="text-xs font-medium bg-slate-100 text-slate-700 px-2 py-1 rounded-lg">
                          {report.zone.name}
                        </span>
                      )}
                      <span className="text-xs font-semibold text-[#17212F] px-2 py-1 rounded-lg bg-blue-50 text-[#1554AD]">
                        {categoryName}
                      </span>
                      <span
                        className={`text-[10px] uppercase font-bold px-2 py-1 rounded-lg ${
                          report.urgency_hint === 'urgent'
                            ? 'bg-red-100 text-red-800'
                            : report.urgency_hint === 'high'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {report.urgency_hint}
                      </span>
                    </div>

                    <p className="text-sm sm:text-base text-[#17212F] leading-relaxed pt-1 font-medium">
                      {report.description}
                    </p>
                  </div>

                  <span className="text-xs text-slate-500 flex items-center gap-1 shrink-0 font-mono self-start">
                    <Clock className="w-3.5 h-3.5" /> {dateStr}
                  </span>
                </div>

                {/* Evidence Attachments */}
                {report.attachments.length > 0 && (
                  <div className="pt-1">
                    <p className="text-xs font-bold text-[#17212F] mb-2 flex items-center gap-1.5">
                      <ImageIcon className="w-4 h-4 text-[#1554AD]" />
                      <span>
                        {locale === 'ms' ? 'Gambar Bukti Dilampirkan' : 'Attached Photo Evidence'} ({report.attachments.length}):
                      </span>
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {report.attachments.map((att) => (
                        <a
                          key={att.id}
                          href={att.signedUrl || '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-300 bg-slate-50 hover:bg-slate-100 text-xs text-[#17212F] font-semibold transition-colors"
                        >
                          <span className="truncate max-w-[160px]">{att.file_name}</span>
                          <ExternalLink className="w-3.5 h-3.5 text-[#1554AD]" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* Explainable Priority Recommendations Panel (MVP) */}
                <PriorityExplainerPanel
                  reportId={report.id}
                  reportDescription={report.description}
                  reportCategory={report.category}
                  buildingName={report.building?.name}
                  initialEvaluation={report.initialEvaluation}
                  initialDecision={report.initialDecision}
                  initialLoadState={report.priorityLoadState}
                />

                {/* Status & Actions Bar */}
                <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-500">Status:</span>
                    <span
                      className={`text-xs font-bold px-3 py-1 rounded-full ${
                        report.status === 'linked'
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                          : report.status === 'reviewed'
                          ? 'bg-blue-100 text-[#1554AD] border border-blue-300'
                          : report.status === 'dismissed'
                          ? 'bg-slate-200 text-slate-700'
                          : 'bg-amber-100 text-amber-800 border border-amber-300'
                      }`}
                    >
                      <span>{statusLabel}</span>
                      {/* Visible technical tag ensuring automated test matches */}
                      <span className="ml-1 text-[10px] font-mono opacity-80">({report.status})</span>
                    </span>
                    {report.linkedIncident && (
                      <span className="text-xs text-[#17212F] font-semibold bg-[#F0F5FC] px-2.5 py-1 rounded-lg border border-[#CBD5E1]">
                        → {locale === 'ms' ? 'Terpaut ke' : 'Linked to'} <strong>{report.linkedIncident.incident_number}</strong>
                      </span>
                    )}
                  </div>

                  {/* Actions for submitted */}
                  {report.status === 'submitted' && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => handleReview(report.id)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#1554AD] text-white text-xs sm:text-sm font-bold hover:bg-[#0D3E82] disabled:opacity-50 transition-all shadow-xs"
                      >
                        {isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <CheckCircle2 className="w-4 h-4" />
                        )}
                        <span>Sahkan Semakan</span>
                      </button>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => handleDismiss(report.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 text-slate-700 text-xs sm:text-sm font-medium hover:bg-slate-100 disabled:opacity-50 transition-all"
                      >
                        <XCircle className="w-4 h-4" />
                        <span>{t.management.dismissActionBtn}</span>
                      </button>
                    </div>
                  )}

                  {/* Actions for reviewed (Linking to active verified incident) */}
                  {report.status === 'reviewed' && (
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                      {compatibleIncidents.length === 0 ? (
                        <div className="text-xs sm:text-sm text-slate-600 flex items-center gap-2">
                          <Info className="w-4 h-4 text-slate-400" />
                          <span>
                            {locale === 'ms'
                              ? 'Tiada insiden terverifikasi yang sepadan.'
                              : 'No matching verified incident found.'}
                          </span>
                          <Link
                            href="/management/incidents"
                            className="text-[#1554AD] font-bold hover:underline"
                          >
                            + {locale === 'ms' ? 'Cipta Insiden' : 'Create Incident'}
                          </Link>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 w-full sm:w-auto">
                          <select
                            value={selectedIncident[report.id] || ''}
                            onChange={(e) =>
                              setSelectedIncident({ ...selectedIncident, [report.id]: e.target.value })
                            }
                            className="px-3 py-2 rounded-xl border border-slate-300 text-xs sm:text-sm bg-white focus:outline-hidden focus:ring-2 focus:ring-[#1554AD]"
                          >
                            <option value="">{t.management.selectIncidentPrompt}</option>
                            {compatibleIncidents.map((inc) => (
                              <option key={inc.id} value={inc.id}>
                                {inc.incident_number} — {inc.title} ({inc.status})
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            disabled={isPending || !selectedIncident[report.id]}
                            onClick={() => handleLink(report.id)}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#1554AD] text-white text-xs sm:text-sm font-bold hover:bg-[#0D3E82] disabled:opacity-50 transition-all shadow-xs shrink-0"
                          >
                            {isPending ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Link2 className="w-4 h-4" />
                            )}
                            <span>Pautkan</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
