'use client';

import React from 'react';
import { useTranslation } from '@/lib/i18n/LanguageContext';

interface LanguageSwitcherProps {
  className?: string;
}

export function LanguageSwitcher({ className = '' }: LanguageSwitcherProps) {
  const { locale, setLocale } = useTranslation();

  return (
    <div
      role="group"
      aria-label="Tukar bahasa / Switch language"
      className={`inline-flex items-center rounded-lg border border-[#CBD5E1] bg-white p-0.5 shadow-xs ${className}`}
    >
      <button
        type="button"
        onClick={() => setLocale('ms')}
        aria-pressed={locale === 'ms'}
        className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all min-h-[38px] flex items-center justify-center ${
          locale === 'ms'
            ? 'bg-[#1554AD] text-white shadow-xs'
            : 'text-[#17212F] hover:bg-[#F0F5FC]'
        }`}
      >
        <span>BM</span>
      </button>

      <span className="text-[#CBD5E1] mx-0.5 select-none" aria-hidden="true">
        |
      </span>

      <button
        type="button"
        onClick={() => setLocale('en')}
        aria-pressed={locale === 'en'}
        className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all min-h-[38px] flex items-center justify-center ${
          locale === 'en'
            ? 'bg-[#1554AD] text-white shadow-xs'
            : 'text-[#17212F] hover:bg-[#F0F5FC]'
        }`}
      >
        <span>EN</span>
      </button>
    </div>
  );
}
