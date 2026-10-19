'use server';

import crypto from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { requireManager } from '@/lib/auth/session';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import {
  evaluatePriorityRules,
  POLICY_VERSION,
} from '@/lib/priority/rules';
import {
  extractReportFacts,
  computeInputFingerprint,
  getApprovedDemoFixture,
  EXTRACTION_VERSION,
} from '@/lib/priority/extractor';
import type {
  ManagerDecisionTier,
  PriorityEvaluationRecord,
  PriorityDecisionRecord,
  PriorityDataResponse,
} from '@/types/priority-explainer';
import type { FacilityCategory } from '@/types/database';

function safeRevalidatePath(path: string) {
  try {
    revalidatePath(path);
  } catch {
    // Invariant: static generation store missing outside active Next request context
  }
}

function mapDbEvalToRecord(dbEval: {
  id: string;
  report_id: string;
  input_fingerprint: string;
  policy_version: string;
  ai_model: string;
  ai_provider: string;
  extracted_facts: unknown;
  rule_result: unknown;
  created_at: string;
}): PriorityEvaluationRecord {
  return {
    id: dbEval.id,
    reportId: dbEval.report_id,
    inputFingerprint: dbEval.input_fingerprint,
    policyVersion: dbEval.policy_version,
    aiModel: dbEval.ai_model,
    aiProvider: dbEval.ai_provider,
    extractedFacts: dbEval.extracted_facts as PriorityEvaluationRecord['extractedFacts'],
    ruleResult: dbEval.rule_result as PriorityEvaluationRecord['ruleResult'],
    createdAt: dbEval.created_at,
  };
}

function mapDbDecisionToRecord(
  row: {
    id: string;
    report_id: string;
    evaluation_id: string | null;
    decided_priority: string;
    is_override: boolean;
    override_reason: string | null;
    decided_by: string;
    decided_at: string;
    idempotency_key?: string | null;
    decision_version?: number;
  },
  managerName?: string
): PriorityDecisionRecord {
  return {
    id: row.id,
    reportId: row.report_id,
    evaluationId: row.evaluation_id,
    decidedPriority: row.decided_priority as ManagerDecisionTier,
    isOverride: row.is_override,
    overrideReason: row.override_reason,
    decidedById: row.decided_by,
    decidedByName: managerName || 'Pengurus PPR',
    idempotencyKey: row.idempotency_key || null,
    decisionVersion: typeof row.decision_version === 'number' ? row.decision_version : 1,
    decidedAt: row.decided_at,
  };
}

/**
 * 1. Evaluates or loads the priority recommendation for a report.
 * Strictly verifies manager authentication and estate boundaries.
 * Evaluates real complaint text from database without synthetic fallback.
 * Audits all DB reads; fails fast if context query fails.
 */
export async function evaluateReportPriorityAction(
  reportId: string,
  demoKey?: 'lift' | 'water' | 'light'
): Promise<{
  success: boolean;
  evaluation?: PriorityEvaluationRecord;
  isDemoCase?: boolean;
  demoKey?: 'lift' | 'water' | 'light';
  error?: string;
}> {
  try {
    // 1. Authenticate and enforce manager role
    const { profile } = await requireManager();

    // Branch A: Approved Demo Case (Isolated preview only, never persists to DB)
    if (demoKey && ['lift', 'water', 'light'].includes(demoKey)) {
      const fixture = getApprovedDemoFixture(demoKey);
      const fingerprint = computeInputFingerprint(
        fixture.text,
        fixture.category,
        'Blok Demo',
        fixture.facts.relatedReportsCount,
        POLICY_VERSION,
        EXTRACTION_VERSION
      );
      const ruleResult = evaluatePriorityRules(fixture.facts, fixture.category);

      const demoEvaluation: PriorityEvaluationRecord = {
        id: crypto.randomUUID(),
        reportId,
        inputFingerprint: fingerprint,
        policyVersion: POLICY_VERSION,
        aiModel: 'demo-fixture-v1',
        aiProvider: 'approved-prototype',
        extractedFacts: fixture.facts,
        ruleResult,
        createdAt: new Date().toISOString(),
      };

      return {
        success: true,
        evaluation: demoEvaluation,
        isDemoCase: true,
        demoKey,
      };
    }

    // Branch B: Real Report Evaluation
    const supabase = await createServerSupabaseClient();

    // 2. Fetch authoritative report details from database
    const { data: dbReport, error: reportErr } = await supabase
      .from('incident_reports')
      .select(`
        id,
        description,
        category,
        building_id,
        buildings!inner (id, name, code, estate_id),
        service_zones (name, zone_code)
      `)
      .eq('id', reportId)
      .maybeSingle();

    if (reportErr) {
      console.error('[Priority] DB read error on incident_reports:', reportErr.message);
      return {
        success: false,
        error: 'Gagal memuatkan rekod aduan daripada pangkalan data. Sila cuba sebentar lagi.',
      };
    }

    if (!dbReport) {
      return {
        success: false,
        error: 'Aduan tidak dijumpai dalam pangkalan data.',
      };
    }

    // 3. Enforce estate access boundary
    const bldg = dbReport.buildings as unknown as { estate_id: string; name: string } | null;
    if (!bldg?.estate_id || bldg.estate_id !== profile.assigned_estate_id) {
      return {
        success: false,
        error: 'FORBIDDEN: Aduan ini bukan di bawah kawasan perumahan tugas anda.',
      };
    }

    const reportDescription = dbReport.description;
    const reportCategory = dbReport.category as FacilityCategory;
    const zone = dbReport.service_zones as unknown as { name: string } | null;
    const locationContext = `${bldg?.name || ''} ${zone?.name || ''}`.trim();

    // 4. Check for verified official linked reports in database
    let verifiedRelatedCount: number | undefined = undefined;
    const { data: linkData, error: linkErr } = await supabase
      .from('incident_report_links')
      .select('incident_id')
      .eq('report_id', reportId)
      .maybeSingle();

    if (linkErr) {
      console.error('[Priority] DB read error on incident_report_links:', linkErr.message);
      return {
        success: false,
        error: 'Gagal membaca status pautan insiden aduan daripada pangkalan data.',
      };
    }

    if (linkData?.incident_id) {
      const { count, error: countErr } = await supabase
        .from('incident_report_links')
        .select('id', { count: 'exact', head: true })
        .eq('incident_id', linkData.incident_id);

      if (countErr) {
        console.error('[Priority] DB read error on incident_report_links count:', countErr.message);
        return {
          success: false,
          error: 'Gagal membaca kiraan aduan berkaitan daripada pangkalan data.',
        };
      }

      if (typeof count === 'number' && count > 0) {
        verifiedRelatedCount = count;
      }
    }

    // 5. Compute authoritative Input Fingerprint including related count & versions
    const fingerprint = computeInputFingerprint(
      reportDescription,
      reportCategory,
      locationContext,
      verifiedRelatedCount,
      POLICY_VERSION,
      EXTRACTION_VERSION
    );

    // 6. Query existing evaluation from database matching fingerprint & policy version
    const { data: existingEval, error: evalLookupErr } = await supabase
      .from('report_priority_evaluations')
      .select('*')
      .eq('report_id', reportId)
      .eq('input_fingerprint', fingerprint)
      .eq('policy_version', POLICY_VERSION)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (evalLookupErr) {
      console.error('[Priority] DB read error on report_priority_evaluations lookup:', evalLookupErr.message);
      return {
        success: false,
        error: 'Gagal menyemak rekod penilaian sedia ada dalam pangkalan data.',
      };
    }

    if (existingEval) {
      return {
        success: true,
        evaluation: mapDbEvalToRecord(existingEval),
      };
    }

    // 7. Run AI Fact Extraction on real text
    const extraction = await extractReportFacts(reportDescription, reportCategory, verifiedRelatedCount ?? 1);
    if (!extraction.success || !extraction.facts) {
      return {
        success: false,
        error: extraction.error || 'Gagal mengekstrak fakta aduan daripada penyedia AI.',
      };
    }

    // 8. Run Deterministic Rules Engine
    const ruleResult = evaluatePriorityRules(extraction.facts, reportCategory);

    // 9. Persist evaluation into database with a valid UUID using trusted server client
    const evalId = crypto.randomUUID();
    const adminSupabase = createAdminSupabaseClient();
    const { data: insertedData, error: insertErr } = await adminSupabase
      .from('report_priority_evaluations')
      .insert({
        id: evalId,
        report_id: reportId,
        input_fingerprint: fingerprint,
        policy_version: POLICY_VERSION,
        ai_model: extraction.aiModel || 'resolved-model',
        ai_provider: extraction.aiProvider || 'resolved-provider',
        extracted_facts: extraction.facts,
        rule_result: ruleResult,
        recommended_priority: ruleResult.recommendedPriority,
        needs_more_info: ruleResult.needsMoreInfo,
      })
      .select('*')
      .single();

    if (insertErr || !insertedData) {
      console.error('[Priority] DB insert error on report_priority_evaluations:', insertErr?.message);
      return {
        success: false,
        error: 'Gagal menyimpan penilaian ke pangkalan data. Sila cuba lagi.',
      };
    }

    return {
      success: true,
      evaluation: mapDbEvalToRecord(insertedData),
    };
  } catch (err: unknown) {
    console.error('[Priority] Unexpected server error in evaluateReportPriorityAction:', err);
    return {
      success: false,
      error: (err as Error)?.message || 'Ralat pelayan semasa menilai keutamaan aduan.',
    };
  }
}

/**
 * 2. Manager confirms or overrides the priority recommendation.
 * Enforces atomic transaction, optimistic concurrency (expected_version), idempotency_key,
 * and database-level validation.
 */
export async function confirmPriorityDecisionAction(
  reportId: string,
  decision: ManagerDecisionTier,
  overrideReason?: string,
  evaluationId?: string,
  idempotencyKey?: string,
  expectedVersion?: number
): Promise<{
  success: boolean;
  decision?: PriorityDecisionRecord;
  isIdempotent?: boolean;
  isConflict?: boolean;
  error?: string;
}> {
  try {
    const { profile } = await requireManager();
    const supabase = await createServerSupabaseClient();

    // 1. Validate mandatory concurrency & idempotency parameters
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      return {
        success: false,
        error: 'VALIDATION: Idempotency key wajib dibekalkan.',
      };
    }

    if (typeof expectedVersion !== 'number' || expectedVersion < 0) {
      return {
        success: false,
        error: 'VALIDATION: Versi dijangka (expected_version) wajib dibekalkan untuk kawalan konkurensi.',
      };
    }

    // 2. Validate allowed decision tiers
    const validTiers: ManagerDecisionTier[] = [
      'immediate_review',
      'high_priority',
      'standard_review',
      'needs_more_info',
    ];
    if (!validTiers.includes(decision)) {
      return {
        success: false,
        error: 'Tahap keutamaan yang dipilih tidak sah.',
      };
    }

    // 3. Load report and verify estate boundary
    const { data: dbReport, error: repErr } = await supabase
      .from('incident_reports')
      .select(`
        id,
        description,
        category,
        buildings!inner (id, estate_id, name),
        service_zones (name)
      `)
      .eq('id', reportId)
      .maybeSingle();

    if (repErr) {
      console.error('[Priority] DB read error on incident_reports in confirm:', repErr.message);
      return {
        success: false,
        error: 'Gagal memuatkan rekod aduan daripada pangkalan data.',
      };
    }

    if (!dbReport) {
      return {
        success: false,
        error: 'Aduan tidak dijumpai dalam pangkalan data.',
      };
    }

    const bldg = dbReport.buildings as unknown as { estate_id: string; name: string } | null;
    if (!bldg?.estate_id || bldg.estate_id !== profile.assigned_estate_id) {
      return {
        success: false,
        error: 'FORBIDDEN: Aduan ini bukan di bawah kawasan perumahan tugas anda.',
      };
    }

    // 4. Validate mandatory evaluation for recommendation confirmation
    if (!evaluationId || evaluationId.trim().length === 0) {
      return {
        success: false,
        error: 'VALIDATION: evaluation_id wajib dibekalkan untuk pengesahan cadangan sistem.',
      };
    }

    const { data: dbEval, error: evalErr } = await supabase
      .from('report_priority_evaluations')
      .select('*')
      .eq('id', evaluationId.trim())
      .maybeSingle();

      if (evalErr) {
        console.error('[Priority] DB read error on report_priority_evaluations in confirm:', evalErr.message);
        return {
          success: false,
          error: 'Gagal membaca rekod penilaian daripada pangkalan data.',
        };
      }

      if (!dbEval) {
        return {
          success: false,
          error: 'Penilaian yang dirujuk tidak dijumpai dalam pangkalan data.',
        };
      }

      if (dbEval.report_id !== reportId) {
        return {
          success: false,
          error: 'FORBIDDEN: Penilaian yang dirujuk bukan milik aduan ini.',
        };
      }

      // Read linked reports for fresh fingerprint check
      let verifiedRelatedCount: number | undefined = undefined;
      const { data: linkData, error: linkErr } = await supabase
        .from('incident_report_links')
        .select('incident_id')
        .eq('report_id', reportId)
        .maybeSingle();

      if (linkErr) {
        console.error('[Priority] DB read error on links in freshness check:', linkErr.message);
        return {
          success: false,
          error: 'Gagal menyemak status terkini aduan.',
        };
      }

      if (linkData?.incident_id) {
        const { count, error: countErr } = await supabase
          .from('incident_report_links')
          .select('id', { count: 'exact', head: true })
          .eq('incident_id', linkData.incident_id);
        if (!countErr && typeof count === 'number' && count > 0) {
          verifiedRelatedCount = count;
        }
      }

      const zone = dbReport.service_zones as unknown as { name: string } | null;
      const currentLoc = `${bldg?.name || ''} ${zone?.name || ''}`.trim();
      const currentFp = computeInputFingerprint(
        dbReport.description,
        dbReport.category,
        currentLoc,
        verifiedRelatedCount,
        POLICY_VERSION,
        EXTRACTION_VERSION
      );

      if (dbEval.input_fingerprint !== currentFp || dbEval.policy_version !== POLICY_VERSION) {
        return {
          success: false,
          error: 'Kandungan aduan, pautan berkaitan, atau versi polisi telah berubah sejak penilaian dijana. Sila jana semula cadangan sebelum mengesahkan.',
        };
      }

      const recommendedPriority = dbEval.recommended_priority;
      const isOverride = decision !== recommendedPriority;

    // 5. Pre-validate override reason length
    if (isOverride) {
      const cleanReason = (overrideReason || '').trim();
      if (cleanReason.length < 5) {
        return {
          success: false,
          error: 'Sila nyatakan sebab / catatan apabila mengubah cadangan sistem (minimum 5 aksara).',
        };
      }
    }

    // 6. Execute Atomic Database RPC with Idempotency Key & Optimistic Concurrency Version
    const { data: rpcRes, error: rpcErr } = await supabase.rpc('confirm_priority_decision_rpc', {
      p_report_id: reportId,
      p_evaluation_id: evaluationId.trim(),
      p_decided_priority: decision,
      p_override_reason: overrideReason?.trim() || null,
      p_idempotency_key: idempotencyKey.trim(),
      p_expected_version: expectedVersion,
    });

    if (rpcErr) {
      console.error('[Priority] RPC error on confirm_priority_decision_rpc:', rpcErr.message);

      if (rpcErr.message.includes('IDEMPOTENCY_MISMATCH')) {
        return {
          success: false,
          error: 'Idempotency key ini telah digunakan untuk keputusan atau aduan yang berbeza.',
        };
      }

      if (rpcErr.message.includes('STALE_EVALUATION')) {
        return {
          success: false,
          error: 'Kandungan aduan, pautan berkaitan, atau versi polisi telah berubah sejak penilaian dijana. Sila jana semula cadangan sebelum mengesahkan.',
        };
      }

      if (rpcErr.message.includes('CONFLICT')) {
        return {
          success: false,
          isConflict: true,
          error: 'Keputusan aduan ini telah dikemas kini oleh pihak lain. Sila muat semula keputusan terkini sebelum membuat perubahan.',
        };
      }

      if (rpcErr.message.includes('FORBIDDEN')) {
        return {
          success: false,
          error: 'FORBIDDEN: Anda tidak mempunyai kebenaran untuk mengesahkan keputusan bagi aduan ini.',
        };
      }

      if (rpcErr.message.includes('VALIDATION')) {
        return {
          success: false,
          error: 'Sila nyatakan sebab / catatan apabila mengubah cadangan sistem (minimum 5 aksara).',
        };
      }

      return {
        success: false,
        error: 'Gagal menyimpan keputusan pengurus ke pangkalan data.',
      };
    }

    const decisionData = (rpcRes as { decision?: Record<string, unknown>; is_idempotent?: boolean })?.decision;
    if (!decisionData) {
      return {
        success: false,
        error: 'Pangkalan data tidak memulangkan rekod keputusan yang disahkan.',
      };
    }

    safeRevalidatePath('/management/inbox');

    return {
      success: true,
      isIdempotent: !!(rpcRes as { is_idempotent?: boolean })?.is_idempotent,
      decision: mapDbDecisionToRecord(
        decisionData as {
          id: string;
          report_id: string;
          evaluation_id: string | null;
          decided_priority: string;
          is_override: boolean;
          override_reason: string | null;
          decided_by: string;
          decided_at: string;
          idempotency_key?: string | null;
          decision_version?: number;
        },
        (decisionData.decided_by_name as string) || profile.full_name
      ),
    };
  } catch (err: unknown) {
    console.error('[Priority] Unexpected server error in confirmPriorityDecisionAction:', err);
    return {
      success: false,
      error: (err as Error)?.message || 'Ralat pelayan semasa mengesahkan keputusan pengurus.',
    };
  }
}

/**
 * 3. Retrieves priority data (evaluation and decisions history) for a report from the database.
 * Strictly verifies manager authentication and estate boundaries.
 * Fails honestly if any database read fails.
 */
export async function getPriorityDataAction(
  reportId: string
): Promise<PriorityDataResponse> {
  try {
    const { profile } = await requireManager();
    const supabase = await createServerSupabaseClient();

    // 1. Verify report existence and estate access
    const { data: dbReport, error: repErr } = await supabase
      .from('incident_reports')
      .select(`
        id,
        building_id,
        buildings!inner (id, estate_id)
      `)
      .eq('id', reportId)
      .maybeSingle();

    if (repErr) {
      console.error('[Priority] DB read error on incident_reports in getPriorityData:', repErr.message);
      return {
        success: false,
        evaluation: null,
        latestDecision: null,
        decisionHistory: [],
        error: 'Gagal memuatkan rekod aduan daripada pangkalan data.',
      };
    }

    if (!dbReport) {
      return {
        success: false,
        evaluation: null,
        latestDecision: null,
        decisionHistory: [],
        error: 'Aduan tidak dijumpai dalam pangkalan data.',
      };
    }

    const bldg = dbReport.buildings as unknown as { estate_id: string } | null;
    if (!bldg?.estate_id || bldg.estate_id !== profile.assigned_estate_id) {
      return {
        success: false,
        evaluation: null,
        latestDecision: null,
        decisionHistory: [],
        error: 'FORBIDDEN: Aduan ini bukan di bawah kawasan perumahan tugas anda.',
      };
    }

    // Refresh link context too: clients only mark it loaded after this read succeeds.
    const { error: linkErr } = await supabase
      .from('incident_report_links')
      .select('incident_id')
      .eq('report_id', reportId);

    if (linkErr) {
      return {
        success: false,
        evaluation: null,
        latestDecision: null,
        decisionHistory: [],
        error: 'Gagal memuatkan pautan aduan daripada pangkalan data.',
      };
    }

    // 2. Fetch latest evaluation from database
    const { data: dbEval, error: evalErr } = await supabase
      .from('report_priority_evaluations')
      .select('*')
      .eq('report_id', reportId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (evalErr) {
      console.error('[Priority] DB read error on report_priority_evaluations in getPriorityData:', evalErr.message);
      return {
        success: false,
        evaluation: null,
        latestDecision: null,
        decisionHistory: [],
        error: 'Gagal memuatkan penilaian keutamaan daripada pangkalan data.',
      };
    }

    // 3. Fetch decisions history from database
    const { data: dbDecisions, error: decErr } = await supabase
      .from('report_priority_decisions')
      .select(`
        id,
        report_id,
        evaluation_id,
        decided_priority,
        is_override,
        override_reason,
        decided_by,
        decided_at,
        idempotency_key,
        decision_version,
        profiles:decided_by (full_name)
      `)
      .eq('report_id', reportId)
      .order('decision_version', { ascending: false });

    if (decErr) {
      console.error('[Priority] DB read error on report_priority_decisions in getPriorityData:', decErr.message);
      return {
        success: false,
        evaluation: null,
        latestDecision: null,
        decisionHistory: [],
        error: 'Gagal memuatkan sejarah keputusan daripada pangkalan data.',
      };
    }

    type DecisionRowWithProfile = {
      id: string;
      report_id: string;
      evaluation_id: string | null;
      decided_priority: string;
      is_override: boolean;
      override_reason: string | null;
      decided_by: string;
      decided_at: string;
      idempotency_key?: string | null;
      decision_version?: number;
      profiles?: { full_name: string } | { full_name: string }[] | null;
    };

    const history: PriorityDecisionRecord[] = ((dbDecisions as unknown as DecisionRowWithProfile[]) || []).map((row) => {
      const prof = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
      return mapDbDecisionToRecord(row, prof?.full_name || 'Pengurus PPR');
    });

    const latestDecision = history.length > 0 ? history[0] : null;
    const currentVersion = latestDecision?.decisionVersion ?? 0;

    return {
      success: true,
      evaluation: dbEval ? mapDbEvalToRecord(dbEval) : null,
      latestDecision,
      decisionHistory: history,
      currentVersion,
    };
  } catch (err: unknown) {
    console.error('[Priority] Unexpected server error in getPriorityDataAction:', err);
    return {
      success: false,
      evaluation: null,
      latestDecision: null,
      decisionHistory: [],
      error: (err as Error)?.message || 'Ralat mendapatkan data keutamaan aduan.',
    };
  }
}
