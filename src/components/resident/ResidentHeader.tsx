'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Home, ClipboardList, PlusCircle } from 'lucide-react';
import { SignOutButton } from '@/components/auth/SignOutButton';
import { useTranslation } from '@/lib/i18n/LanguageContext';

export function ResidentHeader() {
  const { t, locale, setLocale } = useTranslation();

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-[#eef1f5] shadow-xs">
      <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
        {/* Brand: Emblem + PPRnadi Wordmark */}
        <Link
          href="/resident"
          className="flex items-center gap-2.5 min-h-[44px] hover:opacity-95 transition-opacity"
          aria-label="PPR Nadi Portal Penduduk"
        >
          <div className="relative w-9 h-9 sm:w-10 sm:h-10 shrink-0">
            <Image
              src="/images/nadi-emblem.png"
              alt="Logo PPR NADI"
              width={40}
              height={40}
              priority
              className="w-full h-full object-contain block"
            />
          </div>
          <span
            className="font-['Playfair_Display',Georgia,serif] text-[24px] sm:text-[27px] leading-none inline-flex items-baseline select-none"
            aria-label="PPR Nadi"
          >
            <b className="text-[#0b4699] font-bold tracking-[0.5px]">PPR</b>
            <em className="text-[#ed2431] font-medium text-[26px] sm:text-[29px] tracking-[-0.6px] not-italic italic">
              nadi
            </em>
          </span>
        </Link>

        {/* Action Controls & Navigation */}
        <div className="flex items-center gap-3">
          {/* Desktop Navigation Links */}
          <nav aria-label="Navigasi Desktop" className="hidden md:flex items-center gap-2">
            <Link
              href="/resident"
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold text-[#17212F] hover:bg-[#F0F5FC] transition-colors min-h-[44px]"
            >
              <Home className="w-4 h-4 text-[#1554AD]" />
              <span>{t.residentHome.navHome}</span>
            </Link>
            <Link
              href="/resident/lapor"
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-bold bg-[#1554AD] text-white hover:bg-[#0E3E85] transition-colors shadow-xs min-h-[44px]"
            >
              <PlusCircle className="w-4 h-4" />
              <span>{t.residentHome.prominentReportBtn}</span>
            </Link>
            <Link
              href="/resident/sejarah"
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold text-[#17212F] hover:bg-[#F0F5FC] transition-colors min-h-[44px]"
            >
              <ClipboardList className="w-4 h-4 text-[#1554AD]" />
              <span>{t.residentHome.navReports}</span>
            </Link>
          </nav>

          {/* Language Switcher Capsule */}
          <div
            className="flex border border-[#e5eaf1] rounded-[24px] p-[2px] sm:p-[3px] gap-[1px] bg-[#f3f6fa] shrink-0"
            role="group"
            aria-label={locale === 'ms' ? 'Pilihan Bahasa' : 'Language Selection'}
          >
            <button
              type="button"
              onClick={() => setLocale('ms')}
              aria-label="Bahasa Melayu"
              aria-pressed={locale === 'ms'}
              className={`border-0 rounded-[20px] min-w-[42px] sm:min-w-[44px] min-h-[38px] sm:min-h-[40px] px-2.5 sm:px-[11px] text-[13px] font-bold transition-all cursor-pointer font-['Manrope',Arial,sans-serif] ${
                locale === 'ms'
                  ? 'bg-white text-[#1956b8] shadow-[0_1px_4px_rgba(20,45,69,0.08)]'
                  : 'bg-transparent text-[#4c6079] hover:text-[#1956b8]'
              }`}
            >
              BM
            </button>
            <button
              type="button"
              onClick={() => setLocale('en')}
              aria-label="English"
              aria-pressed={locale === 'en'}
              className={`border-0 rounded-[20px] min-w-[42px] sm:min-w-[44px] min-h-[38px] sm:min-h-[40px] px-2.5 sm:px-[11px] text-[13px] font-bold transition-all cursor-pointer font-['Manrope',Arial,sans-serif] ${
                locale === 'en'
                  ? 'bg-white text-[#1956b8] shadow-[0_1px_4px_rgba(20,45,69,0.08)]'
                  : 'bg-transparent text-[#4c6079] hover:text-[#1956b8]'
              }`}
            >
              English
            </button>
          </div>

          {/* Desktop Sign Out */}
          <div className="hidden md:block border-l border-[#CBD5E1] pl-2 ml-1">
            <SignOutButton />
          </div>
        </div>
      </div>
    </header>
  );
}
