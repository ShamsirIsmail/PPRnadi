-- ==============================================================================
-- PPR NADI Migration: Explainable Priority Recommendations & Decision Audit
-- Policy Version: proto-2026-10
-- Additive, non-destructive migration preserving existing RLS and data integrity.
-- ==============================================================================

-- 1. Table: report_priority_evaluations
-- Stores deterministic rule evaluation results and AI extracted facts.
CREATE TABLE IF NOT EXISTS public.report_priority_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.incident_reports(id) ON DELETE CASCADE,
  input_fingerprint TEXT NOT NULL,
  policy_version TEXT NOT NULL DEFAULT 'proto-2026-10',
  ai_model TEXT NOT NULL,
  ai_provider TEXT NOT NULL,
  extracted_facts JSONB NOT NULL,
  rule_result JSONB NOT NULL,
  recommended_priority TEXT NOT NULL CHECK (recommended_priority IN ('immediate_review', 'high_priority', 'standard_review')),
  needs_more_info BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Table: report_priority_decisions
-- Stores human manager decisions, audit trail, optimistic concurrency version, and idempotency key.
CREATE TABLE IF NOT EXISTS public.report_priority_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.incident_reports(id) ON DELETE CASCADE,
  evaluation_id UUID REFERENCES public.report_priority_evaluations(id) ON DELETE SET NULL,
  decided_priority TEXT NOT NULL CHECK (decided_priority IN ('immediate_review', 'high_priority', 'standard_review', 'needs_more_info')),
  is_override BOOLEAN NOT NULL DEFAULT false,
  override_reason TEXT,
  decided_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  idempotency_key TEXT,
  decision_version INT NOT NULL DEFAULT 1,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_priority_decisions_report_version UNIQUE (report_id, decision_version)
);

-- 3. Indexes for fast lookup by report, fingerprint, manager, and idempotency
CREATE INDEX IF NOT EXISTS idx_priority_evaluations_report
  ON public.report_priority_evaluations(report_id);

CREATE INDEX IF NOT EXISTS idx_priority_evaluations_lookup
  ON public.report_priority_evaluations(report_id, input_fingerprint, policy_version);

CREATE INDEX IF NOT EXISTS idx_priority_decisions_report
  ON public.report_priority_decisions(report_id, decision_version DESC);

CREATE INDEX IF NOT EXISTS idx_priority_decisions_manager
  ON public.report_priority_decisions(decided_by);

CREATE UNIQUE INDEX IF NOT EXISTS idx_priority_decisions_idempotency
  ON public.report_priority_decisions(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.report_priority_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_priority_decisions ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies: Evaluations
CREATE POLICY priority_eval_select ON public.report_priority_evaluations
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.incident_reports r
      JOIN public.buildings b ON b.id = r.building_id
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE r.id = report_priority_evaluations.report_id
        AND p.role = 'management'
        AND p.assigned_estate_id = b.estate_id
    )
  );

CREATE POLICY priority_eval_insert ON public.report_priority_evaluations
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.incident_reports r
      JOIN public.buildings b ON b.id = r.building_id
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE r.id = report_priority_evaluations.report_id
        AND p.role = 'management'
        AND p.assigned_estate_id = b.estate_id
    )
  );

-- 6. RLS Policies: Decisions
CREATE POLICY priority_decision_select ON public.report_priority_decisions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.incident_reports r
      JOIN public.buildings b ON b.id = r.building_id
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE r.id = report_priority_decisions.report_id
        AND (
          (p.role = 'management' AND p.assigned_estate_id = b.estate_id)
          OR (p.role = 'resident' AND r.reporter_id = p.id)
        )
    )
  );

CREATE POLICY priority_decision_insert ON public.report_priority_decisions
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.incident_reports r
      JOIN public.buildings b ON b.id = r.building_id
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE r.id = report_priority_decisions.report_id
        AND p.role = 'management'
        AND p.assigned_estate_id = b.estate_id
        AND report_priority_decisions.decided_by = p.id
    )
  );

-- 7. Atomic Concurrency & Idempotency Function
CREATE OR REPLACE FUNCTION public.confirm_priority_decision_rpc(
  p_report_id UUID,
  p_evaluation_id UUID,
  p_decided_priority TEXT,
  p_is_override BOOLEAN,
  p_override_reason TEXT,
  p_idempotency_key TEXT,
  p_expected_version INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_uid UUID;
  v_manager_role TEXT;
  v_manager_estate TEXT;
  v_manager_name TEXT;
  v_report_estate TEXT;
  v_eval_report_id UUID;
  v_current_version INT;
  v_existing_decision RECORD;
  v_inserted_id UUID;
  v_inserted_at TIMESTAMPTZ;
  v_new_version INT;
BEGIN
  -- 1. Identify authentic caller
  v_auth_uid := auth.uid();
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Sesi autentikasi sah diperlukan.';
  END IF;

  -- 2. Verify manager role and estate assignment
  SELECT role, assigned_estate_id, full_name
  INTO v_manager_role, v_manager_estate, v_manager_name
  FROM public.profiles
  WHERE id = v_auth_uid;

  IF v_manager_role IS NULL OR v_manager_role != 'management' THEN
    RAISE EXCEPTION 'FORBIDDEN: Hanya staf pengurusan dibenarkan membuat keputusan keutamaan.';
  END IF;

  IF v_manager_estate IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: Profil pengurus belum ditugaskan ke mana-mana perumahan.';
  END IF;

  -- 3. Idempotency Check: if idempotency_key already exists, return existing record
  IF p_idempotency_key IS NOT NULL AND length(trim(p_idempotency_key)) > 0 THEN
    SELECT d.id, d.report_id, d.evaluation_id, d.decided_priority, d.is_override,
           d.override_reason, d.decided_by, d.decided_at, d.idempotency_key, d.decision_version,
           p.full_name AS decided_by_name
    INTO v_existing_decision
    FROM public.report_priority_decisions d
    LEFT JOIN public.profiles p ON p.id = d.decided_by
    WHERE d.idempotency_key = p_idempotency_key;

    IF FOUND THEN
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
          'decided_by_name', v_existing_decision.decided_by_name,
          'decided_at', v_existing_decision.decided_at,
          'idempotency_key', v_existing_decision.idempotency_key,
          'decision_version', v_existing_decision.decision_version
        )
      );
    END IF;
  END IF;

  -- 4. Check report existence and estate access
  SELECT b.estate_id
  INTO v_report_estate
  FROM public.incident_reports r
  JOIN public.buildings b ON b.id = r.building_id
  WHERE r.id = p_report_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Aduan tidak dijumpai.';
  END IF;

  IF v_report_estate != v_manager_estate THEN
    RAISE EXCEPTION 'FORBIDDEN: Aduan ini bukan di bawah kawasan perumahan tugas anda.';
  END IF;

  -- 5. Verify evaluation if provided
  IF p_evaluation_id IS NOT NULL THEN
    SELECT report_id INTO v_eval_report_id
    FROM public.report_priority_evaluations
    WHERE id = p_evaluation_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'NOT_FOUND: Penilaian yang dirujuk tidak dijumpai.';
    END IF;

    IF v_eval_report_id != p_report_id THEN
      RAISE EXCEPTION 'FORBIDDEN: Penilaian yang dirujuk bukan milik aduan ini.';
    END IF;
  END IF;

  -- 6. Validate override rationale
  IF p_is_override THEN
    IF p_override_reason IS NULL OR length(trim(p_override_reason)) < 5 THEN
      RAISE EXCEPTION 'VALIDATION: Sila nyatakan sebab / catatan apabila mengubah cadangan sistem (minimum 5 aksara).';
    END IF;
  END IF;

  -- 7. Lock report decisions and enforce optimistic concurrency version
  SELECT COALESCE(MAX(decision_version), 0)
  INTO v_current_version
  FROM public.report_priority_decisions
  WHERE report_id = p_report_id;

  IF p_expected_version IS NOT NULL AND v_current_version != p_expected_version THEN
    RAISE EXCEPTION 'CONFLICT: Keputusan aduan ini telah dikemas kini oleh pengurus lain (versi semasa: %, versi dijangka: %). Sila muat semula keputusan terkini.', v_current_version, p_expected_version;
  END IF;

  v_new_version := v_current_version + 1;
  v_inserted_id := gen_random_uuid();
  v_inserted_at := now();

  -- 8. Atomic Insert with concurrent idempotency handling
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
      p_is_override,
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
        'is_override', p_is_override,
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
      -- If duplicate due to concurrent request with identical idempotency key
      IF p_idempotency_key IS NOT NULL THEN
        SELECT * INTO v_existing_decision
        FROM public.report_priority_decisions
        WHERE report_id = p_report_id AND idempotency_key = p_idempotency_key;

        IF FOUND THEN
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
      END IF;

      -- If duplicate due to another transaction taking the version first
      RAISE EXCEPTION 'CONFLICT: Keputusan aduan ini telah dikemas kini oleh pengurus lain (versi semasa: %, versi dijangka: %). Sila muat semula keputusan terkini.', v_current_version + 1, p_expected_version;
  END;
END;
$$;

-- 8. Permissions
GRANT SELECT, INSERT ON public.report_priority_evaluations TO authenticated;
GRANT SELECT, INSERT ON public.report_priority_decisions TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_priority_decision_rpc TO authenticated;
