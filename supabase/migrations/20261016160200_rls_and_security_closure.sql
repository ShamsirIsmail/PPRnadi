-- Phase 01B. Fresh-project migrations only; NOT executed by this task.
-- Private domain tables never become resident-readable because a notice is published.
-- Helpers deliberately use the migration owner to avoid recursive profile RLS.
REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.is_estate_member(p_estate TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()
   AND assigned_estate_id = p_estate);
$$;
CREATE FUNCTION public.manages_estate(p_estate TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()
   AND role = 'management' AND assigned_estate_id = p_estate);
$$;
CREATE FUNCTION public.manages_building(p_building UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT EXISTS (SELECT 1 FROM public.buildings b WHERE b.id = p_building
   AND public.manages_estate(b.estate_id));
$$;
CREATE FUNCTION public.belongs_to_building(p_building UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT EXISTS (SELECT 1 FROM public.profiles p JOIN public.buildings b
   ON b.id = p.assigned_building_id AND b.estate_id = p.assigned_estate_id
   WHERE p.id = auth.uid() AND b.id = p_building);
$$;
CREATE FUNCTION public.manages_incident(p_incident UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT EXISTS (SELECT 1 FROM public.incidents i WHERE i.id = p_incident
   AND public.manages_building(i.building_id));
$$;
CREATE FUNCTION public.owns_report(p_report UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT EXISTS (SELECT 1 FROM public.incident_reports r WHERE r.id = p_report
   AND r.reporter_id = auth.uid() AND public.belongs_to_building(r.building_id));
$$;
CREATE FUNCTION public.manages_report(p_report UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT EXISTS (SELECT 1 FROM public.incident_reports r WHERE r.id = p_report
   AND public.manages_building(r.building_id));
$$;

-- Only a service-role backend or direct trusted database administrator provisions
-- roles/membership. Management JWTs cannot provision themselves or anyone else.
CREATE FUNCTION public.guard_profile() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE trusted BOOLEAN := coalesce(auth.role() = 'service_role', false)
 OR (session_user IN ('postgres', 'supabase_admin') AND auth.uid() IS NULL);
BEGIN
 IF NOT trusted THEN
   IF TG_OP = 'INSERT' THEN
     IF NEW.role <> 'resident' OR NEW.assigned_estate_id IS NOT NULL
       OR NEW.assigned_building_id IS NOT NULL OR NEW.unit_number IS NOT NULL THEN
       RAISE EXCEPTION 'Profile assignments require trusted provisioning' USING ERRCODE = '42501';
     END IF;
   ELSIF ROW(OLD.id, OLD.role, OLD.assigned_estate_id, OLD.assigned_building_id, OLD.unit_number)
     IS DISTINCT FROM ROW(NEW.id, NEW.role, NEW.assigned_estate_id, NEW.assigned_building_id, NEW.unit_number) THEN
     RAISE EXCEPTION 'Profile assignments are protected' USING ERRCODE = '42501';
   END IF;
 END IF;
 IF NEW.assigned_building_id IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM public.buildings b WHERE b.id = NEW.assigned_building_id
     AND b.estate_id = NEW.assigned_estate_id
 ) THEN RAISE EXCEPTION 'Profile building must belong to assigned estate'; END IF;
 IF NEW.role = 'management' AND NEW.assigned_estate_id IS NULL THEN
   RAISE EXCEPTION 'Management requires a trusted estate assignment';
 END IF;
 NEW.updated_at := now();
 RETURN NEW;
END;
$$;
CREATE TRIGGER profile_guard BEFORE INSERT OR UPDATE ON public.profiles
 FOR EACH ROW EXECUTE FUNCTION public.guard_profile();

-- Keep parent identity/scope stable, including against concurrent child writes.
-- Floor-count changes use an administrative migration rather than ordinary CRUD.
CREATE FUNCTION public.guard_infrastructure() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
 IF TG_OP = 'UPDATE' THEN
   IF NEW.id IS DISTINCT FROM OLD.id THEN RAISE EXCEPTION 'Identity is immutable'; END IF;
   IF TG_TABLE_NAME = 'buildings' THEN
     IF ROW(NEW.estate_id, NEW.total_floors) IS DISTINCT FROM ROW(OLD.estate_id, OLD.total_floors) THEN
       RAISE EXCEPTION 'Building scope and floor count require an administrative migration';
     END IF;
   ELSIF TG_TABLE_NAME = 'facilities' THEN
     IF ROW(NEW.building_id, NEW.category) IS DISTINCT FROM ROW(OLD.building_id, OLD.category) THEN
       RAISE EXCEPTION 'Facility scope and category are immutable';
     END IF;
   ELSIF NEW.building_id IS DISTINCT FROM OLD.building_id THEN
     RAISE EXCEPTION 'Zone building is immutable';
   END IF;
 END IF;
 IF TG_TABLE_NAME = 'service_zones' THEN
   IF NOT EXISTS (
     SELECT 1 FROM public.buildings b WHERE b.id = NEW.building_id
       AND NEW.floor_start >= 1 AND NEW.floor_end BETWEEN NEW.floor_start AND b.total_floors
   ) THEN RAISE EXCEPTION 'Zone floors exceed building range'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER building_guard BEFORE INSERT OR UPDATE ON public.buildings
 FOR EACH ROW EXECUTE FUNCTION public.guard_infrastructure();
CREATE TRIGGER zone_guard BEFORE INSERT OR UPDATE ON public.service_zones
 FOR EACH ROW EXECUTE FUNCTION public.guard_infrastructure();
CREATE TRIGGER facility_guard BEFORE INSERT OR UPDATE ON public.facilities
 FOR EACH ROW EXECUTE FUNCTION public.guard_infrastructure();

CREATE FUNCTION public.guard_report() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
 IF TG_OP = 'INSERT' THEN
   IF NEW.reporter_id IS DISTINCT FROM auth.uid() OR NEW.status <> 'submitted'
     OR NOT public.belongs_to_building(NEW.building_id) THEN
     RAISE EXCEPTION 'Reports require own assigned building and submitted status' USING ERRCODE = '42501';
   END IF;
   NEW.created_at := now();
 ELSE
   IF ROW(NEW.id, NEW.reporter_id, NEW.building_id, NEW.service_zone_id, NEW.category, NEW.created_at)
      IS DISTINCT FROM ROW(OLD.id, OLD.reporter_id, OLD.building_id, OLD.service_zone_id, OLD.category, OLD.created_at) THEN
     RAISE EXCEPTION 'Report identity and scope are immutable';
   END IF;
   IF NOT public.manages_building(OLD.building_id) THEN
     RAISE EXCEPTION 'Only assigned management may triage' USING ERRCODE = '42501';
   END IF;
   IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
     (OLD.status = 'submitted' AND NEW.status IN ('reviewed', 'dismissed')) OR
     (OLD.status = 'reviewed' AND NEW.status IN ('linked', 'dismissed'))
   ) THEN RAISE EXCEPTION 'Invalid report transition'; END IF;
   IF NEW.status = 'linked' AND NOT EXISTS (SELECT 1 FROM public.incident_report_links l WHERE l.report_id = NEW.id) THEN
     RAISE EXCEPTION 'Linked report requires an incident link';
   END IF;
 END IF;
 IF NEW.service_zone_id IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM public.service_zones z WHERE z.id = NEW.service_zone_id AND z.building_id = NEW.building_id
 ) THEN RAISE EXCEPTION 'Report zone must belong to building'; END IF;
 NEW.updated_at := now();
 RETURN NEW;
END;
$$;
CREATE TRIGGER report_guard BEFORE INSERT OR UPDATE ON public.incident_reports
 FOR EACH ROW EXECUTE FUNCTION public.guard_report();

CREATE FUNCTION public.guard_incident() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
 IF NOT public.manages_building(NEW.building_id) THEN
   RAISE EXCEPTION 'Assigned management required' USING ERRCODE = '42501';
 END IF;
 IF TG_OP = 'INSERT' THEN
   IF NEW.status <> 'investigating' OR NEW.verified_by IS NOT NULL OR NEW.verified_at IS NOT NULL
     OR NEW.restored_at IS NOT NULL OR NEW.restoration_evidence IS NOT NULL THEN
     RAISE EXCEPTION 'Incidents must start investigating without verification';
   END IF;
   NEW.created_at := now();
 ELSE
   IF ROW(NEW.id, NEW.building_id, NEW.category, NEW.created_at, NEW.incident_number)
      IS DISTINCT FROM ROW(OLD.id, OLD.building_id, OLD.category, OLD.created_at, OLD.incident_number) THEN
     RAISE EXCEPTION 'Incident identity and scope are immutable';
   END IF;
   IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
     (OLD.status = 'investigating' AND NEW.status = 'confirmed') OR
     (OLD.status = 'confirmed' AND NEW.status = 'in_maintenance') OR
     (OLD.status = 'in_maintenance' AND NEW.status = 'restored') OR
     (OLD.status = 'restored' AND NEW.status = 'closed')
   ) THEN RAISE EXCEPTION 'Invalid incident transition'; END IF;
   IF OLD.status = 'investigating' AND NEW.status = 'confirmed' THEN
     NEW.verified_by := auth.uid(); NEW.verified_at := now();
   ELSIF ROW(NEW.verified_by, NEW.verified_at) IS DISTINCT FROM ROW(OLD.verified_by, OLD.verified_at) THEN
     RAISE EXCEPTION 'Verification attribution is immutable';
   END IF;
   IF OLD.status = 'in_maintenance' AND NEW.status = 'restored' THEN
     IF length(trim(coalesce(NEW.restoration_evidence, ''))) < 5 THEN
       RAISE EXCEPTION 'Restoration requires physical verification evidence';
     END IF;
     NEW.restored_at := now();
   ELSIF ROW(NEW.restoration_evidence, NEW.restored_at) IS DISTINCT FROM ROW(OLD.restoration_evidence, OLD.restored_at) THEN
     RAISE EXCEPTION 'Restoration evidence is set only on restoration';
   END IF;
 END IF;
 IF NEW.primary_facility_id IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM public.facilities f WHERE f.id = NEW.primary_facility_id
     AND f.building_id = NEW.building_id AND f.category = NEW.category
 ) THEN RAISE EXCEPTION 'Incident facility must match building and category'; END IF;
 NEW.updated_at := now();
 RETURN NEW;
END;
$$;
CREATE TRIGGER incident_guard BEFORE INSERT OR UPDATE ON public.incidents
 FOR EACH ROW EXECUTE FUNCTION public.guard_incident();

CREATE FUNCTION public.guard_update() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE incident public.incidents;
BEGIN
 SELECT * INTO incident FROM public.incidents WHERE id = NEW.incident_id FOR SHARE;
 IF NOT FOUND OR NOT public.manages_building(incident.building_id) THEN
   RAISE EXCEPTION 'Assigned incident management required' USING ERRCODE = '42501';
 END IF;
 IF TG_OP = 'UPDATE' THEN
   IF ROW(NEW.id, NEW.incident_id, NEW.created_at) IS DISTINCT FROM ROW(OLD.id, OLD.incident_id, OLD.created_at) THEN
     RAISE EXCEPTION 'Update identity and incident are immutable';
   END IF;
 END IF;
 IF NEW.is_published THEN
   IF incident.verified_by IS NULL OR incident.verified_at IS NULL OR incident.status = 'investigating' THEN
     RAISE EXCEPTION 'Publication requires a verified incident';
   END IF;
   IF NEW.stage = 'restored' AND incident.status NOT IN ('restored', 'closed') THEN
     RAISE EXCEPTION 'Restored bulletin requires confirmed restoration';
   END IF;
   NEW.published_by := auth.uid(); NEW.published_at := now();
 ELSE
   NEW.published_by := NULL; NEW.published_at := NULL;
 END IF;
 IF length(trim(NEW.update_title)) < 5 OR length(trim(NEW.message_bm)) < 10 THEN
   RAISE EXCEPTION 'Bulletin title and message are required';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER update_guard BEFORE INSERT OR UPDATE ON public.incident_updates
 FOR EACH ROW EXECUTE FUNCTION public.guard_update();

CREATE FUNCTION public.guard_link() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE report public.incident_reports; incident public.incidents;
BEGIN
 SELECT * INTO report FROM public.incident_reports WHERE id = NEW.report_id FOR UPDATE;
 SELECT * INTO incident FROM public.incidents WHERE id = NEW.incident_id FOR SHARE;
 IF report.id IS NULL OR incident.id IS NULL OR report.building_id <> incident.building_id
   OR report.category <> incident.category OR report.status <> 'reviewed'
   OR incident.verified_at IS NULL OR incident.status NOT IN ('confirmed', 'in_maintenance')
   OR NOT public.manages_building(incident.building_id) THEN
   RAISE EXCEPTION 'Link requires reviewed report and compatible verified incident';
 END IF;
 NEW.linked_by := auth.uid(); NEW.linked_at := now();
 RETURN NEW;
END;
$$;
CREATE TRIGGER link_guard BEFORE INSERT ON public.incident_report_links
 FOR EACH ROW EXECUTE FUNCTION public.guard_link();
CREATE FUNCTION public.mark_report_linked() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
 UPDATE public.incident_reports SET status = 'linked' WHERE id = NEW.report_id;
 RETURN NEW;
END;
$$;
CREATE TRIGGER link_report AFTER INSERT ON public.incident_report_links
 FOR EACH ROW EXECUTE FUNCTION public.mark_report_linked();

CREATE FUNCTION public.guard_dependency() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.facilities f JOIN public.service_zones z
   ON z.building_id = f.building_id WHERE f.id = NEW.facility_id AND z.id = NEW.service_zone_id) THEN
   RAISE EXCEPTION 'Dependency must connect facility and zone in same building';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER dependency_guard BEFORE INSERT OR UPDATE ON public.facility_dependencies
 FOR EACH ROW EXECUTE FUNCTION public.guard_dependency();

CREATE FUNCTION public.guard_maintenance() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
 IF NOT public.manages_incident(NEW.incident_id) THEN
   RAISE EXCEPTION 'Assigned management required' USING ERRCODE = '42501';
 END IF;
 IF TG_OP = 'INSERT' THEN
   IF NEW.status <> 'assigned' THEN RAISE EXCEPTION 'Task starts assigned'; END IF;
   NEW.started_at := NULL; NEW.completed_at := NULL;
 ELSE
   IF ROW(NEW.id, NEW.incident_id, NEW.created_at) IS DISTINCT FROM ROW(OLD.id, OLD.incident_id, OLD.created_at) THEN
     RAISE EXCEPTION 'Task identity and incident are immutable';
   END IF;
   IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
     (OLD.status = 'assigned' AND NEW.status IN ('on_site', 'awaiting_parts')) OR
     (OLD.status = 'on_site' AND NEW.status IN ('awaiting_parts', 'completed')) OR
     (OLD.status = 'awaiting_parts' AND NEW.status = 'on_site')
   ) THEN RAISE EXCEPTION 'Invalid maintenance transition'; END IF;
   NEW.started_at := OLD.started_at; NEW.completed_at := OLD.completed_at;
   IF NEW.status = 'on_site' AND OLD.started_at IS NULL THEN NEW.started_at := now(); END IF;
   IF NEW.status = 'completed' AND OLD.status <> 'completed' THEN NEW.completed_at := now(); END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER maintenance_guard BEFORE INSERT OR UPDATE ON public.maintenance_tasks
 FOR EACH ROW EXECUTE FUNCTION public.guard_maintenance();

-- A physical read model, NOT an invoker/definer view. No private-table grants or
-- resident policies are needed to read bulletins. Clients cannot mutate it.
CREATE TABLE public.published_incident_bulletins (
 update_id UUID PRIMARY KEY REFERENCES public.incident_updates(id) ON DELETE CASCADE,
 incident_id UUID NOT NULL REFERENCES public.incidents(id) ON DELETE CASCADE,
 estate_id TEXT NOT NULL,
 incident_number TEXT NOT NULL,
 building_id UUID NOT NULL REFERENCES public.buildings(id),
 building_name TEXT NOT NULL,
 building_code TEXT NOT NULL,
 category TEXT NOT NULL,
 severity TEXT NOT NULL,
 incident_status TEXT NOT NULL,
 update_title TEXT NOT NULL,
 message_bm TEXT NOT NULL,
 stage TEXT NOT NULL,
 published_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX bulletin_estate_idx ON public.published_incident_bulletins(estate_id, published_at DESC);
CREATE FUNCTION public.sync_bulletin() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
 IF NOT NEW.is_published THEN
   DELETE FROM public.published_incident_bulletins WHERE update_id = NEW.id;
 ELSE
   INSERT INTO public.published_incident_bulletins
   SELECT NEW.id, i.id, b.estate_id, i.incident_number, b.id, b.name, b.code,
     i.category, i.severity, i.status, NEW.update_title, NEW.message_bm, NEW.stage, NEW.published_at
   FROM public.incidents i JOIN public.buildings b ON b.id = i.building_id WHERE i.id = NEW.incident_id
   ON CONFLICT (update_id) DO UPDATE SET update_title = EXCLUDED.update_title,
     message_bm = EXCLUDED.message_bm, stage = EXCLUDED.stage, published_at = EXCLUDED.published_at;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER bulletin_sync AFTER INSERT OR UPDATE ON public.incident_updates
 FOR EACH ROW EXECUTE FUNCTION public.sync_bulletin();
CREATE FUNCTION public.sync_incident_bulletins() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
 UPDATE public.published_incident_bulletins SET incident_status = NEW.status,
   severity = NEW.severity WHERE incident_id = NEW.id;
 RETURN NEW;
END;
$$;
CREATE TRIGGER incident_bulletin_sync AFTER UPDATE ON public.incidents
 FOR EACH ROW EXECUTE FUNCTION public.sync_incident_bulletins();

-- Audit inserts run in the SAME transaction as each mutation. A failure aborts
-- the mutation. No authenticated INSERT/UPDATE/DELETE grant or policy exists.
CREATE FUNCTION public.record_domain_audit() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE scope TEXT; action_name TEXT := TG_TABLE_NAME || '.' || lower(TG_OP);
BEGIN
 IF TG_TABLE_NAME IN ('incident_reports', 'incidents') THEN
   SELECT estate_id INTO scope FROM public.buildings WHERE id = NEW.building_id;
 ELSE
   SELECT b.estate_id INTO scope FROM public.incidents i JOIN public.buildings b
     ON b.id = i.building_id WHERE i.id = NEW.incident_id;
 END IF;
 IF TG_TABLE_NAME = 'incidents' AND TG_OP = 'UPDATE' THEN
   IF OLD.status = 'investigating' AND NEW.status = 'confirmed' THEN action_name := 'incident.verified'; END IF;
   IF OLD.status = 'in_maintenance' AND NEW.status = 'restored' THEN action_name := 'incident.restored'; END IF;
 END IF;
 IF TG_TABLE_NAME = 'incident_updates' THEN
   IF NEW.is_published THEN action_name := 'notice.published'; END IF;
 END IF;
 INSERT INTO public.audit_events(estate_id, actor_id, action, target_entity, target_id, previous_state, new_state)
 VALUES (scope, auth.uid(), action_name, TG_TABLE_NAME, NEW.id,
   CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END, to_jsonb(NEW));
 RETURN NEW;
END;
$$;
CREATE TRIGGER report_audit AFTER INSERT OR UPDATE ON public.incident_reports
 FOR EACH ROW EXECUTE FUNCTION public.record_domain_audit();
CREATE TRIGGER incident_audit AFTER INSERT OR UPDATE ON public.incidents
 FOR EACH ROW EXECUTE FUNCTION public.record_domain_audit();
CREATE TRIGGER link_audit AFTER INSERT ON public.incident_report_links
 FOR EACH ROW EXECUTE FUNCTION public.record_domain_audit();
CREATE TRIGGER notice_audit AFTER INSERT OR UPDATE ON public.incident_updates
 FOR EACH ROW EXECUTE FUNCTION public.record_domain_audit();
CREATE TRIGGER maintenance_audit AFTER INSERT OR UPDATE ON public.maintenance_tasks
 FOR EACH ROW EXECUTE FUNCTION public.record_domain_audit();

-- Explicit least-privilege grants, rather than Supabase project default grants.
DO $$
DECLARE t TEXT;
BEGIN
 FOREACH t IN ARRAY ARRAY['profiles','buildings','service_zones','facilities','facility_dependencies',
   'incident_reports','report_attachments','incidents','incident_report_links','incident_updates',
   'maintenance_tasks','temporary_support_notices','audit_events','published_incident_bulletins'] LOOP
   EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
   EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
   EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
 END LOOP;
END;
$$;
GRANT INSERT, UPDATE ON public.profiles, public.incident_reports, public.incidents,
 public.incident_updates, public.maintenance_tasks, public.temporary_support_notices TO authenticated;
GRANT INSERT ON public.incident_report_links, public.report_attachments TO authenticated;
GRANT UPDATE ON public.buildings, public.service_zones, public.facilities TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.facility_dependencies TO authenticated;

CREATE POLICY profile_read ON public.profiles FOR SELECT TO authenticated
 USING (id = auth.uid() OR public.manages_estate(assigned_estate_id));
CREATE POLICY profile_insert ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY profile_update ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY building_read ON public.buildings FOR SELECT TO authenticated USING (public.is_estate_member(estate_id));
CREATE POLICY building_update ON public.buildings FOR UPDATE TO authenticated
 USING (public.manages_estate(estate_id)) WITH CHECK (public.manages_estate(estate_id));
CREATE POLICY zone_read ON public.service_zones FOR SELECT TO authenticated
 USING (EXISTS (SELECT 1 FROM public.buildings b WHERE b.id = building_id));
CREATE POLICY zone_update ON public.service_zones FOR UPDATE TO authenticated
 USING (public.manages_building(building_id)) WITH CHECK (public.manages_building(building_id));
CREATE POLICY facility_read ON public.facilities FOR SELECT TO authenticated
 USING (EXISTS (SELECT 1 FROM public.buildings b WHERE b.id = building_id));
CREATE POLICY facility_update ON public.facilities FOR UPDATE TO authenticated
 USING (public.manages_building(building_id)) WITH CHECK (public.manages_building(building_id));
CREATE POLICY dependency_manage ON public.facility_dependencies FOR ALL TO authenticated
 USING (EXISTS (SELECT 1 FROM public.facilities f WHERE f.id = facility_id AND public.manages_building(f.building_id)))
 WITH CHECK (EXISTS (SELECT 1 FROM public.facilities f WHERE f.id = facility_id AND public.manages_building(f.building_id)));
CREATE POLICY report_read ON public.incident_reports FOR SELECT TO authenticated
 USING (reporter_id = auth.uid() OR public.manages_building(building_id));
CREATE POLICY report_insert ON public.incident_reports FOR INSERT TO authenticated
 WITH CHECK (reporter_id = auth.uid() AND status = 'submitted' AND public.belongs_to_building(building_id));
CREATE POLICY report_update ON public.incident_reports FOR UPDATE TO authenticated
 USING (public.manages_building(building_id)) WITH CHECK (public.manages_building(building_id));
CREATE POLICY attachment_read ON public.report_attachments FOR SELECT TO authenticated
 USING (public.owns_report(report_id) OR public.manages_report(report_id));
CREATE POLICY attachment_insert ON public.report_attachments FOR INSERT TO authenticated WITH CHECK (public.owns_report(report_id));
CREATE POLICY incident_manage ON public.incidents FOR ALL TO authenticated
 USING (public.manages_building(building_id)) WITH CHECK (public.manages_building(building_id));
CREATE POLICY update_manage ON public.incident_updates FOR ALL TO authenticated
 USING (public.manages_incident(incident_id)) WITH CHECK (public.manages_incident(incident_id));
CREATE POLICY link_read ON public.incident_report_links FOR SELECT TO authenticated
 USING (public.owns_report(report_id) OR public.manages_incident(incident_id));
CREATE POLICY link_insert ON public.incident_report_links FOR INSERT TO authenticated
 WITH CHECK (public.manages_incident(incident_id) AND public.manages_report(report_id));
CREATE POLICY maintenance_manage ON public.maintenance_tasks FOR ALL TO authenticated
 USING (public.manages_incident(incident_id)) WITH CHECK (public.manages_incident(incident_id));
CREATE POLICY support_read ON public.temporary_support_notices FOR SELECT TO authenticated
 USING (public.manages_incident(incident_id) OR (is_active AND available_from <= now()
   AND (available_until IS NULL OR available_until > now()) AND EXISTS (
     SELECT 1 FROM public.published_incident_bulletins b WHERE b.incident_id = temporary_support_notices.incident_id)));
CREATE POLICY support_write ON public.temporary_support_notices FOR ALL TO authenticated
 USING (public.manages_incident(incident_id)) WITH CHECK (public.manages_incident(incident_id));
CREATE POLICY audit_read ON public.audit_events FOR SELECT TO authenticated USING (public.manages_estate(estate_id));
CREATE POLICY bulletin_read ON public.published_incident_bulletins FOR SELECT TO authenticated USING (public.is_estate_member(estate_id));

-- Revoke default function execution, including trigger helpers. Trigger dispatch
-- does not require clients to have EXECUTE on the trigger function.
DO $$
DECLARE fn RECORD;
BEGIN
 FOR fn IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n
   ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN (
   'is_estate_member','manages_estate','manages_building','belongs_to_building','manages_incident',
   'owns_report','manages_report','guard_profile','guard_infrastructure','guard_report',
   'guard_incident','guard_update','guard_link','mark_report_linked','guard_dependency',
   'guard_maintenance','sync_bulletin','sync_incident_bulletins','record_domain_audit') LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.signature);
 END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION public.is_estate_member(TEXT), public.manages_estate(TEXT),
 public.manages_building(UUID), public.belongs_to_building(UUID), public.manages_incident(UUID),
 public.owns_report(UUID), public.manages_report(UUID) TO authenticated;

