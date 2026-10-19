-- Isolated, repeatable Phase 01B security test harness
-- Executes with psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/phase01b-security.sql
-- Uses dynamic identifiers per run to prevent collision with existing fixtures.
-- Fixtures and assertions roll back at the end.

SELECT
  gen_random_uuid() AS u_res_a,
  gen_random_uuid() AS u_mgr_a,
  gen_random_uuid() AS u_res_b,
  gen_random_uuid() AS u_mgr_b,
  gen_random_uuid() AS bldg_a,
  gen_random_uuid() AS bldg_b,
  gen_random_uuid() AS zone_b_high,
  gen_random_uuid() AS fac_b_pump,
  gen_random_uuid() AS rpt_a,
  gen_random_uuid() AS inc_a,
  gen_random_uuid() AS mtask_a,
  substr(md5(random()::text), 1, 8) AS run_id
\gset

SELECT
  'est_a_' || :'run_id' AS est_a,
  'est_b_' || :'run_id' AS est_b,
  'BLD_A_' || :'run_id' AS bldg_code_a,
  'BLD_B_' || :'run_id' AS bldg_code_b,
  'Z_B_' || :'run_id' AS zone_code_b,
  'PUMP_B_' || :'run_id' AS fac_code_b,
  'INC_' || :'run_id' AS inc_num_a
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

-- Two estates; resident A, manager A, resident B, manager B.
INSERT INTO auth.users(id, email) VALUES
 (:'u_res_a', 'res-a-' || :'run_id' || '@example.invalid'),
 (:'u_mgr_a', 'mgr-a-' || :'run_id' || '@example.invalid'),
 (:'u_res_b', 'res-b-' || :'run_id' || '@example.invalid'),
 (:'u_mgr_b', 'mgr-b-' || :'run_id' || '@example.invalid');

INSERT INTO public.buildings(id, estate_id, code, name, total_floors, total_units) VALUES
 (:'bldg_a', :'est_a', :'bldg_code_a', 'Test A', 15, 180),
 (:'bldg_b', :'est_b', :'bldg_code_b', 'Test B', 12, 144);

INSERT INTO public.profiles(id, role, full_name, assigned_estate_id, assigned_building_id) VALUES
 (:'u_res_a', 'resident', 'Resident A', :'est_a', :'bldg_a'),
 (:'u_mgr_a', 'management', 'Manager A', :'est_a', NULL),
 (:'u_res_b', 'resident', 'Resident B', :'est_b', :'bldg_b'),
 (:'u_mgr_b', 'management', 'Manager B', :'est_b', NULL);

INSERT INTO public.service_zones(id, building_id, zone_code, name, floor_start, floor_end, zone_type)
VALUES (:'zone_b_high', :'bldg_b', :'zone_code_b', 'High', 8, 12, 'residential_floors');

INSERT INTO public.facilities(id, building_id, facility_code, name, category)
VALUES (:'fac_b_pump', :'bldg_b', :'fac_code_b', 'Pump B', 'water_supply');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"' || :'u_res_a' || '","role":"authenticated"}', true);

SELECT pg_temp.expect_error($q$UPDATE public.profiles SET role='management' WHERE id=auth.uid()$q$, 'protected');
SELECT pg_temp.expect_error(format('UPDATE public.profiles SET assigned_estate_id=%L WHERE id=auth.uid()', :'est_b'), 'protected');
SELECT pg_temp.expect_error(format('UPDATE public.profiles SET assigned_building_id=%L WHERE id=auth.uid()', :'bldg_b'), 'protected');
SELECT pg_temp.expect_error(format('INSERT INTO public.incident_reports(reporter_id,building_id,category,description,status) VALUES(auth.uid(),%L,%L,%L,%L)', :'bldg_a', 'water_supply', 'Testing forged status', 'linked'), 'submitted status');
SELECT pg_temp.expect_error(format('INSERT INTO public.incident_reports(reporter_id,building_id,service_zone_id,category,description) VALUES(auth.uid(),%L,%L,%L,%L)', :'bldg_a', :'zone_b_high', 'water_supply', 'Testing wrong zone'), 'zone must belong');

INSERT INTO public.incident_reports(id, reporter_id, building_id, category, description)
VALUES (:'rpt_a', auth.uid(), :'bldg_a', 'water_supply', 'Testing actual report creation');

SELECT pg_temp.assert_true(public.owns_evidence_path(auth.uid()::text || '/' || :'rpt_a' || '/tap.jpg'), 'owned evidence path');
SELECT pg_temp.assert_true(NOT public.owns_evidence_path(auth.uid()::text || '/e0000000-0000-4000-8000-000000000099/tap.jpg'), 'unknown report path denied');
SELECT pg_temp.expect_error(format('INSERT INTO public.report_attachments(report_id,storage_path,file_name,mime_type,file_size_bytes) VALUES(%L,%L,%L,%L,100)', :'rpt_a', auth.uid()::text || '/' || :'rpt_a' || '/tap.jpg', 'tap.jpg', 'image/jpeg'), 'existing upload');

SELECT set_config('request.jwt.claims', '{"sub":"' || :'u_mgr_a' || '","role":"authenticated"}', true);
SELECT pg_temp.assert_true(public.manages_building(:'bldg_a'), 'manager own estate');
SELECT pg_temp.assert_true(NOT public.manages_building(:'bldg_b'), 'manager cross estate denied');

WITH changed AS (UPDATE public.service_zones SET floor_end=99 WHERE id=:'zone_b_high' RETURNING id)
SELECT pg_temp.assert_true((SELECT count(*) FROM changed)=0, 'cross estate update affects zero rows');

SELECT pg_temp.expect_error(format('INSERT INTO public.incidents(incident_number,building_id,primary_facility_id,title,category) VALUES(%L,%L,%L,%L,%L)', 'TEST_BAD_FAC_' || :'run_id', :'bldg_a', :'fac_b_pump', 'Wrong facility', 'water_supply'), 'facility must match');

INSERT INTO public.incidents(id, incident_number, building_id, title, category, internal_notes)
VALUES (:'inc_a', :'inc_num_a', :'bldg_a', 'Test water incident', 'water_supply', 'PRIVATE_SENTINEL');

SELECT pg_temp.expect_error(format('INSERT INTO public.incident_updates(incident_id,update_title,message_bm,stage,is_published) VALUES(%L,%L,%L,%L,true)', :'inc_a', 'Test notice', 'Test official notice text', 'investigation'), 'verified incident');
SELECT pg_temp.expect_error(format('UPDATE public.incidents SET status=%L,restoration_evidence=%L WHERE incident_number=%L', 'restored', 'Water flow tested', :'inc_num_a'), 'Invalid incident transition');

UPDATE public.incidents SET status='confirmed' WHERE incident_number=:'inc_num_a';
SELECT pg_temp.assert_true((SELECT verified_by=auth.uid() AND verified_at IS NOT NULL FROM public.incidents WHERE incident_number=:'inc_num_a'), 'verification attribution');

UPDATE public.incident_reports SET status='reviewed' WHERE id=:'rpt_a';
INSERT INTO public.incident_report_links(incident_id, report_id) VALUES (:'inc_a', :'rpt_a');
SELECT pg_temp.assert_true((SELECT status='linked' FROM public.incident_reports WHERE id=:'rpt_a'), 'link updates report atomically');

INSERT INTO public.incident_updates(incident_id, update_title, message_bm, stage, is_published, published_by, published_at)
VALUES (:'inc_a', 'Official notice', 'Pasukan teknikal sedang membaiki pam.', 'contractor_assigned', true, :'u_mgr_b', '2000-01-01');
SELECT pg_temp.assert_true((SELECT published_by=auth.uid() AND published_at = transaction_timestamp() FROM public.incident_updates WHERE incident_id=:'inc_a'), 'publisher and timestamp cannot be spoofed');

UPDATE public.incidents SET status='in_maintenance' WHERE incident_number=:'inc_num_a';
SELECT pg_temp.expect_error(format('UPDATE public.incidents SET status=%L WHERE incident_number=%L', 'restored', :'inc_num_a'), 'verification evidence');

UPDATE public.incidents SET status='restored', restoration_evidence='Pressure and flow tested at floor 15' WHERE incident_number=:'inc_num_a';
SELECT pg_temp.expect_error(format('UPDATE public.incidents SET status=%L WHERE incident_number=%L', 'confirmed', :'inc_num_a'), 'Invalid incident transition');

INSERT INTO public.maintenance_tasks(id, incident_id, task_title) VALUES (:'mtask_a', :'inc_a', 'Test maintenance');
UPDATE public.maintenance_tasks SET status='on_site' WHERE id=:'mtask_a';
UPDATE public.maintenance_tasks SET status='completed' WHERE id=:'mtask_a';

SELECT pg_temp.assert_true((SELECT count(*) >= 10 FROM public.audit_events WHERE estate_id=:'est_a'), 'transactional audit rows');
SELECT pg_temp.expect_error(format('INSERT INTO public.audit_events(estate_id,action,target_entity,target_id) VALUES(%L,%L,%L,%L)', :'est_a', 'forged', 'incidents', :'inc_a'), 'permission denied');
SELECT pg_temp.expect_error($q$DELETE FROM public.audit_events$q$, 'permission denied');

SELECT set_config('request.jwt.claims', '{"sub":"' || :'u_res_a' || '","role":"authenticated"}', true);
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.incidents), 'resident cannot read private incidents even after publication');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.incident_updates), 'resident cannot read internal updates');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.published_incident_bulletins WHERE incident_number=:'inc_num_a'), 'resident can read sanitized bulletin');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM information_schema.columns WHERE table_schema='public' AND table_name='published_incident_bulletins' AND column_name IN ('internal_notes','restoration_evidence','verified_by','published_by','reporter_id')), 'read model contains no private fields');
SELECT pg_temp.expect_error($q$UPDATE public.published_incident_bulletins SET message_bm='forged'$q$, 'permission denied');

SELECT set_config('request.jwt.claims', '{"sub":"' || :'u_res_b' || '","role":"authenticated"}', true);
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.incident_reports), 'other resident reports denied');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.published_incident_bulletins WHERE incident_number=:'inc_num_a'), 'other estate bulletin denied');
SELECT pg_temp.assert_true(NOT public.owns_evidence_path(:'u_res_a' || '/' || :'rpt_a' || '/tap.jpg'), 'other resident evidence denied');

SELECT set_config('request.jwt.claims', '{"sub":"' || :'u_mgr_b' || '","role":"authenticated"}', true);
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.incident_reports), 'other manager reports denied');
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.audit_events WHERE estate_id=:'est_a'), 'other manager audit denied');

-- Test valid estate-B manager floor update rejects out-of-bounds floors.
SELECT pg_temp.expect_error(format('UPDATE public.service_zones SET floor_end=99 WHERE id=%L', :'zone_b_high'), 'Zone floors exceed');

SELECT set_config('request.jwt.claims', '{"sub":"' || :'u_mgr_a' || '","role":"authenticated"}', true);
SELECT pg_temp.assert_true((SELECT count(DISTINCT action)=6 FROM public.audit_events
 WHERE estate_id=:'est_a' AND action IN ('incident_reports.insert','incident.verified',
 'incident_report_links.insert','notice.published','maintenance_tasks.update','incident.restored')), 'all required audit action categories');

UPDATE public.incident_updates SET is_published=false WHERE incident_id=:'inc_a';
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.published_incident_bulletins WHERE incident_number=:'inc_num_a'), 'unpublishing removes resident read model');

RESET ROLE;
ROLLBACK;
