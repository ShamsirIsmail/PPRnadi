-- ==============================================================================
-- PPR NADI: Priority Security Hardening & Atomic Verification Migration
-- File: 20261019130000_priority_security_hardening.sql
-- ==============================================================================

-- 1. Safely backfill any NULL idempotency_key on legacy decisions
UPDATE public.report_priority_decisions
SET idempotency_key = 'legacy-' || id::text
WHERE idempotency_key IS NULL;

-- 2. Enforce NOT NULL constraint on idempotency_key
ALTER TABLE public.report_priority_decisions
  ALTER COLUMN idempotency_key SET NOT NULL;

-- 3. Strict Write Protection on Decisions: Revoke direct INSERT/UPDATE/DELETE from clients
REVOKE INSERT, UPDATE, DELETE ON public.report_priority_decisions FROM authenticated, anon, public;
GRANT SELECT ON public.report_priority_decisions TO authenticated;
DROP POLICY IF EXISTS priority_decision_insert ON public.report_priority_decisions;

-- 4. Pure Deterministic SQL Helper for Report Fingerprint Computation in PostgreSQL
CREATE OR REPLACE FUNCTION public.compute_report_input_fingerprint(
  p_description TEXT,
  p_category TEXT,
  p_location TEXT,
  p_verified_count INT,
  p_policy_version TEXT,
  p_extraction_version TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT encode(
    sha256(
      convert_to(
        lower(trim(coalesce(p_category, ''))) || '|' ||
        lower(trim(coalesce(p_location, ''))) || '|' ||
        trim(coalesce(p_description, '')) || '|' ||
        CASE WHEN p_verified_count IS NOT NULL AND p_verified_count > 1 THEN 'rel:' || p_verified_count ELSE 'rel:none' END || '|' ||
        'pol:' || coalesce(p_policy_version, 'proto-2026-10') || '|' ||
        'ext:' || coalesce(p_extraction_version, 'proto-extract-2026-10'),
        'UTF8'
      )
    ),
    'hex'
  );
$$;

-- 5. Hardened Atomic RPC Function
-- Drops older signature taking p_is_override boolean
DROP FUNCTION IF EXISTS public.confirm_priority_decision_rpc(UUID, UUID, TEXT, BOOLEAN, TEXT, TEXT, INT);
DROP FUNCTION IF EXISTS public.confirm_priority_decision_rpc(UUID, UUID, TEXT, TEXT, TEXT, INT);

CREATE OR REPLACE FUNCTION public.confirm_priority_decision_rpc(
  p_report_id UUID,
  p_evaluation_id UUID,
  p_decided_priority TEXT,
  p_override_reason TEXT,
  p_idempotency_key TEXT,
  p_expected_version INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_auth_uid UUID;
  v_manager_role TEXT;
  v_manager_estate TEXT;
  v_manager_name TEXT;
  v_rep_desc TEXT;
  v_rep_cat TEXT;
  v_bldg_name TEXT;
  v_zone_name TEXT;
  v_report_estate TEXT;
  v_loc TEXT;
  v_links_count INT := 0;
  v_current_fp TEXT;
  v_eval RECORD;
  v_is_override BOOLEAN := false;
  v_current_version INT;
  v_new_version INT;
  v_inserted_id UUID;
  v_inserted_at TIMESTAMPTZ;
  v_existing_decision RECORD;
BEGIN
  -- A. Validate inputs
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'VALIDATION: Idempotency key wajib dibekalkan.' USING ERRCODE = '22023';
  END IF;

  IF p_expected_version IS NULL OR p_expected_version < 0 THEN
    RAISE EXCEPTION 'VALIDATION: Versi dijangka (expected_version) wajib dibekalkan untuk kawalan konkurensi.' USING ERRCODE = '22023';
  END IF;

  IF p_decided_priority NOT IN ('immediate_review', 'high_priority', 'standard_review', 'needs_more_info') THEN
    RAISE EXCEPTION 'VALIDATION: Tahap keutamaan yang dipilih tidak sah.' USING ERRCODE = '22023';
  END IF;

  -- B. Auth & Role verification BEFORE checking or returning any idempotent result
  v_auth_uid := auth.uid();
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Sesi autentikasi sah diperlukan.' USING ERRCODE = '42501';
  END IF;

  SELECT role, assigned_estate_id, full_name
  INTO v_manager_role, v_manager_estate, v_manager_name
  FROM public.profiles
  WHERE id = v_auth_uid;

  IF v_manager_role IS NULL OR v_manager_role != 'management' THEN
    RAISE EXCEPTION 'FORBIDDEN: Hanya staf pengurusan dibenarkan membuat keputusan keutamaan.' USING ERRCODE = '42501';
  END IF;

  -- C. Lock and verify report and estate boundaries BEFORE idempotency checks
  SELECT r.description, r.category, b.name, z.name, b.estate_id
  INTO v_rep_desc, v_rep_cat, v_bldg_name, v_zone_name, v_report_estate
  FROM public.incident_reports r
  JOIN public.buildings b ON b.id = r.building_id
  LEFT JOIN public.service_zones z ON z.id = r.service_zone_id
  WHERE r.id = p_report_id
  FOR SHARE OF r, b;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Aduan tidak dijumpai.' USING ERRCODE = 'P0002';
  END IF;

  IF v_report_estate IS NULL OR v_report_estate != v_manager_estate THEN
    RAISE EXCEPTION 'FORBIDDEN: Aduan ini bukan di bawah kawasan perumahan tugas anda.' USING ERRCODE = '42501';
  END IF;

  -- D. Idempotency Check with Strict Payload & Identity Binding
  SELECT * INTO v_existing_decision
  FROM public.report_priority_decisions
  WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    -- Verify exact identity, report, priority, evaluation, and reason match
    IF v_existing_decision.report_id != p_report_id
       OR v_existing_decision.decided_by != v_auth_uid
       OR v_existing_decision.decided_priority != p_decided_priority
       OR v_existing_decision.evaluation_id IS DISTINCT FROM p_evaluation_id
       OR v_existing_decision.override_reason IS DISTINCT FROM trim(p_override_reason) THEN
      RAISE EXCEPTION 'IDEMPOTENCY_MISMATCH: Idempotency key ini telah digunakan untuk keputusan atau aduan yang berbeza.' USING ERRCODE = '40001';
    END IF;

    -- Return the existing decision idempotently
    RETURN jsonb_build_object(
      'success', true,
      'is_idempotent', true,
      'decision', jsonb_build_object(
        'id', v_existing_decision.id,
        'report_id', v_existing_decision.report_id,
        'evaluation_id', v_existing_decision.evaluation_id,
        'decided_priority', v_existing_decision.decided_priority,
        'is_override', v_existing_decision.is_override,
        'override_reason', v_existing_decision.override_reason,
        'decided_by', v_existing_decision.decided_by,
        'decided_by_name', v_manager_name,
        'decided_at', v_existing_decision.decided_at,
        'idempotency_key', v_existing_decision.idempotency_key,
        'decision_version', v_existing_decision.decision_version
      )
    );
  END IF;

  -- E. Evaluation Validation & Atomic Freshness Check
  IF p_evaluation_id IS NOT NULL THEN
    SELECT * INTO v_eval
    FROM public.report_priority_evaluations
    WHERE id = p_evaluation_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'NOT_FOUND: Penilaian yang dirujuk tidak dijumpai.' USING ERRCODE = 'P0002';
    END IF;

    IF v_eval.report_id != p_report_id THEN
      RAISE EXCEPTION 'FORBIDDEN: Penilaian yang dirujuk bukan milik aduan ini.' USING ERRCODE = '42501';
    END IF;

    -- Count verified linked reports in same transaction
    SELECT count(*) INTO v_links_count
    FROM public.incident_report_links
    WHERE incident_id = (
      SELECT incident_id FROM public.incident_report_links WHERE report_id = p_report_id LIMIT 1
    );

    v_loc := trim(coalesce(v_bldg_name, '') || ' ' || coalesce(v_zone_name, ''));
    v_current_fp := public.compute_report_input_fingerprint(
      v_rep_desc,
      v_rep_cat,
      v_loc,
      CASE WHEN v_links_count > 0 THEN v_links_count ELSE NULL END,
      'proto-2026-10',
      'proto-extract-2026-10'
    );

    IF v_eval.input_fingerprint != v_current_fp OR v_eval.policy_version != 'proto-2026-10' THEN
      RAISE EXCEPTION 'STALE_EVALUATION: Kandungan aduan, pautan berkaitan, atau versi polisi telah berubah sejak penilaian dijana. Sila jana semula cadangan sebelum mengesahkan.' USING ERRCODE = '40001';
    END IF;

    -- Calculate is_override on the server/database, DO NOT trust client boolean
    v_is_override := (p_decided_priority != v_eval.recommended_priority);
  ELSE
    v_is_override := false;
  END IF;

  -- F. Override Rationale Enforcement
  IF v_is_override THEN
    IF p_override_reason IS NULL OR length(trim(p_override_reason)) < 5 THEN
      RAISE EXCEPTION 'VALIDATION: Sila nyatakan sebab / catatan apabila mengubah cadangan sistem (minimum 5 aksara).' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- G. Optimistic Concurrency Version Verification
  SELECT COALESCE(MAX(decision_version), 0)
  INTO v_current_version
  FROM public.report_priority_decisions
  WHERE report_id = p_report_id;

  IF v_current_version != p_expected_version THEN
    -- Check if this version change was committed concurrently by the identical idempotency key
    SELECT * INTO v_existing_decision
    FROM public.report_priority_decisions
    WHERE idempotency_key = p_idempotency_key;

    IF FOUND THEN
      IF v_existing_decision.report_id != p_report_id
         OR v_existing_decision.decided_by != v_auth_uid
         OR v_existing_decision.decided_priority != p_decided_priority
         OR v_existing_decision.evaluation_id IS DISTINCT FROM p_evaluation_id
         OR v_existing_decision.override_reason IS DISTINCT FROM trim(p_override_reason) THEN
        RAISE EXCEPTION 'IDEMPOTENCY_MISMATCH: Idempotency key ini telah digunakan untuk keputusan atau aduan yang berbeza.' USING ERRCODE = '40001';
      END IF;

      RETURN jsonb_build_object(
        'success', true,
        'is_idempotent', true,
        'decision', jsonb_build_object(
          'id', v_existing_decision.id,
          'report_id', v_existing_decision.report_id,
          'evaluation_id', v_existing_decision.evaluation_id,
          'decided_priority', v_existing_decision.decided_priority,
          'is_override', v_existing_decision.is_override,
          'override_reason', v_existing_decision.override_reason,
          'decided_by', v_existing_decision.decided_by,
          'decided_by_name', v_manager_name,
          'decided_at', v_existing_decision.decided_at,
          'idempotency_key', v_existing_decision.idempotency_key,
          'decision_version', v_existing_decision.decision_version
        )
      );
    END IF;

    RAISE EXCEPTION 'CONFLICT: Keputusan aduan ini telah dikemas kini oleh pengurus lain (versi semasa: %, versi dijangka: %). Sila muat semula keputusan terkini.', v_current_version, p_expected_version USING ERRCODE = '40001';
  END IF;

  -- H. Atomic Insert with Concurrency & Idempotency Exception Handling
  v_new_version := v_current_version + 1;
  v_inserted_id := gen_random_uuid();
  v_inserted_at := now();

  BEGIN
    INSERT INTO public.report_priority_decisions (
      id,
      report_id,
      evaluation_id,
      decided_priority,
      is_override,
      override_reason,
      decided_by,
      idempotency_key,
      decision_version,
      decided_at
    ) VALUES (
      v_inserted_id,
      p_report_id,
      p_evaluation_id,
      p_decided_priority,
      v_is_override,
      trim(p_override_reason),
      v_auth_uid,
      p_idempotency_key,
      v_new_version,
      v_inserted_at
    );

    RETURN jsonb_build_object(
      'success', true,
      'is_idempotent', false,
      'decision', jsonb_build_object(
        'id', v_inserted_id,
        'report_id', p_report_id,
        'evaluation_id', p_evaluation_id,
        'decided_priority', p_decided_priority,
        'is_override', v_is_override,
        'override_reason', trim(p_override_reason),
        'decided_by', v_auth_uid,
        'decided_by_name', v_manager_name,
        'decided_at', v_inserted_at,
        'idempotency_key', p_idempotency_key,
        'decision_version', v_new_version
      )
    );
  EXCEPTION
    WHEN unique_violation THEN
      SELECT * INTO v_existing_decision
      FROM public.report_priority_decisions
      WHERE idempotency_key = p_idempotency_key;

      IF FOUND THEN
        IF v_existing_decision.report_id != p_report_id
           OR v_existing_decision.decided_by != v_auth_uid
           OR v_existing_decision.decided_priority != p_decided_priority
           OR v_existing_decision.evaluation_id IS DISTINCT FROM p_evaluation_id
           OR v_existing_decision.override_reason IS DISTINCT FROM trim(p_override_reason) THEN
          RAISE EXCEPTION 'IDEMPOTENCY_MISMATCH: Idempotency key ini telah digunakan untuk keputusan atau aduan yang berbeza.' USING ERRCODE = '40001';
        END IF;

        RETURN jsonb_build_object(
          'success', true,
          'is_idempotent', true,
          'decision', jsonb_build_object(
            'id', v_existing_decision.id,
            'report_id', v_existing_decision.report_id,
            'evaluation_id', v_existing_decision.evaluation_id,
            'decided_priority', v_existing_decision.decided_priority,
            'is_override', v_existing_decision.is_override,
            'override_reason', v_existing_decision.override_reason,
            'decided_by', v_existing_decision.decided_by,
            'decided_by_name', v_manager_name,
            'decided_at', v_existing_decision.decided_at,
            'idempotency_key', v_existing_decision.idempotency_key,
            'decision_version', v_existing_decision.decision_version
          )
        );
      END IF;

      RAISE EXCEPTION 'CONFLICT: Keputusan aduan ini telah dikemas kini oleh pengurus lain (versi semasa: %, versi dijangka: %). Sila muat semula keputusan terkini.', v_current_version + 1, p_expected_version USING ERRCODE = '40001';
  END;
END;
$$;

-- 6. Permissions
GRANT EXECUTE ON FUNCTION public.confirm_priority_decision_rpc TO authenticated;
GRANT EXECUTE ON FUNCTION public.compute_report_input_fingerprint TO authenticated;
