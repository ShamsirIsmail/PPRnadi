-- Private evidence. Apply only after reviewed approval in an isolated Supabase project.
INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES ('incident-evidence', 'incident-evidence', false, 5242880,
 ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 5242880,
 allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE FUNCTION public.owns_evidence_path(p_path TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT split_part(p_path, '/', 1) = auth.uid()::text
   AND array_length(string_to_array(p_path, '/'), 1) = 3
   AND split_part(p_path, '/', 3) NOT IN ('', '.', '..')
   AND EXISTS (SELECT 1 FROM public.incident_reports r
     WHERE r.id::text = split_part(p_path, '/', 2) AND public.owns_report(r.id));
$$;
CREATE FUNCTION public.manages_evidence_path(p_path TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT EXISTS (SELECT 1 FROM public.incident_reports r
   WHERE r.id::text = split_part(p_path, '/', 2)
     AND r.reporter_id::text = split_part(p_path, '/', 1)
     AND array_length(string_to_array(p_path, '/'), 1) = 3
     AND public.manages_report(r.id));
$$;
REVOKE ALL ON FUNCTION public.owns_evidence_path(TEXT), public.manages_evidence_path(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.owns_evidence_path(TEXT), public.manages_evidence_path(TEXT) TO authenticated;

CREATE POLICY evidence_upload ON storage.objects FOR INSERT TO authenticated
 WITH CHECK (bucket_id = 'incident-evidence' AND public.owns_evidence_path(name));
CREATE POLICY evidence_read ON storage.objects FOR SELECT TO authenticated
 USING (bucket_id = 'incident-evidence' AND
   (public.owns_evidence_path(name) OR public.manages_evidence_path(name)));
-- No UPDATE/DELETE policies; no blanket storage table REVOKE affecting other buckets.
-- Existing projects with other permissive storage policies require a separate review.

CREATE FUNCTION public.guard_attachment() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
 -- Serialize the three-attachment limit per report.
 PERFORM 1 FROM public.incident_reports WHERE id = NEW.report_id FOR UPDATE;
 IF NOT public.owns_report(NEW.report_id) OR NOT public.owns_evidence_path(NEW.storage_path)
   OR split_part(NEW.storage_path, '/', 2) <> NEW.report_id::text
   OR split_part(NEW.storage_path, '/', 3) <> NEW.file_name THEN
   RAISE EXCEPTION 'Evidence must belong to the authenticated report owner' USING ERRCODE = '42501';
 END IF;
 IF (SELECT count(*) FROM public.report_attachments WHERE report_id = NEW.report_id) >= 3 THEN
   RAISE EXCEPTION 'Maximum three evidence attachments per report';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'incident-evidence'
   AND o.name = NEW.storage_path AND o.metadata->>'mimetype' = NEW.mime_type
   AND o.metadata->>'size' = NEW.file_size_bytes::text) THEN
   RAISE EXCEPTION 'Evidence object and metadata must match an existing upload';
 END IF;
 NEW.uploaded_at := now();
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_attachment() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER attachment_guard BEFORE INSERT ON public.report_attachments
 FOR EACH ROW EXECUTE FUNCTION public.guard_attachment();
