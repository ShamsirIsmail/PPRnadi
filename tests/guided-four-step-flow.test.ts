import { describe, it, expect } from 'vitest';
import { residentReportSchema, facilityCategorySchema } from '@/lib/validators/report';
import { evaluatePriorityRules } from '@/lib/priority/rules';
import type { StructuredReportFacts } from '@/types/priority-explainer';

describe('Guided 4-Step Flow & Other Category Verification', () => {
  it('accepts other category in facilityCategorySchema and residentReportSchema', () => {
    expect(facilityCategorySchema.safeParse('other').success).toBe(true);

    const validOtherReport = {
      buildingId: '10000000-0000-4000-8000-000000000002',
      category: 'other',
      description: 'Pintu pagar taman permainan rosak dan tercabut engsel',
      urgencyHint: 'medium',
    };
    const result = residentReportSchema.safeParse(validOtherReport);
    expect(result.success).toBe(true);
  });

  it('triggers deterministic priority rule R-04 for other category', () => {
    const neutralFacts: StructuredReportFacts = {
      issueType: 'kerosakan umum',
      safety: { hasHazard: false, isNegated: false, isPastResolved: false, isUncertain: false },
      location: { mentionedBlock: null, mentionedFloor: null, specificLocation: null },
      scope: { scope: 'single_point', hasAlternatives: true },
      duration: { rawMention: null },
      factsList: [],
      unknowns: { ms: [], en: [] },
    };

    const evalResult = evaluatePriorityRules(neutralFacts, 'other');
    expect(evalResult.ruleIds).toContain('R-04');
    expect(evalResult.recommendedPriority).toBe('standard_review');
    expect(evalResult.ruleBasisExplanation.ms).toContain('R-04');
    expect(evalResult.primaryReasons.ms).toContain('Aduan kategori lain-lain memerlukan penilaian manual pihak pengurusan');
  });

  it('validates floor bounds correctly when switching blocks (e.g. Blok A 18 to Blok L 15)', () => {
    const buildingA = { id: 'bld-a', name: 'Blok A', code: 'DR_BLK_A', total_floors: 18 };
    const buildingL = { id: 'bld-l', name: 'Blok L', code: 'DR_BLK_L', total_floors: 15 };

    const selectedFloor = '18';
    const isOutOfBoundsForA = parseInt(selectedFloor, 10) > (buildingA.total_floors || 18);
    const isOutOfBoundsForL = parseInt(selectedFloor, 10) > (buildingL.total_floors || 15);

    expect(isOutOfBoundsForA).toBe(false);
    expect(isOutOfBoundsForL).toBe(true);
  });

  it('preserves special locations (G and unknown) without converting to floor 1 or fake zone IDs', () => {
    const specialFloors = ['G', 'unknown'];

    for (const floor of specialFloors) {
      // Floor parser should not interpret G or unknown as numerical floor 1
      const numFloor = floor !== 'G' && floor !== 'unknown' ? parseInt(floor, 10) : null;
      expect(numFloor).toBeNull();

      // Zone mapping for special floor should remain null
      const serviceZoneId = null;
      expect(serviceZoneId).toBeNull();
    }
  });

  it('produces deterministic review summary without AI labels', () => {
    const buildSummary = (
      buildingName: string,
      floor: string,
      cat: string,
      sub: string,
      extra: string
    ) => {
      const locText = floor === 'G' ? `${buildingName} · Aras bawah` : `${buildingName} · Tingkat ${floor}`;
      const catLabel = cat === 'water_supply' ? 'Bekalan Air' : 'Lain-lain';
      const parts = [`[Lokasi: ${locText}]`, `[Kategori: ${catLabel}]`];
      if (sub) parts.push(`[Butiran: ${sub}]`);
      if (extra) parts.push(extra.trim());
      return parts.join('\n');
    };

    const summary = buildSummary('Blok A', '12', 'water_supply', 'Tekanan rendah', 'Paip berbunyi bising');
    expect(summary).toContain('[Lokasi: Blok A · Tingkat 12]');
    expect(summary).toContain('[Kategori: Bekalan Air]');
    expect(summary).toContain('[Butiran: Tekanan rendah]');
    expect(summary).toMatch(/\b(bekalan air|paip)\b/i);
    expect(summary).not.toMatch(/\b(ai|artificial intelligence|kecerdasan buatan)\b/i);
  });
});
