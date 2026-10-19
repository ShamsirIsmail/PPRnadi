-- ==============================================================================
-- Migration: 20261019150000_incident_link_immutability.sql
-- Description: Enforce strict link immutability on incident_report_links to prevent
--              uncoordinated link moves between incidents, and ensure consistent
--              locking order across all link operations.
-- ==============================================================================

-- 1. Update the concurrency guard function to strictly reject mutation of
--    incident_id or report_id on UPDATE operations.
CREATE OR REPLACE FUNCTION public.guard_incident_link_concurrency()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_inc_id UUID;
BEGIN
  -- Strict Link Immutability:
  -- The application architecture does not support moving links between reports or incidents.
  -- Re-associating a link requires deleting the old link and creating a new one.
  -- Any direct attempt to change incident_id or report_id via UPDATE is strictly rejected.
  IF TG_OP = 'UPDATE' THEN
    IF (OLD.incident_id IS DISTINCT FROM NEW.incident_id OR OLD.report_id IS DISTINCT FROM NEW.report_id) THEN
      RAISE EXCEPTION 'LINK_MUTATION_NOT_SUPPORTED: Pemindahan pautan tidak disokong. Sila padam dan cipta semula pautan.'
        USING ERRCODE = '0A000'; -- feature_not_supported
    END IF;
    -- If non-key fields are updated (if any), touch incident
    v_inc_id := NEW.incident_id;
  ELSE
    v_inc_id := COALESCE(NEW.incident_id, OLD.incident_id);
  END IF;

  IF v_inc_id IS NOT NULL THEN
    -- Lock shared incident row FOR UPDATE to serialize concurrent link alterations
    PERFORM 1 FROM public.incidents WHERE id = v_inc_id FOR UPDATE;

    -- Bump incident timestamp
    UPDATE public.incidents
    SET updated_at = timezone('utc'::text, now())
    WHERE id = v_inc_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 2. Ensure BEFORE UPDATE trigger exists and is ENABLE ALWAYS
DROP TRIGGER IF EXISTS trg_incident_link_concurrency_update ON public.incident_report_links;
CREATE TRIGGER trg_incident_link_concurrency_update
  BEFORE UPDATE ON public.incident_report_links
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_incident_link_concurrency();

ALTER TABLE public.incident_report_links ENABLE ALWAYS TRIGGER trg_incident_link_concurrency_update;
