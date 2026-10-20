// ==============================================================================
// Database Types for Supabase Schema (PPR NADI)
// ==============================================================================

export type UserRole = 'resident' | 'management';
export type FacilityCategory = 'water_supply' | 'lift' | 'corridor_lighting' | 'other';
export type FacilityStatus = 'operational' | 'degraded' | 'offline';
export type ZoneType = 'residential_floors' | 'lobby' | 'lift_shaft' | 'roof_tank' | 'basement';
export type DependencyType = 'primary_feeder' | 'secondary_feeder' | 'lighting_circuit' | 'vertical_transport';
export type CriticalityLevel = 'critical' | 'high' | 'medium' | 'low';
export type ReportStatus = 'submitted' | 'reviewed' | 'linked' | 'dismissed';
export type UrgencyHint = 'low' | 'medium' | 'high' | 'urgent';
export type IncidentSeverity = 'critical' | 'major' | 'minor';
export type IncidentStatus = 'investigating' | 'confirmed' | 'in_maintenance' | 'restored' | 'closed';
export type UpdateStage = 'investigation' | 'contractor_assigned' | 'parts_ordered' | 'testing' | 'restored';
export type TaskStatus = 'assigned' | 'on_site' | 'awaiting_parts' | 'completed';
export type SupportType = 'water_tanker' | 'shuttle_lift' | 'portable_lamp' | 'bottled_water_hub';

export interface ProfileRow {
  id: string;
  role: UserRole;
  full_name: string;
  phone_number: string | null;
  assigned_estate_id: string | null;
  assigned_building_id: string | null;
  unit_number: string | null;
  created_at: string;
  updated_at: string;
}

export interface BuildingRow {
  id: string;
  estate_id: string;
  code: string;
  name: string;
  total_floors: number;
  total_units: number | null;
  created_at: string;
}

export interface ServiceZoneRow {
  id: string;
  building_id: string;
  zone_code: string;
  name: string;
  floor_start: number;
  floor_end: number;
  zone_type: ZoneType;
  created_at: string;
}

export interface FacilityRow {
  id: string;
  building_id: string;
  facility_code: string;
  name: string;
  category: FacilityCategory;
  location_details: string | null;
  operational_status: FacilityStatus;
  created_at: string;
  updated_at: string;
}

export interface FacilityDependencyRow {
  id: string;
  facility_id: string;
  service_zone_id: string;
  dependency_type: DependencyType;
  criticality: CriticalityLevel;
  created_at: string;
}

export interface IncidentReportRow {
  id: string;
  reporter_id: string;
  building_id: string;
  service_zone_id: string | null;
  category: FacilityCategory;
  description: string;
  status: ReportStatus;
  urgency_hint: UrgencyHint;
  created_at: string;
  updated_at: string;
}

export interface ReportAttachmentRow {
  id: string;
  report_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  file_size_bytes: number;
  uploaded_at: string;
}

export interface IncidentRow {
  id: string;
  incident_number: string;
  primary_facility_id: string | null;
  building_id: string;
  title: string;
  category: FacilityCategory;
  severity: IncidentSeverity;
  status: IncidentStatus;
  internal_notes: string | null; // PRIVATE
  verified_by: string | null;
  verified_at: string | null;
  restoration_evidence: string | null; // PRIVATE
  restored_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface IncidentReportLinkRow {
  id: string;
  incident_id: string;
  report_id: string;
  linked_at: string;
  linked_by: string | null;
}

export interface IncidentUpdateRow {
  id: string;
  incident_id: string;
  update_title: string;
  message_bm: string;
  stage: UpdateStage;
  is_published: boolean;
  published_at: string | null;
  published_by: string | null;
  created_at: string;
}

export interface MaintenanceTaskRow {
  id: string;
  incident_id: string;
  task_title: string;
  contractor_name: string | null;
  status: TaskStatus;
  started_at: string | null;
  completed_at: string | null;
  technician_notes: string | null;
  created_at: string;
}

export interface TemporarySupportNoticeRow {
  id: string;
  incident_id: string;
  support_type: SupportType;
  location_description: string;
  available_from: string;
  available_until: string | null;
  instructions_bm: string;
  is_active: boolean;
  created_at: string;
}

export interface AuditEventRow {
  estate_id: string;
  id: string;
  actor_id: string | null;
  action: string;
  target_entity: string;
  target_id: string;
  previous_state: Record<string, unknown> | null;
  new_state: Record<string, unknown> | null;
  created_at: string;
}

/**
 * Safe public projection for resident view
 */
export interface PublishedIncidentBulletin {
  estate_id: string;
  update_id: string;
  incident_id: string;
  incident_number: string;
  building_id: string;
  building_name: string;
  building_code: string;
  category: FacilityCategory;
  severity: IncidentSeverity;
  incident_status: IncidentStatus;
  update_title: string;
  message_bm: string;
  stage: UpdateStage;
  published_at: string;
}

export interface ReportPriorityEvaluationRow {
  id: string;
  report_id: string;
  input_fingerprint: string;
  policy_version: string;
  ai_model: string;
  ai_provider: string;
  extracted_facts: Record<string, unknown>;
  rule_result: Record<string, unknown>;
  recommended_priority: 'immediate_review' | 'high_priority' | 'standard_review';
  needs_more_info: boolean;
  created_at: string;
}

export interface ReportPriorityDecisionRow {
  id: string;
  report_id: string;
  evaluation_id: string | null;
  decided_priority: 'immediate_review' | 'high_priority' | 'standard_review' | 'needs_more_info';
  is_override: boolean;
  override_reason: string | null;
  decided_by: string;
  idempotency_key: string | null;
  decision_version: number;
  decided_at: string;
}

