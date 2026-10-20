import React from 'react';
import { requireManager } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import {
  ManagementDashboardClient,
  type DashboardReportItem,
  type DashboardStats,
  type UnconfirmedEvaluation,
} from '@/components/management/ManagementDashboardClient';
import type { FacilityCategory, ReportStatus } from '@/types/database';

export const instant = false;

/**
 * Returns ISO string for the start of the current month in Asia/Kuala_Lumpur (UTC+8).
 * Example: for October 2026, returns '2026-10-01T00:00:00+08:00'.
 */
function getStartOfMonthInKL(): string {
  const now = new Date();
  const klFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
  });
  const [year, month] = klFormatter.format(now).split('-');
  return `${year}-${month}-01T00:00:00+08:00`;
}

export default async function ManagementDashboardPage() {
  const { profile } = await requireManager();
  const supabase = await createServerSupabaseClient();
  const estateId = profile.assigned_estate_id!;
  const estateName =
    estateId === 'ppr-desa-rejang' ? 'PPR Desa Rejang' : 'PPR Sentosa';

  let hasError = false;
  let newReportsCount = 0;
  let activeIncidentsCount = 0;
  let pendingDecisionsCount = 0;
  let resolvedThisMonthCount = 0;

  // 1. Fetch 4 Statistics with authoritative DB queries
  try {
    // 1A. Aduan Baharu (Resident reports awaiting initial manager review)
    const { count: newCount, error: newErr } = await supabase
      .from('incident_reports')
      .select('id, buildings!inner(estate_id)', { count: 'exact', head: true })
      .eq('buildings.estate_id', estateId)
      .eq('status', 'submitted');
    if (newErr) throw newErr;
    newReportsCount = newCount || 0;

    // 1B. Insiden Dalam Tindakan (Estate-level operational incidents being investigated/repaired)
    const { count: actCount, error: actErr } = await supabase
      .from('incidents')
      .select('id, buildings!inner(estate_id)', { count: 'exact', head: true })
      .eq('buildings.estate_id', estateId)
      .in('status', ['investigating', 'confirmed', 'in_maintenance']);
    if (actErr) throw actErr;
    activeIncidentsCount = actCount || 0;

    // 1C. Cadangan Perlu Keputusan (Deterministic priority evaluations pending human manager decision)
    const { data: evals, error: evalErr } = await supabase
      .from('report_priority_evaluations')
      .select('id, report_id, incident_reports!inner(buildings!inner(estate_id))')
      .eq('incident_reports.buildings.estate_id', estateId);
    if (evalErr) throw evalErr;

    const { data: decs, error: decErr } = await supabase
      .from('report_priority_decisions')
      .select('report_id');
    if (decErr) throw decErr;

    const decidedSet = new Set((decs || []).map((d) => d.report_id));
    const pendingEvals = (evals || []).filter((e) => !decidedSet.has(e.report_id));
    pendingDecisionsCount = pendingEvals.length;

    // 1D. Insiden Selesai Bulan Ini (Restored/closed incidents within current month in Asia/Kuala_Lumpur)
    const startOfMonthKL = getStartOfMonthInKL();
    const { count: resCount, error: resErr } = await supabase
      .from('incidents')
      .select('id, buildings!inner(estate_id)', { count: 'exact', head: true })
      .eq('buildings.estate_id', estateId)
      .in('status', ['restored', 'closed'])
      .gte('updated_at', startOfMonthKL);
    if (resErr) throw resErr;
    resolvedThisMonthCount = resCount || 0;
  } catch (err) {
    console.error('[Dashboard Stats Error]:', err);
    hasError = true;
  }

  // 2. Fetch Buildings in Estate
  let buildings: Array<{ id: string; name: string; code: string }> = [];
  try {
    const { data: bldgsData } = await supabase
      .from('buildings')
      .select('id, name, code')
      .eq('estate_id', estateId)
      .order('name');
    buildings = bldgsData || [];
  } catch {
    // Graceful fallback
  }

  // 3. Fetch Reports with attachments
  let reports: DashboardReportItem[] = [];
  try {
    const { data: rawReports, error: repError } = await supabase
      .from('incident_reports')
      .select(`
        id,
        category,
        description,
        status,
        urgency_hint,
        created_at,
        buildings!inner(id, name, code, estate_id),
        service_zones(id, name),
        profiles:reporter_id(full_name),
        report_attachments(id, file_name, mime_type, storage_path)
      `)
      .eq('buildings.estate_id', estateId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (repError) throw repError;

    // Securely generate signed URLs on server side (zero service role in browser)
    let adminSupabase: ReturnType<typeof createAdminClient> | null = null;
    const serviceRoleKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.STAGING_SERVICE_ROLE_KEY;
    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.STAGING_SUPABASE_URL;

    if (serviceRoleKey && supabaseUrl) {
      adminSupabase = createAdminClient(supabaseUrl, serviceRoleKey);
    }

    reports = await Promise.all(
      (rawReports || []).map(async (r) => {
        const rawAtts = (r.report_attachments as Array<{
          id: string;
          file_name: string;
          mime_type: string;
          storage_path: string;
        }>) || [];

        const signedAtts = await Promise.all(
          rawAtts.map(async (att) => {
            let signedUrl: string | undefined = undefined;
            if (adminSupabase && att.storage_path) {
              const { data } = await adminSupabase.storage
                .from('incident-evidence')
                .createSignedUrl(att.storage_path, 3600);
              signedUrl = data?.signedUrl;
            }
            return {
              id: att.id,
              file_name: att.file_name,
              mime_type: att.mime_type,
              signedUrl,
            };
          })
        );

        const bldg = r.buildings as unknown as { id: string; name: string; code: string } | null;
        const zone = r.service_zones as unknown as { id: string; name: string } | null;
        const reporter = r.profiles as unknown as { full_name?: string } | null;

        return {
          id: r.id,
          category: r.category as FacilityCategory,
          description: r.description,
          status: r.status as ReportStatus,
          urgency_hint: r.urgency_hint,
          created_at: r.created_at,
          building: bldg,
          zone: zone,
          reporterName: reporter?.full_name,
          attachments: signedAtts,
        };
      })
    );
  } catch (err) {
    console.error('[Dashboard Reports Error]:', err);
    hasError = true;
  }

  // 4. Calculate active facility counts and active block counts
  const activeReports = reports.filter(
    (r) => r.status === 'submitted' || r.status === 'reviewed' || r.status === 'linked'
  );

  const activeFacilityCounts = {
    lift: activeReports.filter((r) => r.category === 'lift').length,
    water_supply: activeReports.filter((r) => r.category === 'water_supply').length,
    corridor_lighting: activeReports.filter((r) => r.category === 'corridor_lighting').length,
    other: activeReports.filter((r) => r.category === 'other').length,
  };

  const activeBlockCounts: Record<string, number> = {};
  for (const b of buildings) {
    const norm = b.code.replace('DR_', '').replace('BLK_', '');
    activeBlockCounts[norm] = activeReports.filter((r) => r.building?.id === b.id).length;
  }

  // 5. Fetch single latest unconfirmed priority evaluation (if any)
  let unconfirmedEvaluation: UnconfirmedEvaluation | null = null;
  try {
    const { data: latestEvals } = await supabase
      .from('report_priority_evaluations')
      .select(`
        id,
        report_id,
        recommended_priority,
        rule_result,
        extracted_facts,
        incident_reports!inner(id, category, buildings!inner(estate_id))
      `)
      .eq('incident_reports.buildings.estate_id', estateId)
      .order('created_at', { ascending: false });

    if (latestEvals && latestEvals.length > 0) {
      const { data: decsData } = await supabase
        .from('report_priority_decisions')
        .select('report_id');
      const decidedReportIds = new Set((decsData || []).map((d) => d.report_id));

      const firstUnconfirmed = latestEvals.find((ev) => !decidedReportIds.has(ev.report_id));
      if (firstUnconfirmed) {
        const rep = firstUnconfirmed.incident_reports as unknown as { id: string; category: string } | null;
        const ruleRes = firstUnconfirmed.rule_result as Record<string, unknown> | null;
        const reasonText =
          (ruleRes?.reason as string) ||
          'Cadangan keutamaan dihasilkan oleh peraturan deterministik berdasarkan kesan fasiliti.';

        unconfirmedEvaluation = {
          reportId: firstUnconfirmed.report_id,
          reportRef: `#LPR-${firstUnconfirmed.report_id.substring(0, 8).toUpperCase()}`,
          category: rep?.category || 'Kerosakan',
          recommendedPriority: firstUnconfirmed.recommended_priority,
          reason: reasonText,
          factsSummary: JSON.stringify(firstUnconfirmed.extracted_facts || {}),
        };
      }
    }
  } catch {
    // Graceful fallback
  }

  const stats: DashboardStats = {
    newReportsCount,
    activeIncidentsCount,
    pendingDecisionsCount,
    resolvedThisMonthCount,
    hasError,
  };

  return (
    <ManagementDashboardClient
      stats={stats}
      reports={reports}
      estateName={estateName}
      buildings={buildings}
      unconfirmedEvaluation={unconfirmedEvaluation}
      activeFacilityCounts={activeFacilityCounts}
      activeBlockCounts={activeBlockCounts}
    />
  );
}
