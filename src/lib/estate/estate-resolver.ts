import { DESA_REJANG_ESTATE, DEMO_ESTATE } from '@/lib/constants/estate-data';

export interface EstateResolution {
  name: string;
  isSpecified: boolean;
}

/**
 * Resolves estate display name strictly based on profile or building estate_id.
 * Never falls back to a default estate (e.g. PPR Sentosa) if the ID is unknown or empty.
 */
export function resolveEstateName(
  estateId: string | null | undefined,
  locale: 'ms' | 'en' = 'ms'
): EstateResolution {
  if (!estateId || !estateId.trim()) {
    return {
      name: locale === 'ms' ? 'Kawasan tidak ditentukan' : 'Estate not specified',
      isSpecified: false,
    };
  }

  const cleanId = estateId.trim();

  if (cleanId === DESA_REJANG_ESTATE.id || cleanId === 'desa-rejang') {
    return { name: 'PPR Desa Rejang', isSpecified: true };
  }
  if (cleanId === DEMO_ESTATE.id || cleanId === 'ppr-sentosa') {
    return { name: 'PPR Sentosa', isSpecified: true };
  }
  if (cleanId === 'test-estate-b') {
    return { name: 'PPR Lestari', isSpecified: true };
  }
  if (cleanId === 'test-estate-a') {
    return { name: 'PPR Harmoni', isSpecified: true };
  }

  // Unknown estate: return neutral message without inventing or defaulting to PPR Sentosa
  return {
    name: locale === 'ms' ? 'Kawasan tidak ditentukan' : 'Estate not specified',
    isSpecified: false,
  };
}
