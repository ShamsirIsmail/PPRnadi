import React from 'react';
import { requireResident } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { ResidentHomeClient } from './ResidentHomeClient';
import type { PublishedIncidentBulletin, IncidentReportRow, IncidentStatus } from '@/types/database';

export default async function ResidentDashboardPage() {
  const { profile } = await requireResident();
  const supabase = await createServerSupabaseClient();

  // 1. Fetch resident's assigned building
  const { data: building } = await supabase
    .from('buildings')
    .select('id, name, code, total_floors, estate_id')
    .eq('id', profile.assigned_building_id || '')
    .maybeSingle();

  // 2. Fetch official published bulletins for resident's estate (enforced by RLS)
  const { data: bulletins, error: bulletinError } = await supabase
    .from('published_incident_bulletins')
    .select('*')
    .order('published_at', { ascending: false });

  const activeBulletins: PublishedIncidentBulletin[] = (bulletins || []) as PublishedIncidentBulletin[];

  // 3. Fetch resident's reports (scoped to user by RLS). Do NOT limit to 3 so older active reports are not missed!
  const { data: reports, error: reportsError } = await supabase
    .from('incident_reports')
    .select('id, category, description, status, urgency_hint, created_at, updated_at')
    .order('created_at', { ascending: false });

  // 4. Safely check linked incident status for any 'linked' reports
  const reportIncidentMap: Record<string, { status: IncidentStatus }> = {};
  const linkedReportIds = (reports || []).filter((r) => r.status === 'linked').map((r) => r.id);

  if (linkedReportIds.length > 0) {
    const { data: links } = await supabase
      .from('incident_report_links')
      .select('report_id, incident_id')
      .in('report_id', linkedReportIds);

    if (links && links.length > 0) {
      for (const link of links) {
        const matchingBulletin = activeBulletins.find((b) => b.incident_id === link.incident_id);
        if (matchingBulletin) {
          reportIncidentMap[link.report_id] = { status: matchingBulletin.incident_status };
        }
      }
    }
  }

  return (
    <ResidentHomeClient
      profile={profile}
      building={building || null}
      activeBulletins={activeBulletins}
      hasBulletinError={Boolean(bulletinError)}
      reports={(reports || []) as IncidentReportRow[]}
      hasReportsError={Boolean(reportsError)}
      reportIncidentMap={reportIncidentMap}
    />
  );
}

