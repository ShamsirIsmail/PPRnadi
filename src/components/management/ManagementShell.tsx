'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutGrid,
  Inbox,
  Layers,
  Blocks,
  Bell,
  Menu,
  X,
} from 'lucide-react';
import { SignOutButton } from '@/components/auth/SignOutButton';
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher';
import { useTranslation } from '@/lib/i18n/LanguageContext';
import { createClient } from '@/lib/supabase/client';

export interface NewReportNotification {
  id: string;
  category: string;
  categoryTitle: string;
  description: string;
  location: string;
  created_at: string;
}

interface ManagementShellProps {
  children: React.ReactNode;
  managerProfile: {
    id: string;
    fullName: string;
    assignedEstateId: string;
    role: string;
  };
  estateName: string;
  initialPendingReportsCount: number;
  initialReportIds: string[];
}

export function ManagementShell({
  children,
  managerProfile,
  estateName,
  initialPendingReportsCount,
  initialReportIds,
}: ManagementShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useTranslation();

  // Navigation states
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(initialPendingReportsCount);

  // Notification states
  const [bellRinging, setBellRinging] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState<NewReportNotification[]>([]);
  const [latestNewReport, setLatestNewReport] = useState<NewReportNotification | null>(null);

  // Storage and deduplication
  const seenReportIdsRef = useRef<Set<string>>(new Set(initialReportIds));
  const readStorageKey = `ppr_nadi_read_notifications_${managerProfile.id}`;

  // Helper to get read IDs from localStorage
  const getReadNotificationIds = useCallback((): string[] => {
    if (typeof window === 'undefined') return [];
    try {
      const stored = localStorage.getItem(readStorageKey);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }, [readStorageKey]);

  // Helper to mark a notification as read
  const markAsRead = useCallback(
    (reportId: string) => {
      if (typeof window === 'undefined') return;
      try {
        const readIds = getReadNotificationIds();
        if (!readIds.includes(reportId)) {
          const updated = [...readIds, reportId];
          localStorage.setItem(readStorageKey, JSON.stringify(updated));
        }
        setUnreadNotifications((prev) => prev.filter((n) => n.id !== reportId));
        if (latestNewReport?.id === reportId) {
          setLatestNewReport(null);
        }
      } catch {
        // Storage restricted
      }
    },
    [getReadNotificationIds, readStorageKey, latestNewReport]
  );

  // Process a newly arrived report
  const handleIncomingReport = useCallback(
    (report: {
      id: string;
      category: string;
      description: string;
      created_at: string;
      building?: { name?: string };
      buildings?: { name?: string; estate_id?: string };
      service_zones?: { name?: string };
    }) => {
      // Deduplicate: if already seen, ignore
      if (seenReportIdsRef.current.has(report.id)) {
        return;
      }
      seenReportIdsRef.current.add(report.id);

      const bldgName = report.building?.name || report.buildings?.name || 'Blok';
      const zoneName = report.service_zones?.name ? ` · ${report.service_zones.name}` : '';
      const location = `${bldgName}${zoneName}`;

      const catTitle =
        t.categories[report.category as keyof typeof t.categories] || report.category;

      const newNotif: NewReportNotification = {
        id: report.id,
        category: report.category,
        categoryTitle: catTitle,
        description: report.description,
        location,
        created_at: report.created_at,
      };

      // Trigger bell ring animation
      setBellRinging(true);
      setTimeout(() => setBellRinging(false), 2000);

      // Add to unread and open pop-up
      setLatestNewReport(newNotif);
      setUnreadNotifications((prev) => [newNotif, ...prev.filter((n) => n.id !== report.id)]);
      setNotificationOpen(true);
      setPendingCount((prev) => prev + 1);

      // Dispatch event for dashboard live rows update if dashboard is mounted
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('ppr_new_report_arrived', { detail: report }));
      }
    },
    [t]
  );

  // Realtime & Controlled Polling Setup
  useEffect(() => {
    let supabase: ReturnType<typeof createClient> | null = null;
    let pollTimer: NodeJS.Timeout | null = null;
    let isSubscribed = true;

    try {
      supabase = createClient();

      // 1. Supabase Realtime Subscription
      const channel = supabase
        .channel(`manager_estate_${managerProfile.assignedEstateId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'incident_reports',
          },
          async (payload) => {
            if (!isSubscribed) return;
            const newRecord = payload.new as {
              id: string;
              category: string;
              description: string;
              status: string;
              created_at: string;
              building_id: string;
            };

            if (newRecord && newRecord.status === 'submitted') {
              // Fetch building to verify estate membership
              try {
                const { data: bldg } = await supabase!
                  .from('buildings')
                  .select('id, name, estate_id')
                  .eq('id', newRecord.building_id)
                  .single();

                if (bldg && bldg.estate_id === managerProfile.assignedEstateId) {
                  handleIncomingReport({
                    ...newRecord,
                    building: { name: bldg.name },
                  });
                }
              } catch {
                // Ignore building fetch error
              }
            }
          }
        )
        .subscribe();

      // 2. Controlled Polling Fallback (Every 10 seconds)
      pollTimer = setInterval(async () => {
        if (!isSubscribed || !supabase) return;
        try {
          const { data: latestReports } = await supabase
            .from('incident_reports')
            .select(`
              id,
              category,
              description,
              status,
              created_at,
              building_id,
              buildings!inner(name, estate_id),
              service_zones(name)
            `)
            .eq('buildings.estate_id', managerProfile.assignedEstateId)
            .eq('status', 'submitted')
            .order('created_at', { ascending: false })
            .limit(10);

          if (latestReports) {
            for (const rep of latestReports) {
              if (!seenReportIdsRef.current.has(rep.id)) {
                handleIncomingReport({
                  id: rep.id,
                  category: rep.category,
                  description: rep.description,
                  created_at: rep.created_at,
                  buildings: rep.buildings as unknown as { name?: string; estate_id?: string },
                  service_zones: rep.service_zones as unknown as { name?: string },
                });
              }
            }
          }
        } catch {
          // Controlled polling retry silently
        }
      }, 10000);

      return () => {
        isSubscribed = false;
        if (channel && supabase) {
          supabase.removeChannel(channel);
        }
        if (pollTimer) {
          clearInterval(pollTimer);
        }
      };
    } catch {
      return () => {
        isSubscribed = false;
        if (pollTimer) clearInterval(pollTimer);
      };
    }
  }, [managerProfile.assignedEstateId, handleIncomingReport]);

  // Handle reviewing a report from notification
  const handleReviewReport = (reportId: string) => {
    markAsRead(reportId);
    setNotificationOpen(false);
    // Navigate to inbox with hash anchor
    router.push(`/management/inbox#report-${reportId}`);
  };

  const isOps = pathname === '/management';
  const isInbox = pathname.startsWith('/management/inbox');
  const isIncidents = pathname.startsWith('/management/incidents');
  const isFacilities = pathname.startsWith('/management/facilities');

  // Active breadcrumb label
  const activeCrumb = isOps
    ? t.management.crumbDashboard
    : isInbox
    ? t.management.sidebarInbox
    : isIncidents
    ? t.management.sidebarIncidents
    : isFacilities
    ? t.management.sidebarFacilities
    : 'Dashboard';

  // Manager initials
  const initials = managerProfile.fullName
    ? managerProfile.fullName
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map((n) => n[0].toUpperCase())
        .join('')
    : 'PR';

  return (
    <div className="min-h-screen bg-[#fcfdfe] text-[#152743] flex flex-col md:flex-row antialiased">
      {/* ─────────────────────────────────────────────────────────────────────────────
          1. Sidebar Navigation (Left Rail on Desktop)
          ───────────────────────────────────────────────────────────────────────────── */}
      <aside className="w-full md:w-[176px] lg:w-[190px] shrink-0 bg-[#f6f8fb] border-b md:border-b-0 md:border-r border-[#eef1f6] p-4 md:p-5 flex flex-col justify-between">
        <div className="space-y-6">
          {/* Top Brand & Mobile Hamburger Bar */}
          <div className="flex items-center justify-between md:block">
            <Link
              href="/management"
              className="inline-block font-serif text-2xl lg:text-[27px] font-bold text-[#0754ac] tracking-tight focus:outline-hidden"
            >
              PPR<em className="text-[#e52232] not-italic">nadi</em>
            </Link>

            {/* Mobile menu trigger */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-lg text-slate-600 hover:bg-slate-200"
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>

          {/* Navigation Links (Desktop + Collapsible Mobile) */}
          <nav
            aria-label="Navigasi Pengurusan"
            className={`${mobileMenuOpen ? 'block' : 'hidden'} md:block space-y-1.5`}
          >
            <Link
              href="/management"
              onClick={() => setMobileMenuOpen(false)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-semibold transition-all min-h-[40px] ${
                isOps
                  ? 'bg-[#1965c6] text-white shadow-xs'
                  : 'text-[#37455b] hover:bg-[#edf4ff] hover:text-[#0754ac]'
              }`}
            >
              <LayoutGrid className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{t.management.sidebarDashboard}</span>
            </Link>

            <Link
              href="/management/inbox"
              onClick={() => setMobileMenuOpen(false)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-semibold transition-all min-h-[40px] ${
                isInbox
                  ? 'bg-[#1965c6] text-white shadow-xs'
                  : 'text-[#37455b] hover:bg-[#edf4ff] hover:text-[#0754ac]'
              }`}
            >
              <Inbox className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{t.management.sidebarInbox}</span>
              {pendingCount > 0 && (
                <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#deebff] text-[#185bb5]">
                  {pendingCount}
                </span>
              )}
            </Link>

            <Link
              href="/management/incidents"
              onClick={() => setMobileMenuOpen(false)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-semibold transition-all min-h-[40px] ${
                isIncidents
                  ? 'bg-[#1965c6] text-white shadow-xs'
                  : 'text-[#37455b] hover:bg-[#edf4ff] hover:text-[#0754ac]'
              }`}
            >
              <Layers className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{t.management.sidebarIncidents}</span>
            </Link>

            <Link
              href="/management/facilities"
              onClick={() => setMobileMenuOpen(false)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-semibold transition-all min-h-[40px] ${
                isFacilities
                  ? 'bg-[#1965c6] text-white shadow-xs'
                  : 'text-[#37455b] hover:bg-[#edf4ff] hover:text-[#0754ac]'
              }`}
            >
              <Blocks className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{t.management.sidebarFacilities}</span>
            </Link>
          </nav>
        </div>

        {/* Sidebar Footer Estate Context */}
        <div className="hidden md:block pt-6 border-t border-[#eef1f6] text-[10px] text-slate-400">
          <p className="font-semibold text-slate-600 truncate">{estateName}</p>
          <p>PPR NADI · Pengurusan</p>
        </div>
      </aside>

      {/* ─────────────────────────────────────────────────────────────────────────────
          2. Content Area (Header + Main Page Content)
          ───────────────────────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header */}
        <header className="relative bg-white border-b border-[#edf0f5] px-4 sm:px-6 py-3.5 min-h-[64px] flex items-center justify-between gap-4">
          {/* Breadcrumb */}
          <nav aria-label="Breadcrumb" className="text-xs text-[#7b8ba3] flex items-center gap-1.5 font-medium">
            <span>{t.management.crumbManagement}</span>
            <span className="text-slate-300">/</span>
            <strong className="text-[#37455b] font-semibold">{activeCrumb}</strong>
          </nav>

          {/* Account Controls: Language, Bell, Avatar, Sign Out */}
          <div className="flex items-center gap-3 sm:gap-4">
            <LanguageSwitcher />

            {/* Notification Bell */}
            <div className="relative">
              <button
                type="button"
                id="management-bell"
                onClick={() => setNotificationOpen(!notificationOpen)}
                aria-label={`Notifikasi: ${unreadNotifications.length} aduan baharu`}
                aria-expanded={notificationOpen}
                className={`relative w-9 h-9 rounded-lg flex items-center justify-center text-[#37455b] hover:bg-[#f1f6fd] transition-colors focus:outline-hidden focus:ring-2 focus:ring-[#1965c6] ${
                  bellRinging ? 'bell-ring-active' : ''
                }`}
              >
                <Bell className={`w-4.5 h-4.5 ${bellRinging ? 'bell-ring-active' : ''}`} aria-hidden="true" />
                {unreadNotifications.length > 0 && (
                  <span
                    aria-hidden="true"
                    className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#e83c4c] ring-2 ring-white"
                  />
                )}
              </button>

              {/* Floating Notification Pop-up Dialog */}
              {notificationOpen && (
                <div
                  id="management-notification-panel"
                  role="alert"
                  aria-label="Notifikasi aduan baharu"
                  aria-live="polite"
                  className="absolute right-0 top-12 w-80 sm:w-88 bg-white border border-[#e4eaf3] rounded-xl shadow-2xl p-4 z-50 space-y-3"
                >
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <strong className="text-xs font-bold text-[#17212F]">
                      {t.management.notificationNewTitle}
                    </strong>
                    <span className="text-[10px] font-semibold text-slate-400">
                      {unreadNotifications.length} {t.management.unreadNotificationsCount}
                    </span>
                  </div>

                  {latestNewReport ? (
                    <div className="p-3 bg-blue-50/70 rounded-lg border border-blue-100 text-xs space-y-1.5">
                      <p className="font-bold text-[#1554AD] truncate">
                        {latestNewReport.categoryTitle}
                      </p>
                      <p className="text-slate-600 line-clamp-2 leading-relaxed">
                        {latestNewReport.description}
                      </p>
                      <p className="text-[10px] text-slate-400 pt-0.5">
                        {latestNewReport.location} · {t.management.justNow}
                      </p>
                      <div className="pt-2 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleReviewReport(latestNewReport.id)}
                          className="px-3 py-1.5 bg-[#1966c7] hover:bg-[#1359af] text-white rounded-lg text-xs font-bold transition-all shadow-xs"
                        >
                          {t.management.reviewComplaintBtn}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            markAsRead(latestNewReport.id);
                            setNotificationOpen(false);
                          }}
                          className="px-3 py-1.5 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-lg text-xs font-medium transition-all"
                        >
                          {t.management.closeNotificationBtn}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500 py-3 text-center">
                      {t.management.noNewNotifications}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Profile Avatar & Label */}
            <div className="flex items-center gap-2 pl-1 border-l border-slate-200">
              <span className="w-8 h-8 rounded-full bg-[#dfebff] text-[#185cb5] font-bold text-xs flex items-center justify-center shrink-0">
                {initials}
              </span>
              <span className="hidden sm:inline text-xs font-semibold text-[#152743]">
                {t.management.roleManager}
              </span>
            </div>

            {/* Sign Out */}
            <SignOutButton />
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 p-4 sm:p-6 lg:p-7 max-w-7xl w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
