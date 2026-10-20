'use client';

import React, { useActionState, useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Camera,
  Image as ImageIcon,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  X,
  Building2,
  RefreshCw,
  FileCheck2,
  Mic,
  PenLine,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import {
  submitResidentReport,
  getReportRecoveryStatusAction,
  type SubmitReportResult,
} from '@/app/actions/resident-report';
import type { FacilityCategory } from '@/types/database';
import { useTranslation } from '@/lib/i18n/LanguageContext';
import { GuidedVoiceAssistant } from '@/components/resident/GuidedVoiceAssistant';
import { GuidedFourStepFlow } from '@/components/resident/GuidedFourStepFlow';
import { VoiceCorrectionModal } from '@/components/resident/VoiceCorrectionModal';
import type { ReportDraftResult, ExistingDraftContext } from '@/app/actions/ai-draft';

export interface BuildingOption {
  id: string;
  name: string;
  code: string;
  total_floors?: number | null;
}

export interface ZoneOption {
  id: string;
  building_id?: string;
  zone_code: string;
  name: string;
  floor_start?: number | null;
  floor_end?: number | null;
}

export interface LaporFormProps {
  buildingName: string;
  assignedBuildingId?: string;
  buildings?: BuildingOption[];
  unitNumber: string | null;
  residentName?: string | null;
  zones: ZoneOption[];
  initialCategory?: FacilityCategory;
}

export function LaporForm({
  buildingName,
  assignedBuildingId,
  buildings = [],
  unitNumber,
  residentName,
  zones,
  initialCategory,
}: LaporFormProps) {
  const { t, locale, toggleLocale } = useTranslation();
  const [state, formAction, isPending] = useActionState(submitResidentReport, null);

  // Mode Selection: null (picker) | 'guided' | 'manual'
  const [activeEntryMode, setActiveEntryMode] = useState<'picker' | 'guided' | 'manual'>('picker');

  // Guided Voice Modal
  const [isVoiceAssistantOpen, setIsVoiceAssistantOpen] = useState(false);

  // Voice Correction Modal
  const [isVoiceCorrectionOpen, setIsVoiceCorrectionOpen] = useState(false);

  // Review step state: false (entry) vs true (direct review & edit screen)
  const [isReviewing, setIsReviewing] = useState(false);

  // Form Draft Data
  const defaultBuildingId = assignedBuildingId || (buildings.length > 0 ? buildings[0].id : '');
  const [selectedBuildingId, setSelectedBuildingId] = useState<string>(defaultBuildingId);
  const [selectedFloor, setSelectedFloor] = useState<string>('');
  const [category, setCategory] = useState<FacilityCategory>(
    initialCategory && ['water_supply', 'lift', 'corridor_lighting', 'other'].includes(initialCategory)
      ? initialCategory
      : 'water_supply'
  );
  const [description, setDescription] = useState('');
  const [selectedZone, setSelectedZone] = useState('');
  const [specificLocation, setSpecificLocation] = useState('');

  // Selected Photos
  const [selectedImages, setSelectedImages] = useState<Array<{ file: File; url: string }>>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [cameraNotice, setCameraNotice] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [correctionToast, setCorrectionToast] = useState<string | null>(null);
  const [aiDraftBadge, setAiDraftBadge] = useState<boolean>(false);

  // Latency Metrics
  const [metrics, setMetrics] = useState<{
    transcriptionMs?: number;
    draftMs?: number;
    correctionMs?: number;
  }>({});

  const files = selectedImages.map((img) => img.file);
  const selectedImagesRef = useRef(selectedImages);

  // Synchronize ref and cleanup object URLs
  useEffect(() => {
    selectedImagesRef.current = selectedImages;
  }, [selectedImages]);

  useEffect(() => {
    return () => {
      selectedImagesRef.current.forEach((img) => URL.revokeObjectURL(img.url));
    };
  }, []);

  // File Input Refs
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  // Client operation identity & durable session recovery
  const [clientReportId, setClientReportId] = useState<string>('');
  const [restoredReportId, setRestoredReportId] = useState<string | null>(null);
  const [reconcileResult, setReconcileResult] = useState<SubmitReportResult | null>(null);

  const activeReportId = state?.reportId || reconcileResult?.reportId || restoredReportId;

  // Retry state for partial failure on existing report
  const [retryFiles, setRetryFiles] = useState<File[]>([]);
  const [retryError, setRetryError] = useState<string | null>(null);

  // Initialize or restore client_report_id / active_report_id on client mount
  useEffect(() => {
    let mounted = true;
    try {
      const storedReportId =
        sessionStorage.getItem('ppr_active_report_id') ||
        sessionStorage.getItem('ppr_client_report_id');
      if (storedReportId) {
        getReportRecoveryStatusAction(storedReportId).then((status) => {
          if (mounted && status) {
            setRestoredReportId(storedReportId);
            setReconcileResult({
              success: true,
              reportSaved: true,
              reportId: status.reportId,
              attachmentsCount: status.attachmentsCount,
              awaitingRecovery: status.awaitingRecoveryPaths.length > 0,
              unregisteredPaths: status.awaitingRecoveryPaths,
              canRetry: status.canRetry,
              statusChanged: status.statusChanged,
            });
          }
        });
      }

      let storedClientId = sessionStorage.getItem('ppr_client_report_id');
      if (!storedClientId) {
        storedClientId =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : '';
        if (storedClientId) {
          sessionStorage.setItem('ppr_client_report_id', storedClientId);
        }
      }
      if (storedClientId) {
        queueMicrotask(() => {
          if (mounted) {
            setClientReportId(storedClientId);
          }
        });
      }
    } catch {
      // Ignore sessionStorage errors
    }
    return () => {
      mounted = false;
    };
  }, []);

  // Update session storage when a report ID is returned from action
  useEffect(() => {
    const reportId = state?.reportId || reconcileResult?.reportId;
    if (reportId) {
      try {
        sessionStorage.setItem('ppr_active_report_id', reportId);
      } catch {
        // Ignore
      }
    }
  }, [state?.reportId, reconcileResult?.reportId]);

  // Play success audio only AFTER confirmed save
  useEffect(() => {
    const reportId = state?.reportId || reconcileResult?.reportId;
    if (reportId && (state?.reportSaved || state?.success)) {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try {
          const text =
            locale === 'ms'
              ? 'Aduan anda sudah dihantar. Anda boleh semak perkembangannya dalam Aduan Saya.'
              : 'Your report has been submitted. You can track its progress in My Reports.';
          const utt = new SpeechSynthesisUtterance(text);
          utt.lang = locale === 'ms' ? 'ms-MY' : 'en-US';
          utt.rate = 0.95;
          window.speechSynthesis.speak(utt);
        } catch {
          // Ignore audio errors
        }
      }
    }
  }, [state?.reportId, state?.reportSaved, state?.success, reconcileResult?.reportId, locale]);

  // Active target building calculation
  const targetBuilding =
    buildings.find((b) => b.id === selectedBuildingId) ||
    buildings.find((b) => b.id === assignedBuildingId) ||
    buildings[0] || {
      id: assignedBuildingId || '',
      name: buildingName,
      code: 'BLKA',
      total_floors: 18,
    };

  // Filter service zones for currently selected building
  const availableBuildingZones = zones.filter((z) => !z.building_id || z.building_id === targetBuilding.id);

  // Floor Bounds Validation
  const maxFloor = typeof targetBuilding.total_floors === 'number' ? targetBuilding.total_floors : null;
  const numFloor = selectedFloor && selectedFloor !== 'G' && selectedFloor !== 'unknown' ? parseInt(selectedFloor, 10) : null;
  const isFloorOutOfBounds = maxFloor !== null && numFloor !== null && !isNaN(numFloor) && numFloor > maxFloor;

  // Photo handlers
  const validateAndAddFiles = (newFiles: File[]) => {
    setFileError(null);
    setCameraNotice(null);
    const availableSlots = 3 - selectedImages.length;
    if (availableSlots <= 0) {
      setFileError(t.reportForm.errMaxFiles);
      return;
    }

    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    const validToAdd: File[] = [];
    let errMessage: string | null = null;

    for (const f of newFiles) {
      if (validToAdd.length >= availableSlots) {
        errMessage = t.reportForm.errMaxFiles;
        break;
      }
      if (f.size > 5 * 1024 * 1024) {
        errMessage = t.reportForm.photoSizeLimitHint;
        continue;
      }
      if (!validTypes.includes(f.type)) {
        errMessage = t.reportForm.errFileMime;
        continue;
      }
      validToAdd.push(f);
    }

    if (errMessage) {
      setFileError(errMessage);
    }

    if (validToAdd.length > 0) {
      const itemsToAdd = validToAdd.map((file) => ({
        file,
        url: URL.createObjectURL(file),
      }));
      setSelectedImages((prev) => [...prev, ...itemsToAdd]);
    }
  };

  const handleCameraCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      if (e.target.files && e.target.files.length > 0) {
        validateAndAddFiles(Array.from(e.target.files));
        e.target.value = '';
      }
    } catch {
      setCameraNotice(t.reportForm.cameraDeniedNotice);
    }
  };

  const handleGallerySelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      validateAndAddFiles(Array.from(e.target.files));
      e.target.value = '';
    }
  };

  const removeFile = (index: number) => {
    setSelectedImages((prev) => {
      const target = prev[index];
      if (target) {
        URL.revokeObjectURL(target.url);
      }
      return prev.filter((_, i) => i !== index);
    });
    setFileError(null);
    if (cameraInputRef.current) cameraInputRef.current.value = '';
    if (galleryInputRef.current) galleryInputRef.current.value = '';
  };

  // Handle draft completed by Guided Voice Assistant
  const handleVoiceDraftReady = (
    draft: NonNullable<ReportDraftResult['draft']>,
    rawSpokenText: string,
    spokenMetrics: { transcriptionMs?: number; draftMs?: number; correctionMs?: number }
  ) => {
    setIsVoiceAssistantOpen(false);
    setAiDraftBadge(true);
    setMetrics(spokenMetrics);

    // Apply fields to form
    if (draft.category) setCategory(draft.category);
    if (draft.description) setDescription(draft.description);
    if (draft.buildingId) setSelectedBuildingId(draft.buildingId);
    if (draft.mentionedFloor !== null && draft.mentionedFloor !== undefined) {
      setSelectedFloor(String(draft.mentionedFloor));
    }
    if (draft.matchedZoneId) {
      setSelectedZone(draft.matchedZoneId);
    }

    // DIRECTLY open the review screen without any intermediate button!
    setIsReviewing(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Handle voice correction from review screen
  const handleApplyVoiceCorrection = (
    updatedDraft: NonNullable<ReportDraftResult['draft']>,
    summaryMessage: string,
    correctionElapsedMs: number
  ) => {
    setMetrics((prev) => ({ ...prev, correctionMs: correctionElapsedMs }));
    setCorrectionToast(summaryMessage);
    setTimeout(() => setCorrectionToast(null), 5000);

    // Update corrected fields, update description with new location, preserve photos!
    if (updatedDraft.mentionedFloor !== null && updatedDraft.mentionedFloor !== undefined) {
      setSelectedFloor(String(updatedDraft.mentionedFloor));
    }
    if (updatedDraft.buildingId) {
      setSelectedBuildingId(updatedDraft.buildingId);
    }
    if (updatedDraft.matchedZoneId) {
      setSelectedZone(updatedDraft.matchedZoneId);
    } else {
      setSelectedZone('');
    }
    if (updatedDraft.category) {
      setCategory(updatedDraft.category);
    }
    if (updatedDraft.description) {
      setDescription(updatedDraft.description);
    }
  };

  // Proceed to review from manual form
  const handleProceedManualToReview = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    if (!category) {
      setValidationError(t.reportForm.validationError);
      return;
    }
    if (description.trim().length < 10) {
      setValidationError(t.reportForm.validationError);
      return;
    }
    if (isFloorOutOfBounds) {
      setValidationError(
        locale === 'ms'
          ? `Tingkat ${selectedFloor} melebihi had tingkat bagi ${targetBuilding.name} (${maxFloor} tingkat).`
          : `Floor ${selectedFloor} exceeds floor limit for ${targetBuilding.name} (${maxFloor} floors).`
      );
      return;
    }

    if (!selectedZone && selectedFloor) {
      const fNum = parseInt(selectedFloor, 10);
      const matchedZone = availableBuildingZones.find(
        (z) => typeof z.floor_start === 'number' && typeof z.floor_end === 'number' && fNum >= z.floor_start && fNum <= z.floor_end
      );
      if (matchedZone) {
        setSelectedZone(matchedZone.id);
      }
    }

    setIsReviewing(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Submit Report (Final step)
  const handleSubmitReport = (formData: FormData) => {
    if (isPending) return;

    if (isFloorOutOfBounds) {
      setValidationError(
        locale === 'ms'
          ? `Tingkat ${selectedFloor} melebihi had tingkat bagi ${targetBuilding.name} (${maxFloor} tingkat).`
          : `Floor ${selectedFloor} exceeds floor limit for ${targetBuilding.name} (${maxFloor} floors).`
      );
      return;
    }

    formData.delete('photos');
    for (const file of files) {
      formData.append('photos', file, file.name);
    }
    if (clientReportId) {
      formData.set('client_report_id', clientReportId);
    }
    formData.set('category', category);
    formData.set('building_id', selectedBuildingId);
    formData.set('urgency_hint', 'medium'); // Resident NEVER chooses priority

    let effectiveZone = selectedZone;
    if (!effectiveZone && selectedFloor && selectedFloor !== 'G' && selectedFloor !== 'unknown') {
      const fNum = parseInt(selectedFloor, 10);
      if (!isNaN(fNum)) {
        const matchedZone = availableBuildingZones.find(
          (z) => typeof z.floor_start === 'number' && typeof z.floor_end === 'number' && fNum >= z.floor_start && fNum <= z.floor_end
        );
        if (matchedZone) {
          effectiveZone = matchedZone.id;
        }
      }
    }

    if (effectiveZone) {
      formData.set('service_zone_id', effectiveZone);
    } else {
      formData.delete('service_zone_id');
    }

    // Embed floor / specific location in description for auditability
    let finalDesc = description.trim();
    const locParts: string[] = [];
    if (selectedFloor) {
      if (selectedFloor === 'G') {
        locParts.push(locale === 'ms' ? 'Aras Bawah' : 'Ground Floor');
      } else if (selectedFloor === 'unknown') {
        locParts.push(locale === 'ms' ? 'Tingkat Belum Pasti' : 'Floor Uncertain');
      } else {
        locParts.push(locale === 'ms' ? `Tingkat ${selectedFloor}` : `Floor ${selectedFloor}`);
      }
    }
    if (specificLocation.trim()) {
      locParts.push(specificLocation.trim());
    }
    if (locParts.length > 0) {
      const locHeader = `[Lokasi: ${targetBuilding.name}, ${locParts.join(', ')}]`;
      if (!finalDesc.includes(locHeader) && finalDesc.length + locHeader.length + 2 <= 1000) {
        finalDesc = `${locHeader}\n${finalDesc}`;
      }
    }

    formData.set('description', finalDesc);
    formAction(formData);
  };

  // Post-submit: Start new report cleanly
  const handleStartNewReport = () => {
    try {
      sessionStorage.removeItem('ppr_active_report_id');
      const newClientId =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : '';
      if (newClientId) {
        sessionStorage.setItem('ppr_client_report_id', newClientId);
        setClientReportId(newClientId);
      }
    } catch {}

    setRestoredReportId(null);
    setReconcileResult(null);
    setDescription('');
    setSelectedFloor('');
    setSelectedZone('');
    setSpecificLocation('');
    selectedImages.forEach((img) => URL.revokeObjectURL(img.url));
    setSelectedImages([]);
    setRetryFiles([]);
    setIsReviewing(false);
    setActiveEntryMode('picker');
    setAiDraftBadge(false);
    window.location.reload();
  };

  // Post-submit: Add more photos to current submitted report
  const handleRetrySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const effectiveReportId = state?.reportId || activeReportId;
    if (!effectiveReportId || retryFiles.length === 0) return;

    const fd = new FormData();
    fd.append('report_id', effectiveReportId);
    for (const file of retryFiles) {
      fd.append('photos', file, file.name);
    }
    formAction(fd);
    setRetryFiles([]);
  };

  const handleRetryFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRetryError(null);
    if (!e.target.files) return;

    const newFiles = Array.from(e.target.files);
    const combined = [...retryFiles, ...newFiles];

    if (combined.length > remainingSlots) {
      setRetryError(`Hanya ${remainingSlots} fail dibenarkan untuk memenuhi had 3 gambar.`);
      return;
    }

    for (const f of newFiles) {
      if (f.size > 5 * 1024 * 1024) {
        setRetryError(`Fail "${f.name}" melebihi had 5 MB.`);
        return;
      }
    }

    setRetryFiles(combined.slice(0, remainingSlots));
    e.target.value = '';
  };

  const removeRetryFile = (index: number) => {
    setRetryFiles(retryFiles.filter((_, i) => i !== index));
    setRetryError(null);
  };

  const currentAttachments =
    reconcileResult?.attachmentsCount ?? state?.attachmentsCount ?? 0;
  const remainingSlots = Math.max(0, 3 - currentAttachments);

  const currentReportId = state?.reportId || activeReportId;
  const isReportSaved = Boolean(state?.reportSaved || state?.success || activeReportId);
  const isStatusChanged = Boolean(reconcileResult?.statusChanged ?? state?.statusChanged);

  // Category Labels

  const categoryLabels: Record<FacilityCategory, string> = {
    water_supply: t.reportForm.catWater,
    lift: t.reportForm.catLift,
    corridor_lighting: t.reportForm.catLighting,
    other: t.reportForm.catOther,
  };

  // ---------------------------------------------------------------------------
  // VIEW A: POST-SUBMISSION CONFIRMATION SCREEN
  // ---------------------------------------------------------------------------
  if (isReportSaved && currentReportId) {
    return (
      <div className="max-w-xl mx-auto space-y-6" data-testid="report-recovery-container">
        <Link
          href="/resident"
          className="inline-flex items-center gap-2 text-sm font-bold text-[#1554AD] hover:underline min-h-[44px]"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>{t.common.back}</span>
        </Link>

        <div className="bg-white rounded-3xl border-2 border-[#1554AD] p-6 sm:p-8 shadow-sm space-y-6">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-full bg-[#EBF3FC] text-[#1554AD] border-2 border-[#1554AD] flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-extrabold text-[#17212F]" data-testid="report-saved-heading">
                {t.reportForm.savedTitle}
              </h2>
              <p className="text-sm text-slate-600">
                {t.reportForm.savedSubtitle}
              </p>
            </div>
          </div>

          {/* Reference & Evidence Status Badges */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 flex items-center gap-3" data-testid="status-report-saved">
              <FileCheck2 className="w-5 h-5 text-[#1554AD] shrink-0" />
              <div>
                <span className="text-slate-500 block text-xs uppercase font-bold">
                  {t.reportForm.refNumberLabel}
                </span>
                <span className="font-mono font-bold text-slate-900 text-xs truncate block max-w-[200px]" data-testid="active-report-id">
                  {currentReportId}
                </span>
              </div>
            </div>

            <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 flex items-center gap-3" data-testid="status-evidence-attached">
              <CheckCircle2 className="w-5 h-5 text-[#1554AD] shrink-0" />
              <div>
                <span className="text-slate-500 block text-xs uppercase font-bold">
                  {t.reportForm.evidenceAttachedLabel}
                </span>
                <span className="font-bold text-slate-900 text-xs" data-testid="evidence-count-display">
                  {state?.countUnverified
                    ? t.reportForm.unverifiedEvidenceLabel
                    : `${currentAttachments} / 3 gambar`}
                </span>
              </div>
            </div>
          </div>

          {/* Post-Submit Option 1 & 2: Primary Actions */}
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <Link
              href="/resident/sejarah"
              className="flex-1 min-h-[50px] py-3 px-5 rounded-2xl font-bold text-sm bg-[#1554AD] text-white hover:bg-[#0E3E85] text-center transition-all flex items-center justify-center shadow-sm"
              data-testid="view-my-reports-button"
            >
              {t.reportForm.viewInHistoryBtn}
            </Link>
            <button
              type="button"
              onClick={handleStartNewReport}
              className="min-h-[50px] py-3 px-6 rounded-2xl font-bold text-sm border-2 border-slate-300 bg-white text-slate-800 hover:bg-slate-50 transition-all text-center cursor-pointer"
              data-testid="start-new-report-button"
            >
              {t.reportForm.newReportBtn}
            </button>
          </div>

          {/* Post-Submit Option 3: Distinct Section to Add Extra Photos to THIS Report */}
          {!isStatusChanged && remainingSlots > 0 && (
            <div className="pt-4 border-t border-slate-100">
              <form
                onSubmit={handleRetrySubmit}
                className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3"
                data-testid="retry-upload-section"
              >
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                    <Camera className="w-4 h-4 text-[#1554AD]" />
                    <span>{t.reportForm.retrySectionTitle} ({remainingSlots} slot baki)</span>
                  </p>
                </div>

                {retryError && <p className="text-xs text-red-600 font-semibold">{retryError}</p>}

                {retryFiles.length > 0 && (
                  <div className="space-y-1.5">
                    {retryFiles.map((file, idx) => (
                      <div key={idx} className="flex items-center justify-between p-2 bg-white border border-slate-200 rounded-xl text-xs">
                        <span className="truncate max-w-[260px] font-medium text-slate-800">
                          {file.name} ({(file.size / 1024).toFixed(0)} KB)
                        </span>
                        <button
                          type="button"
                          onClick={() => removeRetryFile(idx)}
                          className="text-slate-500 hover:text-red-600 p-1 min-h-[36px]"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {retryFiles.length < remainingSlots && (
                  <label className="border-2 border-dashed border-slate-300 rounded-xl p-3 text-center bg-white hover:bg-slate-100 cursor-pointer block transition-all min-h-[48px]">
                    <Camera className="w-5 h-5 text-[#1554AD] mx-auto mb-1" />
                    <p className="text-xs font-bold text-slate-800">{t.reportForm.retryBtn}</p>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      multiple
                      onChange={handleRetryFileChange}
                      className="hidden"
                      disabled={isPending}
                    />
                  </label>
                )}

                {retryFiles.length > 0 && (
                  <button
                    type="submit"
                    disabled={isPending}
                    className="w-full min-h-[44px] py-2.5 px-4 rounded-xl font-bold text-xs bg-[#1554AD] text-white hover:bg-[#0E3E85] transition-all flex items-center justify-center gap-2"
                  >
                    {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    <span>{t.reportForm.retryBtn}</span>
                  </button>
                )}
              </form>
            </div>
          )}

          {/* Next Steps Information (No false 24h SLA) */}
          <div className="p-4 rounded-2xl bg-blue-50/60 border border-blue-100 space-y-2">
            <h4 className="text-xs font-bold text-[#1554AD] uppercase tracking-wider">
              {t.reportForm.nextStepsTitle}
            </h4>
            <p className="text-xs text-slate-700 leading-relaxed">
              {t.reportForm.nextStep1}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // VIEW B: REVIEW & EDIT SCREEN (Directly opened after voice or manual)
  // ---------------------------------------------------------------------------
  if (isReviewing) {
    const existingDraftCtx: ExistingDraftContext = {
      description,
      category,
      buildingId: selectedBuildingId,
      mentionedBlock: targetBuilding.name,
      mentionedFloor: numFloor,
      matchedZoneId: selectedZone,
      specificLocation,
    };

    return (
      <div className="max-w-xl mx-auto space-y-5 pb-12">
        {/* Header Bar */}
        <header className="flex items-center justify-between pb-3 border-b border-slate-200">
          <button
            type="button"
            onClick={() => setIsReviewing(false)}
            className="inline-flex items-center gap-1.5 text-sm font-bold text-[#1554AD] hover:underline min-h-[44px]"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>{t.common.back}</span>
          </button>
          <button
            type="button"
            onClick={toggleLocale}
            className="border border-slate-200 bg-white rounded-full text-xs font-bold px-3 py-1.5 min-h-[40px] text-[#1554AD] hover:bg-slate-50 transition-all cursor-pointer"
          >
            {locale === 'ms' ? 'English' : 'BM'}
          </button>
        </header>

        {/* AI Draft Badge & Correction Toast */}
        {aiDraftBadge && (
          <div className="flex items-center gap-2.5 p-3.5 bg-blue-50 border border-blue-200 rounded-2xl text-xs text-[#1554AD] font-medium leading-relaxed">
            <Sparkles className="w-4 h-4 text-[#1554AD] shrink-0" />
            <span>{t.reportForm.reviewAiDraftNotice}</span>
          </div>
        )}

        {correctionToast && (
          <div className="flex items-center gap-2.5 p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-800 font-semibold animate-in fade-in duration-200">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{correctionToast}</span>
          </div>
        )}

        {/* Form Container */}
        <form action={handleSubmitReport} className="space-y-6 bg-white rounded-3xl border border-slate-200 p-5 sm:p-7 shadow-xs">
          {/* Title with Voice Correction Trigger Button */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div>
              <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
                {t.reportForm.reviewHeading}
              </h1>
              <p className="text-xs sm:text-sm text-slate-500">
                {t.reportForm.reviewSubtitle}
              </p>
            </div>

            {/* Feature 4: "Betulkan melalui suara" button */}
            <button
              type="button"
              onClick={() => setIsVoiceCorrectionOpen(true)}
              className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-amber-500/10 border border-amber-300 text-amber-800 text-xs sm:text-sm font-bold hover:bg-amber-500/20 active:scale-[0.98] transition-all min-h-[44px] cursor-pointer"
              data-testid="voice-correction-button"
            >
              <Mic className="w-4 h-4 text-amber-700" />
              <span>{t.reportForm.voiceCorrectionBtn}</span>
            </button>
          </div>

          {/* 1. Kategori Kerosakan (Single-click editable) */}
          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider">
              {t.reportForm.reviewCategoryLabel}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['water_supply', 'lift', 'corridor_lighting'] as FacilityCategory[]).map((cat) => {
                const isSelected = category === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    className={`p-3 rounded-2xl border text-center flex flex-col items-center justify-center gap-1 min-h-[64px] transition-all cursor-pointer ${
                      isSelected
                        ? 'border-[#1554AD] bg-[#1554AD] text-white shadow-xs font-bold'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 font-medium'
                    }`}
                  >
                    <span className="text-xs">{categoryLabels[cat]}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Lokasi: Blok Bangunan & Tingkat (Editable) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {/* Blok Dropdown */}
            <div>
              <label htmlFor="review-building" className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">
                Blok Bangunan
              </label>
              <select
                id="review-building"
                value={selectedBuildingId}
                onChange={(e) => {
                  setSelectedBuildingId(e.target.value);
                  setSelectedZone('');
                }}
                className="w-full p-3 rounded-xl border border-slate-300 text-sm font-bold text-slate-900 bg-white focus:outline-none focus:border-[#1554AD] min-h-[48px]"
              >
                {buildings.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.total_floors ? `${b.total_floors} tingkat` : '18 tingkat'})
                  </option>
                ))}
              </select>
            </div>

            {/* Tingkat (Number Input with bounds check) */}
            <div>
              <label htmlFor="review-floor" className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">
                Nombor Tingkat
              </label>
              <input
                id="review-floor"
                type="number"
                min="1"
                max={maxFloor || 18}
                value={selectedFloor}
                onChange={(e) => {
                  setSelectedFloor(e.target.value);
                  setValidationError(null);
                }}
                placeholder="Cth: 17 atau 1 (Bawah)"
                className="w-full p-3 rounded-xl border border-slate-300 text-sm font-bold text-slate-900 bg-white focus:outline-none focus:border-[#1554AD] min-h-[48px]"
              />
            </div>
          </div>

          {/* Floor Warning Notice (e.g. Blok L floor 16 rejected) */}
          {isFloorOutOfBounds && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                {locale === 'ms'
                  ? `${targetBuilding.name} hanya mempunyai ${maxFloor} tingkat. Sila masukkan nombor tingkat yang betul.`
                  : `${targetBuilding.name} only has ${maxFloor} floors. Please enter a valid floor number.`}
              </span>
            </div>
          )}

          {/* Zon Perkhidmatan (Optional / Auto-matching) */}
          {availableBuildingZones.length > 0 && (
            <div>
              <label htmlFor="review-zone" className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">
                {t.reportForm.reviewZoneLabel}
              </label>
              <select
                id="review-zone"
                value={selectedZone}
                onChange={(e) => setSelectedZone(e.target.value)}
                className="w-full p-3 rounded-xl border border-slate-300 text-sm text-slate-800 bg-white focus:outline-none focus:border-[#1554AD] min-h-[48px]"
              >
                <option value="">{t.reportForm.allZonesOption}</option>
                {availableBuildingZones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name} ({z.zone_code})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* 3. Keterangan Masalah (Directly Editable Textarea) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="review-desc" className="block text-xs font-bold text-slate-600 uppercase tracking-wider">
                {t.reportForm.reviewDescLabel}
              </label>
              <span className="text-xs text-slate-400 font-mono">{description.length}/1000</span>
            </div>
            <textarea
              id="review-desc"
              rows={4}
              maxLength={1000}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setValidationError(null);
              }}
              placeholder={t.reportForm.descPlaceholder}
              className="w-full p-3.5 rounded-2xl border border-slate-300 text-base text-slate-900 bg-white focus:outline-none focus:border-[#1554AD] min-h-[100px] leading-relaxed"
            />
          </div>

          {/* 4. Bukti Gambar (In the same review flow!) */}
          <div className="space-y-3 pt-2 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider">
                {t.reportForm.reviewPhotosLabel} ({selectedImages.length}/3)
              </label>
            </div>

            {/* Hidden Camera Input */}
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleCameraCapture}
              className="hidden"
              disabled={isPending}
            />

            {/* Hidden Gallery Input */}
            <input
              ref={galleryInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={handleGallerySelect}
              className="hidden"
              disabled={isPending}
            />

            {/* Camera & Gallery Buttons */}
            {selectedImages.length < 3 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="min-h-[50px] p-3 rounded-2xl border-2 border-dashed border-[#1554AD]/40 bg-[#1554AD]/5 hover:bg-[#1554AD]/10 active:scale-[0.99] text-[#1554AD] font-bold text-sm flex items-center justify-center gap-2.5 transition-all cursor-pointer"
                >
                  <Camera className="w-5 h-5 text-[#1554AD]" />
                  <span>{t.reportForm.takePhotoBtn}</span>
                </button>

                <button
                  type="button"
                  onClick={() => galleryInputRef.current?.click()}
                  className="min-h-[50px] p-3 rounded-2xl border border-slate-300 bg-slate-50 hover:bg-slate-100 active:scale-[0.99] text-slate-700 font-bold text-sm flex items-center justify-center gap-2.5 transition-all cursor-pointer"
                >
                  <ImageIcon className="w-5 h-5 text-slate-500" />
                  <span>{t.reportForm.chooseGalleryBtn}</span>
                </button>
              </div>
            )}

            {/* Camera denied notice */}
            {cameraNotice && (
              <p className="text-xs text-amber-800 bg-amber-50 p-2.5 rounded-xl border border-amber-200">
                {cameraNotice}
              </p>
            )}

            {/* File error */}
            {fileError && (
              <p className="text-xs text-red-600 bg-red-50 p-2.5 rounded-xl border border-red-200">
                {fileError}
              </p>
            )}

            {/* Thumbnails Display */}
            {selectedImages.length > 0 && (
              <div className="flex gap-2.5 flex-wrap pt-1">
                {selectedImages.map((item, idx) => (
                  <div key={idx} className="w-24 bg-slate-50 border border-slate-200 rounded-2xl p-1.5 space-y-1.5 shrink-0 shadow-xs">
                    <div className="w-full h-20 rounded-xl overflow-hidden bg-slate-200">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={item.url} alt={`Bukti ${idx + 1}`} className="w-full h-full object-cover" />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeFile(idx)}
                      className="w-full min-h-[44px] bg-red-50 hover:bg-red-100 text-red-700 font-bold text-xs py-1 rounded-xl flex items-center justify-center gap-1 cursor-pointer"
                      aria-label={`${t.common.remove} ${item.file.name}`}
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>{t.common.remove}</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Validation Error Banner */}
          {validationError && (
            <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-xs font-bold text-red-700 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{validationError}</span>
            </div>
          )}

          {/* Performance Metrics (Transparently displayed) */}
          {(metrics.transcriptionMs || metrics.draftMs || metrics.correctionMs) && (
            <div className="text-[11px] text-slate-400 font-mono flex items-center gap-3 pt-1">
              {metrics.transcriptionMs !== undefined && <span>Transkripsi: {metrics.transcriptionMs}ms</span>}
              {metrics.draftMs !== undefined && <span>Draf AI: {metrics.draftMs}ms</span>}
              {metrics.correctionMs !== undefined && <span>Pembetulan: {metrics.correctionMs}ms</span>}
            </div>
          )}

          {/* Primary Submit Button: "Hantar Aduan" with Idempotency Guard */}
          <div className="pt-3">
            <button
              type="submit"
              disabled={isPending || isFloorOutOfBounds}
              className="w-full min-h-[54px] py-3.5 px-6 rounded-2xl font-bold text-base bg-[#1554AD] text-white hover:bg-[#0E3E85] active:scale-[0.99] transition-all flex items-center justify-center gap-2 shadow-md disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              data-testid="submit-report-button"
            >
              {isPending ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>{t.reportForm.submittingBtn}</span>
                </>
              ) : (
                <>
                  <span>{t.reportForm.submitBtn}</span>
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
            <p className="text-xs text-slate-500 text-center mt-2">
              {locale === 'ms'
                ? 'Laporan akan disemak oleh pihak pengurusan untuk tindakan sewajarnya.'
                : 'Reports will be reviewed by management for appropriate action.'}
            </p>
          </div>
        </form>

        {/* Voice Correction Modal */}
        <VoiceCorrectionModal
          isOpen={isVoiceCorrectionOpen}
          onClose={() => setIsVoiceCorrectionOpen(false)}
          existingDraft={existingDraftCtx}
          onApplyCorrection={handleApplyVoiceCorrection}
        />
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // VIEW B2: 4-STEP GUIDED WORKFLOW (Lokasi -> Masalah -> Bukti -> Semak)
  // ---------------------------------------------------------------------------
  if (activeEntryMode === 'guided') {
    return (
      <GuidedFourStepFlow
        buildings={buildings}
        assignedBuildingId={assignedBuildingId}
        assignedBuildingName={targetBuilding.name}
        unitNumber={unitNumber}
        residentName={residentName || ''}
        selectedBuildingId={selectedBuildingId}
        setSelectedBuildingId={setSelectedBuildingId}
        selectedFloor={selectedFloor}
        setSelectedFloor={setSelectedFloor}
        category={category}
        setCategory={setCategory}
        description={description}
        setDescription={setDescription}
        specificLocation={specificLocation}
        setSpecificLocation={setSpecificLocation}
        selectedImages={selectedImages}
        onAddImages={validateAndAddFiles}
        onRemoveImage={removeFile}
        onSubmit={() => {
          const fd = new FormData();
          handleSubmitReport(fd);
        }}
        isSubmitting={isPending}
        validationError={validationError || (state && !state.success ? (state.error ?? null) : null)}
        setValidationError={setValidationError}
        onSwitchToManual={() => setActiveEntryMode('manual')}
        onBackToStart={() => setActiveEntryMode('picker')}
      />
    );
  }

  // ---------------------------------------------------------------------------
  // VIEW C: START SCREEN (2 Simple Entry Modes: Aduan Berpandu / Taip Sendiri)
  // ---------------------------------------------------------------------------
  return (
    <div className="max-w-xl mx-auto space-y-6 pb-12">
      {/* Eyebrow & Title */}
      <div>
        <span className="text-[11px] font-extrabold tracking-widest text-[#1554AD] uppercase block mb-1">
          {t.reportForm.eyebrowNewReport}
        </span>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight leading-tight">
          {t.reportForm.pageTitle}
        </h1>
        <p className="text-sm sm:text-base text-slate-600 mt-1 leading-relaxed">
          {t.reportForm.pageSubtitle}
        </p>
      </div>

      {/* Resident Location Banner (Dynamic Real Session Data) */}
      <div className="flex items-center gap-3.5 p-3.5 rounded-2xl bg-[#F0F5FC] border border-[#C8DCF5] text-slate-700">
        <div className="w-10 h-10 rounded-xl bg-white border border-[#C8DCF5] text-[#1554AD] flex items-center justify-center shrink-0 shadow-xs">
          <Building2 className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <strong className="text-sm font-extrabold text-slate-900 block truncate">
            {residentName || 'Penduduk'}
          </strong>
          <span className="text-xs text-slate-600 block truncate">
            PPR Desa Rejang · {targetBuilding.name} · {unitNumber ? `Rumah ${unitNumber}` : 'Blok Kediaman'}
          </span>
        </div>
      </div>

      {/* 2 Primary Action Buttons: Aduan Berpandu & Taip Sendiri */}
      <div className="flex flex-col gap-3">
        {/* Button 1: Aduan Berpandu */}
        <button
          type="button"
          onClick={() => setActiveEntryMode('guided')}
          className="w-full min-h-[58px] px-5 py-3 rounded-2xl bg-[#1554AD] text-white font-bold text-base flex items-center justify-between shadow-xs hover:bg-[#0E3E85] active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-[#1554AD] focus-visible:outline-offset-2 transition-all cursor-pointer"
          data-testid="start-guided-flow-button"
        >
          <div className="flex items-center gap-3 text-left">
            <Mic className="w-5 h-5 text-white shrink-0 stroke-[2.2]" />
            <div>
              <div className="text-base font-extrabold leading-tight">{t.reportForm.startVoiceBtn}</div>
              <div className="text-xs font-normal text-blue-100">{t.reportForm.startVoiceDesc}</div>
            </div>
          </div>
          <ArrowRight className="w-5 h-5 text-white/80 shrink-0" />
        </button>

        {/* Button 2: Taip Sendiri */}
        <button
          type="button"
          onClick={() => setActiveEntryMode('manual')}
          className={`w-full min-h-[58px] px-5 py-3 rounded-2xl border-1.5 font-bold text-base flex items-center justify-between active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-[#1554AD] focus-visible:outline-offset-2 transition-all cursor-pointer ${
            activeEntryMode === 'manual'
              ? 'bg-blue-50/50 border-[#1554AD] text-[#1554AD]'
              : 'bg-white border-slate-300 text-slate-800 hover:bg-slate-50 hover:border-slate-400'
          }`}
          data-testid="start-manual-form-button"
        >
          <div className="flex items-center gap-3 text-left">
            <PenLine className="w-5 h-5 text-slate-600 shrink-0 stroke-[1.8]" />
            <div>
              <div className="text-base font-extrabold text-slate-900 leading-tight">{t.reportForm.startManualBtn}</div>
              <div className="text-xs font-normal text-slate-500">{t.reportForm.startManualDesc}</div>
            </div>
          </div>
          <ArrowRight className="w-5 h-5 text-slate-400 shrink-0" />
        </button>
      </div>

      {/* Subtle Process Flow Note */}
      <div className="text-xs text-center text-slate-500 pt-2 border-t border-slate-100">
        {t.reportForm.processFlowNote}
      </div>

      {/* Manual Input Form (Expands when Taip Sendiri is active) */}
      {activeEntryMode === 'manual' && (
        <form onSubmit={handleProceedManualToReview} className="space-y-5 bg-white rounded-3xl border border-slate-200 p-5 sm:p-7 shadow-xs animate-in fade-in duration-200">
          <h3 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-2">
            {t.reportForm.step1Name}
          </h3>

          {/* Kategori */}
          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider">
              {t.reportForm.stepCategory}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['water_supply', 'lift', 'corridor_lighting', 'other'] as FacilityCategory[]).map((cat) => {
                const isSelected = category === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    className={`p-3 rounded-2xl border text-center flex flex-col items-center justify-center gap-1 min-h-[64px] transition-all cursor-pointer ${
                      isSelected
                        ? 'border-[#1554AD] bg-[#1554AD] text-white shadow-xs font-bold'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 font-medium'
                    }`}
                  >
                    <span className="text-xs">{categoryLabels[cat]}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Blok & Tingkat */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label htmlFor="manual-building" className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">
                Blok Bangunan
              </label>
              <select
                id="manual-building"
                value={selectedBuildingId}
                onChange={(e) => {
                  setSelectedBuildingId(e.target.value);
                  setSelectedZone('');
                }}
                className="w-full p-3 rounded-xl border border-slate-300 text-sm font-bold text-slate-900 bg-white focus:outline-none focus:border-[#1554AD] min-h-[48px]"
              >
                {buildings.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.total_floors ? `${b.total_floors} tingkat` : '18 tingkat'})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="manual-floor" className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">
                Nombor Tingkat
              </label>
              <input
                id="manual-floor"
                type="number"
                min="1"
                max={maxFloor || 18}
                value={selectedFloor}
                onChange={(e) => {
                  const val = e.target.value;
                  setSelectedFloor(val);
                  const fNum = parseInt(val, 10);
                  const matchedZone = availableBuildingZones.find(
                    (z) => typeof z.floor_start === 'number' && typeof z.floor_end === 'number' && fNum >= z.floor_start && fNum <= z.floor_end
                  );
                  if (matchedZone) {
                    setSelectedZone(matchedZone.id);
                  }
                }}
                placeholder="Cth: 17 atau 1"
                className="w-full p-3 rounded-xl border border-slate-300 text-sm font-bold text-slate-900 bg-white focus:outline-none focus:border-[#1554AD] min-h-[48px]"
              />
            </div>
          </div>

          {/* Floor Bounds Notice */}
          {isFloorOutOfBounds && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                {locale === 'ms'
                  ? `${targetBuilding.name} hanya mempunyai ${maxFloor} tingkat.`
                  : `${targetBuilding.name} only has ${maxFloor} floors.`}
              </span>
            </div>
          )}

          {/* Keterangan */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="manual-desc" className="block text-xs font-bold text-slate-600 uppercase tracking-wider">
                {t.reportForm.stepDescription}
              </label>
              <span className="text-xs text-slate-400 font-mono">{description.length}/1000</span>
            </div>
            <textarea
              id="manual-desc"
              rows={4}
              maxLength={1000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t.reportForm.descPlaceholder}
              className="w-full p-3.5 rounded-2xl border border-slate-300 text-base text-slate-900 bg-white focus:outline-none focus:border-[#1554AD] min-h-[100px] leading-relaxed"
              required
            />
          </div>

          {/* Validation Error */}
          {validationError && (
            <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-xs font-bold text-red-700 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{validationError}</span>
            </div>
          )}

          {/* Button to proceed to review */}
          <button
            type="submit"
            disabled={isFloorOutOfBounds}
            className="w-full min-h-[52px] py-3 px-6 rounded-2xl font-bold text-base bg-[#1554AD] text-white hover:bg-[#0E3E85] active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md disabled:opacity-50"
            data-testid="manual-proceed-review-button"
          >
            <span>{t.reportForm.reviewBtn}</span>
            <ArrowRight className="w-5 h-5" />
          </button>
        </form>
      )}

      {/* Guided Turn-Based Voice Assistant Modal */}
      <GuidedVoiceAssistant
        isOpen={isVoiceAssistantOpen}
        onClose={() => setIsVoiceAssistantOpen(false)}
        onDraftReady={handleVoiceDraftReady}
        onSwitchToManual={(transcriptText?: string) => {
          setIsVoiceAssistantOpen(false);
          setActiveEntryMode('manual');
          if (transcriptText) {
            setDescription(transcriptText);
          }
        }}
        assignedBuildingName={targetBuilding.name}
      />
    </div>
  );
}
