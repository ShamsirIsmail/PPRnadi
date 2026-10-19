-- Seed synthetic test identities for API, Storage, and Concurrency testing
-- Committed into local database for HTTP API testing

-- Insert users into auth.users if not exists
INSERT INTO auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES 
 ('a0000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'res-a@estate-a.local', '{"provider":"email","providers":["email"]}', '{}', now(), now()),
 ('a0000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'mgr-a@estate-a.local', '{"provider":"email","providers":["email"]}', '{}', now(), now()),
 ('a0000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'res-b@estate-b.local', '{"provider":"email","providers":["email"]}', '{}', now(), now()),
 ('a0000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'mgr-b@estate-b.local', '{"provider":"email","providers":["email"]}', '{}', now(), now()),
 ('a0000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'unassigned@test.local', '{"provider":"email","providers":["email"]}', '{}', now(), now())
ON CONFLICT (id) DO NOTHING;

-- Insert buildings
INSERT INTO public.buildings (id, estate_id, code, name, total_floors, total_units)
VALUES
 ('b0000000-0000-4000-8000-000000000001', 'test-estate-a', 'BLDG_TEST_A', 'Test Block A', 15, 180),
 ('b0000000-0000-4000-8000-000000000002', 'test-estate-b', 'BLDG_TEST_B', 'Test Block B', 12, 144)
ON CONFLICT (id) DO NOTHING;

-- Trusted backend/admin provisions profiles
INSERT INTO public.profiles (id, role, full_name, assigned_estate_id, assigned_building_id, unit_number)
VALUES
 ('a0000000-0000-4000-8000-000000000001', 'resident', 'Resident A', 'test-estate-a', 'b0000000-0000-4000-8000-000000000001', '05-10'),
 ('a0000000-0000-4000-8000-000000000002', 'management', 'Manager A', 'test-estate-a', NULL, NULL),
 ('a0000000-0000-4000-8000-000000000003', 'resident', 'Resident B', 'test-estate-b', 'b0000000-0000-4000-8000-000000000002', '03-04'),
 ('a0000000-0000-4000-8000-000000000004', 'management', 'Manager B', 'test-estate-b', NULL, NULL),
 ('a0000000-0000-4000-8000-000000000005', 'resident', 'Unassigned Resident', NULL, NULL, NULL)
ON CONFLICT (id) DO NOTHING;

-- Insert service zones
INSERT INTO public.service_zones (id, building_id, zone_code, name, floor_start, floor_end, zone_type)
VALUES
 ('c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'Z_A_RES', 'Block A Floors 1-15', 1, 15, 'residential_floors'),
 ('c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', 'Z_B_RES', 'Block B Floors 1-12', 1, 12, 'residential_floors')
ON CONFLICT (id) DO NOTHING;

-- Insert facilities
INSERT INTO public.facilities (id, building_id, facility_code, name, category)
VALUES
 ('d0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'FAC_A_PUMP', 'Main Water Pump A', 'water_supply'),
 ('d0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', 'FAC_B_PUMP', 'Main Water Pump B', 'water_supply')
ON CONFLICT (id) DO NOTHING;
