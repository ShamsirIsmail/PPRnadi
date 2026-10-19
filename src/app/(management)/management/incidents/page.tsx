import React from 'react';
import { requireManager } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { IncidentsClient, type IncidentItem, type BuildingOption, type FacilityOption } from './IncidentsClient';
import type { FacilityCategory, IncidentSeverity, IncidentStatus, UpdateStage } from '@/types/database';

export default async function VerifiedIncidentsPage() {
  const { profile } = await requireManager();
  const supabase = await createServerSupabaseClient();

  // 1. Fetch real incidents for manager's assigned estate
  const { data: incidentsData, error: incError } = await supabase
    .from('incidents')
    .select(`
      id,
      incident_number,
      title,
      category,
      severity,
      status,
      internal_notes,
      verified_by,
      verified_at,
      restoration_evidence,
      created_at,
      buildings!inner (id, name, code, estate_id),
      facilities (name, facility_code),
      incident_updates (id, update_title, message_bm, stage, is_published, published_at)
    `)
    .eq('buildings.estate_id', profile.assigned_estate_id!)
    .order('created_at', { ascending: false });

  if (incError) {
    return (
      <div className="p-4 bg-red-50 text-red-800 rounded-xl text-xs">
        Ralat semasa memuatkan senarai insiden: {incError.message}
      </div>
    );
  }

  // 2. Fetch estate buildings
  const { data: buildingsData } = await supabase
    .from('buildings')
    .select('id, name, code')
    .eq('estate_id', profile.assigned_estate_id!)
    .order('name');

  const buildings: BuildingOption[] = (buildingsData || []).map((b) => ({
    id: b.id,
    name: b.name,
    code: b.code,
  }));

  // 3. Fetch estate facilities
  const buildingIds = buildings.map((b) => b.id);
  let facilities: FacilityOption[] = [];
  if (buildingIds.length > 0) {
    const { data: facsData } = await supabase
      .from('facilities')
      .select('id, building_id, name, facility_code, category')
      .in('building_id', buildingIds)
      .order('name');

    facilities = (facsData || []).map((f) => ({
      id: f.id,
      building_id: f.building_id,
      name: f.name,
      facility_code: f.facility_code,
      category: f.category as FacilityCategory,
    }));
  }

  // 4. Format incidents
  const incidents: IncidentItem[] = (incidentsData || []).map((inc) => {
    const bldg = inc.buildings as unknown as { id: string; name: string; code: string } | null;
    const fac = inc.facilities as unknown as { name: string; facility_code: string } | null;
    const updates = (inc.incident_updates || []) as unknown as Array<{
      id: string;
      update_title: string;
      message_bm: string;
      stage: UpdateStage;
      is_published: boolean;
      published_at: string | null;
    }>;

    return {
      id: inc.id,
      incident_number: inc.incident_number,
      title: inc.title,
      category: inc.category as FacilityCategory,
      severity: inc.severity as IncidentSeverity,
      status: inc.status as IncidentStatus,
      internal_notes: inc.internal_notes,
      verified_by: inc.verified_by,
      verified_at: inc.verified_at,
      restoration_evidence: inc.restoration_evidence,
      created_at: inc.created_at,
      building: bldg ? { id: bldg.id, name: bldg.name, code: bldg.code } : null,
      facility: fac ? { name: fac.name, facility_code: fac.facility_code } : null,
      updates: updates.filter((u) => u.is_published),
    };
  });

  return (
    <IncidentsClient
      incidents={incidents}
      buildings={buildings}
      facilities={facilities}
    />
  );
}
