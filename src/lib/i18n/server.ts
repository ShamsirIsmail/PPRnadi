import { cookies } from 'next/headers';
import { translations, type Locale, type TranslationDictionary } from './translations';

export async function getServerLocale(): Promise<Locale> {
  try {
    const cookieStore = await cookies();
    const cookieLocale = cookieStore.get('ppr_locale')?.value;
    if (cookieLocale === 'en' || cookieLocale === 'ms') {
      return cookieLocale;
    }
  } catch {
    // Fallback if cookies() unavailable (e.g. static generation)
  }
  return 'ms';
}

export async function getServerTranslation(): Promise<{
  locale: Locale;
  t: TranslationDictionary;
}> {
  const locale = await getServerLocale();
  const t = (translations[locale] || translations.ms) as TranslationDictionary;
  return { locale, t };
}
