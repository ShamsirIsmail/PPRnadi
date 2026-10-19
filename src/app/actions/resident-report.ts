'use server';

import crypto from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { createServerSupabaseClient } from '../../lib/supabase/server';
import { requireResident } from '../../lib/auth/session';
import { validateImageSignature } from '../../lib/validators/image-signature';
import type { FacilityCategory, UrgencyHint } from '../../types/database';

export interface SubmitReportResult {
  success: boolean;
  reportId?: string;
  reportSaved?: boolean;
  attachmentsCount?: number;
  countUnverified?: boolean;
  uploadErrors?: string[];
  awaitingRecovery?: boolean;
  unregisteredPaths?: string[];
  error?: string;
  canRetry?: boolean;
  statusChanged?: boolean;
}


export interface ReportRecoveryStatus {
  reportId: string;
  reportSaved: boolean;
  status: string;
  attachmentsCount: number;
  registeredPaths: string[];
  awaitingRecoveryPaths: string[];
  canRetry: boolean;
  statusChanged: boolean;
}

const ALLOWED_CATEGORIES: FacilityCategory[] = ['water_supply', 'lift', 'corridor_lighting'];
const ALLOWED_URGENCIES: UrgencyHint[] = ['low', 'medium', 'high', 'urgent'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

/**
 * Submits a new resident incident report or retries evidence submission
 * on an existing report with full duplicate protection and failure recovery.
 */
export async function submitResidentReport(
  _prevState: SubmitReportResult | null,
  formData: FormData
): Promise<SubmitReportResult> {
  let activeReportId: string | undefined = undefined;

  try {
    const { user, profile } = await requireResident();
    const supabase = await createServerSupabaseClient();

    const existingReportId = (formData.get('report_id') as string)?.trim() || null;
    const clientReportId = (formData.get('client_report_id') as string)?.trim() || null;

    let reportId: string;
    let currentAttachmentsCount = 0;

    const rawPhotos = formData.getAll('photos') as File[];
    const validPhotos = rawPhotos.filter((f) => f && typeof f.size === 'number' && f.size > 0);

    // -------------------------------------------------------------------------
    // 1. UNIFIED REPORT RESOLUTION & ACCESS ENFORCEMENT
    // -------------------------------------------------------------------------
    const targetReportId = existingReportId || clientReportId;

    if (targetReportId) {
      const { data: existingReport, error: repError } = await supabase
        .from('incident_reports')
        .select('id, reporter_id, status')
        .eq('id', targetReportId)
        .maybeSingle();

      if (repError) {
        return { success: false, error: `Gagal menyemak status laporan: ${repError.message}` };
      }

      if (existingReport) {
        // Enforce ownership
        if (existingReport.reporter_id !== user.id) {
          return {
            success: false,
            error: 'Anda tidak dibenarkan mengubah suai atau menambah bukti pada laporan milik penduduk lain.',
          };
        }

        reportId = existingReport.id;
        activeReportId = reportId;

        // Enforce status constraint: Only 'submitted' reports accept new evidence
        if (existingReport.status !== 'submitted') {
          return {
            success: false,
            reportId,
            reportSaved: true,
            statusChanged: true,
            canRetry: false,
            error: `Status laporan telah berubah kepada '${existingReport.status}'. Penambahan atau pemulihan bukti tidak lagi dibenarkan kerana tindakan pengurusan telah dimulakan.`,
          };
        }
      } else {
        // Not found in database
        if (existingReportId) {
          // Explicit report_id provided but report does not exist
          return {
            success: false,
            error: 'Laporan tidak dijumpai atau anda tidak dibenarkan mengakses laporan ini.',
          };
        }

        // client_report_id provided: insert new report with this client-generated UUID
        if (validPhotos.length > 3) {
          return { success: false, error: 'Maksimum 3 keping gambar sahaja dibenarkan.' };
        }
        const insertRes = await insertNewReport(supabase, user.id, profile.assigned_building_id, profile.assigned_estate_id, formData, clientReportId);
        if (!insertRes.success) {
          // Reconcile possible duplicate-key race condition from concurrent request
          const { data: racedReport } = await supabase
            .from('incident_reports')
            .select('id, reporter_id, status')
            .eq('id', clientReportId)
            .maybeSingle();

          if (racedReport && racedReport.reporter_id === user.id) {
            reportId = racedReport.id;
            activeReportId = reportId;
            if (racedReport.status !== 'submitted') {
              return {
                success: false,
                reportId,
                reportSaved: true,
                statusChanged: true,
                canRetry: false,
                error: `Status laporan telah berubah kepada '${racedReport.status}'. Penambahan atau pemulihan bukti tidak lagi dibenarkan kerana tindakan pengurusan telah dimulakan.`,
              };
            }
          } else {
            return insertRes;
          }
        } else {
          reportId = insertRes.reportId!;
          activeReportId = reportId;
        }
      }
    } else {
      // No report ID supplied -> Generate and insert fresh report
      if (validPhotos.length > 3) {
        return { success: false, error: 'Maksimum 3 keping gambar sahaja dibenarkan.' };
      }
      const insertRes = await insertNewReport(supabase, user.id, profile.assigned_building_id, profile.assigned_estate_id, formData, null);
      if (!insertRes.success) return insertRes;
      reportId = insertRes.reportId!;
      activeReportId = reportId;
    }

    // -------------------------------------------------------------------------
    // 2. EVIDENCE DEDUPLICATION & VALIDATION (BEFORE SLOT CALCULATION)
    // -------------------------------------------------------------------------
    const { data: existingAttachments, error: attFetchError } = await supabase
      .from('report_attachments')
      .select('storage_path, file_name, file_size_bytes')
      .eq('report_id', reportId);

    if (attFetchError) {
      return {
        success: false,
        reportId,
        reportSaved: true,
        countUnverified: true,
        canRetry: true,
        error: `Gagal menyemak lampiran sedia ada: ${attFetchError.message}`,
      };
    }

    const registeredPathsSet = new Set((existingAttachments || []).map((a) => a.storage_path));
    currentAttachmentsCount = existingAttachments?.length ?? 0;

    const uploadErrors: string[] = [];

    interface CandidatePhoto {
      file: File;
      buffer: Buffer;
      label: string;
      safeFilename: string;
      storagePath: string;
      mimeType: string;
    }

    const newCandidatesToUpload: CandidatePhoto[] = [];
    const batchCandidatePaths = new Set<string>();

    for (let i = 0; i < validPhotos.length; i++) {
      const photo = validPhotos[i];
      const photoLabel = photo.name || `Gambar ${i + 1}`;

      // Check size limit (5 MB)
      if (photo.size > MAX_FILE_SIZE) {
        uploadErrors.push(
          `Fail "${photoLabel}" (${(photo.size / (1024 * 1024)).toFixed(2)} MB): Melebihi had maksimum 5 MB.`
        );
        continue;
      }

      let buffer: Buffer;
      try {
        const arrayBuf = await photo.arrayBuffer();
        buffer = Buffer.from(arrayBuf);
      } catch {
        uploadErrors.push(`Fail "${photoLabel}": Gagal membaca data fail dari pelayar.`);
        continue;
      }

      // Validate authentic image binary magic bytes
      const sig = validateImageSignature(buffer);
      if (!sig) {
        uploadErrors.push(
          `Fail "${photoLabel}": Format fail tidak disokong atau binari rosak. Hanya gambar JPEG, PNG, dan WebP dibenarkan.`
        );
        continue;
      }

      // Compute deterministic content-hashed path
      const contentHash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
      const rawBase = photo.name ? photo.name.replace(/\.[^.]+$/, '') : `photo_${i + 1}`;
      const cleanBase = rawBase.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 24) || `photo_${i + 1}`;
      const safeFilename = `${cleanBase}_${contentHash}.${sig.extension}`;
      const storagePath = `${user.id}/${reportId}/${safeFilename}`;

      // Deduplication check 1: Is this exact evidence already registered in DB?
      if (registeredPathsSet.has(storagePath)) {
        // Already registered! Requires zero new slots.
        continue;
      }

      // Deduplication check 2: Is this exact evidence repeated within the same batch?
      if (batchCandidatePaths.has(storagePath)) {
        // Repeated photo candidate in same submitted batch! Skip redundant candidate.
        continue;
      }
      batchCandidatePaths.add(storagePath);

      newCandidatesToUpload.push({
        file: photo,
        buffer,
        label: photoLabel,
        safeFilename,
        storagePath,
        mimeType: sig.mimeType,
      });
    }

    // Query authoritative count from database state before evaluating quota
    const { count: currentDbCount, error: preCountErr } = await supabase
      .from('report_attachments')
      .select('*', { count: 'exact', head: true })
      .eq('report_id', reportId);

    if (preCountErr) {
      return {
        success: false,
        reportId,
        reportSaved: true,
        countUnverified: true,
        canRetry: true,
        error: `Gagal mengesahkan bilangan lampiran sedia ada: ${preCountErr.message}`,
      };
    }
    currentAttachmentsCount = currentDbCount ?? currentAttachmentsCount;

    // Calculate slots needed after deduplication
    const newSlotsNeeded = newCandidatesToUpload.length;

    // Check if new photos exceed authoritative 3-slot capacity
    if (currentAttachmentsCount + newSlotsNeeded > 3) {
      return {
        success: false,
        reportId,
        reportSaved: true,
        attachmentsCount: currentAttachmentsCount,
        uploadErrors: uploadErrors.length > 0 ? uploadErrors : undefined,
        canRetry: currentAttachmentsCount < 3,
        error: `Penambahan bukti melebihi had maksimum 3 gambar (${currentAttachmentsCount} sedia ada, ${newSlotsNeeded} baharu diperlukan).`,
      };
    }

    // If no new candidates to upload (repeating completed request or all photos already registered)
    if (newSlotsNeeded === 0 && validPhotos.length > 0 && uploadErrors.length === 0) {
      return {
        success: true,
        reportSaved: true,
        reportId,
        attachmentsCount: currentAttachmentsCount,
        canRetry: false,
      };
    }

    // -------------------------------------------------------------------------
    // 3. STORAGE UPLOAD & METADATA REGISTRATION FOR NEW CANDIDATES
    // -------------------------------------------------------------------------
    const folderPath = `${user.id}/${reportId}`;
    const { data: storageList } = await supabase.storage
      .from('incident-evidence')
      .list(folderPath);
    const existingStorageFilenames = new Set((storageList || []).map((f) => f.name));

    const unregisteredPaths: string[] = [];
    let hasAwaitingRecovery = false;

    for (const candidate of newCandidatesToUpload) {
      let objectInStorage = existingStorageFilenames.has(candidate.safeFilename);

      // Step A: Upload to Storage if not already present
      if (!objectInStorage) {
        const { error: storageError } = await supabase.storage
          .from('incident-evidence')
          .upload(candidate.storagePath, candidate.buffer, {
            contentType: candidate.mimeType,
            upsert: false,
          });

        if (storageError) {
          // Reconcile: If upload reports an existing-object conflict or network collision,
          // re-query Storage with user's authenticated session to check if exact matching file exists.
          let verifiedInStorage = false;
          const { data: dlBlob, error: dlError } = await supabase.storage
            .from('incident-evidence')
            .download(candidate.storagePath);

          if (!dlError && dlBlob) {
            try {
              const dlBuf = Buffer.from(await dlBlob.arrayBuffer());
              if (dlBuf.equals(candidate.buffer)) {
                // Exactly matching completed upload! Recognize as success.
                verifiedInStorage = true;
              }
            } catch {
              verifiedInStorage = false;
            }
          }

          if (verifiedInStorage) {
            objectInStorage = true;
            existingStorageFilenames.add(candidate.safeFilename);
          } else {
            // Unrelated authorization, validation, or real upload failure -> do not treat as success
            uploadErrors.push(`Fail "${candidate.label}": Muat naik storan gagal (${storageError.message}).`);
            continue;
          }
        } else {
          objectInStorage = true;
          existingStorageFilenames.add(candidate.safeFilename);
        }
      }

      // Step B: Register attachment in report_attachments
      // First, re-query DB to check if another concurrent request or earlier attempt already committed it
      const { data: existingRow } = await supabase
        .from('report_attachments')
        .select('id, storage_path, file_name, mime_type, file_size_bytes')
        .eq('report_id', reportId)
        .eq('storage_path', candidate.storagePath)
        .maybeSingle();

      if (
        existingRow &&
        existingRow.storage_path === candidate.storagePath &&
        existingRow.file_name === candidate.safeFilename &&
        existingRow.mime_type === candidate.mimeType &&
        Number(existingRow.file_size_bytes) === candidate.buffer.length
      ) {
        // Matching completed operation already in database! Recognize as success.
        registeredPathsSet.add(candidate.storagePath);
        continue;
      }

      // Attempt metadata insertion
      const { error: attError } = await supabase
        .from('report_attachments')
        .insert({
          report_id: reportId,
          storage_path: candidate.storagePath,
          file_name: candidate.safeFilename,
          mime_type: candidate.mimeType,
          file_size_bytes: candidate.buffer.length,
        });

      if (attError) {
        // Reconcile: Did another concurrent worker commit this attachment in the meantime?
        let verifiedCommitted = false;
        const { data: checkRow } = await supabase
          .from('report_attachments')
          .select('id, storage_path, file_name, mime_type, file_size_bytes')
          .eq('report_id', reportId)
          .eq('storage_path', candidate.storagePath)
          .maybeSingle();

        if (
          checkRow &&
          checkRow.storage_path === candidate.storagePath &&
          checkRow.file_name === candidate.safeFilename &&
          checkRow.mime_type === candidate.mimeType &&
          Number(checkRow.file_size_bytes) === candidate.buffer.length
        ) {
          verifiedCommitted = true;
        }

        if (verifiedCommitted) {
          registeredPathsSet.add(candidate.storagePath);
        } else {
          // Verify if report status changed (e.g. management reviewed report)
          const { data: repStatusCheck } = await supabase
            .from('incident_reports')
            .select('status')
            .eq('id', reportId)
            .single();

          if (repStatusCheck && repStatusCheck.status !== 'submitted') {
            uploadErrors.push(
              `Status laporan telah beralih kepada '${repStatusCheck.status}'. Pendaftaran bukti ditolak oleh pengurusan.`
            );
          } else {
            uploadErrors.push(
              `Fail "${candidate.label}": Muat naik berjaya tetapi pendaftaran metadata gagal (${attError.message}). Sila klik 'Pulihkan Bukti' untuk mendaftar.`
            );
            unregisteredPaths.push(candidate.storagePath);
            hasAwaitingRecovery = true;
          }
          continue;
        }
      } else {
        registeredPathsSet.add(candidate.storagePath);
      }
    }

    try {
      revalidatePath('/resident/sejarah');
      revalidatePath('/management/inbox');
    } catch {
      // Invariant: static generation store missing outside active Next request context
    }

    // Query authoritative database count from verified state
    const { count: finalDbCount, error: finalCountErr } = await supabase
      .from('report_attachments')
      .select('*', { count: 'exact', head: true })
      .eq('report_id', reportId);

    if (finalCountErr || typeof finalDbCount !== 'number') {
      return {
        success: false,
        reportSaved: true,
        reportId,
        countUnverified: true,
        canRetry: true,
        error: `Bukti berjaya diproses tetapi pengesahan jumlah lampiran dari pangkalan data gagal (${finalCountErr?.message || 'data tidak dijumpai'}). Sila muat semula halaman untuk menyemak status terkini.`,
      };
    }

    const totalAttachments = finalDbCount;

    return {
      success: true,
      reportSaved: true,
      reportId,
      attachmentsCount: totalAttachments,
      uploadErrors: uploadErrors.length > 0 ? uploadErrors : undefined,
      awaitingRecovery: hasAwaitingRecovery,
      unregisteredPaths: unregisteredPaths.length > 0 ? unregisteredPaths : undefined,
      canRetry: (uploadErrors.length > 0 || hasAwaitingRecovery) && totalAttachments < 3,
    };
  } catch (err: unknown) {
    const msg = (err as Error)?.message || 'Ralat tidak diketahui';
    if (activeReportId) {
      try {
        const supabase = await createServerSupabaseClient();
        const { data: rep } = await supabase
          .from('incident_reports')
          .select('id, status')
          .eq('id', activeReportId)
          .maybeSingle();

        const { count: finalCount } = await supabase
          .from('report_attachments')
          .select('*', { count: 'exact', head: true })
          .eq('report_id', activeReportId);

        return {
          success: false,
          reportSaved: Boolean(rep),
          reportId: activeReportId,
          attachmentsCount: finalCount ?? undefined,
          statusChanged: rep ? rep.status !== 'submitted' : undefined,
          canRetry: rep ? rep.status === 'submitted' && (finalCount ?? 0) < 3 : true,
          error: msg,
        };
      } catch {
        // Fall back to basic response if state check fails
      }
    }

    return {
      success: false,
      reportSaved: Boolean(activeReportId),
      reportId: activeReportId,
      canRetry: Boolean(activeReportId),
      error: msg,
    };
  }
}

/**
 * Reconciles evidence objects already present in Storage but whose
 * database metadata registration failed or was interrupted.
 * Operates without requiring the client to re-upload files.
 */
export async function reconcilePendingEvidenceAction(reportId: string): Promise<SubmitReportResult> {
  try {
    const { user } = await requireResident();
    const supabase = await createServerSupabaseClient();

    // 1. Validate report ownership and current status
    const { data: report, error: repError } = await supabase
      .from('incident_reports')
      .select('id, reporter_id, status')
      .eq('id', reportId)
      .single();

    if (repError || !report) {
      return { success: false, error: 'Laporan tidak dijumpai atau anda tidak mempunyai kebenaran akses.' };
    }

    if (report.reporter_id !== user.id) {
      return { success: false, error: 'Anda tidak dibenarkan memulihkan bukti milik laporan penduduk lain.' };
    }

    if (report.status !== 'submitted') {
      return {
        success: false,
        reportId,
        reportSaved: true,
        statusChanged: true,
        canRetry: false,
        error: `Status laporan telah berubah kepada '${report.status}'. Pemulihan bukti tidak lagi dibenarkan kerana tindakan pengurusan telah dimulakan.`,
      };
    }

    // 2. Fetch existing registered attachments in DB
    const { data: registeredAttachments, error: attError } = await supabase
      .from('report_attachments')
      .select('storage_path, file_name')
      .eq('report_id', reportId);

    if (attError) {
      return { success: false, reportId, reportSaved: true, error: `Gagal menyemak lampiran: ${attError.message}` };
    }

    const registeredPathsSet = new Set((registeredAttachments || []).map((a) => a.storage_path));
    const currentCount = registeredAttachments?.length ?? 0;

    if (currentCount >= 3) {
      return {
        success: true,
        reportId,
        reportSaved: true,
        attachmentsCount: 3,
        canRetry: false,
      };
    }

    // 3. List objects in Storage folder for this report
    const folderPath = `${user.id}/${reportId}`;
    const { data: storageObjects, error: storageError } = await supabase.storage
      .from('incident-evidence')
      .list(folderPath);

    if (storageError) {
      return { success: false, reportId, reportSaved: true, error: `Gagal mengakses storan bukti: ${storageError.message}` };
    }

    const unregisteredObjects = (storageObjects || []).filter(
      (obj) => !registeredPathsSet.has(`${folderPath}/${obj.name}`)
    );

    if (unregisteredObjects.length === 0) {
      return {
        success: true,
        reportId,
        reportSaved: true,
        attachmentsCount: currentCount,
        awaitingRecovery: false,
        canRetry: false,
      };
    }

    // 4. Register unregistered objects into report_attachments
    let newlyReconciled = 0;
    const errors: string[] = [];

    for (const obj of unregisteredObjects) {
      if (currentCount + newlyReconciled >= 3) {
        errors.push(`Had maksimum 3 gambar telah dicapai. Fail "${obj.name}" tidak dapat didaftarkan.`);
        break;
      }

      const storagePath = `${folderPath}/${obj.name}`;

      // Check safe filename pattern
      if (!/^[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$/i.test(obj.name)) {
        errors.push(`Fail "${obj.name}": Nama fail tidak sah atau tidak mematuhi piawaian keselamatan.`);
        continue;
      }

      // Retrieve object using authenticated resident's authorized client (no service-role)
      const { data: blob, error: dlError } = await supabase.storage
        .from('incident-evidence')
        .download(storagePath);

      if (dlError || !blob) {
        errors.push(`Fail "${obj.name}": Gagal membaca fail dari storan (${dlError?.message || 'Objek tidak dijumpai'}).`);
        continue;
      }

      let buffer: Buffer;
      try {
        const arrayBuf = await blob.arrayBuffer();
        buffer = Buffer.from(arrayBuf);
      } catch {
        errors.push(`Fail "${obj.name}": Gagal memproses data binari fail.`);
        continue;
      }

      // Enforce actual byte-size limit
      if (buffer.length > MAX_FILE_SIZE) {
        errors.push(`Fail "${obj.name}": Saiz fail (${(buffer.length / (1024 * 1024)).toFixed(2)} MB) melebihi had 5 MB.`);
        continue;
      }

      if (buffer.length === 0) {
        errors.push(`Fail "${obj.name}": Fail kosong tidak sah.`);
        continue;
      }

      // Validate authentic image binary magic bytes (rejects fake images)
      const sig = validateImageSignature(buffer);
      if (!sig) {
        errors.push(`Fail "${obj.name}": Format fail tidak sah atau binari imej rosak. Pendaftaran ditolak.`);
        continue;
      }

      const { error: insertError } = await supabase
        .from('report_attachments')
        .insert({
          report_id: reportId,
          storage_path: storagePath,
          file_name: obj.name,
          mime_type: sig.mimeType,
          file_size_bytes: buffer.length,
        });

      if (insertError) {
        // Reconcile: Did another concurrent worker commit this attachment in the meantime?
        let verifiedCommitted = false;
        const { data: checkRow } = await supabase
          .from('report_attachments')
          .select('id, storage_path, file_name, mime_type, file_size_bytes')
          .eq('report_id', reportId)
          .eq('storage_path', storagePath)
          .maybeSingle();

        if (
          checkRow &&
          checkRow.storage_path === storagePath &&
          checkRow.file_name === obj.name &&
          checkRow.mime_type === sig.mimeType &&
          Number(checkRow.file_size_bytes) === buffer.length
        ) {
          verifiedCommitted = true;
        }

        if (verifiedCommitted) {
          registeredPathsSet.add(storagePath);
        } else {
          errors.push(`Gagal memulihkan fail "${obj.name}": ${insertError.message}`);
        }
      } else {
        newlyReconciled++;
        registeredPathsSet.add(storagePath);
      }
    }

    try {
      revalidatePath('/resident/sejarah');
      revalidatePath('/management/inbox');
    } catch {
      // Invariant: static generation store missing outside active Next request context
    }

    // Query authoritative database count from verified state
    const { count: finalDbCount, error: finalCountErr } = await supabase
      .from('report_attachments')
      .select('*', { count: 'exact', head: true })
      .eq('report_id', reportId);

    if (finalCountErr || typeof finalDbCount !== 'number') {
      return {
        success: false,
        reportId,
        reportSaved: true,
        countUnverified: true,
        canRetry: true,
        error: `Pemulihan selesai tetapi pengesahan jumlah lampiran dari pangkalan data gagal (${finalCountErr?.message || 'data tidak dijumpai'}). Sila muat semula halaman untuk menyemak status terkini.`,
      };
    }

    const verifiedCount = finalDbCount;
    const hasRemainingUnregistered = unregisteredObjects.some(
      (o) => !registeredPathsSet.has(`${folderPath}/${o.name}`)
    );

    return {
      success: true,
      reportId,
      reportSaved: true,
      attachmentsCount: verifiedCount,
      uploadErrors: errors.length > 0 ? errors : undefined,
      awaitingRecovery: hasRemainingUnregistered,
      canRetry: hasRemainingUnregistered && verifiedCount < 3,
    };
  } catch (err: unknown) {
    const msg = (err as Error)?.message || 'Ralat semasa pemulihan bukti';
    return { success: false, reportId, reportSaved: true, error: msg };
  }
}

/**
 * Retrieves the durable recovery status of an active report.
 */
export async function getReportRecoveryStatusAction(reportId: string): Promise<ReportRecoveryStatus | null> {
  try {
    const { user } = await requireResident();
    const supabase = await createServerSupabaseClient();

    const { data: report } = await supabase
      .from('incident_reports')
      .select('id, reporter_id, status')
      .eq('id', reportId)
      .single();

    if (!report || report.reporter_id !== user.id) return null;

    const { data: attachments } = await supabase
      .from('report_attachments')
      .select('storage_path')
      .eq('report_id', reportId);

    const registeredPaths = (attachments || []).map((a) => a.storage_path);
    const registeredSet = new Set(registeredPaths);

    // List storage folder
    const { data: storageObjects } = await supabase.storage
      .from('incident-evidence')
      .list(`${user.id}/${reportId}`);

    const awaitingRecoveryPaths: string[] = [];
    if (storageObjects) {
      for (const obj of storageObjects) {
        const fullPath = `${user.id}/${reportId}/${obj.name}`;
        if (!registeredSet.has(fullPath)) {
          awaitingRecoveryPaths.push(fullPath);
        }
      }
    }

    const isSubmitted = report.status === 'submitted';
    const canRetry = isSubmitted && registeredPaths.length < 3 && awaitingRecoveryPaths.length > 0;

    return {
      reportId: report.id,
      reportSaved: true,
      status: report.status,
      attachmentsCount: registeredPaths.length,
      registeredPaths,
      awaitingRecoveryPaths,
      canRetry,
      statusChanged: !isSubmitted,
    };
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// Internal Helper: Insert New Report
// -----------------------------------------------------------------------------
async function insertNewReport(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
  assignedBuildingId: string | null,
  assignedEstateId: string | null,
  formData: FormData,
  customReportId: string | null
): Promise<{ success: boolean; reportId?: string; error?: string }> {
  // 1. Resolve Target Building (defaults to assigned building, supports any building in estate)
  let targetBuildingId = assignedBuildingId;
  const rawBuildingId = (formData.get('building_id') as string)?.trim();
  if (rawBuildingId && rawBuildingId !== assignedBuildingId) {
    const { data: bldg } = await supabase
      .from('buildings')
      .select('id, estate_id')
      .eq('id', rawBuildingId)
      .maybeSingle();
    if (bldg && assignedEstateId && bldg.estate_id === assignedEstateId) {
      targetBuildingId = bldg.id;
    }
  }

  // 2. Validate Category
  const category = formData.get('category') as FacilityCategory;
  if (!ALLOWED_CATEGORIES.includes(category)) {
    return { success: false, error: 'Kategori kerosakan tidak sah. Sila pilih kategori yang betul.' };
  }

  // 3. Validate Description
  const description = (formData.get('description') as string)?.trim();
  if (!description || description.length < 10) {
    return { success: false, error: 'Penerangan kerosakan mestilah sekurang-kurangnya 10 aksara.' };
  }

  // 4. Validate Urgency
  const rawUrgency = (formData.get('urgency_hint') as UrgencyHint) || 'medium';
  const urgencyHint = ALLOWED_URGENCIES.includes(rawUrgency) ? rawUrgency : 'medium';

  // 5. Validate Service Zone (Optional)
  const rawZoneId = formData.get('service_zone_id') as string | null;
  let serviceZoneId: string | null = null;
  if (rawZoneId && rawZoneId.trim() !== '') {
    serviceZoneId = rawZoneId.trim();
    const { data: zone, error: zoneError } = await supabase
      .from('service_zones')
      .select('id, building_id')
      .eq('id', serviceZoneId)
      .single();

    if (zoneError || !zone || (targetBuildingId && zone.building_id !== targetBuildingId)) {
      return { success: false, error: 'Zon perkhidmatan yang dipilih tidak sepadan dengan blok terpilih.' };
    }
  }

  // 6. Insert new report (with deterministic customReportId if supplied)
  const insertPayload: Record<string, unknown> = {
    reporter_id: userId,
    building_id: targetBuildingId,
    service_zone_id: serviceZoneId,
    category,
    description,
    status: 'submitted',
    urgency_hint: urgencyHint,
  };
  if (customReportId) {
    insertPayload.id = customReportId;
  }

  const { data: report, error: reportError } = await supabase
    .from('incident_reports')
    .insert(insertPayload)
    .select('id')
    .single();

  if (reportError || !report) {
    // If conflict on customReportId, query existing
    if (customReportId && reportError?.code === '23505') {
      const { data: existing } = await supabase
        .from('incident_reports')
        .select('id, reporter_id')
        .eq('id', customReportId)
        .single();
      if (existing && existing.reporter_id === userId) {
        return { success: true, reportId: existing.id };
      }
    }
    return { success: false, error: `Gagal mencipta laporan: ${reportError?.message || 'Ralat pangkalan data'}` };
  }

  return { success: true, reportId: report.id };
}
