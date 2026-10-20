'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, ClipboardList, UserRound } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/LanguageContext';
import { createClient } from '@/lib/supabase/client';
import { ResidentAccountModal } from './ResidentAccountModal';
import type { ProfileRow } from '@/types/database';

interface CachedProfileState {
  profile?: ProfileRow;
  building?: { name: string; code?: string; estate_id?: string } | null;
}

function getCachedProfile(): CachedProfileState | undefined {
  if (typeof window === 'undefined') return undefined;
  const win = window as unknown as { __pprResidentProfile?: CachedProfileState };
  return win.__pprResidentProfile;
}

export function ResidentBottomNav() {
  const pathname = usePathname();
  const { locale } = useTranslation();

  const isHome = pathname === '/resident';
  const isReports = pathname.startsWith('/resident/sejarah');

  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [profile, setProfile] = useState<ProfileRow | null>(() => {
    return getCachedProfile()?.profile || null;
  });
  const [building, setBuilding] = useState<{ name: string; code?: string; estate_id?: string } | null>(() => {
    return getCachedProfile()?.building || null;
  });

  // Listen to open-resident-account and set-resident-profile events
  useEffect(() => {
    const handleOpen = () => {
      const cached = getCachedProfile();
      if (cached?.profile) setProfile(cached.profile);
      if (cached?.building) setBuilding(cached.building);
      setIsAccountOpen(true);
    };
    const handleSetProfile = (e: Event) => {
      const customEvent = e as CustomEvent<{ profile: ProfileRow; building: { name: string } }>;
      if (customEvent.detail?.profile) setProfile(customEvent.detail.profile);
      if (customEvent.detail?.building) setBuilding(customEvent.detail.building);
    };

    window.addEventListener('open-resident-account', handleOpen);
    window.addEventListener('set-resident-profile', handleSetProfile);
    return () => {
      window.removeEventListener('open-resident-account', handleOpen);
      window.removeEventListener('set-resident-profile', handleSetProfile);
    };
  }, []);

  // Fetch profile on-demand when account modal opens
  useEffect(() => {
    if (isAccountOpen && !profile) {
      try {
        const supabase = createClient();
        supabase.auth.getUser().then(async ({ data }) => {
          const user = data?.user;
          if (user) {
            const { data: prof } = await supabase
              .from('profiles')
              .select('*')
              .eq('id', user.id)
              .single();
            if (prof) {
              setProfile(prof as ProfileRow);
              if (prof.assigned_building_id) {
                const { data: bld } = await supabase
                  .from('buildings')
                  .select('name')
                  .eq('id', prof.assigned_building_id)
                  .single();
                if (bld) setBuilding(bld);
              }
            }
          }
        });
      } catch {
        // Handle offline or fallback
      }
    }
  }, [isAccountOpen, profile]);

  return (
    <>
      <nav
        aria-label="Navigasi Utama Penduduk"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-[#e2e8f0] shadow-lg pb-[env(safe-area-inset-bottom)]"
      >
        <div className="grid grid-cols-3 h-16">
          {/* Tab 1: Utama / Home */}
          <Link
            href="/resident"
            aria-current={isHome && !isAccountOpen ? 'page' : undefined}
            className={`relative flex flex-col items-center justify-center gap-1 min-h-[48px] transition-all duration-200 cursor-pointer ${
              isHome && !isAccountOpen
                ? 'bg-[#f0f5fd] text-[#1554ad] font-bold'
                : 'text-slate-600 hover:text-[#1554ad] hover:bg-slate-50'
            }`}
          >
            {isHome && !isAccountOpen && (
              <span className="absolute top-0 left-1/4 right-1/4 h-[3px] bg-[#1554ad] rounded-b-md" />
            )}
            <Home className="w-5 h-5 stroke-2" />
            <span className="text-[11px] sm:text-xs leading-none font-bold">
              {locale === 'ms' ? 'Utama' : 'Home'}
            </span>
          </Link>

          {/* Tab 2: Aduan Saya / My Reports */}
          <Link
            href="/resident/sejarah"
            aria-current={isReports && !isAccountOpen ? 'page' : undefined}
            className={`relative flex flex-col items-center justify-center gap-1 min-h-[48px] transition-all duration-200 cursor-pointer ${
              isReports && !isAccountOpen
                ? 'bg-[#f0f5fd] text-[#1554ad] font-bold'
                : 'text-slate-600 hover:text-[#1554ad] hover:bg-slate-50'
            }`}
          >
            {isReports && !isAccountOpen && (
              <span className="absolute top-0 left-1/4 right-1/4 h-[3px] bg-[#1554ad] rounded-b-md" />
            )}
            <ClipboardList className="w-5 h-5 stroke-2" />
            <span className="text-[11px] sm:text-xs leading-none font-bold">
              {locale === 'ms' ? 'Aduan Saya' : 'My Reports'}
            </span>
          </Link>

          {/* Tab 3: Akaun / Account */}
          <button
            type="button"
            onClick={() => {
              const cached = getCachedProfile();
              if (cached?.profile) setProfile(cached.profile);
              if (cached?.building) setBuilding(cached.building);
              setIsAccountOpen(true);
            }}
            aria-current={isAccountOpen ? 'page' : undefined}
            aria-label={locale === 'ms' ? 'Akaun' : 'Account'}
            className={`relative flex flex-col items-center justify-center gap-1 min-h-[48px] transition-all duration-200 cursor-pointer ${
              isAccountOpen
                ? 'bg-[#f0f5fd] text-[#1554ad] font-bold'
                : 'text-slate-600 hover:text-[#1554ad] hover:bg-slate-50'
            }`}
          >
            {isAccountOpen && (
              <span className="absolute top-0 left-1/4 right-1/4 h-[3px] bg-[#1554ad] rounded-b-md" />
            )}
            <UserRound className="w-5 h-5 stroke-2" />
            <span className="text-[11px] sm:text-xs leading-none font-bold">
              {locale === 'ms' ? 'Akaun' : 'Account'}
            </span>
          </button>
        </div>
      </nav>

      {/* Account Info & Logout Modal */}
      <ResidentAccountModal
        isOpen={isAccountOpen}
        onClose={() => setIsAccountOpen(false)}
        profile={profile}
        building={building}
      />
    </>
  );
}
