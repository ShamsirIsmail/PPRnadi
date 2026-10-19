-- ==============================================================================
-- PPR NADI Migration 01: Core Domain Schema
-- ==============================================================================
-- Fictional Estate: PPR Sentosa (SYNTHETIC DEMO)
-- Infrastructure Resilience, Resident Continuity & Connected Problem Intelligence

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------------------------
-- 1. Profiles (Linked to Supabase Auth)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'resident' CHECK (role IN ('resident', 'management')),
  full_name TEXT NOT NULL,
  phone_number TEXT,
  assigned_estate_id TEXT, -- NULL until provisioned by a trusted administrator
  assigned_building_id UUID,
  unit_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.profiles IS 'User profiles linked to auth.users. Role is strictly server-managed.';

-- ------------------------------------------------------------------------------
-- 2. Buildings (PPR Residential Blocks)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.buildings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estate_id TEXT NOT NULL DEFAULT 'ppr-sentosa-demo',
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  total_floors INTEGER NOT NULL CHECK (total_floors > 0),
  total_units INTEGER NOT NULL CHECK (total_units > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Foreign key back-reference from profiles to buildings
ALTER TABLE public.profiles 
  ADD CONSTRAINT fk_profiles_building 
  FOREIGN KEY (assigned_building_id) REFERENCES public.buildings(id) ON DELETE SET NULL;

-- ------------------------------------------------------------------------------
-- 3. Service Zones (Floors or Infrastructure Service Areas)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.service_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id UUID NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  zone_code TEXT NOT NULL,
  name TEXT NOT NULL,
  floor_start INTEGER NOT NULL CHECK (floor_start >= 1),
  floor_end INTEGER NOT NULL CHECK (floor_end >= 1),
  zone_type TEXT NOT NULL CHECK (zone_type IN ('residential_floors', 'lobby', 'lift_shaft', 'roof_tank', 'basement')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_service_zones_floor_range CHECK (floor_start <= floor_end)
);

-- ------------------------------------------------------------------------------
-- 4. Facilities (Pumps, Lifts, Lighting Circuits)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.facilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id UUID NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  facility_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('water_supply', 'lift', 'corridor_lighting')),
  location_details TEXT,
  operational_status TEXT NOT NULL DEFAULT 'operational' CHECK (operational_status IN ('operational', 'degraded', 'offline')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 5. Facility Dependencies (Mapping Assets to Dependent Service Zones)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.facility_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  service_zone_id UUID NOT NULL REFERENCES public.service_zones(id) ON DELETE CASCADE,
  dependency_type TEXT NOT NULL CHECK (dependency_type IN ('primary_feeder', 'secondary_feeder', 'lighting_circuit', 'vertical_transport')),
  criticality TEXT NOT NULL DEFAULT 'high' CHECK (criticality IN ('critical', 'high', 'medium', 'low')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_facility_service_zone UNIQUE (facility_id, service_zone_id)
);

-- ------------------------------------------------------------------------------
-- 6. Incident Reports (Private Reports Submitted by Residents)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.incident_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  building_id UUID NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  service_zone_id UUID REFERENCES public.service_zones(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK (category IN ('water_supply', 'lift', 'corridor_lighting')),
  description TEXT NOT NULL CHECK (length(trim(description)) BETWEEN 5 AND 1000),
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'reviewed', 'linked', 'dismissed')),
  urgency_hint TEXT NOT NULL DEFAULT 'medium' CHECK (urgency_hint IN ('low', 'medium', 'high', 'urgent')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 7. Report Attachments (Metadata for Private Photos in Storage)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.report_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.incident_reports(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  file_size_bytes INTEGER NOT NULL CHECK (file_size_bytes BETWEEN 1 AND 5242880),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 8. Incidents (Management-Recognised & Verified Infrastructure Incidents)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_number TEXT NOT NULL UNIQUE,
  primary_facility_id UUID REFERENCES public.facilities(id) ON DELETE SET NULL,
  building_id UUID NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('water_supply', 'lift', 'corridor_lighting')),
  severity TEXT NOT NULL DEFAULT 'major' CHECK (severity IN ('critical', 'major', 'minor')),
  status TEXT NOT NULL DEFAULT 'investigating' CHECK (status IN ('investigating', 'confirmed', 'in_maintenance', 'restored', 'closed')),
  internal_notes TEXT, -- PRIVATE TO MANAGEMENT
  verified_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ,
  restoration_evidence TEXT, -- PRIVATE TO MANAGEMENT
  restored_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 9. Incident Report Links (Many Resident Reports to One Incident)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.incident_report_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES public.incidents(id) ON DELETE CASCADE,
  report_id UUID NOT NULL REFERENCES public.incident_reports(id) ON DELETE CASCADE,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  linked_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT uq_incident_report_link UNIQUE (report_id)
);

-- ------------------------------------------------------------------------------
-- 10. Incident Updates (Official Verified Updates Published to Residents)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.incident_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES public.incidents(id) ON DELETE CASCADE,
  update_title TEXT NOT NULL,
  message_bm TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('investigation', 'contractor_assigned', 'parts_ordered', 'testing', 'restored')),
  is_published BOOLEAN NOT NULL DEFAULT false,
  published_at TIMESTAMPTZ,
  published_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 11. Maintenance Tasks (Actions Coordinated by Management)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.maintenance_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES public.incidents(id) ON DELETE CASCADE,
  task_title TEXT NOT NULL,
  contractor_name TEXT,
  status TEXT NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'on_site', 'awaiting_parts', 'completed')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  technician_notes TEXT, -- PRIVATE TO MANAGEMENT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 12. Temporary Support Notices (Relief Actions for Residents)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.temporary_support_notices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES public.incidents(id) ON DELETE CASCADE,
  support_type TEXT NOT NULL CHECK (support_type IN ('water_tanker', 'shuttle_lift', 'portable_lamp', 'bottled_water_hub')),
  location_description TEXT NOT NULL,
  available_from TIMESTAMPTZ NOT NULL,
  available_until TIMESTAMPTZ,
  instructions_bm TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 13. Audit Events (Operational and Security-Sensitive State Changes)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estate_id TEXT NOT NULL,
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_entity TEXT NOT NULL,
  target_id UUID NOT NULL,
  previous_state JSONB,
  new_state JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- Indexes for Performance & Query Scaling
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_buildings_estate ON public.buildings(estate_id);
CREATE INDEX IF NOT EXISTS idx_service_zones_building ON public.service_zones(building_id);
CREATE INDEX IF NOT EXISTS idx_facilities_building ON public.facilities(building_id);
CREATE INDEX IF NOT EXISTS idx_facilities_category ON public.facilities(category);
CREATE INDEX IF NOT EXISTS idx_incident_reports_reporter ON public.incident_reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_incident_reports_building ON public.incident_reports(building_id);
CREATE INDEX IF NOT EXISTS idx_incident_reports_status ON public.incident_reports(status);
CREATE INDEX IF NOT EXISTS idx_incidents_building ON public.incidents(building_id);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON public.incidents(status);
CREATE INDEX IF NOT EXISTS idx_incident_updates_incident ON public.incident_updates(incident_id);
CREATE INDEX IF NOT EXISTS idx_incident_updates_published ON public.incident_updates(is_published);
CREATE INDEX IF NOT EXISTS idx_temporary_support_incident ON public.temporary_support_notices(incident_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_target ON public.audit_events(target_entity, target_id);
