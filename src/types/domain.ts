// ==============================================================================
// Domain Models and View Models (PPR NADI)
// ==============================================================================

import type { 
  FacilityCategory, 
  FacilityStatus, 
  IncidentSeverity, 
  UpdateStage, 
  UserRole 
} from './database';

export interface AuthUserContext {
  id: string;
  email?: string;
  fullName: string;
  role: UserRole;
  assignedEstateId: string;
  assignedBuildingId?: string | null;
  unitNumber?: string | null;
}

export interface BuildingSummary {
  id: string;
  code: string;
  name: string;
  totalFloors: number;
  totalUnits: number;
  activeIncidentCount: number;
  overallStatus: FacilityStatus;
}

export interface ResidentReportSubmission {
  buildingId: string;
  serviceZoneId?: string;
  category: FacilityCategory;
  description: string;
  urgencyHint: 'low' | 'medium' | 'high' | 'urgent';
}

export interface ManagementVerificationAction {
  incidentId?: string;
  createNewIncident: boolean;
  incidentTitle?: string;
  category: FacilityCategory;
  severity: IncidentSeverity;
  primaryFacilityId?: string;
  internalNotes: string;
}

export interface PublishBulletinAction {
  incidentId: string;
  updateTitle: string;
  messageBm: string;
  stage: UpdateStage;
}

export interface RestorationVerificationAction {
  incidentId: string;
  restorationEvidence: string;
  closureRemarks: string;
}
