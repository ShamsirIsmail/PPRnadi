import React from 'react';
import { InboxLoadError } from './InboxLoadError';
import { requireManager } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { InboxClient, type ReportItem, type IncidentOption } from './InboxClient';
import type { FacilityCategory, ReportStatus } from '@/types/database';
import type {
  PriorityEvaluationRecord,
  PriorityDecisionRecord,
  PriorityLoadState,
} from '@/types/priority-explainer';

type DbQueryResult<T> =
  | { status: 'success'; data: T }
  | { status: 'timeout' }
  | { status: 'error'; userMessage: { ms: string; en: string } };

async function fetchWithDbGuard<T>(
  promiseLike: PromiseLike<{ data: T | null; error: unknown }>,
  timeoutMs = 2500
): Promise<DbQueryResult<T>> {
  try {
    const raceResult = await Promise.race([
      Promise.resolve(promiseLike),
      new Promise<'TIMEOUT'>((resolve) => setTimeout(() => resolve('TIMEOUT'), timeoutMs)),
    ]);

    if (raceResult === 'TIMEOUT') {
      return { status: 'timeout' };
    }

    if (raceResult && typeof raceResult === 'object' && 'error' in raceResult && raceResult.error) {
      const err = raceResult.error as { message?: string; code?: string };
      // Log sanitized server-side, never expose raw DB message or stack trace to client
      console.error('[Inbox DB Read Error]:', err?.message || err);
      return {
        status: 'error',
        userMessage: {
          ms: 'Pangkalan data tidak dapat diakses buat masa ini. Sila cuba sebentar lagi.',
          en: 'Database is currently inaccessible. Please try again shortly.',
        },
      };
    }

    const payload =
      raceResult && typeof raceResult === 'object' && 'data' in raceResult
        ? raceResult.data
        : null;
    return { status: 'success', data: payload as T };
  } catch (err: unknown) {
    console.error('[Inbox DB Exception]:', (err as Error)?.message || err);
    return {
      status: 'error',
      userMessage: {
        ms: 'Ralat sambungan pangkalan data. Sila muat semula halaman.',
        en: 'Database connection error. Please refresh the page.',
      },
    };
  }
}

export default async function TriageInboxPage() {
  const { profile } = await requireManager();
  const supabase = await createServerSupabaseClient();

  // 1. Fetch real reports for manager's assigned estate
  const reportsRes = await fetchWithDbGuard(
    supabase
      .from('incident_reports')
      .select(`
        id,
        category,
        description,
        status,
        urgency_hint,
        created_at,
        buildings!inner (id, name, code, estate_id),
        service_zones (name, zone_code),
        report_attachments (id, file_name, file_size_bytes, mime_type, storage_path)
      `)
      .eq('buildings.estate_id', profile.assigned_estate_id!)
      .order('created_at', { ascending: false })
  );

  if (reportsRes.status !== 'success') {
    return <InboxLoadError status={reportsRes.status} />;
  }

  // Succeeded: reportsData is either non-empty array or genuinely empty []
  const reportsData = reportsRes.data;
  type ReportRawRow = NonNullable<typeof reportsData>[number];
  const reportsToProcess: ReportRawRow[] = reportsData || [];

  // 2. Fetch compatible verified incidents
  const incidentsRes = await fetchWithDbGuard(
    supabase
      .from('incidents')
      .select(`
        id,
        incident_number,
        title,
        building_id,
        category,
        status,
        buildings!inner (estate_id)
      `)
      .eq('buildings.estate_id', profile.assigned_estate_id!)
      .in('status', ['confirmed', 'in_maintenance'])
      .order('created_at', { ascending: false })
  );

  type IncidentRawRow = {
    id: string;
    incident_number: string;
    title: string;
    building_id: string;
    category: FacilityCategory;
    status: string;
  };

  const verifiedIncidents: IncidentOption[] = (
    incidentsRes.status === 'success' && incidentsRes.data
      ? (incidentsRes.data as unknown as IncidentRawRow[])
      : []
  ).map((inc) => ({
    id: inc.id,
    incident_number: inc.incident_number,
    title: inc.title,
    building_id: inc.building_id,
    category: inc.category,
    status: inc.status,
  }));

  // 3. Fetch incident links
  const reportIds = reportsToProcess.map((r) => r.id);
  const linksMap = new Map<string, { id: string; incident_number: string; title: string }>();
  let linksStatus: 'loaded' | 'timeout' | 'error' = 'loaded';
  let linksErrorMessage: { ms: string; en: string } | undefined = undefined;

  if (reportIds.length > 0) {
    const linksRes = await fetchWithDbGuard(
      supabase
        .from('incident_report_links')
        .select(`
          report_id,
          incidents (id, incident_number, title)
        `)
        .in('report_id', reportIds)
    );

    if (linksRes.status === 'success') {
      const links = linksRes.data;
      if (links) {
        for (const l of links) {
          const inc = l.incidents as unknown as { id: string; incident_number: string; title: string } | null;
          if (inc) {
            linksMap.set(l.report_id, {
              id: inc.id,
              incident_number: inc.incident_number,
              title: inc.title,
            });
          }
        }
      }
    } else {
      linksStatus = linksRes.status;
      linksErrorMessage =
        linksRes.status === 'timeout'
          ? {
              ms: 'Masa sambungan pautan insiden tamat.',
              en: 'Connection timed out while loading incident links.',
            }
          : linksRes.userMessage;
    }
  }

  // 3b. Fetch authoritative priority evaluations & decisions for reports
  const evaluationsMap = new Map<string, PriorityEvaluationRecord>();
  const decisionsMap = new Map<string, PriorityDecisionRecord>();
  let evalsStatus: 'loaded' | 'timeout' | 'error' = 'loaded';
  let evalsErrorMessage: { ms: string; en: string } | undefined = undefined;
  let decsStatus: 'loaded' | 'timeout' | 'error' = 'loaded';
  let decsErrorMessage: { ms: string; en: string } | undefined = undefined;

  if (reportIds.length > 0) {
    const evalsRes = await fetchWithDbGuard(
      supabase
        .from('report_priority_evaluations')
        .select('*')
        .in('report_id', reportIds)
        .order('created_at', { ascending: false })
    );

    if (evalsRes.status === 'success') {
      if (evalsRes.data) {
        for (const ev of evalsRes.data) {
          if (!evaluationsMap.has(ev.report_id)) {
            evaluationsMap.set(ev.report_id, {
              id: ev.id,
              reportId: ev.report_id,
              inputFingerprint: ev.input_fingerprint,
              policyVersion: ev.policy_version,
              aiModel: ev.ai_model,
              aiProvider: ev.ai_provider,
              extractedFacts: ev.extracted_facts,
              ruleResult: ev.rule_result,
              createdAt: ev.created_at,
            });
          }
        }
      }
    } else {
      evalsStatus = evalsRes.status;
      evalsErrorMessage =
        evalsRes.status === 'timeout'
          ? {
              ms: 'Masa sambungan penilaian keutamaan tamat.',
              en: 'Connection timed out while loading priority evaluations.',
            }
          : evalsRes.userMessage;
    }

    const decsRes = await fetchWithDbGuard(
      supabase
        .from('report_priority_decisions')
        .select(`
          *,
          profiles:decided_by (full_name)
        `)
        .in('report_id', reportIds)
        .order('decided_at', { ascending: false })
    );

    if (decsRes.status === 'success') {
      if (decsRes.data) {
        for (const dec of decsRes.data) {
          if (!decisionsMap.has(dec.report_id)) {
            const prof = dec.profiles as unknown as { full_name: string } | null;
            decisionsMap.set(dec.report_id, {
              id: dec.id,
              reportId: dec.report_id,
              evaluationId: dec.evaluation_id,
              decidedPriority: dec.decided_priority,
              isOverride: dec.is_override,
              overrideReason: dec.override_reason,
              decidedById: dec.decided_by,
              decidedByName: prof?.full_name || 'Pengurus PPR',
              decidedAt: dec.decided_at,
              idempotencyKey: dec.idempotency_key,
              decisionVersion: dec.decision_version,
            });
          }
        }
      }
    } else {
      decsStatus = decsRes.status;
      decsErrorMessage =
        decsRes.status === 'timeout'
          ? {
              ms: 'Masa sambungan keputusan pengurus tamat.',
              en: 'Connection timed out while loading manager decisions.',
            }
          : decsRes.userMessage;
    }
  }

  // 4. Pre-generate signed URLs for private evidence attachments
  const formattedReports: ReportItem[] = [];

  for (const raw of reportsToProcess) {
    const bldg = raw.buildings as unknown as { id: string; name: string; code: string } | null;
    const zone = raw.service_zones as unknown as { name: string; zone_code: string } | null;
    const rawAtts = raw.report_attachments as unknown as Array<{
      id: string;
      file_name: string;
      file_size_bytes: number;
      mime_type: string;
      storage_path: string;
    }> | null;

    const attachments: ReportItem['attachments'] = [];

    if (rawAtts && rawAtts.length > 0) {
      for (const att of rawAtts) {
        const { data: signed } = await supabase.storage
          .from('incident-evidence')
          .createSignedUrl(att.storage_path, 3600);

        let signedUrl: string | undefined = undefined;
        if (signed?.signedUrl) {
          signedUrl = signed.signedUrl.startsWith('http')
            ? signed.signedUrl
            : `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1${signed.signedUrl}`;
        }

        attachments.push({
          id: att.id,
          file_name: att.file_name,
          file_size_bytes: att.file_size_bytes,
          mime_type: att.mime_type,
          signedUrl,
        });
      }
    }

    const priorityLoadState: PriorityLoadState = {
      evaluationStatus: evalsStatus,
      decisionStatus: decsStatus,
      linkStatus: linksStatus,
      isVersionKnown: decsStatus === 'loaded',
      userMessage: evalsErrorMessage || decsErrorMessage || linksErrorMessage,
    };

    formattedReports.push({
      id: raw.id,
      category: raw.category as FacilityCategory,
      description: raw.description,
      status: raw.status as ReportStatus,
      urgency_hint: raw.urgency_hint,
      created_at: raw.created_at,
      building: bldg ? { id: bldg.id, name: bldg.name, code: bldg.code } : null,
      zone: zone ? { name: zone.name, zone_code: zone.zone_code } : null,
      attachments,
      linkedIncident: linksMap.get(raw.id) || null,
      initialEvaluation: evaluationsMap.get(raw.id) || null,
      initialDecision: decisionsMap.get(raw.id) || null,
      priorityLoadState,
    });
  }

  return (
    <InboxClient
      reports={formattedReports}
      verifiedIncidents={verifiedIncidents}
    />
  );
}
