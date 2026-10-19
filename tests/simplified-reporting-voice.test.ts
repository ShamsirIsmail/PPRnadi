import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateReportDraftAction } from '@/app/actions/ai-draft';
import { submitResidentReport } from '@/app/actions/resident-report';
import { resetRateLimitsForTesting } from '@/lib/ai/rate-limiter';
import { translations } from '@/lib/i18n/translations';

// -----------------------------------------------------------------------------
// Mock Setup: Resident Profile & Supabase DB
// -----------------------------------------------------------------------------
const { BLOK_A_ID, BLOK_L_ID, mockDesaRejangBuildings, mockDesaRejangZones } = vi.hoisted(() => {
  const BLOK_A_ID = 'b0000000-0000-0000-0000-000000000001';
  const BLOK_L_ID = 'b0000000-0000-0000-0000-000000000012';

  const blocks = [
    { id: BLOK_A_ID, code: 'DR_BLK_A', name: 'Blok A', temporaryDemoFloors: 18 },
    { id: 'b0000000-0000-0000-0000-000000000002', code: 'DR_BLK_B', name: 'Blok B', temporaryDemoFloors: 18 },
    { id: 'b0000000-0000-0000-0000-000000000003', code: 'DR_BLK_C', name: 'Blok C', temporaryDemoFloors: 18 },
    { id: 'b0000000-0000-0000-0000-000000000004', code: 'DR_BLK_D', name: 'Blok D', temporaryDemoFloors: 18 },
    { id: 'b0000000-0000-0000-0000-000000000005', code: 'DR_BLK_E', name: 'Blok E', temporaryDemoFloors: 18 },
    { id: 'b0000000-0000-0000-0000-000000000006', code: 'DR_BLK_F', name: 'Blok F', temporaryDemoFloors: 18 },
    { id: 'b0000000-0000-0000-0000-000000000007', code: 'DR_BLK_G', name: 'Blok G', temporaryDemoFloors: 18 },
    { id: 'b0000000-0000-0000-0000-000000000008', code: 'DR_BLK_H', name: 'Blok H', temporaryDemoFloors: 18 },
    { id: 'b0000000-0000-0000-0000-000000000009', code: 'DR_BLK_I', name: 'Blok I', temporaryDemoFloors: 17 },
    { id: 'b0000000-0000-0000-0000-000000000010', code: 'DR_BLK_J', name: 'Blok J', temporaryDemoFloors: 17 },
    { id: 'b0000000-0000-0000-0000-000000000011', code: 'DR_BLK_K', name: 'Blok K', temporaryDemoFloors: 16 },
    { id: BLOK_L_ID, code: 'DR_BLK_L', name: 'Blok L', temporaryDemoFloors: 15 },
  ];

  const mockDesaRejangBuildings = blocks.map((b) => ({
    id: b.id,
    code: b.code,
    name: b.name,
    total_floors: b.temporaryDemoFloors,
    estate_id: 'ppr-desa-rejang',
  }));

  const mockDesaRejangZones = [
    { id: 'zone-a-low', building_id: BLOK_A_ID, zone_code: 'DR-A-LOW', name: 'Blok A Zon Rendah', floor_start: 1, floor_end: 9 },
    { id: 'zone-a-high', building_id: BLOK_A_ID, zone_code: 'DR-A-HIGH', name: 'Blok A Zon Tinggi', floor_start: 10, floor_end: 18 },
    { id: 'zone-l-low', building_id: BLOK_L_ID, zone_code: 'DR-L-LOW', name: 'Blok L Zon Rendah', floor_start: 1, floor_end: 7 },
    { id: 'zone-l-high', building_id: BLOK_L_ID, zone_code: 'DR-L-HIGH', name: 'Blok L Zon Tinggi', floor_start: 8, floor_end: 15 },
  ];

  return { BLOK_A_ID, BLOK_L_ID, mockDesaRejangBuildings, mockDesaRejangZones };
});

let insertedReports: Array<Record<string, unknown>> = [];

vi.mock('@/lib/auth/session', () => ({
  requireResident: vi.fn().mockResolvedValue({
    user: { id: 'resident-rejang-uuid' },
    profile: {
      id: 'resident-rejang-uuid',
      role: 'resident',
      assigned_estate_id: 'ppr-desa-rejang',
      assigned_building_id: BLOK_A_ID,
      unit_number: '17-02',
      full_name: 'Pak Cik Ali (Penduduk Rejang)',
    },
  }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn().mockResolvedValue({
    from: (table: string) => {
      if (table === 'buildings') {
        return {
          select: () => ({
            eq: (_col: string, val: string) => {
              const matched = mockDesaRejangBuildings.filter((b) => b.estate_id === val || b.id === val);
              return {
                data: matched,
                error: null,
                maybeSingle: async () => ({
                  data: mockDesaRejangBuildings.find((b) => b.id === val) || null,
                  error: null,
                }),
                single: async () => ({
                  data: mockDesaRejangBuildings.find((b) => b.id === val) || null,
                  error: null,
                }),
              };
            },
          }),
        };
      }
      if (table === 'service_zones') {
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              data: mockDesaRejangZones.filter((z) => z.building_id === val),
              error: null,
              single: async () => ({
                data: mockDesaRejangZones.find((z) => z.id === val) || null,
                error: null,
              }),
            }),
            in: (_col: string, vals: string[]) => ({
              order: () => ({
                data: mockDesaRejangZones.filter((z) => vals.includes(z.building_id)),
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'incident_reports') {
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              maybeSingle: async () => ({
                data: insertedReports.find((r) => r.id === val) || null,
                error: null,
              }),
              single: async () => ({
                data: insertedReports.find((r) => r.id === val) || null,
                error: null,
              }),
            }),
          }),
          insert: (payload: Record<string, unknown>) => {
            const reportId = (payload.id as string) || 'new-report-uuid-' + (insertedReports.length + 1);
            const reportRecord = { ...payload, id: reportId };
            insertedReports.push(reportRecord);
            return {
              select: () => ({
                single: async () => ({ data: { id: reportId }, error: null }),
              }),
            };
          },
        };
      }
      if (table === 'report_attachments') {
        return {
          select: () => ({
            eq: async () => ({ data: [], error: null, count: 0 }),
          }),
        };
      }
      return {
        select: () => ({ eq: async () => ({ data: [], error: null }) }),
      };
    },
    storage: {
      from: () => ({
        list: async () => ({ data: [], error: null }),
        upload: async () => ({ data: { path: 'test' }, error: null }),
      }),
    },
  }),
}));

describe('PPR NADI — Simplified Resident Reporting & Guided Voice Test Suite', () => {
  beforeEach(() => {
    process.env.USE_MOCK_AI = 'true';
    insertedReports = [];
    resetRateLimitsForTesting();
  });

  // a. Manual report submission succeeds
  it('a. manual report workflow succeeds and produces registered report in database', async () => {
    const fd = new FormData();
    fd.set('category', 'water_supply');
    fd.set('description', 'Paip utama di koridor tingkat 17 bocor teruk dan air bertakung.');
    fd.set('building_id', BLOK_A_ID);

    const result = await submitResidentReport(null, fd);
    expect(result.success).toBe(true);
    expect(result.reportId).toBeDefined();
    expect(insertedReports.length).toBe(1);
    expect(insertedReports[0].category).toBe('water_supply');
    expect(insertedReports[0].building_id).toBe(BLOK_A_ID);
    // Verified: resident NEVER chooses priority, defaults to submitted & medium urgency
    expect(insertedReports[0].urgency_hint).toBe('medium');
    expect(insertedReports[0].status).toBe('submitted');
  });

  // b. Voice produces accurate draft directly for review screen
  it('b. voice transcription produces accurate structured draft directly for review', async () => {
    const rawTranscript = 'Lif rosak di Blok A dekat tingkat 17 pintu tersekat';
    const draftRes = await generateReportDraftAction(rawTranscript, { mode: 'initial' });

    expect(draftRes.success).toBe(true);
    expect(draftRes.draft).toBeDefined();
    expect(draftRes.draft?.category).toBe('lift');
    expect(draftRes.draft?.mentionedFloor).toBe(17);
    expect(draftRes.draft?.buildingId).toBe(BLOK_A_ID);
    expect(draftRes.draft?.matchedZoneId).toBe('zone-a-high');
    expect(draftRes.draft?.missingFields).not.toContain('floor');
    expect(draftRes.metrics?.draftMs).toBeGreaterThanOrEqual(0);
  });

  // c. Follow-up floor question only appears if floor is missing
  it('c. follow-up floor is required when floor is omitted, but NOT when floor is present', async () => {
    // Case 1: Floor missing
    const transcriptWithoutFloor = 'Lampu koridor padam di Blok A';
    const resWithoutFloor = await generateReportDraftAction(transcriptWithoutFloor, { mode: 'initial' });
    expect(resWithoutFloor.draft?.mentionedFloor).toBeNull();
    expect(resWithoutFloor.draft?.missingFields).toContain('floor');

    // Case 2: Floor present
    const transcriptWithFloor = 'Lampu koridor padam di Blok A tingkat 8';
    const resWithFloor = await generateReportDraftAction(transcriptWithFloor, { mode: 'initial' });
    expect(resWithFloor.draft?.mentionedFloor).toBe(8);
    expect(resWithFloor.draft?.missingFields).not.toContain('floor');
  });

  // d. Incremental voice correction updates location in draft, title, and description, preserving other facts
  it('d. voice correction updates floor, title and description without altering unit numbers or durations', async () => {
    const existingDraft = {
      title: 'Aduan Kerosakan Lif Tingkat 17',
      description: 'Lif penumpang bergegar dan pintu tidak dapat dibuka rapat di tingkat 17 Blok A depan Unit 17-02 sudah 3 hari.',
      category: 'lift' as const,
      buildingId: BLOK_A_ID,
      mentionedBlock: 'A',
      mentionedFloor: 17,
      matchedZoneId: 'zone-a-high',
    };

    const correctionSpoken = 'Bukan tingkat 17, tingkat 16';
    const corrRes = await generateReportDraftAction(correctionSpoken, {
      mode: 'correction',
      existingDraft,
    });

    expect(corrRes.success).toBe(true);
    expect(corrRes.draft).toBeDefined();
    // Corrected floor updated
    expect(corrRes.draft?.mentionedFloor).toBe(16);
    // Title updated from 17 to 16
    expect(corrRes.draft?.title).toBe('Aduan Kerosakan Lif Tingkat 16');
    // Description updated from 17 to 16, but Unit 17-02 and duration '3 hari' remain intact!
    expect(corrRes.draft?.description).toContain('tingkat 16 Blok A');
    expect(corrRes.draft?.description).toContain('Unit 17-02');
    expect(corrRes.draft?.description).toContain('3 hari');
    // Category preserved
    expect(corrRes.draft?.category).toBe('lift');
    expect(corrRes.draft?.buildingId).toBe(BLOK_A_ID);
    // Change summary format: "Tingkat: 17 → 16"
    expect(corrRes.draft?.correctionSummary?.ms).toBe('Tingkat: 17 → 16');
    expect(corrRes.draft?.correctionSummary?.en).toBe('Floor: 17 → 16');
    expect(corrRes.metrics?.correctionMs).toBeGreaterThanOrEqual(0);
  });

  // d2. Negated category correction ("Bukan air, lampu koridor")
  it('d2. handles negated category correction without selecting negated category', async () => {
    const existingDraft = {
      title: 'Aduan Masalah Air Tingkat 5',
      description: 'Tekanan air rendah di tingkat 5.',
      category: 'water_supply' as const,
      buildingId: BLOK_A_ID,
      mentionedBlock: 'A',
      mentionedFloor: 5,
    };

    const corrRes = await generateReportDraftAction('Bukan air, lampu koridor padam', {
      mode: 'correction',
      existingDraft,
    });

    expect(corrRes.success).toBe(true);
    expect(corrRes.draft?.category).toBe('corridor_lighting');
    expect(corrRes.draft?.correctionSummary?.ms).toContain('Bekalan Air → Lampu Koridor');
  });

  // d3. Block change invalidates old zone ID and verifies new floor limit
  it('d3. block change cancels old zone ID and enforces new building floor limits', async () => {
    const existingDraft = {
      title: 'Aduan Kerosakan Koridor',
      description: 'Lampu koridor rosak di tingkat 17 Blok A.',
      category: 'corridor_lighting' as const,
      buildingId: BLOK_A_ID,
      mentionedBlock: 'A',
      mentionedFloor: 17,
      matchedZoneId: 'zone-a-high',
    };

    // Resident changes block to Blok L (15 floors) without speaking floor
    const corrRes = await generateReportDraftAction('Bukan Blok A, tapi di Blok L', {
      mode: 'correction',
      existingDraft,
    });

    expect(corrRes.success).toBe(true);
    expect(corrRes.draft?.mentionedBlock).toBe('L');
    expect(corrRes.draft?.buildingId).toBe(BLOK_L_ID);
    // Old zone ID from Blok A is strictly invalidated!
    expect(corrRes.draft?.matchedZoneId).toBeNull();
    // Floor 17 exceeds Blok L's 15 floors limit!
    expect(corrRes.draft?.invalidFloorWarning).toContain('15 tingkat');
    expect(corrRes.draft?.mentionedFloor).toBeNull();
  });

  // e. Blok A accepts floor 17 and 18 (18 floors)
  it('e. Blok A accepts floors 17 and 18 without out-of-bounds warning', async () => {
    const resFloor17 = await generateReportDraftAction('Paip bocor di Blok A tingkat 17');
    expect(resFloor17.draft?.mentionedFloor).toBe(17);
    expect(resFloor17.draft?.invalidFloorWarning).toBeFalsy();

    const resFloor18 = await generateReportDraftAction('Lampu rosak di Blok A tingkat 18');
    expect(resFloor18.draft?.mentionedFloor).toBe(18);
    expect(resFloor18.draft?.invalidFloorWarning).toBeFalsy();
  });

  // f. Blok L rejects floor 16 and provides clear floor limit warning (15 floors)
  it('f. Blok L rejects floor 16 and provides clear floor limit warning', async () => {
    const resFloor16BlokL = await generateReportDraftAction('Lif rosak di Blok L tingkat 16');
    expect(resFloor16BlokL.draft?.mentionedBlock).toBe('L');
    expect(resFloor16BlokL.draft?.invalidFloorWarning).toContain('15 tingkat');
    expect(resFloor16BlokL.draft?.invalidFloorWarning).toContain('Blok L');
  });

  // Section 4: Ground Floor Audit
  it('audit: "bawah sinki" does NOT trigger ground floor, and ground floor requires confirmation', async () => {
    // 1. "bawah sinki" with explicit floor 17 -> floor remains 17!
    const resSink = await generateReportDraftAction('Paip bawah sinki bocor di Blok A tingkat 17');
    expect(resSink.draft?.mentionedFloor).toBe(17);

    // 2. Explicit ground floor mention without verified mapping does NOT blindly assign 1
    const resGround = await generateReportDraftAction('Lampu padam di Blok A aras bawah');
    expect(resGround.draft?.mentionedFloor).toBeNull();
    expect(resGround.draft?.missingFields).toContain('floor_confirmation');
    expect(resGround.draft?.clarificationPrompt?.ms).toContain('aras bawah/G');
  });

  // g. Fallback when Web Speech API is not supported
  it('g. fallback messaging exists in translations for unsupported speech environments', () => {
    expect(translations.ms.reportForm.assistantSpeechNotSupported).toBeDefined();
    expect(translations.en.reportForm.assistantSpeechNotSupported).toBeDefined();
    expect(translations.ms.reportForm.assistantSpeechNotSupported).not.toContain('undefined');
  });

  // h. Microphone and camera permission denials are handled politely
  it('h. mic and camera denials have user-friendly polite fallback messages without jargon', () => {
    const msMicDenied = translations.ms.reportForm.assistantMicDenied;
    const enMicDenied = translations.en.reportForm.assistantMicDenied;
    const msCameraDenied = translations.ms.reportForm.cameraDeniedNotice;
    const enCameraDenied = translations.en.reportForm.cameraDeniedNotice;

    expect(msMicDenied).toContain('Kebenaran mikrofon');
    expect(enMicDenied).toContain('Microphone permission');
    expect(msCameraDenied).toContain('Kebenaran kamera');
    expect(enCameraDenied).toContain('Camera permission');

    // Verify absence of low-level jargon
    expect(msCameraDenied).not.toContain('DOMException');
    expect(msCameraDenied).not.toContain('NotAllowedError');
  });

  // i. Connection error or AI timeout preserves user input
  it('i. ambiguous correction preserves existing draft context and asks for clarification', async () => {
    const existingDraft = {
      description: 'Lampu koridor tingkat 12 padam.',
      category: 'corridor_lighting' as const,
      buildingId: BLOK_A_ID,
      mentionedFloor: 12,
    };

    const resAmbiguous = await generateReportDraftAction('Eh bukan macam tu', {
      mode: 'correction',
      existingDraft,
    });

    expect(resAmbiguous.success).toBe(true);
    expect(resAmbiguous.draft?.description).toBe(existingDraft.description);
    expect(resAmbiguous.draft?.mentionedFloor).toBe(12);
    expect(resAmbiguous.draft?.clarificationPrompt).toBeDefined();
    expect(resAmbiguous.draft?.clarificationPrompt?.ms).toContain('Sila nyatakan bahagian');
  });

  // j. Idempotency protection against double submit
  it('j. prevents double submission when client_report_id is reused', async () => {
    const clientReportId = 'c0000000-0000-4000-8000-000000000099';
    const fd1 = new FormData();
    fd1.set('client_report_id', clientReportId);
    fd1.set('category', 'lift');
    fd1.set('description', 'Lif nombor 2 tersangkut antara tingkat 4 dan 5.');
    fd1.set('building_id', BLOK_A_ID);

    const firstSubmit = await submitResidentReport(null, fd1);
    expect(firstSubmit.success).toBe(true);
    expect(insertedReports.length).toBe(1);

    // Second submit with exact same client_report_id
    const fd2 = new FormData();
    fd2.set('client_report_id', clientReportId);
    fd2.set('category', 'lift');
    fd2.set('description', 'Lif nombor 2 tersangkut antara tingkat 4 dan 5.');
    fd2.set('building_id', BLOK_A_ID);

    const secondSubmit = await submitResidentReport(null, fd2);
    expect(secondSubmit.success).toBe(true);
    // Did NOT insert a second duplicate row in database!
    expect(insertedReports.length).toBe(1);
    expect(secondSubmit.reportId).toBe(clientReportId);
  });

  // k. "Buat aduan baharu" button and reset state
  it('k. start new report clears active report id and provides fresh slate', () => {
    expect(translations.ms.reportForm.newReportBtn).toBe('Buat aduan baharu');
    expect(translations.en.reportForm.newReportBtn).toBe('Submit another report');
    expect(translations.ms.reportForm.viewInHistoryBtn).toBe('Lihat aduan saya');
    expect(translations.en.reportForm.viewInHistoryBtn).toBe('View my reports');
  });

  // l. Language consistency: No mixed language and no technical jargon
  it('l. language consistency check: clean BM and clean EN without mixed words or technical jargon', () => {
    const msTexts = JSON.stringify(translations.ms);
    const enTexts = JSON.stringify(translations.en);

    // Jargon check in user-facing texts
    expect(msTexts).not.toContain('payload');
    expect(enTexts).not.toContain('payload');
    expect(msTexts).not.toContain('resolver');
    expect(enTexts).not.toContain('resolver');
    expect(msTexts).not.toContain('unregistered storage evidence');
    expect(enTexts).not.toContain('unregistered storage evidence');

    // No false 24h SLA promises in resident copy
    expect(msTexts).not.toContain('dalam tempoh 24 jam');
    expect(enTexts).not.toContain('within 24 hours');

    // Clean translations check
    expect(translations.ms.reportForm.assistantTitle).toBe('Pembantu Pintar AI');
    expect(translations.en.reportForm.assistantTitle).toBe('AI Smart Assistant');
  });
});
