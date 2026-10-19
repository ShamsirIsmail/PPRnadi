// ==============================================================================
// Estate Visual Typed Data Contract
// ==============================================================================
// Integration Boundary: src/components/estate/
// Supports both the verified PPR/PA Desa Rejang field study site (12 blocks A-L)
// and the isolated synthetic demonstration dataset (PPR Sentosa).

import type { FacilityCategory, FacilityStatus, IncidentSeverity, IncidentStatus } from '@/types/database';

export interface EstateBuildingData {
  id: string;
  code: string;                      // "DR_BLK_A" | "BLK_A"
  name: string;                      // "Blok A"
  totalFloors?: number | null;       // null if unverified by field survey (do not hallucinate)
  temporaryDemoFloors?: number | null; // User-permitted temporary demo assumption (18, 17, 16, 15)
  totalUnits?: number | null;        // null if unverified
  totalLifts?: number | null;        // null if unverified
  cluster?: 'utara' | 'tengah' | 'selatan';
  clusterLabel?: string;
  verificationStatus?: 'verified' | 'pending_verification' | 'unverified';
  activeIncidentCount: number;
  worstStatus: FacilityStatus;
  notes?: string;
}

export interface EstateZoneData {
  id: string;
  buildingId: string;
  zoneCode: string;
  name: string;
  floorRange?: [number, number];     // [1, 7] or undefined if unverified
  isAffected: boolean;
  activeIncidentIds: string[];
}

export interface EstateFacilityData {
  id: string;
  buildingId: string;
  facilityCode: string;
  name: string;
  category: FacilityCategory;
  status: FacilityStatus;
  dependentZoneIds: string[];
  verified?: boolean;
}

export interface EstateIncidentSummary {
  id: string;
  incidentNumber: string;
  buildingId: string;
  category: FacilityCategory;
  severity: IncidentSeverity;
  status: IncidentStatus;
  title: string;
  affectedZoneIds: string[];
  isSyntheticDemo?: boolean;         // Differentiates synthetic demonstration incidents from real estate status
}

export interface BuildingVisualProps {
  buildings: EstateBuildingData[];
  selectedBuildingId: string | null;
  zones: EstateZoneData[];
  facilities: EstateFacilityData[];
  incidents?: EstateIncidentSummary[];
  estateTitle?: string;
  estateSubtitle?: string;
  isDemoEnvironment?: boolean;
  onSelectBuilding?: (buildingId: string) => void;
  onSelectZone?: (zoneId: string) => void;
  className?: string;
  showOverlayStats?: boolean;
}
