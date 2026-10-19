import React from 'react';
import { requireResident } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { SejarahClient, type ReportHistoryItem } from './SejarahClient';
import type { FacilityCategory, ReportStatus } from '@/types/database';

export default async function SejarahLaporanPage() {
  await requireResident();
  const supabase = await createServerSupabaseClient();

  // Query resident's reports
  const { data: reports, error: reportsError } = await supabase
    .from('incident_reports')
    .select(`
      id,
      category,
      description,
      status,
      urgency_hint,
      created_at,
      buildings (name, code),
      service_zones (name, zone_code),
      report_attachments (id, storage_path, file_name, file_size_bytes, mime_type)
    `)
    .order('created_at', { ascending: false });

  if (reportsError) {
    return <SejarahClient reports={[]} reportsError={reportsError.message} />;
  }

  // Fetch incident links if any reports exist
  const reportIds = (reports || []).map((r) => r.id);
  const linksMap = new Map<string, { incidentNumber: string; title: string; status: string }>();

  if (reportIds.length > 0) {
    const { data: links } = await supabase
      .from('incident_report_links')
      .select(`
        report_id,
        incidents (incident_number, title, status)
      `)
      .in('report_id', reportIds);

    if (links) {
      for (const link of links) {
        const inc = link.incidents as unknown as { incident_number: string; title: string; status: string } | null;
        if (inc) {
          linksMap.set(link.report_id, {
            incidentNumber: inc.incident_number,
            title: inc.title,
            status: inc.status,
          });
        }
      }
    }
  }

  // Pre-generate signed URLs for attachments
  const formattedReports: ReportHistoryItem[] = [];

  for (const rep of reports || []) {
    const bldg = rep.buildings as unknown as { name: string; code: string } | null;
    const zone = rep.service_zones as unknown as { name: string; zone_code: string } | null;
    const rawAttachments = rep.report_attachments as unknown as Array<{
      id: string;
      storage_path: string;
      file_name: string;
      file_size_bytes: number;
      mime_type: string;
    }> | null;

    const attachmentsWithUrls: Array<{
      id: string;
      file_name: string;
      file_size_bytes: number;
      mime_type: string;
      signedUrl?: string;
    }> = [];

    if (rawAttachments && rawAttachments.length > 0) {
      for (const att of rawAttachments) {
        let signedUrl = '';
        const { data: signed } = await supabase.storage
          .from('incident-evidence')
          .createSignedUrl(att.storage_path, 3600);

        if (signed?.signedUrl) {
          signedUrl = signed.signedUrl.startsWith('http')
            ? signed.signedUrl
            : `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1${signed.signedUrl}`;
        }

        attachmentsWithUrls.push({
          id: att.id,
          file_name: att.file_name,
          file_size_bytes: att.file_size_bytes,
          mime_type: att.mime_type,
          signedUrl,
        });
      }
    }

    formattedReports.push({
      id: rep.id,
      category: rep.category as FacilityCategory,
      description: rep.description,
      status: rep.status as ReportStatus,
      urgency_hint: rep.urgency_hint,
      created_at: rep.created_at,
      buildingName: bldg?.name || 'Blok',
      zoneName: zone?.name || null,
      attachments: attachmentsWithUrls,
      linkedIncident: linksMap.get(rep.id) || null,
    });
  }

  return <SejarahClient reports={formattedReports} />;
}
