'use client';

import React from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Clock,
  FileText,
  ExternalLink,
  Image as ImageIcon,
  PlusCircle,
  AlertOctagon,
  XCircle,
} from 'lucide-react';
import { useTranslation } from '@/lib/i18n/LanguageContext';
import type { ReportStatus, FacilityCategory } from '@/types/database';

export interface ReportHistoryItem {
  id: string;
  category: FacilityCategory;
  description: string;
  status: ReportStatus;
  urgency_hint: string;
  created_at: string;
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

export function SejarahClient({ reports, reportsError }: SejarahClientProps) {
  const { t, locale } = useTranslation();

  if (reportsError) {
    return (
      <div className="max-w-xl mx-auto p-4 bg-[#FEF2F2] border-2 border-[#DC2626] text-[#991B1B] rounded-xl text-sm font-semibold">
        Ralat semasa memuatkan sejarah laporan: {reportsError}
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <Link
        href="/resident"
        className="inline-flex items-center gap-2 text-sm font-bold text-[#1554AD] hover:underline min-h-[44px]"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>{t.common.back}</span>
      </Link>

      {/* Header */}
      <div className="border-b border-[#CBD5E1] pb-4 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-[#17212F]">
            {t.history.pageTitle}
          </h1>
          <p className="text-sm text-[#374151] mt-0.5">
            {t.history.pageSubtitle}
          </p>
        </div>

        <Link
          href="/resident/lapor"
          className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-[#1554AD] text-white text-xs font-bold hover:bg-[#0E3E85] transition-all shadow-xs shrink-0 min-h-[44px]"
        >
          <PlusCircle className="w-4 h-4" />
          <span>{t.history.newReportBtn}</span>
        </Link>
      </div>

      {/* Empty State */}
      {reports.length === 0 ? (
        <div className="bg-white rounded-2xl border-2 border-[#CBD5E1] p-8 text-center space-y-3">
          <FileText className="w-12 h-12 text-[#1554AD] mx-auto opacity-60" />
          <h2 className="text-lg font-bold text-[#17212F]">
            {t.history.emptyHeading}
          </h2>
          <p className="text-sm text-[#374151] max-w-sm mx-auto">
            {t.history.emptyDesc}
          </p>
          <Link
            href="/resident/lapor"
            className="inline-flex items-center justify-center mt-2 px-5 py-3 bg-[#1554AD] text-white text-sm font-bold rounded-xl hover:bg-[#0E3E85] transition-all min-h-[48px]"
          >
            {t.history.emptyAction}
          </Link>
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

            const displayRef = `#LPR-${report.id.substring(0, 8).toUpperCase()}`;

            // Determine status step
            const isSubmitted = true;
            const isReviewed = ['reviewed', 'linked'].includes(report.status);
            const isLinked = report.status === 'linked';
            const isDismissed = report.status === 'dismissed';
            const isResolved = report.linkedIncident?.status === 'resolved' || report.linkedIncident?.status === 'closed';

            return (
              <article
                key={report.id}
                className="bg-white rounded-2xl border-2 border-[#CBD5E1] p-5 sm:p-6 shadow-xs space-y-4"
              >
                {/* Header row: Display Reference & Date */}
                <div className="flex items-center justify-between text-xs border-b border-[#CBD5E1] pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-extrabold text-[#1554AD] bg-[#F0F5FC] px-2.5 py-1 rounded-md border border-[#CBD5E1]">
                      {displayRef}
                    </span>
                    <span className="text-[11px] text-[#374151] hidden sm:inline" title={report.id}>
                      ({report.id.substring(0, 12)}...)
                    </span>
                  </div>
                  <span className="text-[#374151] flex items-center gap-1 font-medium">
                    <Clock className="w-3.5 h-3.5 text-[#1554AD]" />
                    <span>{dateStr}</span>
                  </span>
                </div>

                {/* Category & Location Badges */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-extrabold text-[#17212F] bg-[#F8F9FA] px-3 py-1 rounded-lg border border-[#CBD5E1]">
                    {t.categories[report.category] || report.category}
                  </span>
                  <span className="text-xs px-2.5 py-1 rounded-lg bg-[#F0F5FC] text-[#1554AD] font-bold border border-[#CBD5E1]">
                    {report.buildingName}
                  </span>
                  {report.zoneName && (
                    <span className="text-xs px-2.5 py-1 rounded-lg bg-[#F8F9FA] text-[#374151] border border-[#CBD5E1]">
                      {report.zoneName}
                    </span>
                  )}
                </div>

                {/* Report Description */}
                <p className="text-base text-[#17212F] leading-relaxed">
                  {report.description}
                </p>

                {/* Attached Evidence Preview */}
                {report.attachments.length > 0 && (
                  <div className="pt-2 border-t border-[#CBD5E1]/60">
                    <p className="text-xs font-bold text-[#17212F] mb-2 flex items-center gap-1.5">
                      <ImageIcon className="w-4 h-4 text-[#1554AD]" />
                      <span>{t.history.evidenceAttached} ({report.attachments.length}):</span>
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {report.attachments.map((att) => (
                        <a
                          key={att.id}
                          href={att.signedUrl || '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#CBD5E1] bg-[#F8F9FA] hover:bg-[#F0F5FC] text-xs font-bold text-[#1554AD] transition-colors min-h-[38px]"
                        >
                          <span className="truncate max-w-[150px]">{att.file_name}</span>
                          <ExternalLink className="w-3.5 h-3.5 text-[#1554AD]" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* Plain Status Progress Bar */}
                <div className="pt-3 border-t border-[#CBD5E1]">
                  {isDismissed ? (
                    <div className="flex items-center gap-2 p-2.5 rounded-xl bg-[#F8F9FA] border border-[#CBD5E1] text-xs font-bold text-[#374151]">
                      <XCircle className="w-4 h-4 text-[#374151]" />
                      <span>{t.status.dismissed}</span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="grid grid-cols-4 text-center text-[11px] font-bold gap-1">
                        <span className={isSubmitted ? 'text-[#1554AD]' : 'text-[#374151]'}>
                          {t.history.statusProgress.step1}
                        </span>
                        <span className={isReviewed ? 'text-[#1554AD]' : 'text-[#374151]'}>
                          {t.history.statusProgress.step2}
                        </span>
                        <span className={isLinked ? 'text-[#1554AD]' : 'text-[#374151]'}>
                          {t.history.statusProgress.step3}
                        </span>
                        <span className={isResolved ? 'text-emerald-700' : 'text-[#374151]'}>
                          {t.history.statusProgress.step4}
                        </span>
                      </div>
                      <div className="grid grid-cols-4 gap-1 h-2 bg-[#F0F5FC] rounded-full overflow-hidden p-0.5 border border-[#CBD5E1]">
                        <div className={`h-full rounded-full ${isSubmitted ? 'bg-[#1554AD]' : 'bg-transparent'}`} />
                        <div className={`h-full rounded-full ${isReviewed ? 'bg-[#1554AD]' : 'bg-transparent'}`} />
                        <div className={`h-full rounded-full ${isLinked ? 'bg-[#1554AD]' : 'bg-transparent'}`} />
                        <div className={`h-full rounded-full ${isResolved ? 'bg-emerald-600' : 'bg-transparent'}`} />
                      </div>
                    </div>
                  )}

                  {/* Linked Incident Information */}
                  {report.linkedIncident && (
                    <div className="mt-3 p-3 rounded-xl bg-[#F0F5FC] border border-[#CBD5E1] text-xs flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <AlertOctagon className="w-4 h-4 text-[#1554AD]" />
                        <span>
                          {t.history.linkedIncidentLabel} <strong className="text-[#17212F]">{report.linkedIncident.incidentNumber}</strong> — {report.linkedIncident.title}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
