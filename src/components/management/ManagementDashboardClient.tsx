'use client';

import React, { useState, useEffect, useMemo, useSyncExternalStore } from 'react';

const subscribeTime = (callback: () => void) => {
  const id = setInterval(callback, 30000);
  return () => clearInterval(id);
};
const getTimeSnapshot = () => Date.now();
const getServerTimeSnapshot = () => 0;
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Mail,
  Clock3,
  ClipboardList,
  CheckCircle2,
  Building2,
  ChevronDown,
  ChevronRight,
  Droplets,
  Lightbulb,
  ArrowUpDown,
  Wrench,
  AlertTriangle,
  X,
  ExternalLink,
  ImageIcon,
} from 'lucide-react';
import { useTranslation } from '@/lib/i18n/LanguageContext';
import type { FacilityCategory, ReportStatus } from '@/types/database';

export interface DashboardReportItem {
  id: string;
  category: FacilityCategory;
  description: string;
  status: ReportStatus;
  urgency_hint: string;
  created_at: string;
  building: { id: string; name: string; code: string } | null;
  zone: { id: string; name: string } | null;
  reporterName?: string;
  attachments: Array<{
    id: string;
    file_name: string;
    mime_type: string;
    signedUrl?: string;
  }>;
}

export interface DashboardStats {
  newReportsCount: number;
  activeIncidentsCount: number;
  pendingDecisionsCount: number;
  resolvedThisMonthCount: number;
  hasError?: boolean;
}

export interface UnconfirmedEvaluation {
  reportId: string;
  reportRef: string;
  category: string;
  recommendedPriority: string;
  reason: string;
  factsSummary?: string;
}

interface ManagementDashboardClientProps {
  stats: DashboardStats;
  reports: DashboardReportItem[];
  estateName: string;
  buildings: Array<{ id: string; name: string; code: string }>;
  unconfirmedEvaluation: UnconfirmedEvaluation | null;
  activeFacilityCounts: {
    lift: number;
    water_supply: number;
    corridor_lighting: number;
    other: number;
  };
  activeBlockCounts: Record<string, number>;
}

export function ManagementDashboardClient({
  stats: initialStats,
  reports: initialReports,
  estateName,
  unconfirmedEvaluation,
  activeFacilityCounts,
  activeBlockCounts,
}: ManagementDashboardClientProps) {
  const { t, locale } = useTranslation();
  const router = useRouter();
  const currentTime = useSyncExternalStore(subscribeTime, getTimeSnapshot, getServerTimeSnapshot);

  // State
  const [reports, setReports] = useState<DashboardReportItem[]>(initialReports);
  const [stats, setStats] = useState<DashboardStats>(initialStats);
  const [prevInitialReports, setPrevInitialReports] = useState(initialReports);
  const [prevInitialStats, setPrevInitialStats] = useState(initialStats);

  if (initialReports !== prevInitialReports) {
    setPrevInitialReports(initialReports);
    setReports(initialReports);
  }
  if (initialStats !== prevInitialStats) {
    setPrevInitialStats(initialStats);
    setStats(initialStats);
  }

  const [tabFilter, setTabFilter] = useState<'new' | 'active' | 'done'>('new');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [selectedFacilityCategory, setSelectedFacilityCategory] = useState<FacilityCategory | null>(null);
  const [selectedBlockCode, setSelectedBlockCode] = useState<string | null>(null);
  const [expandedReportId, setExpandedReportId] = useState<string | null>(null);
  const [showReasonText, setShowReasonText] = useState(false);

  // Listen for realtime incoming report event dispatched from ManagementShell
  useEffect(() => {
    const handleNewReport = (e: Event) => {
      const customEvent = e as CustomEvent<DashboardReportItem>;
      if (customEvent.detail) {
        const incoming = customEvent.detail;
        setReports((prev) => {
          if (prev.some((r) => r.id === incoming.id)) return prev;
          return [incoming, ...prev];
        });
        setStats((prev) => ({
          ...prev,
          newReportsCount: prev.newReportsCount + 1,
        }));
      }
    };

    window.addEventListener('ppr_new_report_arrived', handleNewReport);
    return () => window.removeEventListener('ppr_new_report_arrived', handleNewReport);
  }, []);

  // Category Icon Resolver
  const getCategoryIcon = (cat: FacilityCategory) => {
    switch (cat) {
      case 'water_supply':
        return <Droplets className="w-4 h-4" aria-hidden="true" />;
      case 'lift':
        return <ArrowUpDown className="w-4 h-4" aria-hidden="true" />;
      case 'corridor_lighting':
        return <Lightbulb className="w-4 h-4" aria-hidden="true" />;
      default:
        return <Wrench className="w-4 h-4" aria-hidden="true" />;
    }
  };

  // Relative Time Formatter
  const formatTime = (isoString: string) => {
    try {
      const d = new Date(isoString);
      if (currentTime === 0) {
        return d.toLocaleDateString(locale === 'ms' ? 'ms-MY' : 'en-MY', {
          day: 'numeric',
          month: 'short',
        });
      }
      const diffMs = Math.max(0, currentTime - d.getTime());
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffMins < 1) return t.management.justNow;
      if (diffMins < 60) return `${diffMins} min lalu`;
      if (diffHours < 24) return `${diffHours} jam lalu`;
      if (diffDays === 1) return locale === 'ms' ? 'Semalam' : 'Yesterday';
      return d.toLocaleDateString(locale === 'ms' ? 'ms-MY' : 'en-MY', {
        day: 'numeric',
        month: 'short',
      });
    } catch {
      return isoString;
    }
  };

  // Filtered and Sorted Reports
  const filteredReports = useMemo(() => {
    return reports
      .filter((r) => {
        // Tab Filter
        if (tabFilter === 'new') {
          if (r.status !== 'submitted') return false;
        } else if (tabFilter === 'active') {
          if (r.status !== 'reviewed' && r.status !== 'linked') return false;
        } else if (tabFilter === 'done') {
          if (r.status !== 'dismissed') return false;
        }

        // Facility Category Filter
        if (selectedFacilityCategory && r.category !== selectedFacilityCategory) {
          return false;
        }

        // Block Filter
        if (selectedBlockCode) {
          const bldgCode = r.building?.code || '';
          // Support both "DR_BLK_A" and "BLK_A"
          const normalized = bldgCode.replace('DR_', '').replace('BLK_', '');
          if (normalized !== selectedBlockCode) {
            return false;
          }
        }

        return true;
      })
      .sort((a, b) => {
        const timeA = new Date(a.created_at).getTime();
        const timeB = new Date(b.created_at).getTime();
        return sortOrder === 'newest' ? timeB - timeA : timeA - timeB;
      });
  }, [reports, tabFilter, selectedFacilityCategory, selectedBlockCode, sortOrder]);

  const activeReportsCount = reports.filter(
    (r) => r.status === 'reviewed' || r.status === 'linked'
  ).length;

  const resolvedReportsCount = reports.filter((r) => r.status === 'dismissed').length;

  // Selected report for expanded drawer
  const expandedReport = useMemo(() => {
    return reports.find((r) => r.id === expandedReportId) || null;
  }, [reports, expandedReportId]);

  // Facilities list for right rail
  const facilityItems: Array<{
    key: FacilityCategory;
    name: string;
    icon: React.ReactNode;
    count: number;
  }> = [
    {
      key: 'lift',
      name: t.categories.lift,
      icon: <ArrowUpDown className="w-4 h-4" />,
      count: activeFacilityCounts.lift,
    },
    {
      key: 'water_supply',
      name: t.categories.water_supply,
      icon: <Droplets className="w-4 h-4" />,
      count: activeFacilityCounts.water_supply,
    },
    {
      key: 'corridor_lighting',
      name: t.categories.corridor_lighting,
      icon: <Lightbulb className="w-4 h-4" />,
      count: activeFacilityCounts.corridor_lighting,
    },
    {
      key: 'other',
      name: t.categories.other,
      icon: <Wrench className="w-4 h-4" />,
      count: activeFacilityCounts.other,
    },
  ];

  // 12 Blocks for PPR Desa Rejang: A to L
  const blockLetters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

  return (
    <div className="space-y-5">
      {/* ─────────────────────────────────────────────────────────────────────────────
          1. Intro Header & Estate Context Pill
          ───────────────────────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <span className="text-[10px] font-bold text-[#7f90a7] tracking-wider uppercase">
            {estateName.toUpperCase()}
          </span>
          <h1 className="text-xl sm:text-2xl font-bold text-[#152743] tracking-tight mt-0.5">
            {t.management.dashboardTitle}
          </h1>
          <p className="text-xs text-[#7b8da6] mt-0.5">
            {t.management.dashboardSubtitle}
          </p>
        </div>

        {/* Estate Pill */}
        <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[#e5ebf3] bg-white text-xs font-semibold text-[#152743] shadow-2xs self-start sm:self-auto">
          <Building2 className="w-3.5 h-3.5 text-[#1965c6]" aria-hidden="true" />
          <span>{estateName}</span>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────────────────────
          2. Error Banner (If DB Query Failed — Never silently turned into 0)
          ───────────────────────────────────────────────────────────────────────────── */}
      {stats.hasError && (
        <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl flex items-center justify-between gap-3 text-xs text-red-800">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{t.management.statsLoadError}</span>
          </div>
          <button
            type="button"
            onClick={() => router.refresh()}
            className="px-3 py-1 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700 transition-colors shrink-0"
          >
            {t.management.retryBtn}
          </button>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────────────
          3. Four Statistics Metric Cards (Authoritative Real DB Data)
          ───────────────────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
        {/* Metric 1: Aduan Baharu */}
        <div className="flex items-start gap-3 p-3.5 sm:p-4 rounded-xl border border-[#e7edf5] bg-linear-to-br from-[#f9fbff] to-white shadow-2xs">
          <div className="w-9 h-9 rounded-xl bg-[#eaf3ff] text-[#0969dc] flex items-center justify-center shrink-0">
            <Mail className="w-4.5 h-4.5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <span className="text-[11px] font-medium text-slate-500 block truncate">
              {t.management.metricNewReports}
            </span>
            <strong className="text-2xl sm:text-[27px] font-semibold text-[#152743] leading-tight tracking-tight block my-0.5">
              {stats.newReportsCount}
            </strong>
            <small className="text-[10px] text-[#8797ad] flex items-center gap-1.5 truncate">
              <span className="w-1.5 h-1.5 rounded-full bg-[#2479df]" />
              {t.management.metricNewReportsSub}
            </small>
          </div>
        </div>

        {/* Metric 2: Dalam Tindakan */}
        <div className="flex items-start gap-3 p-3.5 sm:p-4 rounded-xl border border-[#e7edf5] bg-linear-to-br from-[#f9fbff] to-white shadow-2xs">
          <div className="w-9 h-9 rounded-xl bg-[#fff3e0] text-[#bc780d] flex items-center justify-center shrink-0">
            <Clock3 className="w-4.5 h-4.5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <span className="text-[11px] font-medium text-slate-500 block truncate">
              {t.management.metricActiveIncidents}
            </span>
            <strong className="text-2xl sm:text-[27px] font-semibold text-[#152743] leading-tight tracking-tight block my-0.5">
              {stats.activeIncidentsCount}
            </strong>
            <small className="text-[10px] text-[#8797ad] flex items-center gap-1.5 truncate">
              <span className="w-1.5 h-1.5 rounded-full bg-[#bc780d]" />
              {t.management.metricActiveIncidentsSub}
            </small>
          </div>
        </div>

        {/* Metric 3: Perlu Keputusan */}
        <div className="flex items-start gap-3 p-3.5 sm:p-4 rounded-xl border border-[#e7edf5] bg-linear-to-br from-[#f9fbff] to-white shadow-2xs">
          <div className="w-9 h-9 rounded-xl bg-[#fff0f1] text-[#dd4454] flex items-center justify-center shrink-0">
            <ClipboardList className="w-4.5 h-4.5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <span className="text-[11px] font-medium text-slate-500 block truncate">
              {t.management.metricPendingDecisions}
            </span>
            <strong className="text-2xl sm:text-[27px] font-semibold text-[#152743] leading-tight tracking-tight block my-0.5">
              {stats.pendingDecisionsCount}
            </strong>
            <small className="text-[10px] text-[#8797ad] flex items-center gap-1.5 truncate">
              <span className="w-1.5 h-1.5 rounded-full bg-[#dd4454]" />
              {t.management.metricPendingDecisionsSub}
            </small>
          </div>
        </div>

        {/* Metric 4: Selesai Bulan Ini */}
        <div className="flex items-start gap-3 p-3.5 sm:p-4 rounded-xl border border-[#e7edf5] bg-linear-to-br from-[#f9fbff] to-white shadow-2xs">
          <div className="w-9 h-9 rounded-xl bg-[#eaf7ed] text-[#22964a] flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-4.5 h-4.5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <span className="text-[11px] font-medium text-slate-500 block truncate">
              {t.management.metricResolvedMonth}
            </span>
            <strong className="text-2xl sm:text-[27px] font-semibold text-[#152743] leading-tight tracking-tight block my-0.5">
              {stats.resolvedThisMonthCount}
            </strong>
            <small className="text-[10px] text-[#8797ad] flex items-center gap-1.5 truncate">
              <span className="w-1.5 h-1.5 rounded-full bg-[#7bbd94]" />
              {t.management.metricResolvedMonthSub}
            </small>
          </div>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────────────────────
          4. Workspace: Left Main Panel (Reports & Decision) + Right Rail
          ───────────────────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_250px] gap-3.5">
        {/* ── Left Main Panel: Reports List & Management Decision ── */}
        <section className="border border-[#e6ecf4] rounded-xl bg-white overflow-hidden shadow-2xs flex flex-col justify-between">
          <div>
            {/* Panel Head */}
            <div className="p-4 flex items-center justify-between gap-3 border-b border-slate-100">
              <h2 className="text-sm font-bold text-[#152743]">
                {t.management.reportsToReview}
              </h2>

              {/* Sort button */}
              <button
                type="button"
                onClick={() => setSortOrder(sortOrder === 'newest' ? 'oldest' : 'newest')}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#e3e9f1] hover:bg-[#f1f6fd] text-xs font-medium text-slate-600 transition-colors"
              >
                <span>{sortOrder === 'newest' ? t.management.sortNewest : t.management.sortOldest}</span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </button>
            </div>

            {/* Filter Tabs */}
            <div className="flex items-center gap-3 px-4 pt-2 border-b border-[#e8eef5] text-xs font-medium">
              <button
                type="button"
                onClick={() => setTabFilter('new')}
                className={`pb-2.5 px-1 border-b-2 transition-all ${
                  tabFilter === 'new'
                    ? 'border-[#2377eb] text-[#0d61c7] font-bold'
                    : 'border-transparent text-[#8190a5] hover:text-[#152743]'
                }`}
              >
                {t.management.tabNew}
                <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#deebff] text-[#185bb5]">
                  {stats.newReportsCount}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setTabFilter('active')}
                className={`pb-2.5 px-1 border-b-2 transition-all ${
                  tabFilter === 'active'
                    ? 'border-[#2377eb] text-[#0d61c7] font-bold'
                    : 'border-transparent text-[#8190a5] hover:text-[#152743]'
                }`}
              >
                {t.management.tabActive}
                <span className="ml-1 text-[10px] font-semibold text-slate-400">
                  ({activeReportsCount})
                </span>
              </button>

              <button
                type="button"
                onClick={() => setTabFilter('done')}
                className={`pb-2.5 px-1 border-b-2 transition-all ${
                  tabFilter === 'done'
                    ? 'border-[#2377eb] text-[#0d61c7] font-bold'
                    : 'border-transparent text-[#8190a5] hover:text-[#152743]'
                }`}
              >
                {t.management.tabDone}
                <span className="ml-1 text-[10px] font-semibold text-slate-400">
                  ({resolvedReportsCount})
                </span>
              </button>
            </div>

            {/* Active Rail Filter Chips (Facility or Block) */}
            {(selectedFacilityCategory || selectedBlockCode) && (
              <div className="px-4 py-2 bg-blue-50/50 border-b border-blue-100 flex items-center justify-between text-xs">
                <span className="text-[#1554AD] font-medium flex items-center gap-1.5">
                  <span>Ditapis:</span>
                  {selectedFacilityCategory && (
                    <strong className="font-bold underline">
                      {t.categories[selectedFacilityCategory]}
                    </strong>
                  )}
                  {selectedFacilityCategory && selectedBlockCode && <span>•</span>}
                  {selectedBlockCode && (
                    <strong className="font-bold underline">Blok {selectedBlockCode}</strong>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedFacilityCategory(null);
                    setSelectedBlockCode(null);
                  }}
                  className="text-xs font-semibold text-slate-500 hover:text-red-600 flex items-center gap-1"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Kosongkan penapis</span>
                </button>
              </div>
            )}

            {/* Reports List */}
            {filteredReports.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400 italic">
                {t.management.noReportsInTab}
              </div>
            ) : (
              <div className="divide-y divide-[#edf1f6]">
                {filteredReports.map((report) => {
                  const bldgName = report.building?.name || 'Blok';
                  const zoneName = report.zone?.name ? ` · ${report.zone.name}` : '';
                  const locationText = `${bldgName}${zoneName}`;
                  const categoryName = t.categories[report.category] || report.category;
                  const displayRef = `#LPR-${report.id.substring(0, 8).toUpperCase()}`;
                  const hasPhotos = report.attachments && report.attachments.length > 0;
                  const firstPhoto = hasPhotos ? report.attachments[0] : null;

                  return (
                    <div
                      key={report.id}
                      className="p-4 hover:bg-[#fafcff] transition-colors grid grid-cols-[36px_1fr_auto_32px] sm:grid-cols-[36px_minmax(0,1.2fr)_minmax(0,1fr)_32px] gap-3 items-center"
                    >
                      {/* Category Icon Tile */}
                      <div className="w-[35px] h-[36px] rounded-xl bg-[#edf5ff] text-[#2374ce] flex items-center justify-center shrink-0">
                        {getCategoryIcon(report.category)}
                      </div>

                      {/* Main Title, Location, and Status Pill */}
                      <div className="min-w-0 pr-1">
                        <div className="flex items-center gap-2">
                          <strong className="text-xs font-bold text-[#152743] truncate block">
                            {categoryName}
                          </strong>
                          <span className="font-mono text-[10px] text-slate-400 hidden sm:inline">
                            {displayRef}
                          </span>
                        </div>
                        <p className="text-[11px] text-[#7b8da6] mt-0.5 truncate">
                          {locationText} · {formatTime(report.created_at)}
                        </p>
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold mt-1.5 ${
                            report.status === 'submitted'
                              ? 'bg-[#fff2df] text-[#a16f29]'
                              : report.status === 'linked'
                              ? 'bg-[#eaf7ed] text-[#22964a]'
                              : 'bg-[#deebff] text-[#185bb5]'
                          }`}
                        >
                          {report.status === 'submitted'
                            ? t.management.tabNew
                            : report.status === 'linked'
                            ? t.management.tabDone
                            : t.management.tabActive}
                        </span>
                      </div>

                      {/* Snippet Description & Thumbnail */}
                      <div className="hidden sm:flex items-center gap-2.5 min-w-0">
                        <p className="text-xs text-[#8090a7] line-clamp-2 leading-relaxed flex-1">
                          {report.description}
                        </p>
                        {firstPhoto?.signedUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={firstPhoto.signedUrl}
                            alt={firstPhoto.file_name}
                            className="w-9 h-9 object-cover rounded-lg border border-slate-200 shrink-0 shadow-2xs"
                            loading="lazy"
                          />
                        )}
                      </div>

                      {/* Action Chevron Button */}
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedReportId(
                            expandedReportId === report.id ? null : report.id
                          )
                        }
                        aria-label={`Lihat butiran aduan ${displayRef}`}
                        className={`w-8 h-8 rounded-lg flex items-center justify-center text-[#6a87ac] hover:bg-[#edf4ff] hover:text-[#1965c6] transition-all ${
                          expandedReportId === report.id ? 'bg-[#edf4ff] text-[#1965c6]' : ''
                        }`}
                      >
                        <ChevronRight
                          className={`w-4 h-4 transition-transform ${
                            expandedReportId === report.id ? 'rotate-90' : ''
                          }`}
                        />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Inline Detail Drawer (#detail in preview) */}
            {expandedReport && (
              <div
                id="management-report-detail"
                className="p-4 sm:p-5 bg-[#f8fbff] border-t border-[#e4ecf6] space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-[#152743]">
                      {t.categories[expandedReport.category] || expandedReport.category}
                    </h3>
                    <span className="font-mono text-xs font-bold text-[#1554AD]">
                      #LPR-{expandedReport.id.substring(0, 8).toUpperCase()}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExpandedReportId(null)}
                    className="text-xs font-semibold text-slate-400 hover:text-slate-600"
                  >
                    {t.management.closeDetail}
                  </button>
                </div>

                <p className="text-xs text-slate-700 leading-relaxed font-medium">
                  {expandedReport.description}
                </p>

                <div className="text-[11px] text-slate-500 space-y-0.5">
                  <p>
                    <strong>Lokasi:</strong> {expandedReport.building?.name || 'Blok'}{' '}
                    {expandedReport.zone?.name ? `(${expandedReport.zone.name})` : ''}
                  </p>
                  <p>
                    <strong>Masa:</strong>{' '}
                    {new Date(expandedReport.created_at).toLocaleString(
                      locale === 'ms' ? 'ms-MY' : 'en-MY'
                    )}
                  </p>
                  {expandedReport.reporterName && (
                    <p>
                      <strong>Pelapor:</strong> {expandedReport.reporterName}
                    </p>
                  )}
                </div>

                {/* Evidence Photos */}
                {expandedReport.attachments && expandedReport.attachments.length > 0 && (
                  <div className="pt-1 space-y-1.5">
                    <p className="text-[11px] font-bold text-slate-600 flex items-center gap-1.5">
                      <ImageIcon className="w-3.5 h-3.5 text-[#1554AD]" />
                      <span>{t.management.evidenceAttached} ({expandedReport.attachments.length}):</span>
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {expandedReport.attachments.map((att) => (
                        <a
                          key={att.id}
                          href={att.signedUrl || '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-[#1554AD] shadow-2xs"
                        >
                          <span className="truncate max-w-[140px]">{att.file_name}</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* Direct Action Link to Inbox */}
                <div className="pt-2">
                  <Link
                    href={`/management/inbox#report-${expandedReport.id}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1965c6] text-white text-xs font-bold hover:bg-[#1359af] transition-colors"
                  >
                    <span>Urus di Peti Aduan →</span>
                  </Link>
                </div>
              </div>
            )}
          </div>

          {/* ── Bottom Section: Keputusan Pengurus (Authoritative Evaluated Priority) ── */}
          <div className="p-4 border-t border-[#e8eef6] bg-[#fafcff] space-y-2">
            <h2 className="text-xs font-bold text-[#152743]">
              {t.management.managerDecisionsTitle}
            </h2>

            {unconfirmedEvaluation ? (
              <div className="space-y-1.5">
                <p className="text-xs text-slate-600 leading-relaxed">
                  <strong>{unconfirmedEvaluation.reportRef} ({unconfirmedEvaluation.category}):</strong> Dicadangkan keutamaan{' '}
                  <span className="font-bold text-[#dd4454] uppercase">
                    {unconfirmedEvaluation.recommendedPriority.replace('_', ' ')}
                  </span>
                  . {unconfirmedEvaluation.reason}
                </p>

                <div className="flex items-center gap-2 pt-0.5">
                  <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-800">
                    {t.management.unconfirmedBadge}
                  </span>

                  <button
                    type="button"
                    onClick={() => setShowReasonText(!showReasonText)}
                    className="text-xs text-[#1766c0] font-semibold hover:underline"
                  >
                    {showReasonText
                      ? t.management.closeReasonBtn
                      : t.management.reviewReasonBtn}
                  </button>
                </div>

                {showReasonText && (
                  <p className="text-[11px] text-slate-500 bg-white p-2.5 rounded-lg border border-slate-200 mt-1 leading-relaxed">
                    {unconfirmedEvaluation.factsSummary ||
                      'Penilaian peraturan deterministik mengesan impak fasiliti kritikal. Keutamaan muktamad memerlukan pengesahan pengurus.'}
                  </p>
                )}

                <div className="pt-1">
                  <Link
                    href="/management/inbox"
                    className="inline-flex items-center gap-1 text-xs font-bold text-[#1965c6] hover:underline"
                  >
                    <span>{t.management.openInboxTriageBtn}</span>
                  </Link>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500 italic">
                {t.management.noDecisionsNeeded}
              </p>
            )}
          </div>
        </section>

        {/* ── Right Rail: Fasiliti PPR + Ringkasan Blok ── */}
        <div className="space-y-3.5">
          {/* Panel 1: Fasiliti PPR */}
          <section className="border border-[#e6ecf4] rounded-xl bg-white overflow-hidden shadow-2xs">
            <div className="p-3 sm:p-3.5 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-xs font-bold text-[#152743]">
                {t.management.facilitiesTitle}
              </h2>
              <span className="text-[9px] font-bold text-[#7f90a7] tracking-wider uppercase">
                {t.management.activeReportsEyebrow}
              </span>
            </div>

            <div className="p-3 grid grid-cols-2 gap-2">
              {facilityItems.map((fac) => (
                <button
                  key={fac.key}
                  type="button"
                  onClick={() =>
                    setSelectedFacilityCategory(
                      selectedFacilityCategory === fac.key ? null : fac.key
                    )
                  }
                  className={`p-2.5 rounded-lg border text-left transition-all flex flex-col items-center justify-center text-center gap-1 min-h-[58px] ${
                    selectedFacilityCategory === fac.key
                      ? 'bg-[#e5efff] border-[#a6c8f7] text-[#185bb5]'
                      : 'bg-[#f6f8fb] border-[#edf1f5] text-slate-700 hover:bg-[#edf4ff]'
                  }`}
                >
                  <span className="text-[#2769b7]">{fac.icon}</span>
                  <span className="text-[11px] font-bold leading-tight line-clamp-1">{fac.name}</span>
                  <small className="text-[10px] text-slate-500">
                    {fac.count} {t.management.aduanCountSuffix}
                  </small>
                </button>
              ))}
            </div>
          </section>

          {/* Panel 2: Ringkasan Blok (A-L) */}
          <section className="border border-[#e6ecf4] rounded-xl bg-white overflow-hidden shadow-2xs">
            <div className="p-3 sm:p-3.5 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-xs font-bold text-[#152743]">
                {t.management.blockSummaryTitle}
              </h2>
              <Building2 className="w-3.5 h-3.5 text-slate-400" />
            </div>

            <div className="p-3">
              <div className="grid grid-cols-4 gap-1.5">
                {blockLetters.map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() =>
                      setSelectedBlockCode(selectedBlockCode === b ? null : b)
                    }
                    className={`h-8 rounded-lg border text-xs font-bold transition-all flex items-center justify-center ${
                      selectedBlockCode === b
                        ? 'bg-[#e5efff] text-[#185bb5] border-[#a6c8f7] shadow-xs'
                        : 'bg-[#f6f8fb] border-[#edf1f5] text-slate-700 hover:bg-[#edf4ff]'
                    }`}
                  >
                    {b}
                  </button>
                ))}
              </div>

              <p className="text-[10px] text-slate-500 mt-2.5 leading-relaxed">
                {selectedBlockCode
                  ? (activeBlockCounts[selectedBlockCode] || 0) > 0
                    ? `Blok ${selectedBlockCode} · ${activeBlockCounts[selectedBlockCode]} ${t.management.blockActiveSummary}`
                    : `Blok ${selectedBlockCode} · ${t.management.blockNoActive}`
                  : t.management.selectBlockPrompt}
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
