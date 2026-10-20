-- ==============================================================================
-- PPR NADI Migration: Support 'other' Facility Category Safely
-- ==============================================================================
-- 1. Updates CHECK constraints on incident_reports, incidents, and facilities
--    to include 'other' alongside 'water_supply', 'lift', 'corridor_lighting'.
-- 2. Preserves 100% of existing rows and column data.
-- 3. Fully idempotent and safe for repeated execution on local and cloud databases.
-- ==============================================================================

-- 1. Update incident_reports category check constraint
DO $$
BEGIN
  ALTER TABLE public.incident_reports DROP CONSTRAINT IF EXISTS incident_reports_category_check;
  ALTER TABLE public.incident_reports 
    ADD CONSTRAINT incident_reports_category_check 
    CHECK (category IN ('water_supply', 'lift', 'corridor_lighting', 'other'));
END $$;

-- 2. Update incidents category check constraint
DO $$
BEGIN
  ALTER TABLE public.incidents DROP CONSTRAINT IF EXISTS incidents_category_check;
  ALTER TABLE public.incidents 
    ADD CONSTRAINT incidents_category_check 
    CHECK (category IN ('water_supply', 'lift', 'corridor_lighting', 'other'));
END $$;

-- 3. Update facilities category check constraint
DO $$
BEGIN
  ALTER TABLE public.facilities DROP CONSTRAINT IF EXISTS facilities_category_check;
  ALTER TABLE public.facilities 
    ADD CONSTRAINT facilities_category_check 
    CHECK (category IN ('water_supply', 'lift', 'corridor_lighting', 'other'));
END $$;
