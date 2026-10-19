'use client';

import { useTranslation } from '@/lib/i18n/LanguageContext';

export function InboxLoadError({ status }: { status: 'timeout' | 'error' }) {
  const { locale } = useTranslation();
  const copy = {
    ms: {
      timeout: 'Masa sambungan pangkalan data tamat',
      error: 'Gagal memuatkan peti masuk',
      message: 'Senarai aduan tidak dapat dimuatkan. Sila cuba semula.',
      retry: 'Cuba semula',
    },
    en: {
      timeout: 'Database connection timed out',
      error: 'Unable to load inbox',
      message: 'The complaints list could not be loaded. Please try again.',
      retry: 'Retry',
    },
  }[locale];

  return (
    <div role="alert" data-testid={`inbox-${status}-banner`}
      className="p-8 bg-amber-50 border border-amber-200 rounded-2xl text-center space-y-4 max-w-2xl mx-auto my-8">
      <h3 className="text-base font-bold text-amber-950">{copy[status]}</h3>
      <p className="text-sm text-amber-900">{copy.message}</p>
      <a href="/management/inbox" data-testid="inbox-retry-link"
        className="inline-flex items-center px-4 py-2 bg-[#1554AD] text-white font-bold text-sm rounded-xl">
        {copy.retry}
      </a>
    </div>
  );
}
