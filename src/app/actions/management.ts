'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabaseClient } from '../../lib/supabase/server';
import { requireManager } from '../../lib/auth/session';
import type { FacilityCategory, IncidentSeverity, IncidentStatus, UpdateStage } from '../../types/database';

function safeRevalidatePath(path: string) {
  try {
    revalidatePath(path);
  } catch {
    // Invariant: static generation store missing outside active Next request context
  }
}

export interface ManagementActionResult {
  success: boolean;
  message?: string;
  error?: string;
  data?: unknown;
}

/**
 * 1. Mark submitted report as reviewed
 * Verifies that a row was actually updated and distinguishes already-completed / unavailable states.
 */
export async function reviewReportAction(reportId: string): Promise<ManagementActionResult> {
  try {
    await requireManager();
    const supabase = await createServerSupabaseClient();

    const { data, error } = await supabase
      .from('incident_reports')
      .update({ status: 'reviewed' })
      .eq('id', reportId)
      .eq('status', 'submitted')
      .select('id, status');

    if (error) {
      return { success: false, error: `Gagal mengesahkan semakan: ${error.message}` };
    }

    if (!data || data.length === 0) {
      const { data: existing } = await supabase
        .from('incident_reports')
        .select('id, status')
        .eq('id', reportId)
        .maybeSingle();

      if (!existing) {
        return { success: false, error: 'Laporan tidak dijumpai atau anda tidak mempunyai kebenaran akses ke kawasan ini.' };
      }
      if (existing.status === 'reviewed') {
        return { success: false, error: 'Laporan ini telah pun disemak sebelum ini.' };
      }
      return { success: false, error: `Laporan tidak boleh disemak kerana status semasa adalah '${existing.status}'.` };
    }

    safeRevalidatePath('/management/inbox');
    return { success: true, message: 'Laporan ditandakan sebagai disemak.' };
  } catch (err: unknown) {
    return { success: false, error: (err as Error)?.message || 'Ralat pelayan' };
  }
}

/**
 * 2. Dismiss report
 * Verifies affected records and avoids generic false positives.
 */
export async function dismissReportAction(reportId: string): Promise<ManagementActionResult> {
  try {
    await requireManager();
    const supabase = await createServerSupabaseClient();

    const { data, error } = await supabase
      .from('incident_reports')
      .update({ status: 'dismissed' })
      .eq('id', reportId)
      .in('status', ['submitted', 'reviewed'])
      .select('id, status');

    if (error) {
      return { success: false, error: `Gagal menolak laporan: ${error.message}` };
    }

    if (!data || data.length === 0) {
      const { data: existing } = await supabase
        .from('incident_reports')
        .select('id, status')
        .eq('id', reportId)
        .maybeSingle();

      if (!existing) {
        return { success: false, error: 'Laporan tidak dijumpai atau anda tidak mempunyai kebenaran akses ke kawasan ini.' };
      }
      if (existing.status === 'dismissed') {
        return { success: false, error: 'Laporan ini telah pun ditolak sebelum ini.' };
      }
      return { success: false, error: `Laporan tidak boleh ditolak kerana status semasa adalah '${existing.status}'.` };
    }

    safeRevalidatePath('/management/inbox');
    return { success: true, message: 'Laporan ditandakan sebagai ditolak.' };
  } catch (err: unknown) {
    return { success: false, error: (err as Error)?.message || 'Ralat pelayan' };
  }
}

/**
 * 3. Create a new incident in investigating status
 */
export async function createIncidentAction(
  _prevState: ManagementActionResult | null,
  formData: FormData
): Promise<ManagementActionResult> {
  try {
    const { profile } = await requireManager();
    const supabase = await createServerSupabaseClient();

    const buildingId = (formData.get('building_id') as string)?.trim();
    const category = formData.get('category') as FacilityCategory;
    const title = (formData.get('title') as string)?.trim();
    const severity = (formData.get('severity') as IncidentSeverity) || 'major';
    const primaryFacilityId = (formData.get('primary_facility_id') as string)?.trim() || null;
    const internalNotes = (formData.get('internal_notes') as string)?.trim() || null;

    if (!buildingId || !category || !title || title.length < 5) {
      return { success: false, error: 'Sila lengkapkan blok, kategori, dan tajuk insiden (minimum 5 aksara).' };
    }

    // Verify building belongs to manager's assigned estate
    const { data: bldg, error: bldgError } = await supabase
      .from('buildings')
      .select('estate_id')
      .eq('id', buildingId)
      .single();

    if (bldgError || !bldg || bldg.estate_id !== profile.assigned_estate_id) {
      return { success: false, error: 'Blok yang dipilih bukan di bawah perumahan tugas anda.' };
    }

    // Auto-generate unique incident number: INC-YYYY-XXXX
    const incNumber = `INC-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const { data: incident, error: incError } = await supabase
      .from('incidents')
      .insert({
        incident_number: incNumber,
        building_id: buildingId,
        primary_facility_id: primaryFacilityId,
        category,
        title,
        severity,
        status: 'investigating',
        internal_notes: internalNotes,
      })
      .select('id, incident_number')
      .single();

    if (incError || !incident) {
      return { success: false, error: `Gagal mencipta insiden: ${incError?.message || 'Ralat tidak diketahui'}` };
    }

    safeRevalidatePath('/management/incidents');
    safeRevalidatePath('/management/inbox');
    return {
      success: true,
      message: `Insiden ${incident.incident_number} berjaya dicipta dalam status siasatan (investigating).`,
      data: incident,
    };
  } catch (err: unknown) {
    return { success: false, error: (err as Error)?.message || 'Ralat pelayan' };
  }
}

/**
 * 4. Confirm an incident (investigating -> confirmed)
 * Verifies affected records to prevent silent no-op success.
 */
export async function confirmIncidentAction(incidentId: string): Promise<ManagementActionResult> {
  try {
    await requireManager();
    const supabase = await createServerSupabaseClient();

    const { data, error } = await supabase
      .from('incidents')
      .update({ status: 'confirmed' })
      .eq('id', incidentId)
      .eq('status', 'investigating')
      .select('id, status');

    if (error) {
      return { success: false, error: `Gagal mengesahkan insiden: ${error.message}` };
    }

    if (!data || data.length === 0) {
      const { data: existing } = await supabase
        .from('incidents')
        .select('id, status')
        .eq('id', incidentId)
        .maybeSingle();

      if (!existing) {
        return { success: false, error: 'Insiden tidak dijumpai atau anda tidak mempunyai kebenaran akses.' };
      }
      if (existing.status === 'confirmed') {
        return { success: false, error: 'Insiden telah pun disahkan (confirmed) sebelum ini.' };
      }
      return { success: false, error: `Insiden tidak boleh disahkan kerana status semasa adalah '${existing.status}'.` };
    }

    safeRevalidatePath('/management/incidents');
    safeRevalidatePath('/management/inbox');
    return { success: true, message: 'Insiden telah disahkan (confirmed) dan sedia untuk dipautkan.' };
  } catch (err: unknown) {
    return { success: false, error: (err as Error)?.message || 'Ralat pelayan' };
  }
}

/**
 * 5. Advance incident status (e.g. to in_maintenance, restored, closed)
 * Verifies that a row was actually changed.
 */
export async function advanceIncidentStatusAction(
  incidentId: string,
  newStatus: IncidentStatus,
  restorationEvidence?: string
): Promise<ManagementActionResult> {
  try {
    await requireManager();
    const supabase = await createServerSupabaseClient();

    const updatePayload: Record<string, unknown> = { status: newStatus };
    if (newStatus === 'restored') {
      if (!restorationEvidence || restorationEvidence.trim().length < 5) {
        return { success: false, error: 'Bukti pemulihan fizikal mandatori diperlukan untuk status restored.' };
      }
      updatePayload.restoration_evidence = restorationEvidence.trim();
    }

    const { data, error } = await supabase
      .from('incidents')
      .update(updatePayload)
      .eq('id', incidentId)
      .select('id, status');

    if (error) {
      return { success: false, error: `Gagal mengemas kini status insiden: ${error.message}` };
    }

    if (!data || data.length === 0) {
      const { data: existing } = await supabase
        .from('incidents')
        .select('id, status')
        .eq('id', incidentId)
        .maybeSingle();

      if (!existing) {
        return { success: false, error: 'Insiden tidak dijumpai atau anda tidak mempunyai kebenaran akses.' };
      }
      return { success: false, error: `Status insiden tidak berubah (status semasa kekal '${existing.status}').` };
    }

    safeRevalidatePath('/management/incidents');
    safeRevalidatePath('/resident');
    return { success: true, message: `Status insiden dikemas kini kepada ${newStatus}.` };
  } catch (err: unknown) {
    return { success: false, error: (err as Error)?.message || 'Ralat pelayan' };
  }
}

/**
 * 6. Link reviewed report to verified incident
 * Prevents false positives and returns clear error if duplicate or invalid.
 */
export async function linkReportToIncidentAction(
  incidentId: string,
  reportId: string
): Promise<ManagementActionResult> {
  try {
    await requireManager();
    const supabase = await createServerSupabaseClient();

    const { data, error } = await supabase
      .from('incident_report_links')
      .insert({
        incident_id: incidentId,
        report_id: reportId,
      })
      .select('id');

    if (error) {
      if (error.code === '23505') {
        return { success: false, error: 'Laporan ini telah pun dipautkan kepada insiden ini.' };
      }
      return { success: false, error: `Gagal memautkan laporan: ${error.message}` };
    }

    if (!data || data.length === 0) {
      return { success: false, error: 'Pautan laporan gagal disimpan.' };
    }

    safeRevalidatePath('/management/inbox');
    safeRevalidatePath('/management/incidents');
    return { success: true, message: 'Laporan berjaya dipautkan kepada insiden rasmi.' };
  } catch (err: unknown) {
    return { success: false, error: (err as Error)?.message || 'Ralat pelayan' };
  }
}

/**
 * 7. Publish official resident notice
 */
export async function publishNoticeAction(
  _prevState: ManagementActionResult | null,
  formData: FormData
): Promise<ManagementActionResult> {
  try {
    await requireManager();
    const supabase = await createServerSupabaseClient();

    const incidentId = (formData.get('incident_id') as string)?.trim();
    const updateTitle = (formData.get('update_title') as string)?.trim();
    const messageBm = (formData.get('message_bm') as string)?.trim();
    const stage = (formData.get('stage') as UpdateStage) || 'contractor_assigned';

    if (!incidentId || !updateTitle || updateTitle.length < 5 || !messageBm || messageBm.length < 10) {
      return {
        success: false,
        error: 'Sila lengkapkan tajuk notis (min 5 aksara) dan mesej rasmi (min 10 aksara).',
      };
    }

    const { data: update, error: updateError } = await supabase
      .from('incident_updates')
      .insert({
        incident_id: incidentId,
        update_title: updateTitle,
        message_bm: messageBm,
        stage,
        is_published: true,
      })
      .select('id')
      .single();

    if (updateError || !update) {
      return { success: false, error: `Gagal menerbitkan notis: ${updateError?.message || 'Ralat pangkalan data'}` };
    }

    safeRevalidatePath('/management/incidents');
    safeRevalidatePath('/resident');
    return { success: true, message: 'Notis rasmi berjaya diterbitkan kepada penduduk perumahan.' };
  } catch (err: unknown) {
    return { success: false, error: (err as Error)?.message || 'Ralat pelayan' };
  }
}
