-- PPR NADI Phase 02A: Comprehensive Database Security Test Suite
-- Target: Isolated Local Supabase Database
-- Executes with psql -v ON_ERROR_STOP=1 -f tests/sql/phase02a-security-suite.sql
-- Uses dynamic identifiers per run to prevent collision with existing fixtures.
-- Fixtures and assertions roll back at the end.

SELECT
  gen_random_uuid() AS u_res_a,
  gen_random_uuid() AS u_mgr_a,
  gen_random_uuid() AS u_res_b,
  gen_random_uuid() AS u_mgr_b,
  gen_random_uuid() AS u_unassigned,
  gen_random_uuid() AS bldg_a,
  gen_random_uuid() AS bldg_b,
  gen_random_uuid() AS zone_a_low,
  gen_random_uuid() AS zone_b_high,
  gen_random_uuid() AS fac_a_pump,
  gen_random_uuid() AS fac_a_lift,
  gen_random_uuid() AS fac_b_pump,
  gen_random_uuid() AS rpt_a,
  gen_random_uuid() AS inc_a,
  gen_random_uuid() AS upd_a,
  substr(md5(random()::text), 1, 8) AS run_id
\gset

SELECT
  'est_a_' || :'run_id' AS est_a,
  'est_b_' || :'run_id' AS est_b,
  'BLD_A_' || :'run_id' AS bldg_code_a,
  'BLD_B_' || :'run_id' AS bldg_code_b,
  'Z_A_' || :'run_id' AS zone_code_a,
  'Z_B_' || :'run_id' AS zone_code_b,
  'FAC_A_PUMP_' || :'run_id' AS fac_code_a_pump,
  'FAC_A_LIFT_' || :'run_id' AS fac_code_a_lift,
  'FAC_B_PUMP_' || :'run_id' AS fac_code_b_pump,
  'INC_A_' || :'run_id' AS inc_num_a
\gset

BEGIN;

CREATE FUNCTION pg_temp.assert_true(ok BOOLEAN, message TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL: %', message;
  END IF;
END $$;

CREATE FUNCTION pg_temp.expect_error(statement TEXT, expected_fragment TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE failed BOOLEAN := false;
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF position(expected_fragment IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'Expected fragment "%", got: %', expected_fragment, SQLERRM;
    END IF;
    failed := true;
  END;
  IF NOT failed THEN
    RAISE EXCEPTION 'Expected denial containing "%" but statement succeeded: %', expected_fragment, statement;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. Setup Identities:
--    Estate A: Resident A, Manager A
--    Estate B: Resident B, Manager B
--    Unassigned User (No estate membership)
-- -----------------------------------------------------------------------------
INSERT INTO auth.users(id, email) VALUES
 (:'u_res_a', 'res-a-' || :'run_id' || '@sentosa.local'),
 (:'u_mgr_a', 'mgr-a-' || :'run_id' || '@sentosa.local'),
 (:'u_res_b', 'res-b-' || :'run_id' || '@harmoni.local'),
 (:'u_mgr_b', 'mgr-b-' || :'run_id' || '@harmoni.local'),
 (:'u_unassigned', 'unassigned-' || :'run_id' || '@test.local');

INSERT INTO public.buildings(id, estate_id, code, name, total_floors, total_units) VALUES
 (:'bldg_a', :'est_a', :'bldg_code_a', 'Block A Test', 15, 180),
 (:'bldg_b', :'est_b', :'bldg_code_b', 'Block B Test', 12, 144);

-- Trusted administrator provisions profiles
INSERT INTO public.profiles(id, role, full_name, assigned_estate_id, assigned_building_id, unit_number) VALUES
 (:'u_res_a', 'resident', 'Resident A', :'est_a', :'bldg_a', '04-12'),
 (:'u_mgr_a', 'management', 'Manager A', :'est_a', NULL, NULL),
 (:'u_res_b', 'resident', 'Resident B', :'est_b', :'bldg_b', '08-05'),
 (:'u_mgr_b', 'management', 'Manager B', :'est_b', NULL, NULL),
 (:'u_unassigned', 'resident', 'Unassigned User', NULL, NULL, NULL);

INSERT INTO public.service_zones(id, building_id, zone_code, name, floor_start, floor_end, zone_type) VALUES
 (:'zone_a_low', :'bldg_a', :'zone_code_a', 'Low Floors A', 1, 7, 'residential_floors'),
 (:'zone_b_high', :'bldg_b', :'zone_code_b', 'High Floors B', 8, 12, 'residential_floors');

INSERT INTO public.facilities(id, building_id, facility_code, name, category) VALUES
 (:'fac_a_pump', :'bldg_a', :'fac_code_a_pump', 'Main Pump A', 'water_supply'),
 (:'fac_a_lift', :'bldg_a', :'fac_code_a_lift', 'Lift A1', 'lift'),
 (:'fac_b_pump', :'bldg_b', :'fac_code_b_pump', 'Main Pump B', 'water_supply');

SET LOCAL ROLE authenticated;

-- =============================================================================
-- TEST SUITE 1: Profile Assignment & Protection
-- =============================================================================
-- Test 1.1: Resident cannot promote self to management
SELECT set_config('request.jwt.claims', '{"sub":"' || :'u_res_a' || '","role":"authenticated"}', true);
SELECT pg_temp.expect_error($q$UPDATE public.profiles SET role='management' WHERE id=auth.uid()$q$, 'protected');

-- Test 1.2: Resident cannot modify assigned estate, building, or unit
SELECT pg_temp.expect_error(format('UPDATE public.profiles SET assigned_estate_id=%L WHERE id=auth.uid()', :'est_b'), 'protected');
SELECT pg_temp.expect_error(format('UPDATE public.profiles SET assigned_building_id=%L WHERE id=auth.uid()', :'bldg_b'), 'protected');
SELECT pg_temp.expect_error($q$UPDATE public.profiles SET unit_number='99-99' WHERE id=auth.uid()$q$, 'protected');

-- Test 1.3: Resident CAN update non-protected fields (full_name, phone_number)
UPDATE public.profiles SET full_name='Resident A Renamed', phone_number='+60123456789' WHERE id=auth.uid();
SELECT pg_temp.assert_true((SELECT full_name='Resident A Renamed' FROM public.profiles WHERE id=auth.uid()), 'resident can update permitted profile fields');

-- =============================================================================
-- TEST SUITE 2: Unassigned User Isolation
-- =============================================================================
SELECT set_config('request.jwt.claims', '{"sub":"' || :'u_unassigned' || '","role":"authenticated"}', true);
-- Unassigned user cannot see any buildings or estate data
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.buildings), 'unassigned user sees 0 buildings');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.service_zones), 'unassigned user sees 0 zones');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.facilities), 'unassigned user sees 0 facilities');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.incident_reports), 'unassigned user sees 0 reports');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.published_incident_bulletins), 'unassigned user sees 0 bulletins');
-- Unassigned user cannot insert a report (has no assigned building)
SELECT pg_temp.expect_error(
  format('INSERT INTO public.incident_reports(reporter_id, building_id, category, description) VALUES (auth.uid(), %L, %L, %L)',
         :'bldg_a', 'water_supply', 'Test from unassigned user'),
  'assigned building'
);

-- =============================================================================
-- TEST SUITE 3: Report Validation & Zones
-- =============================================================================
SELECT set_config('request.jwt.claims', '{"sub":"' || :'u_res_a' || '","role":"authenticated"}', true);

-- Test 3.1: Reports must start submitted
SELECT pg_temp.expect_error(
  format('INSERT INTO public.incident_reports(reporter_id, building_id, category, description, status) VALUES (auth.uid(), %L, %L, %L, %L)',
         :'bldg_a', 'water_supply', 'Testing forged status', 'reviewed'),
  'submitted status'
);

-- Test 3.2: Report reporter_id cannot be spoofed
SELECT pg_temp.expect_error(
  format('INSERT INTO public.incident_reports(reporter_id, building_id, category, description) VALUES (%L, %L, %L, %L)',
         :'u_res_b', :'bldg_a', 'water_supply', 'Testing spoofed reporter'),
  'assigned building and submitted status'
);

-- Test 3.3: Reports and zones must belong to the same building
SELECT pg_temp.expect_error(
  format('INSERT INTO public.incident_reports(reporter_id, building_id, service_zone_id, category, description) VALUES (auth.uid(), %L, %L, %L, %L)',
         :'bldg_a', :'zone_b_high', 'water_supply', 'Testing cross building zone'),
  'zone must belong'
);

-- Test 3.4: Valid report insertion succeeds
INSERT INTO public.incident_reports(id, reporter_id, building_id, service_zone_id, category, description)
VALUES (:'rpt_a', auth.uid(), :'bldg_a', :'zone_a_low', 'water_supply', 'Low water pressure at unit 04-12');

-- Test 3.5: Resident cannot triage or modify report status (RLS filters out row)
WITH upd AS (
  UPDATE public.incident_reports SET status='reviewed' WHERE id=:'rpt_a' RETURNING id
) SELECT pg_temp.assert_true((SELECT count(*) FROM upd)=0, 'resident update affects 0 rows');
SELECT pg_temp.assert_true(
  (SELECT status='submitted' FROM public.incident_reports WHERE id=:'rpt_a'),
  'report status remains submitted'
);

-- =============================================================================
-- TEST SUITE 4: Cross-Estate & Management Boundaries
-- =============================================================================
-- Manager A in Estate A
SELECT set_config('request.jwt.claims', '{"sub":"' || :'u_mgr_a' || '","role":"authenticated"}', true);

-- Test 4.1: Manager A can manage Building A, but not Building B
SELECT pg_temp.assert_true(public.manages_building(:'bldg_a'), 'manager A manages building A');
SELECT pg_temp.assert_true(NOT public.manages_building(:'bldg_b'), 'manager A denied building B');

-- Test 4.2: Cross-estate update yields 0 affected rows via RLS
WITH upd AS (
  UPDATE public.service_zones SET name='Tampered' WHERE id=:'zone_b_high' RETURNING id
) SELECT pg_temp.assert_true((SELECT count(*) FROM upd)=0, 'cross-estate update affects 0 rows');

-- Test 4.3: Incident cannot link facility from another building
SELECT pg_temp.expect_error(
  format('INSERT INTO public.incidents(incident_number, building_id, primary_facility_id, title, category) VALUES (%L, %L, %L, %L, %L)',
         'INC_ERR_BLDG_' || :'run_id', :'bldg_a', :'fac_b_pump', 'Pump B in Block A', 'water_supply'),
  'Incident facility must match building and category'
);

-- Test 4.4: Incident cannot link facility of incompatible category
SELECT pg_temp.expect_error(
  format('INSERT INTO public.incidents(incident_number, building_id, primary_facility_id, title, category) VALUES (%L, %L, %L, %L, %L)',
         'INC_ERR_CAT_' || :'run_id', :'bldg_a', :'fac_a_lift', 'Lift facility on water incident', 'water_supply'),
  'Incident facility must match building and category'
);

-- Test 4.5: Valid incident insertion (starts investigating)
INSERT INTO public.incidents(id, incident_number, building_id, primary_facility_id, title, category, internal_notes)
VALUES (:'inc_a', :'inc_num_a', :'bldg_a', :'fac_a_pump', 'Main Pump A Failure', 'water_supply', 'Sensors indicate pressure drop');

-- Test 4.6: Unverified incident cannot publish updates
SELECT pg_temp.expect_error(
  format('INSERT INTO public.incident_updates(incident_id, update_title, message_bm, stage, is_published) VALUES (%L, %L, %L, %L, true)',
         :'inc_a', 'Premature notice', 'Notice published before verification', 'investigation'),
  'verified incident'
);

-- Test 4.7: Invalid transition directly to restored fails
SELECT pg_temp.expect_error(
  format('UPDATE public.incidents SET status=%L, restoration_evidence=%L WHERE id=%L', 'restored', 'Quick test', :'inc_a'),
  'Invalid incident transition'
);

-- Test 4.8: Verification sets verified_by and verified_at automatically
UPDATE public.incidents SET status='confirmed' WHERE id=:'inc_a';
SELECT pg_temp.assert_true(
  (SELECT verified_by=auth.uid() AND verified_at IS NOT NULL FROM public.incidents WHERE id=:'inc_a'),
  'verification automatically stamps actor and timestamp'
);

-- =============================================================================
-- TEST SUITE 5: Report Linking & Transitions
-- =============================================================================
-- Test 5.1: Linking requires report to be 'reviewed'
SELECT pg_temp.expect_error(
  format('INSERT INTO public.incident_report_links(incident_id, report_id) VALUES (%L, %L)', :'inc_a', :'rpt_a'),
  'Link requires reviewed report'
);

-- Manager triages report to 'reviewed'
UPDATE public.incident_reports SET status='reviewed' WHERE id=:'rpt_a';

-- Test 5.2: Linking marks report 'linked' atomically
INSERT INTO public.incident_report_links(incident_id, report_id)
VALUES (:'inc_a', :'rpt_a');
SELECT pg_temp.assert_true(
  (SELECT status='linked' FROM public.incident_reports WHERE id=:'rpt_a'),
  'linking report updates report status to linked'
);

-- =============================================================================
-- TEST SUITE 6: Publication & Read Model Sanitization
-- =============================================================================
-- Test 6.1: Publish official notice (spoofed published_by/at overridden by actual actor)
INSERT INTO public.incident_updates(id, incident_id, update_title, message_bm, stage, is_published, published_by, published_at)
VALUES (
  :'upd_a',
  :'inc_a',
  'Gangguan Bekalan Air',
  'Pasukan kontraktor sedang membaiki pam sedutan utama.',
  'contractor_assigned',
  true,
  :'u_mgr_b',              -- Attempt to spoof manager B
  '2000-01-01 00:00:00+00' -- Attempt to spoof timestamp
);

SELECT pg_temp.assert_true(
  (SELECT published_by=auth.uid() AND published_at = transaction_timestamp()
   FROM public.incident_updates WHERE id=:'upd_a'),
  'published_by and published_at cannot be spoofed'
);

-- Test 6.2: Switch to Resident A identity to verify read model
SELECT set_config('request.jwt.claims', '{"sub":"' || :'u_res_a' || '","role":"authenticated"}', true);

-- Direct queries to private incident table return 0 rows for residents
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.incidents), 'resident cannot query private incidents');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.incident_updates), 'resident cannot query private updates');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.maintenance_tasks), 'resident cannot query private maintenance tasks');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.audit_events), 'resident cannot query private audit log');

-- Resident CAN query published bulletin
SELECT pg_temp.assert_true(
  (SELECT count(*)=1 FROM public.published_incident_bulletins WHERE incident_number=:'inc_num_a'),
  'resident reads sanitized published bulletin'
);

-- Bulletin clients cannot mutate published read model
SELECT pg_temp.expect_error(
  format('UPDATE public.published_incident_bulletins SET update_title=%L WHERE incident_number=%L', 'Tampered', :'inc_num_a'),
  'permission denied'
);

-- =============================================================================
-- TEST SUITE 7: Restoration & Verification Evidence
-- =============================================================================
SELECT set_config('request.jwt.claims', '{"sub":"' || :'u_mgr_a' || '","role":"authenticated"}', true);
UPDATE public.incidents SET status='in_maintenance' WHERE id=:'inc_a';

-- Missing restoration evidence fails
SELECT pg_temp.expect_error(
  format('UPDATE public.incidents SET status=%L WHERE id=%L', 'restored', :'inc_a'),
  'Restoration requires physical verification evidence'
);

-- Valid restoration with evidence succeeds
UPDATE public.incidents SET status='restored', restoration_evidence='Main pump pressure tested at 4.2 bar at roof header tank'
WHERE id=:'inc_a';

-- =============================================================================
-- TEST SUITE 8: Audit Immutability & Rollback Safety
-- =============================================================================
-- Audit events exist and are immutable
SELECT pg_temp.assert_true((SELECT count(*) >= 8 FROM public.audit_events WHERE estate_id=:'est_a'), 'audit events generated');
SELECT pg_temp.expect_error(format('INSERT INTO public.audit_events(estate_id, action, target_entity, target_id) VALUES (%L,%L,%L,%L)', :'est_a','forged','incidents',:'inc_a'), 'permission denied');
SELECT pg_temp.expect_error($q$DELETE FROM public.audit_events$q$, 'permission denied');

-- Test 8.2: Transactional rollback on failed mutation leaves zero partial state (Task 6 remediation)
CREATE TEMPORARY TABLE pg_temp.current_test (
  inc_id UUID,
  estate_id TEXT
);
INSERT INTO pg_temp.current_test VALUES (:'inc_a', :'est_a');

DO $$
DECLARE
  v_inc_id UUID;
  v_estate_id TEXT;

  v_status_before TEXT;
  v_evidence_before TEXT;
  v_updated_at_before TIMESTAMPTZ;
  v_bulletin_count_before INT;
  v_audit_count_before INT;

  v_status_after TEXT;
  v_evidence_after TEXT;
  v_updated_at_after TIMESTAMPTZ;
  v_bulletin_count_after INT;
  v_audit_count_after INT;

  v_failed BOOLEAN := false;
  v_error_msg TEXT := '';
BEGIN
  SELECT inc_id, estate_id INTO v_inc_id, v_estate_id FROM pg_temp.current_test;

  -- 1. Snapshot business, projection, and audit state before mutation
  SELECT status, restoration_evidence, updated_at
  INTO v_status_before, v_evidence_before, v_updated_at_before
  FROM public.incidents WHERE id = v_inc_id;

  SELECT count(*) INTO v_bulletin_count_before
  FROM public.published_incident_bulletins WHERE incident_id = v_inc_id;

  SELECT count(*) INTO v_audit_count_before
  FROM public.audit_events WHERE estate_id = v_estate_id;

  -- 2. Attempt invalid mutation inside subtransaction (invalid transition from restored back to confirmed)
  BEGIN
    UPDATE public.incidents
    SET status = 'confirmed'
    WHERE id = v_inc_id;
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
    v_error_msg := SQLERRM;
  END;

  -- 3. Assert that the operation actually failed with the exact expected error
  IF NOT v_failed THEN
    RAISE EXCEPTION 'FAIL: Expected mutation to fail, but it unexpectedly succeeded!';
  END IF;

  IF position('Invalid incident transition' IN v_error_msg) = 0 THEN
    RAISE EXCEPTION 'FAIL: Expected invalid transition error, got: %', v_error_msg;
  END IF;

  -- 4. Snapshot business, projection, and audit state after failed mutation
  SELECT status, restoration_evidence, updated_at
  INTO v_status_after, v_evidence_after, v_updated_at_after
  FROM public.incidents WHERE id = v_inc_id;

  SELECT count(*) INTO v_bulletin_count_after
  FROM public.published_incident_bulletins WHERE incident_id = v_inc_id;

  SELECT count(*) INTO v_audit_count_after
  FROM public.audit_events WHERE estate_id = v_estate_id;

  -- 5. Assert strict business, projection, and audit equality (zero state modification)
  IF v_status_before IS DISTINCT FROM v_status_after THEN
    RAISE EXCEPTION 'FAIL: Incident status modified on failed mutation! Before: %, After: %', v_status_before, v_status_after;
  END IF;

  IF v_evidence_before IS DISTINCT FROM v_evidence_after THEN
    RAISE EXCEPTION 'FAIL: Incident evidence modified on failed mutation!';
  END IF;

  IF v_updated_at_before IS DISTINCT FROM v_updated_at_after THEN
    RAISE EXCEPTION 'FAIL: Incident updated_at modified on failed mutation!';
  END IF;

  IF v_bulletin_count_before <> v_bulletin_count_after THEN
    RAISE EXCEPTION 'FAIL: Bulletin read model modified on failed mutation! Before: %, After: %', v_bulletin_count_before, v_bulletin_count_after;
  END IF;

  IF v_audit_count_before <> v_audit_count_after THEN
    RAISE EXCEPTION 'FAIL: Partial audit rows leaked on failed mutation! Before: %, After: %', v_audit_count_before, v_audit_count_after;
  END IF;
END $$;

-- Test 8.3: Unpublishing removes read model
UPDATE public.incident_updates SET is_published=false WHERE id=:'upd_a';
SELECT pg_temp.assert_true(
  (SELECT count(*)=0 FROM public.published_incident_bulletins WHERE incident_number=:'inc_num_a'),
  'unpublishing removes bulletin from projection'
);

RESET ROLE;
ROLLBACK;
