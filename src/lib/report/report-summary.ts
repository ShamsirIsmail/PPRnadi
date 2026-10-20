import type { FacilityCategory } from '@/types/database';

export type SubIssueId =
  // Water supply
  | 'no_water'
  | 'low_pressure'
  | 'pipe_leak'
  | 'water_other'
  // Lift
  | 'not_moving'
  | 'door_problem'
  | 'trapped'
  | 'lift_other'
  // Corridor lighting
  | 'not_working'
  | 'flickering'
  | 'lighting_other';

export interface SubIssueOption {
  id: SubIssueId;
  label: { ms: string; en: string };
}

export const SUB_ISSUE_OPTIONS: Record<FacilityCategory, SubIssueOption[]> = {
  water_supply: [
    { id: 'no_water', label: { ms: 'Tiada air', en: 'No water supply' } },
    { id: 'low_pressure', label: { ms: 'Tekanan rendah', en: 'Low pressure' } },
    { id: 'pipe_leak', label: { ms: 'Kebocoran', en: 'Pipe leakage' } },
    { id: 'water_other', label: { ms: 'Masalah lain', en: 'Other issue' } },
  ],
  lift: [
    { id: 'not_moving', label: { ms: 'Tidak bergerak', en: 'Not moving' } },
    { id: 'door_problem', label: { ms: 'Pintu bermasalah', en: 'Door problem' } },
    { id: 'trapped', label: { ms: 'Ada orang terperangkap', en: 'People trapped inside' } },
    { id: 'lift_other', label: { ms: 'Kerosakan lain', en: 'Other damage' } },
  ],
  corridor_lighting: [
    { id: 'not_working', label: { ms: 'Tidak menyala', en: 'Not working' } },
    { id: 'flickering', label: { ms: 'Berkelip', en: 'Flickering' } },
    { id: 'lighting_other', label: { ms: 'Kerosakan lain', en: 'Other damage' } },
  ],
  other: [],
};

export function getSubIssueLabel(subIssueId: string | undefined | null, locale: 'ms' | 'en'): string {
  if (!subIssueId) return '';
  for (const list of Object.values(SUB_ISSUE_OPTIONS)) {
    const found = list.find((item) => item.id === subIssueId);
    if (found) {
      return found.label[locale];
    }
  }
  return subIssueId;
}

export function isEmergencySubIssue(category: FacilityCategory, subIssueId: string | undefined | null): boolean {
  return category === 'lift' && subIssueId === 'trapped';
}

export function formatLocationText(buildingName: string, floor: string, locale: 'ms' | 'en'): string {
  if (floor === 'G') {
    return locale === 'ms' ? `${buildingName}, Aras bawah` : `${buildingName}, Ground floor`;
  }
  if (floor === 'unknown') {
    return locale === 'ms' ? `${buildingName}, Tingkat belum pasti` : `${buildingName}, Floor uncertain`;
  }
  if (floor) {
    return locale === 'ms' ? `${buildingName}, Tingkat ${floor}` : `${buildingName}, Floor ${floor}`;
  }
  return buildingName;
}

export interface ReportSummaryFacts {
  buildingName: string;
  floor: string;
  specificLocation?: string;
  category: FacilityCategory;
  subIssueId?: string;
  extraText?: string;
  locale: 'ms' | 'en';
}

export function buildDeterministicSummary(facts: ReportSummaryFacts): string {
  const { buildingName, floor, specificLocation, category, subIssueId, extraText, locale } = facts;
  const loc = formatLocationText(buildingName, floor, locale);
  const specific = specificLocation && specificLocation.trim() ? ` (${specificLocation.trim()})` : '';

  const catLabel =
    category === 'water_supply'
      ? (locale === 'ms' ? 'Bekalan air' : 'Water supply')
      : category === 'lift'
      ? (locale === 'ms' ? 'Lif' : 'Elevator')
      : category === 'corridor_lighting'
      ? (locale === 'ms' ? 'Lampu koridor' : 'Corridor lighting')
      : (locale === 'ms' ? 'Lain-lain' : 'Other');

  if (category === 'other') {
    const mainText = extraText?.trim() || '';
    return `${catLabel} di ${loc}${specific}. ${mainText}`.trim();
  }

  const subLabel = subIssueId ? getSubIssueLabel(subIssueId, locale) : '';
  const detailText = subLabel ? ` · ${subLabel}` : '';
  let summary = `${catLabel}${detailText} di ${loc}${specific}.`;
  if (extraText?.trim()) {
    summary += ` ${extraText.trim()}`;
  }
  return summary.trim();
}

export interface GuidedSubmitPayload {
  buildingId: string;
  floor: string;
  category: FacilityCategory;
  subIssueId?: string;
  specificLocation?: string;
  extraText?: string;
  description: string;
  files: File[];
}
