'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { 
  Building2, 
  Inbox, 
  AlertOctagon, 
  ArrowRight,
  Radio,
  MapPin,
  Layers,
  ArrowUpCircle,
  ShieldCheck,
  CheckCircle2,
} from 'lucide-react';
import { BuildingVisualContainer } from '@/components/estate/BuildingVisualContainer';
import { 
  DESA_REJANG_BUILDINGS, 
  DESA_REJANG_ZONES, 
  DESA_REJANG_FACILITIES,
  DEMO_BUILDINGS, 
  DEMO_ZONES, 
  DEMO_FACILITIES 
} from '@/lib/constants/estate-data';
import { useTranslation } from '@/lib/i18n/LanguageContext';

export default function ManagementDashboardPage() {
  const { locale } = useTranslation();
  
  // Estate View Mode: 'desa-rejang' (Real Field Research Site) vs 'demo' (Synthetic Demo Test Environment)
  const [activeEstateMode, setActiveEstateMode] = useState<'desa-rejang' | 'demo'>('desa-rejang');
  const [selectedBuildingId, setSelectedBuildingId] = useState<string>('dr-blk-a');

  const handleSwitchMode = (mode: 'desa-rejang' | 'demo') => {
    setActiveEstateMode(mode);
    if (mode === 'desa-rejang') {
      setSelectedBuildingId('dr-blk-a');
    } else {
      setSelectedBuildingId('bldg-b');
    }
  };

  return (
    <div className="space-y-6">
      {/* Real Field Research Study Area Banner */}
      <div className="rounded-2xl border-2 border-[#1554AD] bg-[#F0F5FC] p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-mono font-bold uppercase tracking-wider px-2.5 py-1 rounded-md bg-[#1554AD] text-white">
                {locale === 'ms' ? 'Kawasan Kajian Lapangan Sebenar' : 'Verified Field Study Site'}
              </span>
              <span className="text-xs font-semibold text-slate-600 flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-[#1554AD]" />
                Setapak Jaya, 54100 Kuala Lumpur
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-[#17212F] tracking-tight">
              PPR/PA Desa Rejang
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 font-medium">
              {locale === 'ms'
                ? 'Data fizikal teras disahkan oleh pasukan kajian lapangan. Bilangan tingkat berbeza mengikut blok dan diperincikan mengikut bancian fizikal sebenar.'
                : 'Physical core metrics verified by the field research team. Floor counts vary by block and are documented through actual site verification.'}
            </p>
          </div>

          {/* Mode Switcher Toggle */}
          <div className="flex items-center gap-2 bg-white p-1.5 rounded-xl border border-[#CBD5E1] shrink-0 self-start lg:self-center">
            <button
              type="button"
              onClick={() => handleSwitchMode('desa-rejang')}
              className={`px-3.5 py-2 text-xs font-bold rounded-lg transition-all ${
                activeEstateMode === 'desa-rejang'
                  ? 'bg-[#1554AD] text-white shadow-xs'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              PPR/PA Desa Rejang (Kajian)
            </button>
            <button
              type="button"
              onClick={() => handleSwitchMode('demo')}
              className={`px-3.5 py-2 text-xs font-bold rounded-lg transition-all ${
                activeEstateMode === 'demo'
                  ? 'bg-[#1554AD] text-white shadow-xs'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              PPR Sentosa (Demo Sintetik)
            </button>
          </div>
        </div>
      </div>

      {/* Verified Core Metrics (Desa Rejang Baseline) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Total Blocks */}
        <div className="bg-white rounded-2xl border-2 border-slate-200 p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              {locale === 'ms' ? 'Bilangan Blok' : 'Total Blocks'}
            </span>
            <Building2 className="w-5 h-5 text-[#1554AD]" />
          </div>
          <div className="mt-3">
            <span className="text-2xl sm:text-3xl font-extrabold text-[#17212F]">12 Blok</span>
            <span className="text-xs text-slate-500 ml-2 font-mono">Blok A – Blok L</span>
          </div>
          <p className="text-xs text-emerald-700 mt-2 font-semibold flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            {locale === 'ms' ? 'Disahkan Pasukan Kajian' : 'Verified by Field Team'}
          </p>
        </div>

        {/* Metric 2: Total Units */}
        <div className="bg-white rounded-2xl border-2 border-slate-200 p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              {locale === 'ms' ? 'Unit Rumah Keseluruhan' : 'Total Housing Units'}
            </span>
            <Layers className="w-5 h-5 text-[#1554AD]" />
          </div>
          <div className="mt-3">
            <span className="text-2xl sm:text-3xl font-extrabold text-[#17212F]">2,791 Unit</span>
          </div>
          <p className="text-xs text-emerald-700 mt-2 font-semibold flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            {locale === 'ms' ? 'Bancian Rasmi Komuniti' : 'Official Community Census'}
          </p>
        </div>

        {/* Metric 3: Total Elevators */}
        <div className="bg-white rounded-2xl border-2 border-slate-200 p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              {locale === 'ms' ? 'Lif Penumpang Keseluruhan' : 'Total Elevators'}
            </span>
            <ArrowUpCircle className="w-5 h-5 text-[#1554AD]" />
          </div>
          <div className="mt-3">
            <span className="text-2xl sm:text-3xl font-extrabold text-[#17212F]">38 Lif</span>
          </div>
          <p className="text-xs text-emerald-700 mt-2 font-semibold flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            {locale === 'ms' ? 'Aset Vertikal Disahkan' : 'Verified Vertical Assets'}
          </p>
        </div>

        {/* Metric 4: Floor Count Policy */}
        <div className="bg-white rounded-2xl border-2 border-slate-200 p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              {locale === 'ms' ? 'Ketinggian Blok' : 'Floor Variations'}
            </span>
            <ShieldCheck className="w-5 h-5 text-[#1554AD]" />
          </div>
          <div className="mt-3">
            <span className="text-base sm:text-lg font-extrabold text-[#17212F]">
              {locale === 'ms' ? 'Berbeza Ikut Blok' : 'Varying by Block'}
            </span>
          </div>
          <p className="text-xs text-slate-600 mt-2 font-medium">
            {locale === 'ms' ? 'Tiada andaian tetap 18 tingkat' : 'No uniform 18-floor assumption'}
          </p>
        </div>
      </div>

      {/* Demarcation Warning when viewing synthetic demo */}
      {activeEstateMode === 'demo' && (
        <div className="p-4 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 text-xs sm:text-sm font-medium flex items-center gap-3">
          <AlertOctagon className="w-5 h-5 text-amber-700 shrink-0" />
          <span>
            <strong>Persekitaran Demonstrasi Sintetik:</strong> Rekod aduan dan insiden di bawah (seperti gangguan pam air Blok B) adalah data ujian tiruan bagi mengesahkan aliran kerja sistem, dan <strong>BUKAN</strong> insiden sebenar yang berlaku di PPR/PA Desa Rejang.
          </span>
        </div>
      )}

      {/* Interactive Estate Blueprint / Operations Map */}
      <BuildingVisualContainer
        buildings={activeEstateMode === 'desa-rejang' ? DESA_REJANG_BUILDINGS : DEMO_BUILDINGS}
        selectedBuildingId={selectedBuildingId}
        zones={activeEstateMode === 'desa-rejang' ? DESA_REJANG_ZONES : DEMO_ZONES}
        facilities={activeEstateMode === 'desa-rejang' ? DESA_REJANG_FACILITIES : DEMO_FACILITIES}
        estateTitle={
          activeEstateMode === 'desa-rejang'
            ? 'PPR/PA Desa Rejang — Skematik 12 Blok (A hingga L)'
            : 'PPR Sentosa — Skematik Ujian Demonstrasi (3 Blok)'
        }
        estateSubtitle={
          activeEstateMode === 'desa-rejang'
            ? 'Susun atur spatial mengikut rujukan satelit (Zon Utara, Zon Tengah, Zon Selatan) bersempadan Persiaran Rejang dan Lebuhraya DUKE E33.'
            : 'Persekitaran ujian terasing bagi memastikan integriti suite automasi.'
        }
        isDemoEnvironment={activeEstateMode === 'demo'}
        onSelectBuilding={setSelectedBuildingId}
      />

      {/* Operational Actions & Management Flow */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl border-2 border-slate-200 p-5 sm:p-6 shadow-xs space-y-3">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-2.5">
            <Inbox className="w-5 h-5 text-[#1554AD]" />
            <h3 className="text-base font-bold text-[#17212F]">
              {locale === 'ms' ? 'Peti Masuk Semakan Aduan' : 'Review Inbox Workflow'}
            </h3>
          </div>
          <p className="text-xs sm:text-sm text-slate-600 leading-relaxed font-medium">
            {locale === 'ms'
              ? 'Aduan kerosakan yang dihantar penduduk diperiksa bersama gambar bukti fizikal sebelum tindakan penyelenggaraan dimulakan.'
              : 'Resident maintenance reports are inspected along with physical photo evidence before repairs are authorized.'}
          </p>
          <div className="pt-2">
            <Link
              href="/management/inbox"
              className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-bold text-[#1554AD] hover:underline"
            >
              <span>{locale === 'ms' ? 'Buka Peti Masuk Semakan' : 'Open Review Inbox'}</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>

        <div className="bg-white rounded-2xl border-2 border-slate-200 p-5 sm:p-6 shadow-xs space-y-3">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-2.5">
            <Radio className="w-5 h-5 text-[#1554AD]" />
            <h3 className="text-base font-bold text-[#17212F]">
              {locale === 'ms' ? 'Penyiaran Notis Rasmi Komuniti' : 'Official Notice Broadcasting'}
            </h3>
          </div>
          <p className="text-xs sm:text-sm text-slate-600 leading-relaxed font-medium">
            {locale === 'ms'
              ? 'Sebarang penutupan fasiliti terverifikasi disiarkan sebagai buletin rasmi kepada penduduk dengan menjawab 5 soalan penting gangguan.'
              : 'Any verified facility outages are broadcast as official bulletins to residents answering the 5 critical disruption questions.'}
          </p>
          <div className="pt-2">
            <Link
              href="/management/incidents"
              className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-bold text-[#1554AD] hover:underline"
            >
              <span>{locale === 'ms' ? 'Buka Pusat Kawalan Insiden' : 'Open Incident Control Center'}</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
