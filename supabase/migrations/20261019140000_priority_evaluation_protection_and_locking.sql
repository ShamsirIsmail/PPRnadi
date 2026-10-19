-- ==============================================================================
-- PPR NADI: Priority Evaluation Write Protection & Shared Incident Concurrency Locking
-- File: 20261019140000_priority_evaluation_protection_and_locking.sql
-- ==============================================================================

-- 1. Evaluation Write Protection: Revoke direct client writes on report_priority_evaluations
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.report_priority_evaluations FROM authenticated, anon, public;
REVOKE TRUNCATE ON public.report_priority_decisions FROM authenticated, anon, public;
GRANT SELECT ON public.report_priority_evaluations TO authenticated;

DROP POLICY IF EXISTS priority_eval_insert ON public.report_priority_evaluations;
DROP POLICY IF EXISTS priority_eval_update ON public.report_priority_evaluations;
DROP POLICY IF EXISTS priority_eval_delete ON public.report_priority_evaluations;

-- 2. Concurrency Control on Shared Incident Links:
-- Whenever a link is inserted, updated, or deleted, take exclusive lock on the incident
-- and bump updated_at to ensure consistent serialization against priority triage.
CREATE OR REPLACE FUNCTION public.guard_incident_link_concurrency()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_inc_id UUID;
BEGIN
  v_inc_id := COALESCE(NEW.incident_id, OLD.incident_id);
  IF v_inc_id IS NOT NULL THEN
    -- Lock shared incident row FOR UPDATE to serialize concurrent link alterations
    PERFORM 1 FROM public.incidents WHERE id = v_inc_id FOR UPDATE;

    -- Bump incident timestamp
    UPDATE public.incidents
    SET updated_at = now()
    WHERE id = v_inc_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_incident_link_concurrency_insert ON public.incident_report_links;
CREATE TRIGGER trg_incident_link_concurrency_insert
  BEFORE INSERT OR UPDATE ON public.incident_report_links
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_incident_link_concurrency();

DROP TRIGGER IF EXISTS trg_incident_link_concurrency_delete ON public.incident_report_links;
CREATE TRIGGER trg_incident_link_concurrency_delete
  BEFORE DELETE ON public.incident_report_links
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_incident_link_concurrency();

ALTER TABLE public.incident_report_links ENABLE ALWAYS TRIGGER trg_incident_link_concurrency_insert;
ALTER TABLE public.incident_report_links ENABLE ALWAYS TRIGGER trg_incident_link_concurrency_delete;

-- 3. Hardened Atomic RPC Function:
-- Strictly mandates valid evaluation_id, locks incident context, computes is_override in DB,
-- and handles optimistic concurrency and idempotency without bypassing.
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
  v_incident_id UUID;
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

  -- Strictly require evaluation_id for priority recommendation confirmation
  IF p_evaluation_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION: evaluation_id wajib dibekalkan bagi pengesahan keputusan keutamaan.' USING ERRCODE = '22023';
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
  -- Lock order: 1. incident_reports (and buildings)
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
  SELECT * INTO v_eval
  FROM public.report_priority_evaluations
  WHERE id = p_evaluation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Penilaian yang dirujuk tidak dijumpai.' USING ERRCODE = 'P0002';
  END IF;

  IF v_eval.report_id != p_report_id THEN
    RAISE EXCEPTION 'FORBIDDEN: Penilaian yang dirujuk bukan milik aduan ini.' USING ERRCODE = '42501';
  END IF;

  -- Lock order: 2. Shared incident row if report is linked
  SELECT incident_id INTO v_incident_id
  FROM public.incident_report_links
  WHERE report_id = p_report_id
  LIMIT 1;

  IF v_incident_id IS NOT NULL THEN
    -- Lock shared incident FOR SHARE to serialize against concurrent link alterations
    PERFORM 1
    FROM public.incidents
    WHERE id = v_incident_id
    FOR SHARE;

    SELECT count(*) INTO v_links_count
    FROM public.incident_report_links
    WHERE incident_id = v_incident_id;
  ELSE
    v_links_count := 0;
  END IF;

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
      CASE WHEN v_is_override THEN trim(p_override_reason) ELSE NULL END,
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
        'override_reason', CASE WHEN v_is_override THEN trim(p_override_reason) ELSE NULL END,
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

GRANT EXECUTE ON FUNCTION public.confirm_priority_decision_rpc TO authenticated;
