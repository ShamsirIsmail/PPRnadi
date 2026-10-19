import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  evaluateReportPriorityAction,
  confirmPriorityDecisionAction,
  getPriorityDataAction,
} from '@/app/actions/priority';
import * as extractorModule from '@/lib/priority/extractor';
import { evaluatePriorityRules, POLICY_VERSION } from '@/lib/priority/rules';
import type { StructuredReportFacts } from '@/types/priority-explainer';

// UUID validation regex (v4 or standard 8-4-4-4-12 hex format)
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Mock database tables
interface MockReport {
  id: string;
  description: string;
  category: string;
  building_id: string;
  buildings: { id: string; name: string; code: string; estate_id: string };
  service_zones: { name: string; zone_code: string };
}

const mockReports = new Map<string, MockReport>();
const mockEvaluations = new Map<string, Record<string, unknown>>();
let mockDecisions: Array<Record<string, unknown>> = [];
const mockLinks = new Map<string, string>(); // report_id -> incident_id

let currentManager = {
  id: '00000000-0000-0000-0000-000000000001',
  role: 'management',
  full_name: 'Encik Razak (Pengurus Sentosa)',
  assigned_estate_id: 'estate-sentosa-123',
};

let dbReadError: { message: string } | null = null;
let dbInsertError: { message: string } | null = null;
let linkReadError: { message: string } | null = null;

// Mock session module
vi.mock('@/lib/auth/session', () => ({
  requireManager: vi.fn().mockImplementation(async () => {
    if (!currentManager || currentManager.role !== 'management') {
      throw new Error('UNAUTHORIZED: Sesi pengurus sah diperlukan.');
    }
    return {
      user: { id: currentManager.id },
      profile: { ...currentManager },
    };
  }),
}));

// Mock Supabase Server Client with realistic table queries
const createMockClient = () => ({
  from: vi.fn().mockImplementation((table: string) => {
        let currentEqValue: string | null = null;
        const eqFilters: Record<string, string> = {};

        const queryObj: Record<string, unknown> = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockImplementation((col: string, val: string) => {
            currentEqValue = val;
            eqFilters[col] = val;
            return queryObj;
          }),
          in: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockImplementation(async () => {
            if (dbReadError) {
              return { data: null, error: dbReadError };
            }

            if (table === 'incident_reports') {
              const repId = eqFilters['id'] || currentEqValue;
              const rep = repId ? mockReports.get(repId) : null;
              return { data: rep ? { ...rep } : null, error: null };
            }

            if (table === 'report_priority_evaluations') {
              const repId = eqFilters['report_id'];
              const fp = eqFilters['input_fingerprint'];
              const evalId = eqFilters['id'];

              if (evalId) {
                const found = mockEvaluations.get(evalId);
                return { data: found ? { ...found } : null, error: null };
              }

              if (repId) {
                for (const ev of mockEvaluations.values()) {
                  if (ev.report_id === repId && (!fp || ev.input_fingerprint === fp)) {
                    return { data: { ...ev }, error: null };
                  }
                }
              }
              return { data: null, error: null };
            }

            if (table === 'report_priority_decisions') {
              const repId = eqFilters['report_id'];
              const recent = mockDecisions
                .filter((d) => d.report_id === repId)
                .sort((a, b) => new Date(b.decided_at as string).getTime() - new Date(a.decided_at as string).getTime())[0];
              return { data: recent ? { ...recent } : null, error: null };
            }

            if (table === 'incident_report_links') {
              const repId = eqFilters['report_id'];
              const incId = repId ? mockLinks.get(repId) : null;
              return { data: incId ? { incident_id: incId } : null, error: null };
            }

            return { data: null, error: null };
          }),
          insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
            if (dbInsertError) {
              return {
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: null, error: dbInsertError }),
                }),
              };
            }

            if (table === 'report_priority_evaluations') {
              const id = typeof row.id === 'string' ? row.id : '';
              mockEvaluations.set(id, {
                ...row,
                created_at: new Date().toISOString(),
              });
              return {
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: { ...row, created_at: new Date().toISOString() },
                    error: null,
                  }),
                }),
              };
            }

            if (table === 'report_priority_decisions') {
              const saved = {
                ...row,
                decided_at: new Date().toISOString(),
              };
              mockDecisions.push(saved);
              return {
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: saved,
                    error: null,
                  }),
                }),
              };
            }

            return {
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: row, error: null }),
              }),
            };
          }),
        };

        // Handle array select for decision history
        queryObj.then = (resolve: (val: unknown) => void) => {
          if (table === 'incident_report_links' && linkReadError) {
            resolve({ data: null, error: linkReadError });
            return;
          }
          if (table === 'report_priority_decisions') {
            const repId = eqFilters['report_id'];
            const history = mockDecisions
              .filter((d) => !repId || d.report_id === repId)
              .map((d) => ({
                ...d,
                profiles: { full_name: currentManager.full_name },
              }));
            resolve({ data: history, error: null });
          } else {
            resolve({ data: [], error: null });
          }
        };

        return queryObj;
      }),
      rpc: vi.fn().mockImplementation(async (funcName: string, args: Record<string, unknown>) => {
        if (dbInsertError) {
          return { data: null, error: dbInsertError };
        }
        if (funcName === 'confirm_priority_decision_rpc') {
          const reportId = args.p_report_id as string;
          const evalId = args.p_evaluation_id as string | null;
          const priority = args.p_decided_priority as string;
          const evalRow = evalId ? mockEvaluations.get(evalId) : null;
          const isOverride = evalRow ? evalRow.recommended_priority !== priority : false;
          const reason = args.p_override_reason as string | null;
          const idempotencyKey = args.p_idempotency_key as string | null;
          const expectedVersion = args.p_expected_version as number | null;

          // Idempotency check
          if (idempotencyKey) {
            const existing = mockDecisions.find((d) => d.idempotency_key === idempotencyKey);
            if (existing) {
              return {
                data: {
                  success: true,
                  is_idempotent: true,
                  decision: {
                    ...existing,
                    decided_by_name: currentManager.full_name,
                  },
                },
                error: null,
              };
            }
          }

          // Expected version / optimistic concurrency check
          const currentVersion = mockDecisions.filter((d) => d.report_id === reportId).length;
          if (typeof expectedVersion === 'number' && expectedVersion !== currentVersion) {
            return {
              data: null,
              error: {
                message: `CONFLICT: Keputusan aduan ini telah dikemas kini oleh pengurus lain (versi semasa: ${currentVersion}, versi dijangka: ${expectedVersion}).`,
              },
            };
          }

          // Override validation
          if (isOverride && (!reason || reason.trim().length < 5)) {
            return {
              data: null,
              error: {
                message: 'VALIDATION: Sila nyatakan sebab / catatan apabila mengubah cadangan sistem (minimum 5 aksara).',
              },
            };
          }

          const newDecision = {
            id: '33333333-3333-3333-3333-333333333333',
            report_id: reportId,
            evaluation_id: evalId,
            decided_priority: priority,
            is_override: isOverride,
            override_reason: reason,
            decided_by: currentManager.id,
            decided_by_name: currentManager.full_name,
            decided_at: new Date().toISOString(),
            idempotency_key: idempotencyKey,
            decision_version: currentVersion + 1,
          };

          mockDecisions.push(newDecision);

          return {
            data: {
              success: true,
              is_idempotent: false,
              decision: newDecision,
            },
            error: null,
          };
        }
        return { data: null, error: null };
      }),
    });

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn().mockImplementation(async () => createMockClient()),
  createAdminSupabaseClient: vi.fn().mockImplementation(() => createMockClient()),
}));

describe('PPR NADI — Priority MVP: Real Reports, Verified Access and Durable Storage', () => {
  const validReportId1 = '11111111-1111-1111-1111-111111111111';
  const validReportId2 = '22222222-2222-2222-2222-222222222222';
  const otherEstateReportId = '99999999-9999-9999-9999-999999999999';

  beforeEach(() => {
    mockReports.clear();
    mockEvaluations.clear();
    mockDecisions = [];
    mockLinks.clear();
    dbReadError = null;
    linkReadError = null;
    dbInsertError = null;

    currentManager = {
      id: '00000000-0000-0000-0000-000000000001',
      role: 'management',
      full_name: 'Encik Razak (Pengurus Sentosa)',
      assigned_estate_id: 'estate-sentosa-123',
    };

    // Seed valid report 1 (Lift breakdown)
    mockReports.set(validReportId1, {
      id: validReportId1,
      description: 'Lif Blok A terhenti antara tingkat 4 dan 5. Ada dua orang terperangkap di dalam.',
      category: 'lift',
      building_id: 'building-sentosa-blok-a',
      buildings: {
        id: 'building-sentosa-blok-a',
        name: 'Blok A',
        code: 'A',
        estate_id: 'estate-sentosa-123',
      },
      service_zones: { name: 'Zon Rendah', zone_code: 'A-LOW' },
    });

    // Seed valid report 2 (Water supply disruption)
    mockReports.set(validReportId2, {
      id: validReportId2,
      description: 'Air paip tiada tekanan langsung di seluruh tingkat 7 sejak pagi tadi.',
      category: 'water_supply',
      building_id: 'building-sentosa-blok-a',
      buildings: {
        id: 'building-sentosa-blok-a',
        name: 'Blok A',
        code: 'A',
        estate_id: 'estate-sentosa-123',
      },
      service_zones: { name: 'Zon Tinggi', zone_code: 'A-HIGH' },
    });

    // Seed report from a DIFFERENT estate
    mockReports.set(otherEstateReportId, {
      id: otherEstateReportId,
      description: 'Lampu koridor padam di Blok X PPR Lain.',
      category: 'corridor_lighting',
      building_id: 'building-other-estate-blok-x',
      buildings: {
        id: 'building-other-estate-blok-x',
        name: 'Blok X',
        code: 'X',
        estate_id: 'estate-other-456',
      },
      service_zones: { name: 'Zon Utama', zone_code: 'X-ALL' },
    });
  });

  // TEST 1: Real Report path NEVER calls getApprovedDemoFixture
  it('1. Real report evaluation path NEVER calls getApprovedDemoFixture', async () => {
    const fixtureSpy = vi.spyOn(extractorModule, 'getApprovedDemoFixture');
    const extractSpy = vi.spyOn(extractorModule, 'extractReportFacts').mockResolvedValueOnce({
      success: true,
      facts: {
        issueType: 'Lif terhenti dengan orang terperangkap',
        safety: {
          hasHazard: true,
          hazardType: 'trapped_person',
          isNegated: false,
          isPastResolved: false,
          isUncertain: false,
          sourceQuote: 'Ada dua orang terperangkap di dalam.',
        },
        location: { mentionedBlock: 'Blok A', mentionedFloor: 4, specificLocation: 'Antara tingkat 4 dan 5' },
        scope: { scope: 'single_point', hasAlternatives: false },
        duration: { rawMention: null },
        factsList: [],
        unknowns: { ms: [], en: [] },
      },
      aiModel: 'mock-test-model',
      aiProvider: 'test-provider',
    });

    const res = await evaluateReportPriorityAction(validReportId1);

    expect(fixtureSpy).not.toHaveBeenCalled();
    expect(extractSpy).toHaveBeenCalledWith(
      'Lif Blok A terhenti antara tingkat 4 dan 5. Ada dua orang terperangkap di dalam.',
      'lift',
      1
    );
    expect(res.success).toBe(true);
    expect(res.isDemoCase).toBeUndefined();
    expect(res.evaluation?.aiProvider).toBe('test-provider');

    fixtureSpy.mockRestore();
    extractSpy.mockRestore();
  });

  // TEST 2: Two different descriptions in same category produce different fingerprints & distinct inputs
  it('2. Two distinct descriptions in the same category produce different fingerprints and inputs', async () => {
    const repA = 'Lif A sangkut di tingkat 2.';
    const repB = 'Lif B pintu tidak boleh buka di tingkat 8.';

    const fpA = extractorModule.computeInputFingerprint(repA, 'lift', 'Blok A');
    const fpB = extractorModule.computeInputFingerprint(repB, 'lift', 'Blok A');

    expect(fpA).not.toBe(fpB);
    expect(fpA).toHaveLength(64);
    expect(fpB).toHaveLength(64);
  });

  // TEST 3: DB read failure does NOT invent synthetic fallback complaint
  it('3. DB read failure cleanly reports error and does NOT invent synthetic fallback complaint', async () => {
    dbReadError = { message: 'Connection to database timed out' };

    const res = await evaluateReportPriorityAction(validReportId1);

    expect(res.success).toBe(false);
    expect(res.evaluation).toBeUndefined();
    expect(res.error).toContain('Gagal memuatkan rekod aduan daripada pangkalan data');
  });

  // TEST 4: Provider failure (timeout, 503, invalid response) returns clean error without fallback to fixture
  it('4. Provider failure returns clean error without falling back to mock fixtures', async () => {
    const extractSpy = vi.spyOn(extractorModule, 'extractReportFacts').mockResolvedValueOnce({
      success: false,
      error: 'Upstream AI provider returned 503 Service Unavailable',
      errorCode: 'UPSTREAM_ERROR',
    });

    const res = await evaluateReportPriorityAction(validReportId1);

    expect(res.success).toBe(false);
    expect(res.evaluation).toBeUndefined();
    expect(res.isDemoCase).toBeUndefined();
    expect(res.error).toContain('503 Service Unavailable');

    extractSpy.mockRestore();
  });

  // TEST 5: DB insert failure returns clean failure without claiming success
  it('5. DB insert failure returns clean failure and does NOT claim success', async () => {
    const extractSpy = vi.spyOn(extractorModule, 'extractReportFacts').mockResolvedValueOnce({
      success: true,
      facts: {
        issueType: 'Paip pecah',
        safety: { hasHazard: false, isNegated: false, isPastResolved: false, isUncertain: false },
        location: { mentionedBlock: 'Blok A', mentionedFloor: 7, specificLocation: null },
        scope: { scope: 'entire_floor', hasAlternatives: false },
        duration: { rawMention: 'sejak pagi tadi' },
        factsList: [],
        unknowns: { ms: [], en: [] },
      },
      aiModel: 'test-model',
      aiProvider: 'test-provider',
    });

    dbInsertError = { message: 'relation "report_priority_evaluations" does not exist' };

    const res = await evaluateReportPriorityAction(validReportId2);

    expect(res.success).toBe(false);
    expect(res.evaluation).toBeUndefined();
    expect(res.error).toContain('Gagal menyimpan penilaian');

    extractSpy.mockRestore();
  });

  // TEST 6: Valid UUID format generated for evaluations and decisions
  it('6. Generated evaluation and decision IDs strictly conform to valid UUID regex', async () => {
    const extractSpy = vi.spyOn(extractorModule, 'extractReportFacts').mockResolvedValueOnce({
      success: true,
      facts: {
        issueType: 'Lif rosak',
        safety: { hasHazard: true, hazardType: 'trapped_person', isNegated: false, isPastResolved: false, isUncertain: false },
        location: { mentionedBlock: 'Blok A', mentionedFloor: 4, specificLocation: null },
        scope: { scope: 'single_point', hasAlternatives: false },
        duration: { rawMention: null },
        factsList: [],
        unknowns: { ms: [], en: [] },
      },
      aiModel: 'test-model',
      aiProvider: 'test-provider',
    });

    // 1. Evaluate
    const evalRes = await evaluateReportPriorityAction(validReportId1);
    expect(evalRes.success).toBe(true);
    expect(evalRes.evaluation?.id).toMatch(UUID_REGEX);

    // 2. Decide
    const decRes = await confirmPriorityDecisionAction(
      validReportId1,
      'immediate_review',
      undefined,
      evalRes.evaluation?.id,
      'idem-uuid-test',
      0
    );
    expect(decRes.success).toBe(true);
    expect(decRes.decision?.id).toMatch(UUID_REGEX);
    expect(decRes.decision?.decidedById).toMatch(UUID_REGEX);

    extractSpy.mockRestore();
  });

  // TEST 7: Cross-estate access is strictly rejected on evaluate, confirm, and getPriorityData
  it('7. Manager from another estate is strictly rejected for evaluate, confirm, and getPriorityData', async () => {
    // Current manager is assigned to 'estate-sentosa-123'; otherEstateReportId belongs to 'estate-other-456'

    // A. Evaluate
    const evalRes = await evaluateReportPriorityAction(otherEstateReportId);
    expect(evalRes.success).toBe(false);
    expect(evalRes.error).toContain('FORBIDDEN');
    expect(evalRes.error).toContain('bukan di bawah kawasan perumahan');

    // B. Confirm
    const decRes = await confirmPriorityDecisionAction(
      otherEstateReportId,
      'standard_review',
      undefined,
      undefined,
      'idem-other-estate',
      0
    );
    expect(decRes.success).toBe(false);
    expect(decRes.error).toContain('FORBIDDEN');

    // C. Get Data
    const dataRes = await getPriorityDataAction(otherEstateReportId);
    expect(dataRes.success).toBe(false);
    expect(dataRes.error).toContain('FORBIDDEN');
  });

  // TEST 8: Unauthenticated or non-manager access rejected
  it('8. User without management role is strictly rejected', async () => {
    currentManager = {
      id: '00000000-0000-0000-0000-000000000099',
      role: 'resident', // Not management!
      full_name: 'Penduduk Biasa',
      assigned_estate_id: 'estate-sentosa-123',
    };

    const res = await evaluateReportPriorityAction(validReportId1);
    expect(res.success).toBe(false);
    expect(res.error).toContain('UNAUTHORIZED');
  });

  // TEST 9: evaluationId from a different report is rejected
  it('9. evaluationId belonging to a different report is rejected', async () => {
    const wrongEvalId = '77777777-7777-7777-7777-777777777777';
    mockEvaluations.set(wrongEvalId, {
      id: wrongEvalId,
      report_id: validReportId2, // Belongs to report 2, NOT report 1!
      input_fingerprint: 'some-fp',
      recommended_priority: 'high_priority',
    });

    const res = await confirmPriorityDecisionAction(
      validReportId1,
      'high_priority',
      undefined,
      wrongEvalId,
      'idem-wrong-eval',
      0
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain('FORBIDDEN');
    expect(res.error).toContain('bukan milik aduan ini');
  });

  // TEST 10: Override without reason is rejected server-side
  it('10. Manager override without a reason (or < 5 chars) is rejected server-side', async () => {
    const evalId = '88888888-8888-8888-8888-888888888888';
    const rep = mockReports.get(validReportId1)!;
    const fp = extractorModule.computeInputFingerprint(
      rep.description,
      rep.category,
      'Blok A Zon Rendah',
      undefined,
      POLICY_VERSION,
      extractorModule.EXTRACTION_VERSION
    );

    mockEvaluations.set(evalId, {
      id: evalId,
      report_id: validReportId1,
      input_fingerprint: fp,
      policy_version: POLICY_VERSION,
      recommended_priority: 'immediate_review',
    });

    // Attempting to override 'immediate_review' to 'standard_review' with empty reason
    const emptyReasonRes = await confirmPriorityDecisionAction(
      validReportId1,
      'standard_review',
      '',
      evalId,
      'idem-override-empty',
      0
    );
    expect(emptyReasonRes.success).toBe(false);
    expect(emptyReasonRes.error).toContain('Sila nyatakan sebab');

    // Attempting override with too short reason (< 5 chars)
    const shortReasonRes = await confirmPriorityDecisionAction(
      validReportId1,
      'standard_review',
      'test',
      evalId,
      'idem-override-short',
      0
    );
    expect(shortReasonRes.success).toBe(false);
    expect(shortReasonRes.error).toContain('minimum 5 aksara');

    // Valid override (>= 5 chars) succeeds
    const validRes = await confirmPriorityDecisionAction(
      validReportId1,
      'standard_review',
      'Pemeriksaan tapak mendapati lif telah dikosongkan dan pintu telah dikunci.',
      evalId,
      'idem-override-valid',
      0
    );
    expect(validRes.success).toBe(true);
    expect(validRes.decision?.isOverride).toBe(true);
    expect(validRes.decision?.overrideReason).toContain('Pemeriksaan tapak');
  });

  // TEST 11: Stale evaluation detected when report content has changed
  it('11. Flags evaluation as stale when complaint content changes', async () => {
    const evalId = '55555555-5555-5555-5555-555555555555';
    // Evaluation generated with old fingerprint
    mockEvaluations.set(evalId, {
      id: evalId,
      report_id: validReportId1,
      input_fingerprint: 'old-stale-fingerprint-12345',
      policy_version: POLICY_VERSION,
      recommended_priority: 'immediate_review',
    });

    const res = await confirmPriorityDecisionAction(
      validReportId1,
      'immediate_review',
      undefined,
      evalId,
      'idem-stale-test',
      0
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain('telah berubah sejak penilaian dijana');
    expect(res.error).toContain('Sila jana semula cadangan');
  });

  // TEST 12: Idempotent duplicate requests do not duplicate database rows
  it('12. Rapid duplicate clicks return the same recorded decision idempotently', async () => {
    const evalId = '44444444-4444-4444-4444-444444444444';
    const rep = mockReports.get(validReportId1)!;
    const fp = extractorModule.computeInputFingerprint(
      rep.description,
      rep.category,
      'Blok A Zon Rendah',
      undefined,
      POLICY_VERSION,
      extractorModule.EXTRACTION_VERSION
    );
    mockEvaluations.set(evalId, {
      id: evalId,
      report_id: validReportId1,
      input_fingerprint: fp,
      policy_version: POLICY_VERSION,
      recommended_priority: 'standard_review',
    });

    const idemKey = '00000000-0000-4000-8000-000000000012';
    const res1 = await confirmPriorityDecisionAction(
      validReportId1,
      'standard_review',
      'Pemeriksaan tapak selesai.',
      evalId,
      idemKey,
      0
    );
    expect(res1.success).toBe(true);
    const initialDecisionCount = mockDecisions.length;

    // Second click immediately after with same idempotency key
    const res2 = await confirmPriorityDecisionAction(
      validReportId1,
      'standard_review',
      'Pemeriksaan tapak selesai.',
      evalId,
      idemKey,
      0
    );
    expect(res2.success).toBe(true);
    expect(res2.decision?.id).toBe(res1.decision?.id);
    expect(mockDecisions.length).toBe(initialDecisionCount); // No duplicate row created
  });

  // TEST 13: Correlation between reports is NOT invented
  it('13. Unlinked reports are marked as unassessed correlation and do not bump priority', () => {
    const unassessedFacts: StructuredReportFacts = {
      issueType: 'Gangguan bekalan air',
      safety: { hasHazard: false, isNegated: false, isPastResolved: false, isUncertain: false },
      location: { mentionedBlock: 'Blok B', mentionedFloor: null, specificLocation: null },
      scope: { scope: 'entire_floor', hasAlternatives: false },
      duration: { rawMention: 'sejak pagi' },
      factsList: [
        {
          id: 'fact-report-count',
          category: 'scope',
          label: { ms: 'Hubungan antara aduan', en: 'Inter-report Correlation' },
          detail: {
            ms: 'Belum dinilai — tiada hubungan insiden disahkan dalam data.',
            en: 'Unassessed — no confirmed incident links in data.',
          },
          sourceText: 'Rekod sistem pengurusan',
          sourceQuote: null,
          status: 'unknown',
          sourceType: 'official_record',
          quoteVerified: true,
        },
      ],
      unknowns: { ms: [], en: [] },
      relatedReportsCount: 1, // Single unassessed report
    };

    const reportCountFact = unassessedFacts.factsList.find((f) => f.id === 'fact-report-count');
    expect(reportCountFact?.status).toBe('unknown');
    expect(reportCountFact?.detail.ms).toContain('Belum dinilai');

    // Rule evaluation on unassessed report activates I-01 (single report / unverified) and NOT I-02 (shared incident)
    const ruleRes = evaluatePriorityRules(unassessedFacts, 'water_supply');
    expect(ruleRes.ruleIds).toContain('I-01');
    expect(ruleRes.ruleIds).not.toContain('I-02');
  });

  // TEST 14: Difference between negations, temporal context, and uncertainty
  it('14. Rigorously tests safety differences: active vs negated vs past resolved vs uncertain', () => {
    // A: Active hazard
    const activeFacts: StructuredReportFacts = {
      issueType: 'Lif sangkut',
      safety: { hasHazard: true, hazardType: 'trapped_person', isNegated: false, isPastResolved: false, isUncertain: false },
      location: { mentionedBlock: 'Blok A', mentionedFloor: null, specificLocation: null },
      scope: { scope: 'single_point', hasAlternatives: false },
      duration: { rawMention: null },
      factsList: [],
      unknowns: { ms: [], en: [] },
    };
    const activeRes = evaluatePriorityRules(activeFacts, 'lift');
    expect(activeRes.recommendedPriority).toBe('immediate_review');
    expect(activeRes.ruleIds).toContain('S-01');
    expect(activeRes.needsMoreInfo).toBe(true); // Location floor missing

    // B: Explicit negation ("tiada orang terperangkap")
    const negatedFacts: StructuredReportFacts = {
      ...activeFacts,
      safety: { hasHazard: false, hazardType: null, isNegated: true, isPastResolved: false, isUncertain: false },
    };
    const negatedRes = evaluatePriorityRules(negatedFacts, 'lift');
    expect(negatedRes.recommendedPriority).not.toBe('immediate_review');
    expect(negatedRes.ruleIds).not.toContain('S-01');

    // C: Past resolved event ("semalam ada orang terperangkap, sekarang sudah keluar")
    const pastFacts: StructuredReportFacts = {
      ...activeFacts,
      safety: { hasHazard: false, hazardType: null, isNegated: false, isPastResolved: true, isUncertain: false },
    };
    const pastRes = evaluatePriorityRules(pastFacts, 'lift');
    expect(pastRes.recommendedPriority).not.toBe('immediate_review');
    expect(pastRes.ruleIds).not.toContain('S-01');

    // D: Uncertainty ("tidak pasti ada orang di dalam")
    const uncertainFacts: StructuredReportFacts = {
      ...activeFacts,
      safety: { hasHazard: true, hazardType: 'trapped_person', isNegated: false, isPastResolved: false, isUncertain: true },
    };
    const uncertainRes = evaluatePriorityRules(uncertainFacts, 'lift');
    // Safety takes precedence: remains immediate_review, uncertainty flagged via U-01
    expect(uncertainRes.recommendedPriority).toBe('immediate_review');
    expect(uncertainRes.needsMoreInfo).toBe(true);
    expect(uncertainRes.ruleIds).toContain('U-01');
  });

  it('does not mark priority data loaded when link context fails to refresh', async () => {
    linkReadError = { message: 'Link query unavailable' };
    const failed = await getPriorityDataAction(validReportId1);
    expect(failed.success).toBe(false);
    expect(failed.currentVersion).toBeUndefined();
    expect(failed.error).toContain('pautan');

    linkReadError = null;
    const recovered = await getPriorityDataAction(validReportId1);
    expect(recovered.success).toBe(true);
    expect(recovered.currentVersion).toBe(0);
  });

  // TEST 15: Durable database storage retrieval (not Map)
  it('15. getPriorityDataAction retrieves evaluation and decision history from database', async () => {
    // 1. Insert evaluation into mock DB table
    const evalId = '44444444-4444-4444-4444-444444444444';
    mockEvaluations.set(evalId, {
      id: evalId,
      report_id: validReportId1,
      input_fingerprint: 'fp-1234',
      policy_version: POLICY_VERSION,
      ai_model: 'db-persisted-model',
      ai_provider: 'db-persisted-provider',
      extracted_facts: { issueType: 'Ujian Persistensi' },
      rule_result: { recommendedPriority: 'immediate_review' },
      created_at: new Date().toISOString(),
    });

    // 2. Insert decision into mock DB table
    const decId = '33333333-3333-3333-3333-333333333333';
    mockDecisions.push({
      id: decId,
      report_id: validReportId1,
      evaluation_id: evalId,
      decided_priority: 'immediate_review',
      is_override: false,
      override_reason: null,
      decided_by: currentManager.id,
      decided_at: new Date().toISOString(),
    });

    // 3. Retrieve through getPriorityDataAction (simulating a fresh session)
    const dataRes = await getPriorityDataAction(validReportId1);

    expect(dataRes.success).toBe(true);
    expect(dataRes.evaluation?.id).toBe(evalId);
    expect(dataRes.evaluation?.aiProvider).toBe('db-persisted-provider');
    expect(dataRes.latestDecision?.id).toBe(decId);
    expect(dataRes.decisionHistory).toHaveLength(1);
    expect(dataRes.decisionHistory[0].decidedByName).toBe(currentManager.full_name);
  });
});
