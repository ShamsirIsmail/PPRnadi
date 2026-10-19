'use client';

import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import { translations, type Locale, type TranslationDictionary } from './translations';

interface LanguageContextType {
  locale: Locale;
  t: TranslationDictionary;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
}

const LanguageContext = createContext<LanguageContextType>({
  locale: 'ms',
  t: translations.ms,
  setLocale: () => {},
  toggleLocale: () => {},
});

export function LanguageProvider({
  children,
  initialLocale = 'ms',
}: {
  children: React.ReactNode;
  initialLocale?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  // Read saved preference from cookie or localStorage on client mount & listen for cross-tab sync
  useEffect(() => {
    try {
      const match = document.cookie.match(/(?:^|; )ppr_locale=(ms|en)(?:;|$)/);
      const savedCookie = match ? match[1] : null;
      const savedStorage = localStorage.getItem('ppr_locale');
      const activePref = (savedCookie || savedStorage) as Locale | null;

      if (activePref === 'ms' || activePref === 'en') {
        if (activePref !== initialLocale) {
          setTimeout(() => setLocaleState(activePref), 0);
        }
      }
    } catch {
      // Ignore in restricted environments
    }

    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'ppr_locale' && (e.newValue === 'ms' || e.newValue === 'en')) {
        setLocaleState(e.newValue);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [initialLocale]);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    try {
      localStorage.setItem('ppr_locale', newLocale);
      document.cookie = `ppr_locale=${newLocale}; path=/; max-age=31536000; SameSite=Lax`;
    } catch {
      // Ignore
    }
  }, []);

  const toggleLocale = useCallback(() => {
    setLocale(locale === 'ms' ? 'en' : 'ms');
  }, [locale, setLocale]);

  const value = useMemo(() => {
    const activeDict = (translations[locale] || translations.ms) as TranslationDictionary;
    return {
      locale,
      t: activeDict,
      setLocale,
      toggleLocale,
    };
  }, [locale, setLocale, toggleLocale]);

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useTranslation() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    return {
      locale: 'ms' as Locale,
      t: translations.ms as TranslationDictionary,
      setLocale: () => {},
      toggleLocale: () => {},
    };
  }
  return ctx;
}
