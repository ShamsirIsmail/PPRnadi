import React from 'react';
import { notFound, redirect } from 'next/navigation';
import { requireResident } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { ReportDetailView, type ReportDetailData } from '@/components/resident/ReportDetailView';
import type { FacilityCategory, ReportStatus } from '@/types/database';

export const instant = false;

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ReportDetailPage({ params }: PageProps) {
  await requireResident();
  const { id } = await params;

  if (!id) {
    notFound();
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Query resident's report with ownership enforcement
  const { data: report, error: reportError } = await supabase
    .from('incident_reports')
    .select(`
      id,
      reporter_id,
      category,
      description,
      status,
      urgency_hint,
      created_at,
      updated_at,
      buildings (name, code),
      service_zones (name, zone_code),
      report_attachments (id, storage_path, file_name, file_size_bytes, mime_type)
    `)
    .eq('id', id)
    .maybeSingle();

  // If report not found or does not belong to current resident, return 404
  if (reportError || !report || report.reporter_id !== user.id) {
    notFound();
  }

  // Fetch incident link if report is linked
  const { data: link } = await supabase
    .from('incident_report_links')
    .select('report_id, incident_id, linked_at')
    .eq('report_id', id)
    .maybeSingle();

  let linkedIncident: ReportDetailData['linkedIncident'] = null;
  let publishedBulletins: ReportDetailData['publishedBulletins'] = [];

  if (link?.incident_id) {
    const { data: bulletins } = await supabase
      .from('published_incident_bulletins')
      .select('*')
      .eq('incident_id', link.incident_id)
      .order('published_at', { ascending: true });

    if (bulletins && bulletins.length > 0) {
      const primary = bulletins[bulletins.length - 1];
      linkedIncident = {
        incidentNumber: primary.incident_number,
        title: primary.update_title,
        status: primary.incident_status,
      };
      publishedBulletins = bulletins.map((b) => ({
        update_id: b.update_id,
        incident_number: b.incident_number,
        update_title: b.update_title,
        message_bm: b.message_bm,
        stage: b.stage,
        published_at: b.published_at,
      }));
    } else {
      // Linked without published bulletins
      linkedIncident = {
        incidentNumber: '—',
        title: '',
        status: '',
      };
    }
  }

  // Generate signed URLs for attachments
  const bldg = report.buildings as unknown as { name: string; code: string } | null;
  const zone = report.service_zones as unknown as { name: string; zone_code: string } | null;
  const rawAttachments = report.report_attachments as unknown as Array<{
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

  const detailData: ReportDetailData = {
    id: report.id,
    category: report.category as FacilityCategory,
    description: report.description,
    status: report.status as ReportStatus,
    urgency_hint: report.urgency_hint,
    created_at: report.created_at,
    updated_at: report.updated_at,
    buildingName: bldg?.name || 'Blok',
    zoneName: zone?.name || null,
    attachments: attachmentsWithUrls,
    linkedIncident,
    publishedBulletins,
  };

  return <ReportDetailView report={detailData} />;
}
