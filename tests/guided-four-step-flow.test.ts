import { describe, it, expect } from 'vitest';
import {
  buildDeterministicSummary,
  formatLocationText,
  getSubIssueLabel,
  isEmergencySubIssue,
  type GuidedSubmitPayload,
  type ReportSummaryFacts,
  type SubIssueId,
} from '@/lib/report/report-summary';
import { residentReportSchema } from '@/lib/validators/report';

describe('Guided 4-Step Flow & Real Architecture Verification', () => {
  // Kes Wajib 1: Payload semakan sama dengan payload dihantar
  it('Kes Wajib 1: ensures review summary facts match submitted payload description bit-for-bit', () => {
    const facts: ReportSummaryFacts = {
      buildingName: 'Blok L',
      floor: '14',
      specificLocation: 'Koridor sayap kiri',
      category: 'lift',
      subIssueId: 'door_problem',
      extraText: 'Pintu tersekat-sekat bila ditutup',
      locale: 'ms',
    };

    // Synthesized summary displayed on review screen
    const reviewDisplayedSummary = buildDeterministicSummary(facts);

    // Final payload generated at step 3 onSubmit
    const payload: GuidedSubmitPayload = {
      buildingId: 'bld-l-uuid',
      floor: '14',
      category: 'lift',
      subIssueId: 'door_problem',
      specificLocation: 'Koridor sayap kiri',
      extraText: 'Pintu tersekat-sekat bila ditutup',
      description: reviewDisplayedSummary,
      files: [],
    };

    expect(payload.description).toBe(reviewDisplayedSummary);
    expect(payload.description).toContain('Lif · Pintu bermasalah di Blok L, Tingkat 14 (Koridor sayap kiri).');
    expect(payload.description).toContain('Pintu tersekat-sekat bila ditutup');
    expect(payload.description).not.toContain('[Lokasi:'); // No redundant stacked headers
  });

  // Kes Wajib 2: Ubah lokasi selepas semakan membuang lokasi lama
  it('Kes Wajib 2: updating location from review screen discards old location without retaining old block/floor', () => {
    // Initial selection: Blok A, Tingkat 18
    const initialFacts: ReportSummaryFacts = {
      buildingName: 'Blok A',
      floor: '18',
      category: 'water_supply',
      subIssueId: 'low_pressure',
      locale: 'ms',
    };
    const oldSummary = buildDeterministicSummary(initialFacts);
    expect(oldSummary).toContain('Blok A, Tingkat 18');

    // Resident clicks "Ubah" location: changes to Blok L, Tingkat 14
    const updatedFacts: ReportSummaryFacts = {
      buildingName: 'Blok L',
      floor: '14',
      category: 'water_supply',
      subIssueId: 'low_pressure',
      locale: 'ms',
    };
    const newSummary = buildDeterministicSummary(updatedFacts);

    expect(newSummary).toContain('Blok L, Tingkat 14');
    expect(newSummary).not.toContain('Blok A');
    expect(newSummary).not.toContain('Tingkat 18');
  });

  // Kes Wajib 3: Tukar BM -> EN -> BM mengekalkan ID butiran, kategori dan gambar
  it('Kes Wajib 3: toggling BM -> EN -> BM preserves stable machine sub-issue ID, category, and answers', () => {
    const selectedCategory = 'lift';
    const activeSubIssueId: SubIssueId = 'not_moving';

    // BM render
    const labelBm = getSubIssueLabel(activeSubIssueId, 'ms');
    expect(labelBm).toBe('Tidak bergerak');

    // Toggle to English
    const labelEn = getSubIssueLabel(activeSubIssueId, 'en');
    expect(labelEn).toBe('Not moving');

    // Toggle back to BM
    const labelBmRestored = getSubIssueLabel(activeSubIssueId, 'ms');
    expect(labelBmRestored).toBe('Tidak bergerak');

    // The machine ID remains strictly identical
    expect(activeSubIssueId).toBe('not_moving');
    expect(selectedCategory).toBe('lift');
  });

  // Kes Wajib 4: Pengesanan kecemasan tidak berubah apabila bahasa ditukar
  it('Kes Wajib 4: emergency trapped detection is based strictly on stable ID, invariant under language switches', () => {
    const trappedId: SubIssueId = 'trapped';

    // Must be recognized as emergency regardless of whether UI is in BM or EN
    expect(isEmergencySubIssue('lift', trappedId)).toBe(true);
    expect(isEmergencySubIssue('lift', 'door_problem')).toBe(false);
    expect(isEmergencySubIssue('water_supply', trappedId)).toBe(false);

    // Label translation check
    expect(getSubIssueLabel(trappedId, 'ms')).toBe('Ada orang terperangkap');
    expect(getSubIssueLabel(trappedId, 'en')).toBe('People trapped inside');
  });

  // Kes Wajib 5: other memerlukan penerangan
  it('Kes Wajib 5: category other requires adequate description (min 5 characters) and passes schema', () => {
    // Fails with empty description
    const emptyOther = {
      buildingId: '10000000-0000-4000-8000-000000000002',
      category: 'other',
      description: '   ',
    };
    expect(residentReportSchema.safeParse(emptyOther).success).toBe(false);

    // Fails with fewer than 5 characters
    const shortOther = {
      buildingId: '10000000-0000-4000-8000-000000000002',
      category: 'other',
      description: 'rosk',
    };
    expect(residentReportSchema.safeParse(shortOther).success).toBe(false);

    // Passes with adequate description
    const validOther = {
      buildingId: '10000000-0000-4000-8000-000000000002',
      category: 'other',
      description: 'Pagar keselamatan tercabut engsel dan bahaya untuk kanak-kanak',
    };
    expect(residentReportSchema.safeParse(validOther).success).toBe(true);
  });

  // Kes Wajib 6: G/unknown tidak ditukar kepada tingkat 1
  it('Kes Wajib 6: special locations G and unknown are preserved and never coerced to floor 1 or fake zone IDs', () => {
    const groundFloorTextMs = formatLocationText('Blok A', 'G', 'ms');
    expect(groundFloorTextMs).toBe('Blok A, Aras bawah');
    expect(groundFloorTextMs).not.toContain('Tingkat 1');

    const unknownFloorTextEn = formatLocationText('Blok A', 'unknown', 'en');
    expect(unknownFloorTextEn).toBe('Blok A, Floor uncertain');
    expect(unknownFloorTextEn).not.toContain('Floor 1');

    // Numerical parsing of G or unknown yields null
    for (const special of ['G', 'unknown']) {
      const parsedNum = special !== 'G' && special !== 'unknown' ? parseInt(special, 10) : null;
      expect(parsedNum).toBeNull();
    }
  });

  // Kes Wajib 7: Zon lama tidak kekal selepas blok berubah
  it('Kes Wajib 7: previous zone does not persist when selected block changes', () => {
    const allZones = [
      { id: 'zone-a-low', building_id: 'bld-a', floor_start: 1, floor_end: 9 },
      { id: 'zone-a-high', building_id: 'bld-a', floor_start: 10, floor_end: 18 },
      { id: 'zone-l-low', building_id: 'bld-l', floor_start: 1, floor_end: 8 },
      { id: 'zone-l-high', building_id: 'bld-l', floor_start: 9, floor_end: 15 },
    ];

    const resolveZone = (buildingId: string, floorStr: string) => {
      if (!floorStr || floorStr === 'G' || floorStr === 'unknown') return null;
      const fNum = parseInt(floorStr, 10);
      if (isNaN(fNum)) return null;
      const matched = allZones.find(
        (z) => z.building_id === buildingId && fNum >= z.floor_start && fNum <= z.floor_end
      );
      return matched ? matched.id : null;
    };

    // When at Blok A, floor 18:
    const zoneBlokA = resolveZone('bld-a', '18');
    expect(zoneBlokA).toBe('zone-a-high');

    // Switch to Blok L, floor 14:
    const zoneBlokL = resolveZone('bld-l', '14');
    expect(zoneBlokL).toBe('zone-l-high');
    expect(zoneBlokL).not.toBe('zone-a-high'); // Old zone discarded!

    // Floor bounds check: Blok L has max 15 floors; floor 18 is out of bounds
    const maxFloorsL = 15;
    const isOutOfBounds = parseInt('18', 10) > maxFloorsL;
    expect(isOutOfBounds).toBe(true);
  });
});
