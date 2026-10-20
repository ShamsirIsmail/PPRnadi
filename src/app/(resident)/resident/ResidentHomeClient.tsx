'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  Plus,
  Droplet,
  ArrowUpDown,
  Lightbulb,
  ChevronRight,
  Clock,
  AlertTriangle,
  Info,
  CheckCircle2,
  LogOut,
  Loader2,
  Building2,
} from 'lucide-react';
import { logoutAction } from '@/app/actions/auth';
import { useTranslation } from '@/lib/i18n/LanguageContext';
import { resolveEstateName } from '@/lib/estate/estate-resolver';
import {
  selectPrimaryActiveReport,
  evaluateReportProgress,
} from '@/lib/reports/report-status-resolver';
import type {
  ProfileRow,
  FacilityCategory,
  PublishedIncidentBulletin,
  IncidentReportRow,
  IncidentStatus,
} from '@/types/database';

export interface BuildingInfo {
  id: string;
  name: string;
  code: string;
  total_floors: number;
  estate_id?: string;
}

interface ResidentHomeClientProps {
  profile: ProfileRow;
  building: BuildingInfo | null;
  activeBulletins: PublishedIncidentBulletin[];
  hasBulletinError?: boolean;
  reports: IncidentReportRow[];
  hasReportsError?: boolean;
  reportIncidentMap?: Record<string, { status: IncidentStatus }>;
}

export function ResidentHomeClient({
  profile,
  building,
  activeBulletins,
  hasBulletinError,
  reports,
  hasReportsError,
  reportIncidentMap,
}: ResidentHomeClientProps) {
  const { t, locale } = useTranslation();
  const [expandedNoticeId, setExpandedNoticeId] = useState<string | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [hasDraft] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        return Boolean(sessionStorage.getItem('ppr_client_report_id'));
      } catch {
        return false;
      }
    }
    return false;
  });

  // Keyboard accessibility: Escape closes logout confirmation
  React.useEffect(() => {
    if (!confirmLogout) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoggingOut) {
        setConfirmLogout(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [confirmLogout, isLoggingOut]);

  // Sync profile data to window and bottom nav modal in effect
  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      const win = window as unknown as {
        __pprResidentProfile?: { profile: ProfileRow; building: BuildingInfo | null };
      };
      win.__pprResidentProfile = { profile, building };
    }
    window.dispatchEvent(
      new CustomEvent('set-resident-profile', {
        detail: { profile, building },
      })
    );
  }, [profile, building]);

  // Parse resident identity
  const rawName = profile?.full_name || 'Penduduk';
  const cleanName = rawName.replace(/\s*\(.*?\)\s*/, '');
  const initial = cleanName.charAt(0).toUpperCase() || 'P';

  const estateResolution = resolveEstateName(
    profile?.assigned_estate_id || building?.estate_id,
    locale
  );
  const estateName = estateResolution.name;

  const buildingName = building?.name || t.residentHome.unspecifiedBuilding;
  const unitText = profile?.unit_number ? `Unit ${profile.unit_number}` : '';

  // Dynamic greeting based on current time
  const currentHour = new Date().getHours();
  const greeting =
    currentHour < 12
      ? locale === 'ms'
        ? 'Selamat pagi,'
        : 'Good morning,'
      : currentHour < 17
      ? locale === 'ms'
        ? 'Selamat tengah hari,'
        : 'Good afternoon,'
      : locale === 'ms'
      ? 'Selamat petang,'
      : 'Good evening,';

  // Category labels mapper
  const getCategoryName = (cat: FacilityCategory) => {
    switch (cat) {
      case 'water_supply':
        return t.reportForm.catWater || 'Bekalan Air';
      case 'lift':
        return t.reportForm.catLift || 'Lif Penumpang';
      case 'corridor_lighting':
        return t.reportForm.catLighting || 'Lampu Koridor';
      case 'other':
        return t.reportForm.catOther || (locale === 'ms' ? 'Lain-lain' : 'Other Issues');
      default:
        return cat;
    }
  };

  // Dispatch open account modal
  const handleOpenAccount = () => {
    window.dispatchEvent(new CustomEvent('open-resident-account'));
  };

  // Select primary active report (filters out dismissed reports, picks oldest active if latest was dismissed)
  const activeReport = selectPrimaryActiveReport(reports, reportIncidentMap);
  const activeReportIncidentStatus = activeReport
    ? reportIncidentMap?.[activeReport.id]?.status
    : undefined;
  const progressEval = activeReport
    ? evaluateReportProgress(activeReport, activeReportIncidentStatus)
    : null;

  return (
    <div className="w-full max-w-xl mx-auto space-y-5 pb-6">
      {/* ================================================================= */}
      {/* 1. MAKLUMAT PENDUDUK (Resident Summary Card)                      */}
      {/* ================================================================= */}
      <section
        className="bg-white rounded-2xl border border-[#e4eaf2] p-4 sm:p-5 shadow-xs transition-shadow hover:shadow-sm"
        aria-label="Ringkasan Kediaman Penduduk"
      >
        <div className="flex items-center gap-3 sm:gap-3.5">
          {/* Avatar with click to open account info */}
          <button
            type="button"
            onClick={handleOpenAccount}
            aria-label={t.residentHome.navAccount}
            className="w-12 h-12 rounded-xl bg-[#edf3fc] text-[#1956b8] flex items-center justify-center font-extrabold text-lg shrink-0 hover:bg-[#e2edfd] transition-colors cursor-pointer"
          >
            {initial}
          </button>

          <div className="min-w-0 flex-1">
            <p className="text-xs sm:text-sm text-[#64758b] leading-tight mb-0.5">
              {greeting}
            </p>
            <h1 className="text-lg sm:text-xl font-extrabold text-[#17212f] truncate leading-snug">
              {cleanName}
            </h1>
          </div>

          <span className="shrink-0 text-xs font-bold text-[#1956b8] bg-[#edf3fd] border border-[#d6e4fa] px-2.5 py-1 rounded-lg">
            {buildingName}
          </span>
        </div>

        {/* Location, Unit Detail & Log Keluar Action */}
        <div className="mt-3.5 pt-3 border-t border-[#f1f5fa] flex items-center justify-between gap-2 text-xs sm:text-sm">
          <div className="flex items-center gap-2 min-w-0">
            <Building2 className="w-4 h-4 text-[#1554ad] shrink-0" />
            <div className="truncate">
              <strong className="text-[#17212f] font-bold block leading-tight truncate">{estateName}</strong>
              <span className="text-[#586b84] text-xs truncate block">
                {buildingName} {unitText ? `· ${unitText}` : ''}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setConfirmLogout(true)}
            aria-label={locale === 'ms' ? 'Log keluar' : 'Sign out'}
            className="shrink-0 min-h-[44px] px-3.5 py-2 rounded-xl border border-red-200 bg-red-50/70 hover:bg-red-100/80 text-[#991b1b] font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4 text-[#991b1b]" />
            <span>{locale === 'ms' ? 'Log keluar' : 'Sign out'}</span>
          </button>
        </div>

        {/* Alert Pill if there is an active notice for this block */}
        {activeBulletins.length > 0 && (
          <div className="mt-3 p-2.5 rounded-xl bg-[#fff6e3] border border-[#f5dfa7] text-[#825709] flex items-center gap-2 text-xs sm:text-sm">
            <Info className="w-4 h-4 text-[#ca8a04] shrink-0" />
            <span className="font-medium truncate">
              {activeBulletins[0].update_title}
            </span>
          </div>
        )}
      </section>

      {/* ================================================================= */}
      {/* 2. TINDAKAN UTAMA LAPOR MASALAH (Prominent Report Action Panel)   */}
      {/* ================================================================= */}
      <section
        className="rounded-2xl bg-[#1956b8] text-white p-5 sm:p-6 shadow-md"
        aria-label="Tindakan Utama Lapor Masalah"
      >
        <div className="space-y-1 mb-4">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/15 text-[11px] sm:text-xs font-semibold backdrop-blur-xs tracking-wide">
            <span>{t.residentHome.quickTitle}</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white pt-1">
            {t.residentHome.questionTitle}
          </h2>
          <p className="text-xs sm:text-sm text-blue-100 font-normal leading-relaxed">
            {t.residentHome.prominentReportSub}
          </p>
        </div>

        {/* Primary White Button (Min 44x44 touch target) */}
        <Link
          href="/resident/lapor"
          className="flex items-center justify-between w-full min-h-[48px] px-4 py-3 bg-white text-[#1956b8] rounded-xl font-bold text-sm sm:text-base hover:bg-blue-50 active:scale-[0.99] transition-all cursor-pointer shadow-xs"
        >
          <span className="flex items-center gap-2.5">
            <span className="w-6 h-6 rounded-full bg-[#edf3fc] text-[#1956b8] flex items-center justify-center">
              <Plus className="w-4 h-4 stroke-[2.5]" />
            </span>
            <span>{t.residentHome.newReportBtn}</span>
          </span>
          <ChevronRight className="w-5 h-5 text-[#1956b8]" />
        </Link>

        {/* Quick Supported Categories Pill Links */}
        <div className="grid grid-cols-3 gap-2 pt-3.5 mt-3.5 border-t border-white/20">
          <Link
            href="/resident/lapor?category=water_supply"
            className="flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold text-white transition-colors cursor-pointer min-h-[44px]"
          >
            <Droplet className="w-3.5 h-3.5 shrink-0" />
            <span>{t.residentHome.waterCat}</span>
          </Link>
          <Link
            href="/resident/lapor?category=lift"
            className="flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold text-white transition-colors cursor-pointer min-h-[44px]"
          >
            <ArrowUpDown className="w-3.5 h-3.5 shrink-0" />
            <span>{t.residentHome.liftCat}</span>
          </Link>
          <Link
            href="/resident/lapor?category=corridor_lighting"
            className="flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold text-white transition-colors cursor-pointer min-h-[44px]"
          >
            <Lightbulb className="w-3.5 h-3.5 shrink-0" />
            <span>{t.residentHome.lightCat}</span>
          </Link>
        </div>
      </section>

      {/* ================================================================= */}
      {/* 3. NOTIS KOMUNITI YANG RELEVAN (Community Notices)               */}
      {/* ================================================================= */}
      <section className="space-y-3" aria-label="Notis Komuniti">
        <div className="flex items-center justify-between gap-2 pt-1">
          <h2 className="text-lg sm:text-xl font-bold text-[#17212f]">
            {t.residentHome.noticesHeading}
          </h2>
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-[#f1f4f8] text-[#5b6980]">
            {activeBulletins.length} {t.residentHome.noticesCount}
          </span>
        </div>

        {/* Query error state */}
        {hasBulletinError && (
          <div className="p-3.5 bg-[#fef2f2] border border-[#fca5a5] text-[#991b1b] rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{t.residentHome.bulletinsLoadError}</span>
          </div>
        )}

        {/* Empty State (Neutral: does not claim all facilities work) */}
        {!hasBulletinError && activeBulletins.length === 0 && (
          <div className="rounded-2xl border border-[#e1e8f2] bg-white p-6 sm:p-7 text-center space-y-1.5">
            <Info className="w-7 h-7 text-[#1956b8] mx-auto opacity-75 mb-1" />
            <h3 className="text-base font-bold text-[#17212f]">
              {t.residentHome.noNoticesHeading}
            </h3>
            <p className="text-xs sm:text-sm text-[#576c85] max-w-sm mx-auto leading-relaxed">
              {t.residentHome.noNoticesDesc}
            </p>
          </div>
        )}

        {/* Active Notices List */}
        {!hasBulletinError && activeBulletins.length > 0 && (
          <div className="space-y-3">
            {activeBulletins.map((bulletin) => {
              const isExpanded = expandedNoticeId === bulletin.update_id;
              const pubDate = new Date(bulletin.published_at).toLocaleString(
                locale === 'ms' ? 'ms-MY' : 'en-MY',
                {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                }
              );

              const statusKey = bulletin.incident_status as keyof typeof t.status;
              const translatedStatus = t.status[statusKey] || bulletin.incident_status;
              const translatedStage =
                t.residentHome.stages[
                  bulletin.stage as keyof typeof t.residentHome.stages
                ] || bulletin.stage;

              return (
                <article
                  key={bulletin.update_id}
                  className="rounded-2xl border border-[#e1e8f2] bg-white p-4 sm:p-5 shadow-xs space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="px-2 py-0.5 rounded-md bg-[#eff4fc] text-xs font-bold text-[#47658a]">
                        {t.residentHome.noticeNotice}
                      </span>
                      <span className="text-xs text-[#64748b] font-mono">
                        {bulletin.incident_number}
                      </span>
                    </div>

                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-[#fff3da] text-[#825709] text-xs font-bold">
                      <AlertTriangle className="w-3.5 h-3.5 text-[#ca8a04]" />
                      <span>{translatedStatus}</span>
                    </span>
                  </div>

                  <div>
                    <h3 className="text-base sm:text-lg font-bold text-[#17212f] leading-snug">
                      {bulletin.update_title}
                    </h3>
                    <p className="text-xs sm:text-sm text-[#576c85] leading-relaxed mt-1">
                      {bulletin.message_bm}
                    </p>
                    {locale === 'en' && (
                      <p className="text-[11px] text-[#64748b] italic mt-1">
                        {t.residentHome.originalNoticeInBm}
                      </p>
                    )}
                  </div>

                  {/* Footer & Timestamp */}
                  <div className="flex items-center justify-between text-xs text-[#718298] pt-1">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      <span>{pubDate}</span>
                    </span>

                    <button
                      type="button"
                      onClick={() =>
                        setExpandedNoticeId(isExpanded ? null : bulletin.update_id)
                      }
                      className="text-[#1956b8] font-bold hover:underline cursor-pointer"
                    >
                      {isExpanded ? t.common.close : t.residentHome.viewIncidentDetails}
                    </button>
                  </div>

                  {/* Expanded Bulletin Details */}
                  {isExpanded && (
                    <div className="pt-3 border-t border-[#f1f5fa] text-xs text-[#52647a] space-y-1.5 animate-in fade-in duration-150">
                      <p>
                        <strong>{t.residentHome.noticeQuestionWhere}</strong>{' '}
                        {bulletin.building_name}
                      </p>
                      <p>
                        <strong>{t.residentHome.stageLabel}</strong>{' '}
                        {translatedStage}
                      </p>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* ================================================================= */}
      {/* 4. RINGKASAN ADUAN AKTIF PENGGUNA (Active Reports Summary)        */}
      {/* ================================================================= */}
      <section className="space-y-3" aria-label="Aduan Aktif Saya">
        <div className="flex items-center justify-between gap-2 pt-1">
          <h2 className="text-lg sm:text-xl font-bold text-[#17212f]">
            {t.residentHome.myReportsHeading}
          </h2>
          <Link
            href="/resident/sejarah"
            className="text-xs sm:text-sm font-bold text-[#1956b8] hover:underline cursor-pointer flex items-center gap-0.5"
          >
            <span>{t.residentHome.viewAllReports}</span>
            <ChevronRight className="w-4 h-4" />
          </Link>
        </div>

        {/* Query error state */}
        {hasReportsError && (
          <div className="p-3.5 bg-[#fef2f2] border border-[#fca5a5] text-[#991b1b] rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{t.residentHome.reportsLoadError}</span>
          </div>
        )}

        {/* If no active report exists */}
        {!hasReportsError && !activeReport && (
          <div className="rounded-2xl border border-[#e1e8f2] bg-white p-6 sm:p-7 text-center space-y-1.5">
            <CheckCircle2 className="w-7 h-7 text-[#1956b8] mx-auto opacity-75 mb-1" />
            <h3 className="text-base font-bold text-[#17212f]">
              {t.residentHome.noReportsYet}
            </h3>
            <p className="text-xs sm:text-sm text-[#576c85] max-w-sm mx-auto leading-relaxed">
              {t.residentHome.noReportsDesc}
            </p>
          </div>
        )}

        {/* Active Report Card */}
        {!hasReportsError && activeReport && progressEval && (
          <div className="rounded-2xl border border-[#e1e8f2] bg-white p-4 sm:p-5 shadow-xs space-y-3">
            {/* Top row */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-mono text-[#64748b]">
                #LPR-{activeReport.id.substring(0, 8).toUpperCase()}
              </span>

              <span
                className={`text-xs font-bold px-2.5 py-0.5 rounded-md ${
                  activeReport.status === 'dismissed'
                    ? 'bg-[#fee2e2] text-[#991b1b]'
                    : 'bg-[#eef4ff] text-[#1956b8]'
                }`}
              >
                {t.status[activeReport.status] || activeReport.status}
              </span>
            </div>

            {/* Category & Description */}
            <div>
              <strong className="text-base sm:text-lg font-bold text-[#17212f] block leading-snug">
                {getCategoryName(activeReport.category)}
              </strong>
              <p className="text-xs sm:text-sm text-[#576c85] line-clamp-2 mt-1 leading-relaxed">
                {activeReport.description}
              </p>
            </div>

            {/* If report is dismissed: show clear neutral dismissal message, NOT finished repair! */}
            {progressEval.isDismissed && (
              <div className="p-2.5 rounded-xl bg-[#fef2f2] border border-[#fecaca] text-[#991b1b] text-xs leading-relaxed">
                {t.residentHome.statusDismissedNotice}
              </div>
            )}

            {/* If report is linked but incident status unknown: neutral link message */}
            {!progressEval.isDismissed && !progressEval.canShowProgress && (
              <div className="p-2.5 rounded-xl bg-[#eff6ff] border border-[#bfdbfe] text-[#1e40af] text-xs leading-relaxed">
                {t.residentHome.statusLinkedNotice}
              </div>
            )}

            {/* 4-Step Progression Tracker: shown only when status is verified */}
            {!progressEval.isDismissed && progressEval.canShowProgress && (
              <div className="pt-2">
                <div className="grid grid-cols-4 gap-1 sm:gap-2 text-center text-[10px] sm:text-xs">
                  {/* Step 1: Diterima */}
                  <div className="space-y-1.5">
                    <span className="font-bold text-[#1956b8]">
                      {t.residentHome.progressReceived}
                    </span>
                    <div className="h-1.5 rounded-full bg-[#1956b8]" />
                  </div>

                  {/* Step 2: Semakan */}
                  <div className="space-y-1.5">
                    <span
                      className={`font-semibold ${
                        progressEval.stepReview === 'completed' ||
                        progressEval.stepReview === 'active'
                          ? 'text-[#1956b8] font-bold'
                          : 'text-[#94a3b8]'
                      }`}
                    >
                      {t.residentHome.progressReview}
                    </span>
                    <div
                      className={`h-1.5 rounded-full ${
                        progressEval.stepReview === 'completed'
                          ? 'bg-[#1956b8]'
                          : progressEval.stepReview === 'active'
                          ? 'bg-[#d9a12e]'
                          : 'bg-[#e2e8f0]'
                      }`}
                    />
                  </div>

                  {/* Step 3: Tindakan */}
                  <div className="space-y-1.5">
                    <span
                      className={`font-semibold ${
                        progressEval.stepAction === 'completed' ||
                        progressEval.stepAction === 'active'
                          ? 'text-[#1956b8] font-bold'
                          : 'text-[#94a3b8]'
                      }`}
                    >
                      {t.residentHome.progressAction}
                    </span>
                    <div
                      className={`h-1.5 rounded-full ${
                        progressEval.stepAction === 'completed' ||
                        progressEval.stepAction === 'active'
                          ? 'bg-[#1956b8]'
                          : 'bg-[#e2e8f0]'
                      }`}
                    />
                  </div>

                  {/* Step 4: Selesai */}
                  <div className="space-y-1.5">
                    <span
                      className={`font-semibold ${
                        progressEval.stepResolved === 'completed'
                          ? 'text-[#1956b8] font-bold'
                          : 'text-[#94a3b8]'
                      }`}
                    >
                      {t.residentHome.progressCompleted}
                    </span>
                    <div
                      className={`h-1.5 rounded-full ${
                        progressEval.stepResolved === 'completed'
                          ? 'bg-[#1956b8]'
                          : 'bg-[#e2e8f0]'
                      }`}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Bottom Row */}
            <div className="flex items-center justify-between text-xs text-[#718298] pt-2 border-t border-[#f1f5fa]">
              <small className="text-xs text-[#718298]">
                {t.residentHome.submittedOn}{' '}
                {new Date(activeReport.created_at).toLocaleDateString(
                  locale === 'ms' ? 'ms-MY' : 'en-MY',
                  { day: 'numeric', month: 'short' }
                )}
              </small>

              <Link
                href="/resident/sejarah"
                className="text-xs font-bold text-[#1956b8] hover:underline flex items-center gap-0.5 cursor-pointer"
              >
                <span>{t.residentHome.viewDetails}</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        )}
      </section>

      {/* Official Tagline Footer */}
      <footer className="text-center pt-3 pb-2 text-xs text-[#8594a6]">
        <p className="font-semibold text-[#1956b8] mb-0.5">{t.common.tagline}</p>
        <p>
          {t.common.appName} • {t.auth.communityFooter}
        </p>
      </footer>

      {/* Logout Confirmation Accessible Dialog */}
      {confirmLogout && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-logout-title"
          onClick={() => !isLoggingOut && setConfirmLogout(false)}
        >
          <div
            className="w-full max-w-sm bg-white rounded-2xl shadow-xl border border-slate-200 p-6 space-y-4 animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 text-[#991b1b] flex items-center justify-center shrink-0">
                <LogOut className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h2 id="confirm-logout-title" className="text-lg font-bold text-[#17212f]">
                  {locale === 'ms' ? 'Anda mahu log keluar?' : 'Would you like to sign out?'}
                </h2>
                <p className="text-xs text-slate-600 leading-relaxed">
                  {locale === 'ms'
                    ? 'Anda boleh log masuk semula bila-bila masa.'
                    : 'You can sign in again whenever you need.'}
                </p>
                {hasDraft && (
                  <p className="text-xs text-amber-700 bg-amber-50 p-2 rounded-lg font-medium">
                    {locale === 'ms'
                      ? 'Perhatian: Draf aduan yang belum dihantar akan dipadamkan.'
                      : 'Note: Any unsent report draft will be cleared.'}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setConfirmLogout(false)}
                disabled={isLoggingOut}
                className="flex-1 min-h-[44px] px-4 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-700 font-bold text-xs sm:text-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
              >
                {locale === 'ms' ? 'Kekal di sini' : 'Stay here'}
              </button>
              <form action={logoutAction} className="flex-1">
                <button
                  type="submit"
                  disabled={isLoggingOut}
                  onClick={() => setIsLoggingOut(true)}
                  className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-[#dc2626] hover:bg-[#b91c1c] text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-xs disabled:opacity-50"
                >
                  {isLoggingOut ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <span>{locale === 'ms' ? 'Log keluar' : 'Sign out'}</span>
                  )}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
