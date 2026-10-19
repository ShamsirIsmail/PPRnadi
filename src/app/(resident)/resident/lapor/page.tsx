import React from 'react';
import { requireResident } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { LaporForm } from './LaporForm';
import type { FacilityCategory } from '@/types/database';

import Link from 'next/link';
import { AlertTriangle, Building2, HelpCircle } from 'lucide-react';

export default async function LaporKerosakanPage({
  searchParams,
}: {
  searchParams?: Promise<{ category?: string }>;
}) {
  const resolvedParams = searchParams ? await searchParams : undefined;
  const rawCat = resolvedParams?.category?.trim().toLowerCase();

  // Validate and normalize supported categories; invalid values fallback gracefully
  let initialCategory: FacilityCategory | undefined;
  if (rawCat === 'water' || rawCat === 'water_supply') {
    initialCategory = 'water_supply';
  } else if (rawCat === 'lift') {
    initialCategory = 'lift';
  } else if (rawCat === 'lighting' || rawCat === 'corridor_lighting') {
    initialCategory = 'corridor_lighting';
  }

  const { profile } = await requireResident();
  const supabase = await createServerSupabaseClient();

  if (!profile.assigned_building_id) {
    return (
      <div className="max-w-md mx-auto p-6 bg-white rounded-2xl border border-slate-200 shadow-xs space-y-4 text-center">
        <HelpCircle className="w-12 h-12 text-amber-500 mx-auto" />
        <h2 className="text-lg font-bold text-[#17212F]">
          Profil Belum Ditugaskan / Profile Unassigned
        </h2>
        <p className="text-sm text-slate-600 leading-relaxed">
          Akaun anda belum didaftarkan ke mana-mana blok bangunan PPR. Sila hubungi pihak pengurusan untuk mengesahkan unit kediaman anda.
        </p>
        <Link
          href="/resident"
          className="inline-block px-4 py-2.5 rounded-xl bg-[#1554AD] text-white text-sm font-bold hover:bg-[#0E3E85] transition-all"
        >
          Kembali ke Laman Penduduk
        </Link>
      </div>
    );
  }

  const { data: building, error: buildingError } = await supabase
    .from('buildings')
    .select('id, name, code, total_floors')
    .eq('id', profile.assigned_building_id)
    .single();

  const { data: zones, error: zonesError } = await supabase
    .from('service_zones')
    .select('id, zone_code, name')
    .eq('building_id', profile.assigned_building_id)
    .order('floor_start', { ascending: true });

  // Query failure handling: distinct from empty data
  if (buildingError || zonesError) {
    return (
      <div className="max-w-md mx-auto p-6 bg-white rounded-2xl border border-red-200 shadow-xs space-y-4 text-center">
        <AlertTriangle className="w-12 h-12 text-red-600 mx-auto" />
        <h2 className="text-lg font-bold text-red-900">
          Ralat Memuatkan Data Lokasi / Error Loading Location
        </h2>
        <p className="text-sm text-slate-600 leading-relaxed">
          Sistem tidak dapat memuatkan maklumat bangunan atau zon anda buat masa ini. Sila pastikan perkhidmatan rangkaian aktif dan cuba sebentar lagi.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-2 pt-2">
          <Link
            href="/resident/lapor"
            className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-[#1554AD] text-white text-sm font-bold hover:bg-[#0E3E85] transition-all text-center"
          >
            Cuba Semula / Retry
          </Link>
          <Link
            href="/resident"
            className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 text-sm font-bold hover:bg-slate-50 transition-all text-center"
          >
            Kembali ke Laman Penduduk
          </Link>
        </div>
      </div>
    );
  }

  // Building record missing in DB
  if (!building) {
    return (
      <div className="max-w-md mx-auto p-6 bg-white rounded-2xl border border-slate-200 shadow-xs space-y-4 text-center">
        <Building2 className="w-12 h-12 text-slate-400 mx-auto" />
        <h2 className="text-lg font-bold text-[#17212F]">
          Bangunan Tidak Dijumpai / Building Not Found
        </h2>
        <p className="text-sm text-slate-600 leading-relaxed">
          Maklumat blok bangunan anda belum didaftarkan dalam sistem pangkalan data.
        </p>
        <Link
          href="/resident"
          className="inline-block px-4 py-2.5 rounded-xl bg-[#1554AD] text-white text-sm font-bold hover:bg-[#0E3E85] transition-all"
        >
          Kembali ke Laman Penduduk
        </Link>
      </div>
    );
  }

  // Query all buildings in resident's estate (e.g. Blok A - L for Desa Rejang)
  const { data: estateBuildings } = profile.assigned_estate_id
    ? await supabase
        .from('buildings')
        .select('id, name, code, total_floors')
        .eq('estate_id', profile.assigned_estate_id)
        .order('code', { ascending: true })
    : { data: null };

  const availableBuildings = estateBuildings && estateBuildings.length > 0
    ? estateBuildings
    : [building];

  const buildingIds = availableBuildings.map((b) => b.id);

  const { data: allZones } = await supabase
    .from('service_zones')
    .select('id, building_id, zone_code, name, floor_start, floor_end')
    .in('building_id', buildingIds)
    .order('floor_start', { ascending: true });

  return (
    <LaporForm
      buildingName={building.name}
      assignedBuildingId={building.id}
      buildings={availableBuildings}
      unitNumber={profile.unit_number || ''}
      residentName={profile.full_name || ''}
      zones={allZones && allZones.length > 0 ? allZones : zones}
      initialCategory={initialCategory}
    />
  );
}
