// ==============================================================================
// Estate Datasets & Research Site Registry
// ==============================================================================
// 1. KAWASAN KAJIAN SEBENAR: PPR/PA Desa Rejang, Setapak Jaya, Kuala Lumpur
//    - 12 blok keseluruhan: Blok A hingga Blok L
//    - 2,791 unit kediaman disahkan
//    - 38 lif penumpang disahkan
//    - Bilangan tingkat berbeza mengikut blok (dikekalkan null sehingga disahkan)
//
// 2. DATASET DEMONSTRASI SINTETIK: PPR Sentosa (SYNTHETIC DEMO)
//    - Dataset fiksyen untuk pengujian fungsi regresi dan automasi.
//    - Sebarang insiden demonstrasi (cth: pam kerosakan Blok B) TIDAK dipaparkan
//      sebagai kejadian sebenar di Desa Rejang.
// ==============================================================================

import type { 
  EstateBuildingData, 
  EstateZoneData, 
  EstateFacilityData
} from '@/components/estate/types';
import { DESA_REJANG_ESTATE } from './desa-rejang-config';

export { DESA_REJANG_ESTATE } from './desa-rejang-config';

// ==============================================================================
// 1. KAWASAN KAJIAN SEBENAR: PPR/PA Desa Rejang (12 Blok A-L)
// ==============================================================================
export const REAL_ESTATE_DESA_REJANG = {
  id: DESA_REJANG_ESTATE.id,
  code: DESA_REJANG_ESTATE.code,
  name: DESA_REJANG_ESTATE.name,
  officialFullName: DESA_REJANG_ESTATE.officialFullName,
  address: `${DESA_REJANG_ESTATE.location.area}, ${DESA_REJANG_ESTATE.location.postalCode} ${DESA_REJANG_ESTATE.location.city}`,
  totalBlocks: DESA_REJANG_ESTATE.verifiedTotals.totalBlocks,
  totalUnits: DESA_REJANG_ESTATE.verifiedTotals.totalUnits,
  totalLifts: DESA_REJANG_ESTATE.verifiedTotals.totalLifts,
  isRealResearchSite: true,
};

export const DESA_REJANG_BUILDINGS: EstateBuildingData[] = DESA_REJANG_ESTATE.blocks.map((b) => ({
  id: b.id,
  code: b.code,
  name: b.name,
  cluster: b.cluster,
  clusterLabel: b.clusterLabel,
  // Real field survey verified floors remains null until verified
  totalFloors: b.verifiedFloors ?? null,
  // Andaian demo sementara yang dibenarkan pengguna (18, 17, 16, 15 tingkat)
  temporaryDemoFloors: b.temporaryDemoFloors,
  totalUnits: b.verifiedUnits,
  totalLifts: b.verifiedLifts,
  verificationStatus: b.verificationStatus,
  activeIncidentCount: 0,
  worstStatus: 'operational',
  notes: b.notes,
}));

export const DESA_REJANG_ZONES: EstateZoneData[] = DESA_REJANG_ESTATE.blocks.flatMap((b) => {
  const total = b.temporaryDemoFloors;
  const mid = total === 18 ? 9 : total === 17 ? 9 : total === 16 ? 8 : 7;
  const blockLetter = b.name.replace('Blok ', '');
  return [
    {
      id: `zone-${b.code.toLowerCase()}-low`,
      buildingId: b.id,
      zoneCode: `DR-${blockLetter}-LOW`,
      name: `${b.name} Zon Rendah (Tingkat 1-${mid})`,
      floorRange: [1, mid],
      isAffected: false,
      activeIncidentIds: [],
    },
    {
      id: `zone-${b.code.toLowerCase()}-high`,
      buildingId: b.id,
      zoneCode: `DR-${blockLetter}-HIGH`,
      name: `${b.name} Zon Tinggi (Tingkat ${mid + 1}-${total})`,
      floorRange: [mid + 1, total],
      isAffected: false,
      activeIncidentIds: [],
    },
  ];
});
export const DESA_REJANG_FACILITIES: EstateFacilityData[] = [];

// ==============================================================================
// 2. PERSEKITARAN DEMONSTRASI SINTETIK: PPR Sentosa (Demo Fiksyen Sahaja)
// ==============================================================================
export const DEMO_ESTATE = {
  id: 'ppr-sentosa-demo',
  name: 'PPR Sentosa (SYNTHETIC DEMO)',
  address: 'Jalan Sentosa Impian, 56000 Kuala Lumpur',
  totalUnits: 504,
  isRealResearchSite: false,
};

export const DEMO_BUILDINGS: EstateBuildingData[] = [
  {
    id: 'bldg-a',
    code: 'BLK_A',
    name: 'Blok A',
    totalFloors: 15,
    totalUnits: 180,
    activeIncidentCount: 0,
    worstStatus: 'operational',
  },
  {
    id: 'bldg-b',
    code: 'BLK_B',
    name: 'Blok B',
    totalFloors: 15,
    totalUnits: 180,
    activeIncidentCount: 1, // Water disruption demo scenario
    worstStatus: 'degraded',
  },
  {
    id: 'bldg-c',
    code: 'BLK_C',
    name: 'Blok C',
    totalFloors: 12,
    totalUnits: 144,
    activeIncidentCount: 0,
    worstStatus: 'operational',
  },
];

export const DEMO_ZONES: EstateZoneData[] = [
  // Blok A (15 floors)
  {
    id: 'zone-a-low',
    buildingId: 'bldg-a',
    zoneCode: 'A-ZONE-LOW',
    name: 'Blok A Zon Rendah (T1-T7)',
    floorRange: [1, 7],
    isAffected: false,
    activeIncidentIds: [],
  },
  {
    id: 'zone-a-high',
    buildingId: 'bldg-a',
    zoneCode: 'A-ZONE-HIGH',
    name: 'Blok A Zon Tinggi (T8-T15)',
    floorRange: [8, 15],
    isAffected: false,
    activeIncidentIds: [],
  },
  // Blok B (15 floors)
  {
    id: 'zone-b-low',
    buildingId: 'bldg-b',
    zoneCode: 'B-ZONE-LOW',
    name: 'Blok B Zon Rendah (T1-T7)',
    floorRange: [1, 7],
    isAffected: false,
    activeIncidentIds: [],
  },
  {
    id: 'zone-b-high',
    buildingId: 'bldg-b',
    zoneCode: 'B-ZONE-HIGH',
    name: 'Blok B Zon Tinggi (T8-T15)',
    floorRange: [8, 15],
    isAffected: true, // Primary demo scenario
    activeIncidentIds: ['inc-demo-01'],
  },
  // Blok C (12 floors)
  {
    id: 'zone-c-low',
    buildingId: 'bldg-c',
    zoneCode: 'C-ZONE-LOW',
    name: 'Blok C Zon Rendah (T1-T6)',
    floorRange: [1, 6],
    isAffected: false,
    activeIncidentIds: [],
  },
  {
    id: 'zone-c-high',
    buildingId: 'bldg-c',
    zoneCode: 'C-ZONE-HIGH',
    name: 'Blok C Zon Tinggi (T7-T12)',
    floorRange: [7, 12],
    isAffected: false,
    activeIncidentIds: [],
  },
];

export const DEMO_FACILITIES: EstateFacilityData[] = [
  // Blok B Facilities (Demo)
  {
    id: 'fac-b-pump-main',
    buildingId: 'bldg-b',
    facilityCode: 'PUMP-B-MAIN',
    name: 'Pam Sedutan Utama Bawah Tanah',
    category: 'water_supply',
    status: 'operational',
    dependentZoneIds: ['zone-b-low', 'zone-b-high'],
  },
  {
    id: 'fac-b-pump-boost',
    buildingId: 'bldg-b',
    facilityCode: 'PUMP-B-BOOST',
    name: 'Pam Penggalak Zon Tinggi',
    category: 'water_supply',
    status: 'degraded',
    dependentZoneIds: ['zone-b-high'],
  },
  {
    id: 'fac-b-lift-1',
    buildingId: 'bldg-b',
    facilityCode: 'LIFT-B-01',
    name: 'Lif Penumpang 1 (G-15)',
    category: 'lift',
    status: 'operational',
    dependentZoneIds: ['zone-b-low', 'zone-b-high'],
  },
  {
    id: 'fac-b-lift-2',
    buildingId: 'bldg-b',
    facilityCode: 'LIFT-B-02',
    name: 'Lif Penumpang 2 (G-15)',
    category: 'lift',
    status: 'operational',
    dependentZoneIds: ['zone-b-low', 'zone-b-high'],
  },
  {
    id: 'fac-b-light-high',
    buildingId: 'bldg-b',
    facilityCode: 'LIGHT-B-HIGH',
    name: 'Litar Lampu Koridor Tingkat 8-15',
    category: 'corridor_lighting',
    status: 'operational',
    dependentZoneIds: ['zone-b-high'],
  },
  // Blok A Facilities (Demo)
  {
    id: 'fac-a-pump-main',
    buildingId: 'bldg-a',
    facilityCode: 'PUMP-A-MAIN',
    name: 'Pam Sedutan Utama Blok A',
    category: 'water_supply',
    status: 'operational',
    dependentZoneIds: ['zone-a-low', 'zone-a-high'],
  },
  {
    id: 'fac-a-lift-1',
    buildingId: 'bldg-a',
    facilityCode: 'LIFT-A-01',
    name: 'Lif Penumpang 1 Blok A',
    category: 'lift',
    status: 'operational',
    dependentZoneIds: ['zone-a-low', 'zone-a-high'],
  },
  // Blok C Facilities (Demo)
  {
    id: 'fac-c-pump-main',
    buildingId: 'bldg-c',
    facilityCode: 'PUMP-C-MAIN',
    name: 'Pam Sedutan Utama Blok C',
    category: 'water_supply',
    status: 'operational',
    dependentZoneIds: ['zone-c-low', 'zone-c-high'],
  },
];

export const DEMO_ACTIVE_BULLETINS = [
  {
    updateId: 'upd-demo-01',
    incidentId: 'inc-demo-01',
    incidentNumber: 'INC-2026-0042',
    buildingCode: 'BLK_B',
    buildingName: 'Blok B',
    category: 'water_supply' as const,
    severity: 'major' as const,
    incidentStatus: 'in_maintenance' as const,
    updateTitle: 'Gangguan Bekalan Air Zon Tinggi (Tingkat 8-15)',
    messageBm: 'Pasukan teknikal sedang membaiki pam penggalak aras bumbung yang mengalami masalah tekanan. Bekalan air dijangka pulih berperingkat bermula 6:30 petang.',
    stage: 'contractor_assigned' as const,
    publishedAt: '2026-10-16T15:30:00+08:00',
    supportNotice: {
      type: 'water_tanker' as const,
      location: 'Dataran Tempat Letak Kereta Blok B',
      availableFrom: '5:00 petang',
      instructions: 'Penduduk diminta membawa bekas bertutup. Keutamaan diberikan kepada warga emas dan OKU.',
    },
  },
];
