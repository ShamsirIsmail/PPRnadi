'use client';

import React, { useState } from 'react';
import type { BuildingVisualProps } from './types';
import { 
  Building2, 
  AlertTriangle, 
  CheckCircle2, 
  Droplets, 
  ArrowUpCircle, 
  Lightbulb,
  Clock,
  ShieldAlert,
  Layers
} from 'lucide-react';

export function BuildingVisualContainer({
  buildings,
  selectedBuildingId,
  zones,
  facilities,
  estateTitle = 'PPR/PA Desa Rejang — Skematik Infrastruktur',
  estateSubtitle = 'Peta zon perkhidmatan & susun atur blok kawasan kajian lapangan',
  isDemoEnvironment = false,
  onSelectBuilding,
  onSelectZone,
  className = '',
}: BuildingVisualProps) {
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const activeBuilding = buildings.find((b) => b.id === selectedBuildingId) || buildings[0];
  const buildingZones = zones.filter((z) => z.buildingId === activeBuilding?.id);
  const buildingFacilities = facilities.filter((f) => f.buildingId === activeBuilding?.id);

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'water_supply':
        return <Droplets className="w-4 h-4 text-blue-600" />;
      case 'lift':
        return <ArrowUpCircle className="w-4 h-4 text-amber-600" />;
      case 'corridor_lighting':
        return <Lightbulb className="w-4 h-4 text-yellow-600" />;
      default:
        return <Layers className="w-4 h-4 text-slate-500" />;
    }
  };

  return (
    <div
      className={`rounded-2xl border-2 border-slate-200 bg-white p-5 sm:p-6 shadow-xs ${className}`}
      aria-label="Estate Architectural Schematic"
    >
      {/* Header and Estate Demarcation */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Building2 className="w-5 h-5 text-[#1554AD]" />
            <h3 className="font-extrabold text-[#17212F] text-base sm:text-lg">
              {estateTitle}
            </h3>
            {isDemoEnvironment ? (
              <span className="text-[10px] font-mono uppercase font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
                Data Demonstrasi Sintetik
              </span>
            ) : (
              <span className="text-[10px] font-mono uppercase font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
                Kawasan Kajian Sebenar
              </span>
            )}
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            {estateSubtitle}
          </p>
        </div>

        {/* Cluster / Status Summary */}
        <div className="flex items-center gap-2 self-start sm:self-auto text-xs font-mono">
          <span className="bg-[#F0F5FC] text-[#1554AD] px-3 py-1.5 rounded-xl border border-[#CBD5E1] font-bold">
            {buildings.length} Blok
          </span>
        </div>
      </div>

      {/* Building Selector Tabs */}
      <div className="mt-4">
        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">
          Pilih Blok Untuk Diteliti:
        </label>
        <div className="flex flex-wrap gap-2">
          {buildings.map((b) => {
            const isSelected = (selectedBuildingId || activeBuilding?.id) === b.id;
            return (
              <button
                key={b.id}
                type="button"
                aria-pressed={isSelected}
                onClick={() => onSelectBuilding?.(b.id)}
                className={`px-3 py-2 text-xs sm:text-sm font-bold rounded-xl transition-all flex items-center gap-1.5 border min-h-[40px] ${
                  isSelected
                    ? 'bg-[#1554AD] text-white border-[#1554AD] shadow-xs'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50 hover:text-[#17212F]'
                }`}
              >
                <span>{b.name}</span>
                {b.activeIncidentCount > 0 ? (
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                ) : (
                  <span className={`w-2 h-2 rounded-full ${isSelected ? 'bg-white' : 'bg-emerald-500'}`} />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Building Detail & Cross Section */}
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Schematic Tower or Block Elevation Info */}
        <div className="lg:col-span-7 bg-[#F8FAFC] rounded-2xl border border-slate-200 p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-3">
            <div>
              <span className="text-xs font-bold text-[#1554AD] uppercase tracking-wider block">
                {activeBuilding?.clusterLabel || 'Susun Atur Blok'}
              </span>
              <h4 className="text-lg font-extrabold text-[#17212F]">
                {activeBuilding?.name}
              </h4>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
              {activeBuilding?.totalFloors != null ? (
                <span className="bg-white px-2.5 py-1 rounded-lg border border-slate-200 text-slate-700">
                  {activeBuilding.totalFloors} Tingkat
                </span>
              ) : (
                <span className="bg-amber-50 text-amber-800 px-2.5 py-1 rounded-lg border border-amber-200 text-[11px] font-sans">
                  Tingkat: Menunggu Verifikasi
                </span>
              )}

              {activeBuilding?.totalUnits != null ? (
                <span className="bg-white px-2.5 py-1 rounded-lg border border-slate-200 text-slate-700">
                  {activeBuilding.totalUnits} Unit
                </span>
              ) : (
                <span className="bg-slate-100 text-slate-600 px-2.5 py-1 rounded-lg border border-slate-200 text-[11px] font-sans">
                  Sebahagian 2,791 Unit
                </span>
              )}
            </div>
          </div>

          {/* Notes or Verification Guidance */}
          {activeBuilding?.notes && (
            <p className="text-xs sm:text-sm text-slate-600 bg-white p-3 rounded-xl border border-slate-200 leading-relaxed">
              <strong>Nota Lapangan:</strong> {activeBuilding.notes}
            </p>
          )}

          {/* Zones or Floor List */}
          <div className="space-y-2">
            <h5 className="text-xs font-bold text-[#17212F] uppercase tracking-wider">
              {buildingZones.length > 0 ? 'Zon Perkhidmatan / Aras:' : 'Status Verifikasi Aras & Zon:'}
            </h5>

            {buildingZones.length > 0 ? (
              buildingZones.map((zone) => (
                <button
                  type="button"
                  aria-pressed={selectedZoneId === zone.id}
                  key={zone.id}
                  onClick={() => {
                    setSelectedZoneId(zone.id);
                    onSelectZone?.(zone.id);
                  }}
                  className={`w-full text-left p-3.5 rounded-xl border transition-all focus-visible:ring-2 focus-visible:ring-[#1554AD] ${
                    zone.isAffected
                      ? 'border-amber-300 bg-amber-50/80 hover:bg-amber-100/80'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      {zone.floorRange && (
                        <span className="font-mono text-xs font-bold px-2 py-0.5 rounded-md bg-[#F0F5FC] text-[#1554AD]">
                          T{zone.floorRange[0]}-T{zone.floorRange[1]}
                        </span>
                      )}
                      <span className="text-xs sm:text-sm font-semibold text-[#17212F]">
                        {zone.name}
                      </span>
                    </div>
                    {zone.isAffected ? (
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-800 bg-amber-200/80 px-2.5 py-0.5 rounded-full">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-700" /> Terjejas
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-800 bg-emerald-100 px-2.5 py-0.5 rounded-full">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" /> Normal
                      </span>
                    )}
                  </div>
                </button>
              ))
            ) : (
              <div className="p-5 bg-white rounded-xl border border-dashed border-slate-300 text-center space-y-1.5">
                <Clock className="w-6 h-6 text-slate-400 mx-auto" />
                <p className="text-xs sm:text-sm font-semibold text-[#17212F]">
                  Data Aras Menunggu Pengesahan Pasukan Lapangan
                </p>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  Bilangan tingkat berbeza mengikut blok di Desa Rejang. Struktur zon akan dipautkan sebaik sahaja verifikasi ketinggian fizikal direkodkan.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Connected Facilities & Assets */}
        <div className="lg:col-span-5 bg-[#F8FAFC] rounded-2xl border border-slate-200 p-5 space-y-4">
          <div className="border-b border-slate-200 pb-3">
            <h4 className="text-xs font-bold text-[#17212F] uppercase tracking-wider">
              Aset &amp; Fasiliti ({activeBuilding?.name})
            </h4>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {isDemoEnvironment ? 'Inventori aset demonstrasi' : 'Inventori aset terverifikasi'}
            </p>
          </div>

          <div className="space-y-2.5">
            {buildingFacilities.length > 0 ? (
              buildingFacilities.map((fac) => (
                <div
                  key={fac.id}
                  className="p-3 rounded-xl border border-slate-200 bg-white flex items-center justify-between"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="p-1.5 rounded-lg bg-slate-100 shrink-0">
                      {getCategoryIcon(fac.category)}
                    </div>
                    <div className="truncate">
                      <p className="text-xs sm:text-sm font-bold text-[#17212F] truncate">
                        {fac.name}
                      </p>
                      <p className="text-[11px] text-slate-500 font-mono">
                        {fac.facilityCode}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`text-[10px] font-bold px-2.5 py-1 rounded-full shrink-0 ${
                      fac.status === 'operational'
                        ? 'bg-emerald-100 text-emerald-800'
                        : fac.status === 'degraded'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {fac.status === 'operational' ? 'Beroperasi' : fac.status === 'degraded' ? 'Separa' : 'Terhenti'}
                  </span>
                </div>
              ))
            ) : (
              <div className="p-5 bg-white rounded-xl border border-dashed border-slate-300 text-center space-y-1.5">
                <ShieldAlert className="w-6 h-6 text-slate-400 mx-auto" />
                <p className="text-xs sm:text-sm font-semibold text-[#17212F]">
                  Tiada Aset Fiksyen Dicipta
                </p>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Pasukan kajian belum merekodkan senarai aset khusus untuk blok ini. Lif (sebahagian daripada 38 lif keseluruhan) dan pam air akan dilengkapkan mengikut inventori sebenar.
                </p>
              </div>
            )}
          </div>

          <div className="mt-4 p-3.5 bg-white rounded-xl border border-slate-200 text-xs text-slate-600 leading-relaxed">
            <span className="font-bold text-[#17212F]">Nota Integriti Data:</span> Maklumat kawasan kajian sebenar (PPR/PA Desa Rejang) diasingkan sepenuhnya daripada data demonstrasi sintetik untuk mengelakkan kekeliruan laporan.
          </div>
        </div>
      </div>
    </div>
  );
}
