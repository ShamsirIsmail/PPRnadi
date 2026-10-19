-- ==============================================================================
-- PPR NADI Migration 02: Synthetic Demo Seed (PPR Sentosa)
-- ==============================================================================
-- Fictional dataset for hackathon prototype testing.
-- Estate: PPR Sentosa (SYNTHETIC DEMO)
-- Blocks:
--   - Blok A: 15 floors, 180 units
--   - Blok B: 15 floors, 180 units
--   - Blok C: 12 floors, 144 units
-- All floor ranges strictly bounded within each building's physical floor count.

DO $$
DECLARE
  v_bldg_a UUID;
  v_bldg_b UUID;
  v_bldg_c UUID;
  
  v_zone_a_low UUID;
  v_zone_a_high UUID;
  v_zone_b_low UUID;
  v_zone_b_high UUID;
  v_zone_c_low UUID;
  v_zone_c_high UUID;
  
  v_fac_b_pump_main UUID;
  v_fac_b_pump_booster UUID;
  v_fac_b_lift_1 UUID;
  v_fac_b_lift_2 UUID;
  v_fac_b_light_high UUID;
BEGIN
  -- ----------------------------------------------------------------------------
  -- 1. Insert Buildings
  -- ----------------------------------------------------------------------------
  INSERT INTO public.buildings (code, name, total_floors, total_units, estate_id)
  VALUES 
    ('BLK_A', 'Blok A', 15, 180, 'ppr-sentosa-demo')
  RETURNING id INTO v_bldg_a;

  INSERT INTO public.buildings (code, name, total_floors, total_units, estate_id)
  VALUES 
    ('BLK_B', 'Blok B', 15, 180, 'ppr-sentosa-demo')
  RETURNING id INTO v_bldg_b;

  INSERT INTO public.buildings (code, name, total_floors, total_units, estate_id)
  VALUES 
    ('BLK_C', 'Blok C', 12, 144, 'ppr-sentosa-demo')
  RETURNING id INTO v_bldg_c;

  -- ----------------------------------------------------------------------------
  -- 2. Insert Service Zones (Strictly bounded by floor count)
  -- ----------------------------------------------------------------------------
  -- Blok A (15 floors)
  INSERT INTO public.service_zones (building_id, zone_code, name, floor_start, floor_end, zone_type)
  VALUES (v_bldg_a, 'A-ZONE-LOW', 'Blok A Zon Rendah (Tingkat 1-7)', 1, 7, 'residential_floors')
  RETURNING id INTO v_zone_a_low;

  INSERT INTO public.service_zones (building_id, zone_code, name, floor_start, floor_end, zone_type)
  VALUES (v_bldg_a, 'A-ZONE-HIGH', 'Blok A Zon Tinggi (Tingkat 8-15)', 8, 15, 'residential_floors')
  RETURNING id INTO v_zone_a_high;

  -- Blok B (15 floors)
  INSERT INTO public.service_zones (building_id, zone_code, name, floor_start, floor_end, zone_type)
  VALUES (v_bldg_b, 'B-ZONE-LOW', 'Blok B Zon Rendah (Tingkat 1-7)', 1, 7, 'residential_floors')
  RETURNING id INTO v_zone_b_low;

  INSERT INTO public.service_zones (building_id, zone_code, name, floor_start, floor_end, zone_type)
  VALUES (v_bldg_b, 'B-ZONE-HIGH', 'Blok B Zon Tinggi (Tingkat 8-15)', 8, 15, 'residential_floors')
  RETURNING id INTO v_zone_b_high;

  -- Blok C (12 floors)
  INSERT INTO public.service_zones (building_id, zone_code, name, floor_start, floor_end, zone_type)
  VALUES (v_bldg_c, 'C-ZONE-LOW', 'Blok C Zon Rendah (Tingkat 1-6)', 1, 6, 'residential_floors')
  RETURNING id INTO v_zone_c_low;

  INSERT INTO public.service_zones (building_id, zone_code, name, floor_start, floor_end, zone_type)
  VALUES (v_bldg_c, 'C-ZONE-HIGH', 'Blok C Zon Tinggi (Tingkat 7-12)', 7, 12, 'residential_floors')
  RETURNING id INTO v_zone_c_high;

  -- ----------------------------------------------------------------------------
  -- 3. Insert Core Facilities for Blok B (Primary Demo Scenario)
  -- ----------------------------------------------------------------------------
  INSERT INTO public.facilities (building_id, facility_code, name, category, location_details, operational_status)
  VALUES (v_bldg_b, 'PUMP-B-MAIN', 'Pam Sedutan Utama Bawah Tanah', 'water_supply', 'Bilik Pam Bawah Tanah Blok B', 'operational')
  RETURNING id INTO v_fac_b_pump_main;

  INSERT INTO public.facilities (building_id, facility_code, name, category, location_details, operational_status)
  VALUES (v_bldg_b, 'PUMP-B-BOOST', 'Pam Penggalak Zon Tinggi', 'water_supply', 'Bilik Pam Penggalak Aras Bumbung Blok B', 'operational')
  RETURNING id INTO v_fac_b_pump_booster;

  INSERT INTO public.facilities (building_id, facility_code, name, category, location_details, operational_status)
  VALUES (v_bldg_b, 'LIFT-B-01', 'Lif Penumpang 1 (G-15)', 'lift', 'Aci Lif Utama Blok B', 'operational')
  RETURNING id INTO v_fac_b_lift_1;

  INSERT INTO public.facilities (building_id, facility_code, name, category, location_details, operational_status)
  VALUES (v_bldg_b, 'LIFT-B-02', 'Lif Penumpang 2 (G-15)', 'lift', 'Aci Lif Kedua Blok B', 'operational')
  RETURNING id INTO v_fac_b_lift_2;

  INSERT INTO public.facilities (building_id, facility_code, name, category, location_details, operational_status)
  VALUES (v_bldg_b, 'LIGHT-B-HIGH', 'Litar Lampu Koridor Tingkat 8-15', 'corridor_lighting', 'Papan Agihan Elektrik DB-B-T08', 'operational')
  RETURNING id INTO v_fac_b_light_high;

  -- Facilities for Blok A & C
  INSERT INTO public.facilities (building_id, facility_code, name, category, location_details, operational_status)
  VALUES 
    (v_bldg_a, 'PUMP-A-MAIN', 'Pam Sedutan Utama Bawah Tanah Blok A', 'water_supply', 'Bilik Pam Blok A', 'operational'),
    (v_bldg_a, 'LIFT-A-01', 'Lif Penumpang 1 Blok A', 'lift', 'Aci Lif Blok A', 'operational'),
    (v_bldg_c, 'PUMP-C-MAIN', 'Pam Sedutan Utama Bawah Tanah Blok C', 'water_supply', 'Bilik Pam Blok C', 'operational'),
    (v_bldg_c, 'LIFT-C-01', 'Lif Penumpang 1 Blok C', 'lift', 'Aci Lif Blok C', 'operational');

  -- ----------------------------------------------------------------------------
  -- 4. Facility Dependencies (Mapping for Connected Problem Intelligence)
  -- ----------------------------------------------------------------------------
  -- Booster pump serves High Zone of Block B
  INSERT INTO public.facility_dependencies (facility_id, service_zone_id, dependency_type, criticality)
  VALUES 
    (v_fac_b_pump_booster, v_zone_b_high, 'primary_feeder', 'critical'),
    (v_fac_b_pump_main, v_zone_b_low, 'primary_feeder', 'critical'),
    (v_fac_b_pump_main, v_zone_b_high, 'secondary_feeder', 'high'),
    (v_fac_b_lift_1, v_zone_b_low, 'vertical_transport', 'high'),
    (v_fac_b_lift_1, v_zone_b_high, 'vertical_transport', 'high'),
    (v_fac_b_light_high, v_zone_b_high, 'lighting_circuit', 'medium');

END $$;
