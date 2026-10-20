'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Image as ImageIcon,
  Check,
  AlertTriangle,
  Loader2,
  Droplets,
  ArrowUpDown,
  Lightbulb,
  MoreHorizontal,
  Volume2,
  Bell,
  BellOff,
  Plus,
  Minus,
  Mic,
  ShieldAlert,
} from 'lucide-react';
import type { FacilityCategory } from '@/types/database';
import { useTranslation } from '@/lib/i18n/LanguageContext';
import {
  SUB_ISSUE_OPTIONS,
  getSubIssueLabel,
  isEmergencySubIssue,
  buildDeterministicSummary,
  formatLocationText,
  type GuidedSubmitPayload,
  type SubIssueId,
} from '@/lib/report/report-summary';

export interface BuildingOption {
  id: string;
  name: string;
  code: string;
  total_floors?: number | null;
}

export interface GuidedFourStepFlowProps {
  buildings: BuildingOption[];
  assignedBuildingId?: string;
  assignedBuildingName?: string;
  unitNumber?: string | null;
  residentName?: string | null;
  selectedBuildingId: string;
  setSelectedBuildingId: (id: string) => void;
  selectedFloor: string;
  setSelectedFloor: (f: string) => void;
  category: FacilityCategory;
  setCategory: (cat: FacilityCategory) => void;
  description: string;
  setDescription: (d: string) => void;
  specificLocation: string;
  setSpecificLocation: (loc: string) => void;
  selectedImages: Array<{ file: File; url: string }>;
  onAddImages: (files: File[]) => void;
  onRemoveImage: (index: number) => void;
  onSubmit: (payload: GuidedSubmitPayload) => void;
  isSubmitting: boolean;
  validationError: string | null;
  setValidationError: (err: string | null) => void;
  onSwitchToManual: () => void;
  onBackToStart: () => void;
  initialStep?: number;
}

// Audio Guidance Scripts (Bilingual)
const AUDIO_SCRIPTS: Record<number, { ms: string; en: string }> = {
  0: {
    ms: 'Hai, saya NADI. Kita buat aduan satu demi satu. Pilih lokasi masalah dahulu, ya.',
    en: 'Hi, I am NADI. Let us make this report step by step. First, choose the location of the problem.',
  },
  1: {
    ms: 'Baik. Pilih masalah yang anda mahu laporkan.',
    en: 'Great. Now choose the issue you want to report.',
  },
  2: {
    ms: 'Kalau ada gambar, boleh tambah di sini. Boleh juga langkau.',
    en: 'If you have photos, you can add them here. You can also skip.',
  },
  3: {
    ms: 'Semak aduan anda dahulu, ya. Jika betul, tekan hantar.',
    en: 'Please review your report first. If everything is correct, press submit.',
  },
};

export function GuidedFourStepFlow({
  buildings,
  assignedBuildingId,
  assignedBuildingName,
  unitNumber: _unitNumber,
  residentName: _residentName,
  selectedBuildingId,
  setSelectedBuildingId,
  selectedFloor,
  setSelectedFloor,
  category,
  setCategory,
  description,
  setDescription,
  specificLocation,
  setSpecificLocation,
  selectedImages,
  onAddImages,
  onRemoveImage,
  onSubmit,
  isSubmitting,
  validationError,
  setValidationError: _setValidationError,
  onSwitchToManual,
  onBackToStart,
  initialStep = 0,
}: GuidedFourStepFlowProps) {
  const { locale, toggleLocale } = useTranslation();

  // 4 Steps: 0: Lokasi, 1: Masalah, 2: Bukti, 3: Semak
  const [step, setStep] = useState<number>(initialStep);
  const [isEditing, setIsEditing] = useState<boolean>(false);

  // Sub-issue detail (Progressive Disclosure)
  const [subIssue, setSubIssue] = useState<SubIssueId | ''>('');
  const [extraText, setExtraText] = useState<string>('');
  const [extraOpen, setExtraOpen] = useState<boolean>(false);
  const [voiceDemoOpen, setVoiceDemoOpen] = useState<boolean>(false);
  const [stepError, setStepError] = useState<string | null>(null);

  // Audio Guidance Controller State
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState<boolean>(false);

  // Hidden File Inputs for Camera & Gallery
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  // Resolve current active building
  const currentBuilding = buildings.find((b) => b.id === selectedBuildingId) || buildings[0] || {
    id: assignedBuildingId || '',
    name: assignedBuildingName || 'Blok A',
    code: 'DR_BLK_A',
    total_floors: 18,
  };

  const maxFloors = currentBuilding.total_floors || 18;

  // Step names
  const stepNames = locale === 'ms'
    ? ['Lokasi', 'Masalah', 'Bukti', 'Semak']
    : ['Location', 'Problem', 'Evidence', 'Review'];

  // Stop any active speech synthesis
  const stopAudio = () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setIsPlayingAudio(false);
  };

  // Play audio guidance for current step manually
  const playStepAudio = (targetStep: number = step, force: boolean = false) => {
    if (isMuted && !force) return;
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    try {
      window.speechSynthesis.cancel();
      const script = AUDIO_SCRIPTS[targetStep]?.[locale] || '';
      if (!script) return;

      const utterance = new SpeechSynthesisUtterance(script);
      utterance.lang = locale === 'ms' ? 'ms-MY' : 'en-US';
      utterance.rate = 0.95;

      utterance.onstart = () => setIsPlayingAudio(true);
      utterance.onend = () => setIsPlayingAudio(false);
      utterance.onerror = () => setIsPlayingAudio(false);

      window.speechSynthesis.speak(utterance);
    } catch {
      setIsPlayingAudio(false);
    }
  };

  // Play audio when entering a step
  useEffect(() => {
    if (isMuted) return;
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    const script = AUDIO_SCRIPTS[step]?.[locale] || '';
    if (!script) return;

    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(script);
      utterance.lang = locale === 'ms' ? 'ms-MY' : 'en-US';
      utterance.rate = 0.95;

      utterance.onstart = () => setIsPlayingAudio(true);
      utterance.onend = () => setIsPlayingAudio(false);
      utterance.onerror = () => setIsPlayingAudio(false);

      window.speechSynthesis.speak(utterance);
    } catch {
      // Ignore
    }

    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [step, locale, isMuted]);

  // Helper: Format Location String
  const getLocationText = () => {
    return formatLocationText(currentBuilding.name, selectedFloor, locale);
  };

  // Helper: Format Synthesized Deterministic Summary (NO AI, 100% factual)
  const getSynthesizedSummary = () => {
    return buildDeterministicSummary({
      buildingName: currentBuilding.name,
      floor: selectedFloor,
      specificLocation,
      category,
      subIssueId: subIssue || undefined,
      extraText: category === 'other' ? (extraText.trim() || description.trim()) : extraText.trim(),
      locale,
    });
  };

  // Block Selection with Dynamic Floor Bounds Clearing
  const handleSelectBlock = (bId: string) => {
    const targetB = buildings.find((b) => b.id === bId);
    if (!targetB) return;

    setSelectedBuildingId(bId);
    setStepError(null);

    const targetMax = targetB.total_floors || 18;
    if (selectedFloor && selectedFloor !== 'G' && selectedFloor !== 'unknown') {
      const fNum = parseInt(selectedFloor, 10);
      if (!isNaN(fNum) && fNum > targetMax) {
        setSelectedFloor('');
        setStepError(
          locale === 'ms'
            ? `Tingkat ${fNum} tidak tersedia di ${targetB.name} (had ${targetMax} tingkat). Sila pilih tingkat semula.`
            : `Floor ${fNum} is not available in ${targetB.name} (limit ${targetMax} floors). Please select a floor again.`
        );
      }
    }
  };

  // Validate before step navigation
  const handleNextStep = () => {
    setStepError(null);

    if (step === 0) {
      if (!selectedFloor) {
        setStepError(
          locale === 'ms'
            ? 'Pilih tingkat atau “Tidak pasti” dahulu, ya.'
            : 'Please select a floor or “Unsure” first.'
        );
        return;
      }
      if (isEditing) {
        setIsEditing(false);
        setStep(3);
      } else {
        setStep(1);
      }
    } else if (step === 1) {
      if (category === 'other') {
        const textVal = extraText.trim() || description.trim();
        if (textVal.length < 5) {
          setStepError(
            locale === 'ms'
              ? 'Ceritakan masalah dalam beberapa perkataan (minimum 5 aksara), ya.'
              : 'Please describe the problem in a few words (minimum 5 characters).'
          );
          return;
        }
        setDescription(textVal);
      } else if (!subIssue) {
        setStepError(
          locale === 'ms'
            ? 'Pilih keadaan masalah dahulu, ya.'
            : 'Please select the specific issue condition first.'
        );
        return;
      } else {
        // Embed deterministic summary in description
        setDescription(getSynthesizedSummary());
      }

      if (isEditing) {
        setIsEditing(false);
        setStep(3);
      } else {
        setStep(2);
      }
    } else if (step === 2) {
      if (isEditing) {
        setIsEditing(false);
        setStep(3);
      } else {
        setStep(3);
      }
    } else if (step === 3) {
      // Final Submit: construct direct payload from current draft state
      const finalSummary = getSynthesizedSummary();
      setDescription(finalSummary);
      onSubmit({
        buildingId: selectedBuildingId,
        floor: selectedFloor,
        category,
        subIssueId: subIssue || undefined,
        specificLocation: specificLocation.trim() || undefined,
        extraText: category === 'other' ? (extraText.trim() || description.trim()) : (extraText.trim() || undefined),
        description: finalSummary,
        files: selectedImages.map((img) => img.file),
      });
    }
  };

  const handleBack = () => {
    setStepError(null);
    if (isEditing) {
      setIsEditing(false);
      setStep(3);
      return;
    }
    if (step > 0) {
      setStep(step - 1);
    } else {
      onBackToStart();
    }
  };

  // Trigger Ubah to jump to step
  const handleEditSection = (targetStep: number) => {
    setIsEditing(true);
    setStep(targetStep);
  };

  // Real Camera & Gallery Handler
  const handleCameraChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onAddImages(Array.from(e.target.files));
      e.target.value = '';
    }
  };

  const handleGalleryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onAddImages(Array.from(e.target.files));
      e.target.value = '';
    }
  };

  const isTrappedInLift = isEmergencySubIssue(category, subIssue);

  return (
    <div className="max-w-xl mx-auto space-y-5 pb-16">
      {/* Hidden File Inputs */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleCameraChange}
        className="hidden"
        disabled={isSubmitting}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        onChange={handleGalleryChange}
        className="hidden"
        disabled={isSubmitting}
      />

      {/* Top Header Row with Progress and Bilingual Switch */}
      <header className="flex items-center justify-between pb-2 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleBack}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-[#1554AD] hover:underline min-h-[40px] cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>{locale === 'ms' ? 'Kembali' : 'Back'}</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleLocale}
            className="border border-slate-200 bg-white rounded-full text-xs font-bold px-3 py-1.5 min-h-[38px] text-[#1554AD] hover:bg-slate-50 transition-all cursor-pointer"
          >
            {locale === 'ms' ? 'English' : 'B. Melayu'}
          </button>
          <button
            type="button"
            onClick={onSwitchToManual}
            className="text-xs text-slate-500 font-bold hover:text-slate-800 underline px-2 min-h-[38px] cursor-pointer"
          >
            {locale === 'ms' ? 'Taip Sendiri' : 'Type Manually'}
          </button>
        </div>
      </header>

      {/* Progress Bars (4 steps) */}
      <div className="space-y-1.5">
        <div className="flex gap-2 h-1.5">
          {stepNames.map((_, i) => (
            <div
              key={i}
              className={`flex-1 rounded-full transition-all duration-300 ${
                i <= step ? 'bg-[#1554AD]' : 'bg-slate-200'
              }`}
            />
          ))}
        </div>
        <div className="flex justify-between items-center text-xs text-slate-500 font-semibold">
          <span>
            {locale === 'ms' ? 'Langkah' : 'Step'} {step + 1} {locale === 'ms' ? 'daripada' : 'of'} 4
          </span>
          <span className="font-bold text-[#1554AD]">{stepNames[step]}</span>
        </div>
      </div>

      {/* NADI Audio Guidance WhatsApp-Style Message Bubble */}
      <div className="relative pl-11 pr-3 py-3.5 bg-[#EDF4FF] border border-[#E0EAFA] rounded-2xl rounded-tl-xs text-slate-800 text-sm leading-relaxed shadow-2xs">
        {/* N Avatar */}
        <div className="absolute -left-1 top-0 w-8 h-8 rounded-full bg-[#1554AD] text-white font-extrabold text-xs flex items-center justify-center shadow-xs ring-4 ring-white">
          N
        </div>

        {/* Bubble Title and Audio Script */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <strong className="block text-xs font-bold text-[#1554AD] tracking-wider mb-0.5">
              NADI
            </strong>
            <p className="text-sm font-semibold text-slate-800">
              {AUDIO_SCRIPTS[step]?.[locale]}
            </p>
          </div>

          {/* Audio Controls */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => playStepAudio(step, true)}
              className="p-1.5 rounded-lg bg-white/80 border border-[#CBDCF5] text-[#1554AD] hover:bg-white text-xs font-bold flex items-center gap-1 cursor-pointer transition-all"
              title={locale === 'ms' ? 'Dengar atau ulang arahan' : 'Listen or replay audio'}
            >
              <Volume2 className={`w-3.5 h-3.5 ${isPlayingAudio ? 'animate-pulse text-[#1554AD]' : ''}`} />
              <span className="hidden sm:inline">{locale === 'ms' ? 'Ulang' : 'Replay'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (isMuted) {
                  setIsMuted(false);
                  playStepAudio(step, true);
                } else {
                  setIsMuted(true);
                  stopAudio();
                }
              }}
              className="p-1.5 rounded-lg bg-white/80 border border-[#CBDCF5] text-slate-600 hover:bg-white cursor-pointer transition-all"
              title={isMuted ? 'Buka audio' : 'Senyapkan audio'}
            >
              {isMuted ? <BellOff className="w-3.5 h-3.5 text-slate-400" /> : <Bell className="w-3.5 h-3.5 text-[#1554AD]" />}
            </button>
          </div>
        </div>

        <div className="text-[10px] text-right text-slate-400 mt-1">
          NADI · {locale === 'ms' ? 'Panduan langkah ini' : 'Step guidance'}
        </div>
      </div>

      {/* ----------------------------------------------------------------------
          STEP 0: LOKASI KEJADIAN
          ---------------------------------------------------------------------- */}
      {step === 0 && (
        <div className="space-y-5">
          <div>
            <h2 className="text-xl sm:text-2xl font-extrabold text-[#17212F] tracking-tight">
              {locale === 'ms' ? 'Di mana masalah berlaku?' : 'Where did the issue occur?'}
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 mt-1">
              {locale === 'ms'
                ? 'Pilih lokasi kejadian. Tak semestinya di rumah anda.'
                : 'Select the incident location. Does not have to be your own home.'}
            </p>
          </div>

          {/* Blok Selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-slate-700">
              <span>{locale === 'ms' ? 'Blok Kejadian' : 'Incident Block'}</span>
              <span className="text-[11px] font-normal text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                {locale === 'ms' ? `Rumah anda: ${assignedBuildingName || 'Blok A'}` : `Your unit: ${assignedBuildingName || 'Blok A'}`}
              </span>
            </div>

            <div className="grid grid-cols-6 gap-2">
              {buildings.map((b) => {
                const isSelected = b.id === selectedBuildingId;
                const shortName = b.name.replace(/Blok\s*/i, '');
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => handleSelectBlock(b.id)}
                    aria-pressed={isSelected}
                    className={`relative min-h-[48px] h-12 rounded-xl font-extrabold text-base transition-all cursor-pointer flex items-center justify-center ${
                      isSelected
                        ? 'bg-[#1554AD] text-white shadow-sm'
                        : 'bg-[#F9FBFE] border border-slate-200 text-slate-800 hover:bg-[#F0F5FD] hover:border-blue-300'
                    }`}
                  >
                    <span>{shortName}</span>
                    {isSelected && (
                      <span className="absolute top-1 right-1.5 text-[9px] font-mono leading-none">✓</span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="text-[11px] text-[#1554AD] font-semibold">
              {locale === 'ms'
                ? `Dipilih: ${currentBuilding.name} (${maxFloors} tingkat)`
                : `Selected: ${currentBuilding.name} (${maxFloors} floors)`}
            </div>
          </div>

          {/* Floor Selection */}
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between text-xs font-bold text-slate-700">
              <span>{locale === 'ms' ? `Tingkat di ${currentBuilding.name}` : `Floor in ${currentBuilding.name}`}</span>
              <span className="text-[11px] font-normal text-slate-500">
                1–{maxFloors}
              </span>
            </div>

            <div className="grid grid-cols-6 gap-2">
              {Array.from({ length: maxFloors }, (_, idx) => {
                const fStr = String(idx + 1);
                const isSelected = selectedFloor === fStr;
                return (
                  <button
                    key={fStr}
                    type="button"
                    onClick={() => {
                      setSelectedFloor(fStr);
                      setStepError(null);
                    }}
                    aria-pressed={isSelected}
                    className={`relative min-h-[48px] h-12 rounded-xl font-extrabold text-base transition-all cursor-pointer flex items-center justify-center ${
                      isSelected
                        ? 'bg-[#1554AD] text-white shadow-sm'
                        : 'bg-[#F9FBFE] border border-slate-200 text-slate-800 hover:bg-[#F0F5FD] hover:border-blue-300'
                    }`}
                  >
                    <span>{fStr}</span>
                    {isSelected && (
                      <span className="absolute top-1 right-1.5 text-[9px] font-mono leading-none">✓</span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Secondary: Aras Bawah & Tidak Pasti */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setSelectedFloor('G');
                  setStepError(null);
                }}
                aria-pressed={selectedFloor === 'G'}
                className={`min-h-[48px] py-2.5 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                  selectedFloor === 'G'
                    ? 'bg-[#EDF4FF] text-[#1554AD] border-2 border-[#1554AD]'
                    : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {selectedFloor === 'G' && <Check className="w-3.5 h-3.5" />}
                <span>{locale === 'ms' ? 'Aras bawah' : 'Ground floor'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setSelectedFloor('unknown');
                  setStepError(null);
                }}
                aria-pressed={selectedFloor === 'unknown'}
                className={`min-h-[48px] py-2.5 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                  selectedFloor === 'unknown'
                    ? 'bg-[#EDF4FF] text-[#1554AD] border-2 border-[#1554AD]'
                    : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {selectedFloor === 'unknown' && <Check className="w-3.5 h-3.5" />}
                <span>{locale === 'ms' ? 'Tidak pasti' : 'Unsure'}</span>
              </button>
            </div>
          </div>

          {/* Specific Location Input (Optional) */}
          <div className="space-y-1.5 pt-1">
            <label htmlFor="guided-specific-loc" className="block text-xs font-bold text-slate-700">
              {locale === 'ms' ? 'Lokasi khusus (Pilihan)' : 'Specific location (Optional)'}
            </label>
            <input
              id="guided-specific-loc"
              type="text"
              value={specificLocation}
              onChange={(e) => setSpecificLocation(e.target.value)}
              placeholder={locale === 'ms' ? 'Contoh: koridor depan lif, tangga blok' : 'E.g.: corridor near lift, stairs'}
              className="w-full h-12 px-3.5 rounded-xl border border-slate-300 text-sm font-medium text-slate-900 bg-white focus:outline-2 focus:outline-[#1554AD]"
            />
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------------------
          STEP 1: MASALAH KEJADIAN
          ---------------------------------------------------------------------- */}
      {step === 1 && (
        <div className="space-y-5">
          <div>
            <h2 className="text-xl sm:text-2xl font-extrabold text-[#17212F] tracking-tight">
              {locale === 'ms' ? 'Apa masalahnya?' : 'What is the issue?'}
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 mt-1 font-semibold">
              📍 {getLocationText()}
            </p>
          </div>

          {/* 4 Main Categories */}
          <div className="grid grid-cols-2 gap-2.5">
            {[
              { id: 'water_supply', label: locale === 'ms' ? 'Bekalan air' : 'Water supply', icon: Droplets },
              { id: 'lift', label: locale === 'ms' ? 'Lif' : 'Elevator', icon: ArrowUpDown },
              { id: 'corridor_lighting', label: locale === 'ms' ? 'Lampu koridor' : 'Corridor lighting', icon: Lightbulb },
              { id: 'other', label: locale === 'ms' ? 'Lain-lain' : 'Other issues', icon: MoreHorizontal },
            ].map((catItem) => {
              const Icon = catItem.icon;
              const isSelected = category === catItem.id;
              return (
                <button
                  key={catItem.id}
                  type="button"
                  onClick={() => {
                    setCategory(catItem.id as FacilityCategory);
                    setSubIssue('');
                    setStepError(null);
                  }}
                  aria-pressed={isSelected}
                  className={`min-h-[64px] p-3.5 rounded-2xl font-bold text-sm text-left flex items-center gap-3 transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-[#1554AD] text-white shadow-sm'
                      : 'bg-white border border-slate-200 text-slate-800 hover:bg-slate-50'
                  }`}
                >
                  <Icon className={`w-5 h-5 shrink-0 ${isSelected ? 'text-white' : 'text-[#1554AD]'}`} />
                  <span className="leading-tight">{catItem.label}</span>
                </button>
              );
            })}
          </div>

          {/* Sub-Issue Progressive Options (For standard categories) */}
          {category && category !== 'other' && SUB_ISSUE_OPTIONS[category]?.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <label className="block text-xs font-bold text-slate-700">
                {locale === 'ms' ? 'Keadaan masalah' : 'Specific condition'}
              </label>

              <div className="space-y-2">
                {SUB_ISSUE_OPTIONS[category].map((opt) => {
                  const isOptSelected = subIssue === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setSubIssue(opt.id);
                        setStepError(null);
                      }}
                      aria-pressed={isOptSelected}
                      className={`w-full min-h-[48px] py-3 px-4 rounded-xl font-semibold text-sm text-left flex items-center justify-between transition-all cursor-pointer ${
                        isOptSelected
                          ? 'bg-[#1554AD] text-white font-bold'
                          : 'bg-white border border-slate-200 text-slate-800 hover:bg-slate-50'
                      }`}
                    >
                      <span>{opt.label[locale]}</span>
                      <span className="text-base leading-none">
                        {isOptSelected ? '✓' : '○'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Safety Emergency Warning Banner (Ada Orang Terperangkap) */}
          {isTrappedInLift && (
            <div className="p-4 rounded-2xl bg-red-50 border-2 border-red-500 text-red-950 space-y-2">
              <div className="flex items-center gap-2 text-red-700 font-extrabold text-sm">
                <ShieldAlert className="w-5 h-5 shrink-0 text-red-600" />
                <span>{locale === 'ms' ? 'Utamakan keselamatan.' : 'Safety First.'}</span>
              </div>
              <p className="text-xs leading-relaxed text-red-900">
                {locale === 'ms'
                  ? 'Hubungi bantuan kecemasan (999) atau pihak pengurusan segera. Jangan cuba membuka pintu lif sendiri. Aduan aplikasi tidak menggantikan bantuan kecemasan.'
                  : 'Call emergency services (999) or management immediately. Do not attempt to force the elevator doors open yourself. Submitting this app report does not replace an emergency call.'}
              </p>
            </div>
          )}

          {/* Category 'other' Text Input */}
          {category === 'other' ? (
            <div className="space-y-1.5 pt-2 border-t border-slate-100">
              <label htmlFor="guided-other-desc" className="block text-xs font-bold text-slate-700">
                {locale === 'ms' ? 'Ceritakan masalah anda' : 'Describe your issue'}
              </label>
              <textarea
                id="guided-other-desc"
                rows={4}
                value={extraText || description}
                onChange={(e) => {
                  setExtraText(e.target.value);
                  setDescription(e.target.value);
                  setStepError(null);
                }}
                placeholder={
                  locale === 'ms'
                    ? 'Contoh: Pintu pagar keselamatan rosak dan tidak boleh ditutup rapat.'
                    : 'Example: Security gate is broken and cannot be closed properly.'
                }
                className="w-full p-3.5 rounded-2xl border border-slate-300 text-sm font-medium text-slate-900 bg-white focus:outline-2 focus:outline-[#1554AD] leading-relaxed"
              />
            </div>
          ) : (
            /* Optional Extra Info Toggle for standard categories */
            <div className="pt-2 border-t border-slate-100 space-y-3">
              <button
                type="button"
                onClick={() => setExtraOpen(!extraOpen)}
                className="text-xs font-bold text-[#1554AD] hover:underline flex items-center gap-1.5 cursor-pointer py-1"
              >
                {extraOpen ? <Minus className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                <span>
                  {extraOpen
                    ? (locale === 'ms' ? 'Sembunyikan maklumat tambahan' : 'Hide additional details')
                    : (locale === 'ms' ? 'Nak tambah maklumat? (Pilihan)' : 'Add extra details? (Optional)')}
                </span>
              </button>

              {extraOpen && (
                <div className="space-y-1.5">
                  <label htmlFor="guided-extra-desc" className="block text-xs font-bold text-slate-700">
                    {locale === 'ms' ? 'Maklumat tambahan' : 'Additional information'}
                  </label>
                  <textarea
                    id="guided-extra-desc"
                    rows={3}
                    value={extraText}
                    onChange={(e) => setExtraText(e.target.value)}
                    placeholder={
                      locale === 'ms'
                        ? 'Contoh: Di depan lif nombor 2, sejak semalam.'
                        : 'Example: In front of lift #2, since yesterday.'
                    }
                    className="w-full p-3 rounded-xl border border-slate-300 text-sm font-medium text-slate-900 bg-white focus:outline-2 focus:outline-[#1554AD]"
                  />
                </div>
              )}

              {/* Voice Alternative Test (Transparently in staging test mode) */}
              <div>
                <button
                  type="button"
                  onClick={() => setVoiceDemoOpen(!voiceDemoOpen)}
                  className="text-xs font-bold text-slate-500 hover:text-slate-800 flex items-center gap-1.5 cursor-pointer py-1"
                >
                  <Mic className="w-3.5 h-3.5 text-[#1554AD]" />
                  <span>
                    {locale === 'ms' ? 'Ujian tambah melalui suara' : 'Test adding via voice'}
                  </span>
                </button>

                {voiceDemoOpen && (
                  <div className="p-3.5 rounded-xl bg-blue-50/70 border border-blue-200 text-xs text-slate-700 space-y-2 mt-1">
                    <p>
                      {locale === 'ms'
                        ? 'Fasa Staging: Rakaman suara adalah mod ujian tanpa muat naik audio atau pemprosesan AI.'
                        : 'Staging Phase: Voice recording is test mode only with zero audio upload or AI processing.'}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        const sample = locale === 'ms' ? 'Sejak semalam selepas hujan lebat.' : 'Since yesterday after heavy rain.';
                        setExtraText(sample);
                        setExtraOpen(true);
                        setVoiceDemoOpen(false);
                      }}
                      className="px-3 py-1.5 bg-white border border-[#1554AD] text-[#1554AD] rounded-lg font-bold text-xs hover:bg-blue-50 cursor-pointer"
                    >
                      {locale === 'ms' ? 'Gunakan teks contoh' : 'Use sample text'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ----------------------------------------------------------------------
          STEP 2: BUKTI GAMBAR (PILIHAN)
          ---------------------------------------------------------------------- */}
      {step === 2 && (
        <div className="space-y-5">
          <div>
            <h2 className="text-xl sm:text-2xl font-extrabold text-[#17212F] tracking-tight">
              {locale === 'ms' ? 'Ada gambar bukti?' : 'Any photo evidence?'}
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 mt-1">
              {locale === 'ms'
                ? 'Gambar membantu pengurusan memahami masalah dengan lebih cepat.'
                : 'Photos help management understand the issue more quickly.'}
            </p>
          </div>

          {/* Photo Count Label */}
          <div className="flex items-center justify-between text-xs font-bold text-slate-700">
            <span>{locale === 'ms' ? 'Gambar Bukti' : 'Evidence Photos'}</span>
            <span className="text-slate-500 font-normal">
              {selectedImages.length} {locale === 'ms' ? 'daripada 3 · Pilihan' : 'of 3 · Optional'}
            </span>
          </div>

          {/* Photo Thumbnails */}
          {selectedImages.length > 0 ? (
            <div className="grid grid-cols-3 gap-2.5">
              {selectedImages.map((img, idx) => (
                <div
                  key={idx}
                  className="relative aspect-square rounded-2xl overflow-hidden border border-slate-200 bg-slate-100 flex items-center justify-center group"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt={`Bukti ${idx + 1}`} className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => onRemoveImage(idx)}
                    className="absolute top-1.5 right-1.5 p-1 rounded-full bg-black/60 text-white hover:bg-red-600 transition-all cursor-pointer"
                    title={locale === 'ms' ? 'Padam gambar' : 'Delete photo'}
                  >
                    <span className="text-xs font-bold px-1">✕</span>
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center bg-[#F8FAFD] border-2 border-dashed border-[#D5E0ED] rounded-2xl text-slate-500 space-y-2">
              <ImageIcon className="w-8 h-8 text-slate-400 mx-auto" />
              <p className="text-sm font-semibold">
                {locale === 'ms' ? 'Belum ada gambar' : 'No photos added yet'}
              </p>
              <p className="text-xs text-slate-400">
                {locale === 'ms' ? 'Gambar adalah pilihan. Anda boleh teruskan tanpa gambar.' : 'Photos are optional. You can proceed without photos.'}
              </p>
            </div>
          )}

          {/* Action Buttons: Camera & Gallery */}
          {selectedImages.length < 3 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                className="min-h-[54px] py-3 px-4 rounded-xl bg-[#EDF4FF] border border-[#CBDCF6] text-[#1554AD] font-bold text-sm flex items-center justify-center gap-2 hover:bg-blue-100 transition-all cursor-pointer"
              >
                <Camera className="w-4 h-4" />
                <span>{locale === 'ms' ? 'Ambil gambar' : 'Take photo'}</span>
              </button>

              <button
                type="button"
                onClick={() => galleryInputRef.current?.click()}
                className="min-h-[54px] py-3 px-4 rounded-xl bg-white border border-slate-300 text-slate-800 font-bold text-sm flex items-center justify-center gap-2 hover:bg-slate-50 transition-all cursor-pointer"
              >
                <ImageIcon className="w-4 h-4 text-slate-600" />
                <span>{locale === 'ms' ? 'Pilih dari galeri' : 'Choose from gallery'}</span>
              </button>
            </div>
          )}

          {/* Hidden File Inputs */}
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                onAddImages(Array.from(e.target.files));
                e.target.value = '';
              }
            }}
          />
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                onAddImages(Array.from(e.target.files));
                e.target.value = '';
              }
            }}
          />

          {/* Safety Notice */}
          <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              {locale === 'ms'
                ? 'Jangan ambil gambar jika keadaan tapak tidak selamat atau membahayakan diri.'
                : 'Do not take photos if site conditions are unsafe or dangerous.'}
            </span>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------------------
          STEP 3: SEMAK & HANTAR
          ---------------------------------------------------------------------- */}
      {step === 3 && (
        <div className="space-y-5">
          {/* Ready Badge */}
          <div className="inline-flex items-center gap-1.5 bg-[#EDF8F1] text-[#29704D] px-3 py-1.5 rounded-full text-xs font-extrabold">
            <Check className="w-3.5 h-3.5" />
            <span>{locale === 'ms' ? 'Sedia untuk disemak' : 'Ready for review'}</span>
          </div>

          <div>
            <h2 className="text-xl sm:text-2xl font-extrabold text-[#17212F] tracking-tight">
              {locale === 'ms' ? 'Betul semua?' : 'Is everything correct?'}
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 mt-1">
              {locale === 'ms'
                ? 'Semak dahulu. Ada silap, tekan butang Ubah.'
                : 'Review the details below. Tap Edit to make any adjustments.'}
            </p>
          </div>

          {/* Section 1: Lokasi Kejadian */}
          <section className="p-4 bg-white rounded-2xl border border-slate-200 shadow-2xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase font-extrabold text-slate-500 tracking-wider">
                {locale === 'ms' ? '1. Lokasi Kejadian' : '1. Incident Location'}
              </span>
              <button
                type="button"
                onClick={() => handleEditSection(0)}
                className="text-xs font-extrabold text-[#1554AD] hover:underline px-2 py-1 min-h-[36px] cursor-pointer"
              >
                {locale === 'ms' ? 'Ubah' : 'Edit'}
              </button>
            </div>
            <strong className="block text-base font-extrabold text-[#17212F]">
              {getLocationText()}
            </strong>
            {specificLocation.trim() && (
              <p className="text-xs text-slate-600">
                📍 {specificLocation.trim()}
              </p>
            )}
            {selectedFloor === 'unknown' && (
              <p className="text-xs text-amber-700 bg-amber-50 p-2 rounded-lg">
                {locale === 'ms'
                  ? 'Tingkat belum pasti. Pengurusan perlu mengesahkan lokasi sebelum tindakan.'
                  : 'Floor is uncertain. Management will verify location prior to site action.'}
              </p>
            )}
          </section>

          {/* Section 2: Masalah & Butiran */}
          <section className="p-4 bg-white rounded-2xl border border-slate-200 shadow-2xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase font-extrabold text-slate-500 tracking-wider">
                {locale === 'ms' ? '2. Masalah & Butiran' : '2. Problem Details'}
              </span>
              <button
                type="button"
                onClick={() => handleEditSection(1)}
                className="text-xs font-extrabold text-[#1554AD] hover:underline px-2 py-1 min-h-[36px] cursor-pointer"
              >
                {locale === 'ms' ? 'Ubah' : 'Edit'}
              </button>
            </div>
            <strong className="block text-base font-extrabold text-[#17212F]">
              {category === 'water_supply'
                ? (locale === 'ms' ? 'Bekalan air' : 'Water supply')
                : category === 'lift'
                ? (locale === 'ms' ? 'Lif' : 'Elevator')
                : category === 'corridor_lighting'
                ? (locale === 'ms' ? 'Lampu koridor' : 'Corridor lighting')
                : (locale === 'ms' ? 'Lain-lain' : 'Other issues')}
              {subIssue ? ` · ${getSubIssueLabel(subIssue, locale)}` : ''}
            </strong>
            <p className="text-xs sm:text-sm text-slate-700 leading-relaxed">
              {getSynthesizedSummary()}
            </p>
          </section>

          {/* Section 3: Gambar Bukti */}
          <section className="p-4 bg-white rounded-2xl border border-slate-200 shadow-2xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase font-extrabold text-slate-500 tracking-wider">
                {locale === 'ms' ? '3. Gambar Bukti' : '3. Evidence Photos'}
              </span>
              <button
                type="button"
                onClick={() => handleEditSection(2)}
                className="text-xs font-extrabold text-[#1554AD] hover:underline px-2 py-1 min-h-[36px] cursor-pointer"
              >
                {selectedImages.length > 0 ? (locale === 'ms' ? 'Ubah' : 'Edit') : (locale === 'ms' ? 'Tambah' : 'Add')}
              </button>
            </div>
            {selectedImages.length > 0 ? (
              <div className="grid grid-cols-3 gap-2 pt-1">
                {selectedImages.map((img, idx) => (
                  <div key={idx} className="aspect-square rounded-xl overflow-hidden border border-slate-200">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.url} alt={`Bukti ${idx + 1}`} className="w-full h-full object-cover" />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500 italic">
                {locale === 'ms'
                  ? 'Tiada gambar dilampirkan. Anda masih boleh menghantar aduan yang sah.'
                  : 'No photos attached. You can still submit a valid report.'}
              </p>
            )}
          </section>
        </div>
      )}

      {/* Error Notice */}
      {(stepError || validationError) && (
        <div
          role="alert"
          className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs font-bold text-red-700 flex items-center gap-2"
        >
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{stepError || validationError}</span>
        </div>
      )}

      {/* Bottom Sticky Navigation Row */}
      <div className="pt-4 border-t border-slate-200 flex items-center gap-3">
        <button
          type="button"
          onClick={handleBack}
          disabled={isSubmitting}
          className="min-h-[54px] px-5 rounded-xl border border-slate-300 bg-white text-slate-700 font-bold text-sm flex items-center justify-center gap-2 hover:bg-slate-50 transition-all cursor-pointer disabled:opacity-50"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>{locale === 'ms' ? 'Kembali' : 'Back'}</span>
        </button>

        <button
          type="button"
          onClick={handleNextStep}
          disabled={isSubmitting}
          className="flex-1 min-h-[54px] py-3.5 px-6 rounded-xl bg-[#1554AD] text-white font-extrabold text-base flex items-center justify-center gap-2 hover:bg-[#0E3E85] active:scale-[0.99] transition-all cursor-pointer shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>{locale === 'ms' ? 'Menghantar aduan...' : 'Submitting report...'}</span>
            </>
          ) : isEditing ? (
            <>
              <span>{locale === 'ms' ? 'Simpan perubahan' : 'Save changes'}</span>
              <Check className="w-4 h-4" />
            </>
          ) : step === 3 ? (
            <>
              <span>{locale === 'ms' ? 'Hantar aduan' : 'Submit report'}</span>
              <ArrowRight className="w-4 h-4" />
            </>
          ) : step === 2 && selectedImages.length === 0 ? (
            <>
              <span>{locale === 'ms' ? 'Semak tanpa gambar' : 'Review without photos'}</span>
              <ArrowRight className="w-4 h-4" />
            </>
          ) : (
            <>
              <span>
                {step === 0
                  ? (locale === 'ms' ? 'Seterusnya: Masalah' : 'Next: Problem')
                  : step === 1
                  ? (locale === 'ms' ? 'Seterusnya: Bukti' : 'Next: Evidence')
                  : (locale === 'ms' ? 'Semak aduan' : 'Review report')}
              </span>
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
