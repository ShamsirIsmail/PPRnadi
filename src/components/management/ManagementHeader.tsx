'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Inbox,
  AlertOctagon,
  Wrench,
  Building2,
  ChevronDown,
} from 'lucide-react';
import { SignOutButton } from '@/components/auth/SignOutButton';
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher';
import { useTranslation } from '@/lib/i18n/LanguageContext';

export function ManagementHeader() {
  const pathname = usePathname();
  const { t } = useTranslation();

  const isOps = pathname === '/management';
  const isInbox = pathname.startsWith('/management/inbox');
  const isIncidents = pathname.startsWith('/management/incidents');
  const isFacilities = pathname.startsWith('/management/facilities');

  return (
    <header className="sticky top-0 z-40 bg-white border-b-2 border-[#CBD5E1] shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex items-center justify-between gap-4">
        {/* Brand & Location Header */}
        <div className="flex items-center gap-6">
          <Link href="/management" className="flex items-center gap-3 min-h-[44px]">
            <div className="relative w-9 h-9 rounded-lg overflow-hidden shrink-0">
              <Image
                src="/images/logo.png"
                alt="PPR NADI"
                fill
                className="object-contain"
              />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-base tracking-tight text-[#1554AD]">
                  PPR NADI
                </span>
                <span className="text-[10px] font-bold px-1.5 py-0.5 bg-[#1554AD] text-white rounded">
                  {t.nav.management.toUpperCase()}
                </span>
              </div>
              <p className="text-xs font-semibold text-[#374151]">
                {t.management.headerSubtitle}
              </p>
            </div>
          </Link>

          {/* Prominent Authorized Location Header with Field Study Site Context */}
          <div className="hidden lg:flex items-center gap-2.5 px-3.5 py-1.5 rounded-xl border border-[#CBD5E1] bg-[#F0F5FC]">
            <Building2 className="w-4 h-4 text-[#1554AD] shrink-0" />
            <div className="text-xs">
              <div className="flex items-center gap-1.5">
                <span className="font-extrabold text-[#17212F] block">
                  PPR/PA Desa Rejang
                </span>
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-sm bg-emerald-100 text-emerald-800">
                  Kajian
                </span>
              </div>
              <span className="text-[10px] text-slate-600 block">
                Setapak Jaya • 12 Blok • 2,791 Unit
              </span>
            </div>
            <div
              className="ml-1 text-[#374151] opacity-60 cursor-pointer"
              title="Kawasan Kajian Utama: PPR/PA Desa Rejang (12 Blok, 2,791 Unit, 38 Lif). Persekitaran demo ppr-sentosa-demo dikekalkan untuk ujian automasi."
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </div>
          </div>

          {/* Desktop Navigation Links */}
          <nav aria-label="Navigasi Pengurusan" className="hidden xl:flex items-center gap-1">
            <Link
              href="/management"
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all min-h-[40px] ${
                isOps
                  ? 'bg-[#1554AD] text-white shadow-xs'
                  : 'text-[#17212F] hover:bg-[#F0F5FC]'
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              <span>{t.management.navOperations}</span>
            </Link>

            <Link
              href="/management/inbox"
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all min-h-[40px] ${
                isInbox
                  ? 'bg-[#1554AD] text-white shadow-xs'
                  : 'text-[#17212F] hover:bg-[#F0F5FC]'
              }`}
            >
              <Inbox className="w-4 h-4" />
              <span>{t.management.navInbox}</span>
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            </Link>

            <Link
              href="/management/incidents"
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all min-h-[40px] ${
                isIncidents
                  ? 'bg-[#1554AD] text-white shadow-xs'
                  : 'text-[#17212F] hover:bg-[#F0F5FC]'
              }`}
            >
              <AlertOctagon className="w-4 h-4" />
              <span>{t.management.navIncidents}</span>
            </Link>

            <Link
              href="/management/facilities"
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all min-h-[40px] ${
                isFacilities
                  ? 'bg-[#1554AD] text-white shadow-xs'
                  : 'text-[#17212F] hover:bg-[#F0F5FC]'
              }`}
            >
              <Wrench className="w-4 h-4" />
              <span>{t.management.navFacilities}</span>
            </Link>
          </nav>
        </div>

        {/* Right Section: Language Switcher, Home Link, Sign Out */}
        <div className="flex items-center gap-3">
          <LanguageSwitcher />

          <Link
            href="/"
            className="hidden sm:inline-flex items-center text-xs font-bold px-3 py-1.5 rounded-lg border border-[#CBD5E1] bg-white text-[#17212F] hover:bg-[#F0F5FC] transition-colors min-h-[38px]"
          >
            Laman Utama
          </Link>

          <div className="border-l border-[#CBD5E1] pl-2">
            <SignOutButton />
          </div>
        </div>
      </div>

      {/* Mobile / Tablet Horizontal Navigation Scroll */}
      <nav
        aria-label="Navigasi pengurusan mudah alih"
        className="xl:hidden flex items-center gap-1.5 px-4 pb-2.5 overflow-x-auto text-xs"
      >
        <Link
          className={`rounded-lg px-3 py-1.5 font-bold whitespace-nowrap min-h-[38px] flex items-center ${
            isOps ? 'bg-[#1554AD] text-white' : 'bg-[#F0F5FC] text-[#17212F]'
          }`}
          href="/management"
        >
          {t.management.navOperations}
        </Link>
        <Link
          className={`rounded-lg px-3 py-1.5 font-bold whitespace-nowrap min-h-[38px] flex items-center ${
            isInbox ? 'bg-[#1554AD] text-white' : 'bg-[#F0F5FC] text-[#17212F]'
          }`}
          href="/management/inbox"
        >
          {t.management.navInbox}
        </Link>
        <Link
          className={`rounded-lg px-3 py-1.5 font-bold whitespace-nowrap min-h-[38px] flex items-center ${
            isIncidents ? 'bg-[#1554AD] text-white' : 'bg-[#F0F5FC] text-[#17212F]'
          }`}
          href="/management/incidents"
        >
          {t.management.navIncidents}
        </Link>
        <Link
          className={`rounded-lg px-3 py-1.5 font-bold whitespace-nowrap min-h-[38px] flex items-center ${
            isFacilities ? 'bg-[#1554AD] text-white' : 'bg-[#F0F5FC] text-[#17212F]'
          }`}
          href="/management/facilities"
        >
          {t.management.navFacilities}
        </Link>
      </nav>
    </header>
  );
}
