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
  Radio,
  CheckCheck,
} from 'lucide-react';
import { SignOutButton } from '@/components/auth/SignOutButton';
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher';
import { useTranslation } from '@/lib/i18n/LanguageContext';
import { createClient } from '@/lib/supabase/client';

export interface InitialPendingReport {
  id: string;
  category: string;
  description: string;
  location: string;
  created_at: string;
}

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
  initialPendingReports: InitialPendingReport[];
}

export function ManagementShell({
  children,
  managerProfile,
  estateName,
  initialPendingReportsCount,
  initialPendingReports,
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
  const [realtimeStatus, setRealtimeStatus] = useState<'connecting' | 'connected' | 'polling'>('connecting');

  // Timers and deduplication
  const bellTimerRef = useRef<NodeJS.Timeout | null>(null);
  const seenReportIdsRef = useRef<Set<string>>(
    new Set(initialPendingReports.map((r) => r.id))
  );
  const readStorageKey = `ppr_nadi_read_notifications_${managerProfile.id}`;

  // Helper to retrieve read IDs from localStorage
  const getReadNotificationIds = useCallback((): string[] => {
    if (typeof window === 'undefined') return [];
    try {
      const stored = localStorage.getItem(readStorageKey);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }, [readStorageKey]);

  // Initialize unread list on client mount without triggering bell ring animation
  useEffect(() => {
    const readIds = getReadNotificationIds();
    const unread = initialPendingReports
      .filter((r) => !readIds.includes(r.id))
      .map((r) => ({
        id: r.id,
        category: r.category,
        categoryTitle:
          t.categories[r.category as keyof typeof t.categories] || r.category,
        description: r.description,
        location: r.location,
        created_at: r.created_at,
      }));

    setUnreadNotifications(unread);
    if (unread.length > 0) {
      setLatestNewReport(unread[0]);
    }
    // CRITICAL: bellRinging stays false on initial mount
  }, [initialPendingReports, getReadNotificationIds, t]);

  // Mark a single notification as read
  const markAsRead = useCallback(
    (reportId: string) => {
      if (typeof window === 'undefined') return;
      try {
        const readIds = getReadNotificationIds();
        if (!readIds.includes(reportId)) {
          const updated = [...readIds, reportId];
          localStorage.setItem(readStorageKey, JSON.stringify(updated));
        }
      } catch {
        // Storage restricted
      }
      setUnreadNotifications((prev) => {
        const remaining = prev.filter((n) => n.id !== reportId);
        setLatestNewReport(remaining.length > 0 ? remaining[0] : null);
        return remaining;
      });
    },
    [getReadNotificationIds, readStorageKey]
  );

  // Mark all unread notifications as read
  const markAllAsRead = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      const readIds = getReadNotificationIds();
      const currentUnreadIds = unreadNotifications.map((n) => n.id);
      const updated = Array.from(new Set([...readIds, ...currentUnreadIds]));
      localStorage.setItem(readStorageKey, JSON.stringify(updated));
    } catch {
      // Storage restricted
    }
    setUnreadNotifications([]);
    setLatestNewReport(null);
  }, [getReadNotificationIds, readStorageKey, unreadNotifications]);

  // Process a newly arrived report at runtime
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

      const readIds = getReadNotificationIds();
      if (readIds.includes(report.id)) {
        return;
      }

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
      if (bellTimerRef.current) clearTimeout(bellTimerRef.current);
      bellTimerRef.current = setTimeout(() => setBellRinging(false), 1800);

      // Add to unread notifications and pop up panel
      setLatestNewReport(newNotif);
      setUnreadNotifications((prev) => [newNotif, ...prev.filter((n) => n.id !== report.id)]);
      setNotificationOpen(true);
      setPendingCount((prev) => prev + 1);

      // Dispatch event to window so active dashboard rows update live
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('ppr_new_report_arrived', {
            detail: {
              id: report.id,
              category: report.category,
              description: report.description,
              status: 'submitted',
              urgency_hint: 'medium',
              created_at: report.created_at,
              building: {
                id: '',
                name: bldgName,
                code: bldgName,
              },
              zone: report.service_zones ? { id: '', name: report.service_zones.name || '' } : null,
              attachments: [],
            },
          })
        );
      }
    },
    [getReadNotificationIds, t]
  );

  // Realtime & Controlled Polling Setup
  useEffect(() => {
    let supabase: ReturnType<typeof createClient> | null = null;
    let pollTimer: NodeJS.Timeout | null = null;
    let isSubscribed = true;

    try {
      supabase = createClient();

      // 1. Supabase Realtime Channel
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
        .subscribe((status) => {
          if (!isSubscribed) return;
          if (status === 'SUBSCRIBED') {
            setRealtimeStatus('connected');
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            setRealtimeStatus('polling');
          }
        });

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
          // Graceful polling retry
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
        if (bellTimerRef.current) {
          clearTimeout(bellTimerRef.current);
        }
      };
    } catch {
      setRealtimeStatus('polling');
      return () => {
        isSubscribed = false;
        if (pollTimer) clearInterval(pollTimer);
        if (bellTimerRef.current) clearTimeout(bellTimerRef.current);
      };
    }
  }, [managerProfile.assignedEstateId, handleIncomingReport]);

  // Review report action from notification
  const handleReviewReport = (reportId: string) => {
    markAsRead(reportId);
    setNotificationOpen(false);
    if (pathname === '/management') {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('ppr_open_report_detail', { detail: { reportId } })
        );
      }
    } else {
      router.push(`/management#report-${reportId}`);
    }
  };

  const isOps = pathname === '/management';
  const isInbox = pathname.startsWith('/management/inbox');
  const isIncidents = pathname.startsWith('/management/incidents');
  const isFacilities = pathname.startsWith('/management/facilities');

  // Breadcrumb label
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
    <div className="min-h-screen bg-white text-[#152743] flex flex-col md:flex-row antialiased">
      {/* ─────────────────────────────────────────────────────────────────────────────
          1. Sidebar Navigation (Left Rail: 166px / 180px on desktop)
          ───────────────────────────────────────────────────────────────────────────── */}
      <aside className="w-full md:w-[166px] lg:w-[180px] shrink-0 bg-[#f6f8fb] border-b md:border-b-0 md:border-r border-[#eef1f6] p-4 md:py-6 md:px-3 flex flex-col justify-between">
        <div className="space-y-5">
          {/* Brand & Mobile Hamburger */}
          <div className="flex items-center justify-between md:block px-1">
            <Link
              href="/management"
              className="inline-block font-serif text-2xl lg:text-[27px] font-bold text-[#0754ac] tracking-tight focus:outline-hidden"
            >
              PPR<em className="text-[#e52232] not-italic">nadi</em>
            </Link>

            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-lg text-slate-600 hover:bg-slate-200"
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>

          {/* Navigation Links (Only Real Available Routes) */}
          <nav
            aria-label="Navigasi Pengurusan"
            className={`${mobileMenuOpen ? 'block' : 'hidden'} md:block space-y-1`}
          >
            <Link
              href="/management"
              onClick={() => setMobileMenuOpen(false)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[7px] text-xs font-semibold transition-all min-h-[40px] ${
                isOps
                  ? 'bg-[#1965c6] text-white shadow-[0_3px_8px_#1b66b918]'
                  : 'text-[#37455b] hover:bg-[#edf4ff] hover:text-[#0754ac]'
              }`}
            >
              <LayoutGrid className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{t.management.sidebarDashboard}</span>
            </Link>

            <Link
              href="/management/inbox"
              onClick={() => setMobileMenuOpen(false)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[7px] text-xs font-semibold transition-all min-h-[40px] ${
                isInbox
                  ? 'bg-[#1965c6] text-white shadow-[0_3px_8px_#1b66b918]'
                  : 'text-[#37455b] hover:bg-[#edf4ff] hover:text-[#0754ac]'
              }`}
            >
              <Inbox className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{t.management.sidebarInbox}</span>
              {pendingCount > 0 && (
                <span
                  id="side-count"
                  className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#deebff] text-[#185bb5]"
                >
                  {pendingCount}
                </span>
              )}
            </Link>

            <Link
              href="/management/incidents"
              onClick={() => setMobileMenuOpen(false)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[7px] text-xs font-semibold transition-all min-h-[40px] ${
                isIncidents
                  ? 'bg-[#1965c6] text-white shadow-[0_3px_8px_#1b66b918]'
                  : 'text-[#37455b] hover:bg-[#edf4ff] hover:text-[#0754ac]'
              }`}
            >
              <Layers className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{t.management.sidebarIncidents}</span>
            </Link>

            <Link
              href="/management/facilities"
              onClick={() => setMobileMenuOpen(false)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[7px] text-xs font-semibold transition-all min-h-[40px] ${
                isFacilities
                  ? 'bg-[#1965c6] text-white shadow-[0_3px_8px_#1b66b918]'
                  : 'text-[#37455b] hover:bg-[#edf4ff] hover:text-[#0754ac]'
              }`}
            >
              <Blocks className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{t.management.sidebarFacilities}</span>
            </Link>
          </nav>
        </div>

        {/* Sidebar Footer Estate Context */}
        <div className="hidden md:block pt-5 border-t border-[#eef1f6] text-[10px] text-slate-400 px-1">
          <p className="font-semibold text-slate-600 truncate">{estateName}</p>
          <p>PPR NADI · Pengurusan</p>
        </div>
      </aside>

      {/* ─────────────────────────────────────────────────────────────────────────────
          2. Content Area (Header + Main Page Content)
          ───────────────────────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header matching reference */}
        <header className="relative bg-white border-b border-[#edf0f5] px-4 sm:px-6 py-3.5 min-h-[66px] flex items-center justify-between gap-4">
          {/* Breadcrumb */}
          <nav aria-label="Breadcrumb" className="text-[11px] text-[#7b8ba3] flex items-center gap-1.5 font-medium">
            <span>{t.management.crumbManagement}</span>
            <span className="text-slate-300">/</span>
            <strong className="text-[#37455b] font-semibold">{activeCrumb}</strong>
          </nav>

          {/* Account Controls: Language, Bell, Avatar, Sign Out */}
          <div className="flex items-center gap-3 sm:gap-3.5">
            <LanguageSwitcher />

            {/* Notification Bell */}
            <div className="relative">
              <button
                type="button"
                id="bell"
                onClick={() => setNotificationOpen(!notificationOpen)}
                aria-label={`Notifikasi: ${unreadNotifications.length} aduan baharu`}
                aria-expanded={notificationOpen}
                className={`relative w-9 h-9 rounded-lg flex items-center justify-center text-[#37455b] hover:bg-[#f1f6fd] transition-colors focus:outline-hidden focus:ring-2 focus:ring-[#1965c6] ${
                  bellRinging ? 'ring bell-ring-active' : ''
                }`}
              >
                <Bell className={`w-[18px] h-[18px] ${bellRinging ? 'bell-ring-active' : ''}`} aria-hidden="true" />
                {unreadNotifications.length > 0 && (
                  <span
                    aria-hidden="true"
                    className="absolute top-[5px] right-[7px] w-[7px] h-[7px] rounded-full bg-[#e83c4c] ring-2 ring-white"
                  />
                )}
              </button>

              {/* Floating Notification Popover (#notification) */}
              {notificationOpen && (
                <div
                  id="notification"
                  role="alert"
                  aria-label="Notifikasi aduan baharu"
                  aria-live="polite"
                  className="absolute right-0 top-12 w-[310px] sm:w-[330px] bg-white border border-[#e4eaf3] rounded-[10px] shadow-[0_12px_35px_#20345522] p-4 z-50 space-y-3"
                >
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <div className="flex items-center gap-1.5">
                      <strong className="text-xs font-bold text-[#152743]">
                        {unreadNotifications.length > 0
                          ? t.management.notificationNewTitle
                          : 'Notifikasi Pengurusan'}
                      </strong>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span
                        title={
                          realtimeStatus === 'connected'
                            ? 'Realtime aktif'
                            : 'Polling 10s'
                        }
                        className={`inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                          realtimeStatus === 'connected'
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-amber-50 text-amber-700'
                        }`}
                      >
                        <Radio className="w-2.5 h-2.5" />
                        <span>{realtimeStatus === 'connected' ? 'Live' : 'Polling'}</span>
                      </span>
                    </div>
                  </div>

                  {latestNewReport ? (
                    <div className="space-y-2">
                      <div className="p-3 bg-blue-50/60 rounded-lg border border-blue-100/80 text-xs space-y-1">
                        <p className="font-bold text-[#1554AD] truncate">
                          {latestNewReport.categoryTitle}
                        </p>
                        <p className="text-slate-600 text-[11px] line-clamp-2 leading-relaxed">
                          {latestNewReport.description}
                        </p>
                        <p className="text-[10px] text-slate-400 pt-0.5">
                          {latestNewReport.location} · {t.management.justNow}
                        </p>
                      </div>

                      <div className="pt-1 flex items-center gap-2">
                        <button
                          type="button"
                          id="review-new"
                          onClick={() => handleReviewReport(latestNewReport.id)}
                          className="px-3 py-1.5 bg-[#1966c7] hover:bg-[#1359af] text-white rounded-[7px] text-xs font-semibold transition-all shadow-xs"
                        >
                          {t.management.reviewComplaintBtn}
                        </button>
                        <button
                          type="button"
                          id="close-notification"
                          onClick={() => {
                            markAsRead(latestNewReport.id);
                            setNotificationOpen(false);
                          }}
                          className="px-3 py-1.5 border border-[#e3e9f1] hover:bg-slate-50 text-slate-600 rounded-[7px] text-xs font-medium transition-all"
                        >
                          {t.management.closeNotificationBtn}
                        </button>
                      </div>

                      {unreadNotifications.length > 1 && (
                        <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400">
                          <span>
                            +{unreadNotifications.length - 1} lagi belum dibaca
                          </span>
                          <button
                            type="button"
                            onClick={markAllAsRead}
                            className="text-[#1965c6] font-semibold hover:underline flex items-center gap-1"
                          >
                            <CheckCheck className="w-3 h-3" />
                            <span>Tanda semua dibaca</span>
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="py-4 text-center space-y-1">
                      <p className="text-xs text-slate-500">
                        {t.management.noNewNotifications}
                      </p>
                      <button
                        type="button"
                        onClick={() => setNotificationOpen(false)}
                        className="text-[11px] text-[#1965c6] font-medium hover:underline mt-1"
                      >
                        {t.management.closeNotificationBtn}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Profile Avatar & Label */}
            <div className="flex items-center gap-2 pl-1 border-l border-slate-200">
              <span className="w-8 h-8 rounded-full bg-[#dfebff] text-[#185cb5] font-semibold text-[11px] flex items-center justify-center shrink-0">
                {initials}
              </span>
              <span className="hidden sm:inline text-[11px] font-semibold text-[#152743]">
                {t.management.roleManager}
              </span>
            </div>

            {/* Sign Out */}
            <SignOutButton />
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 p-4 sm:p-6 lg:p-6 max-w-7xl w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
