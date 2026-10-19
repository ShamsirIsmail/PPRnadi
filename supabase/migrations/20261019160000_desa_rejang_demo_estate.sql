-- ==============================================================================
-- PPR NADI Migration: PPR Desa Rejang Study & Demonstration Site Setup
-- ==============================================================================
-- PENTING & STATUS PENGESAHAN:
-- Pembahagian tingkat berikut ialah ANDAIAN DEMO SEMENTARA yang dibenarkan pengguna,
-- BUKAN ukuran atau bancian fizikal tapak yang telah disahkan rasmi.
-- Pasukan kajian PPR NADI mengekalkan rekod tapak rasmi secara berasingan.
--
-- Konfigurasi Blok & Tingkat Sementara (12 Blok A - L):
--   - Blok A, B, C, D, E, F, G, H : 18 tingkat
--   - Blok I, J                   : 17 tingkat
--   - Blok K                      : 16 tingkat
--   - Blok L                      : 15 tingkat
-- Jumlah kawasan: 2,791 unit (anggaran tapak keseluruhan).
-- Pecahan unit setiap blok belum disahkan: disimpan sebagai NULL bagi mengelakkan data rekaan.
-- ==============================================================================

-- 1. Update belongs_to_building to allow estate-wide incident reporting
-- Residents can report incidents occurring at any building within their assigned estate
-- (e.g. incident at corridor of Blok A while resident lives in Blok B).
CREATE OR REPLACE FUNCTION public.belongs_to_building(p_building UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.buildings b ON b.estate_id = p.assigned_estate_id
    WHERE p.id = auth.uid()
      AND b.id = p_building
      AND p.assigned_estate_id IS NOT NULL
  );
$$;

-- 2. Allow unverified block unit breakdowns (NULL) while keeping positive unit check when specified
ALTER TABLE public.buildings ALTER COLUMN total_units DROP NOT NULL;
ALTER TABLE public.buildings DROP CONSTRAINT IF EXISTS buildings_total_units_check;
ALTER TABLE public.buildings ADD CONSTRAINT buildings_total_units_check CHECK (total_units IS NULL OR total_units > 0);

-- 3. Ensure idempotent uniqueness constraint on service_zones
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_service_zones_building_code'
  ) THEN
    ALTER TABLE public.service_zones ADD CONSTRAINT uq_service_zones_building_code UNIQUE (building_id, zone_code);
  END IF;
END $$;

-- 4. Insert or update 12 buildings for PPR Desa Rejang (estate_id = 'ppr-desa-rejang')
DO $$
DECLARE
  v_bldg_a UUID;
  v_bldg_b UUID;
  v_bldg_c UUID;
  v_bldg_d UUID;
  v_bldg_e UUID;
  v_bldg_f UUID;
  v_bldg_g UUID;
  v_bldg_h UUID;
  v_bldg_i UUID;
  v_bldg_j UUID;
  v_bldg_k UUID;
  v_bldg_l UUID;
BEGIN
  -- Blok A (18 tingkat)
  INSERT INTO public.buildings (code, name, total_floors, total_units, estate_id)
  VALUES ('DR_BLK_A', 'Blok A', 18, NULL, 'ppr-desa-rejang')
  ON CONFLICT (code) DO UPDATE SET total_floors = 18, total_units = NULL, name = 'Blok A', estate_id = 'ppr-desa-rejang'
  RETURNING id INTO v_bldg_a;

  -- Blok B (18 tingkat)
  INSERT INTO public.buildings (code, name, total_floors, total_units, estate_id)
  VALUES ('DR_BLK_B', 'Blok B', 18, NULL, 'ppr-desa-rejang')
  ON CONFLICT (code) DO UPDATE SET total_floors = 18, total_units = NULL, name = 'Blok B', estate_id = 'ppr-desa-rejang'
  RETURNING id INTO v_bldg_b;

  -- Blok C (18 tingkat)
  INSERT INTO public.buildings (code, name, total_floors, total_units, estate_id)
  VALUES ('DR_BLK_C', 'Blok C', 18, NULL, 'ppr-desa-rejang')
  ON CONFLICT (code) DO UPDATE SET total_floors = 18, total_units = NULL, name = 'Blok C', estate_id = 'ppr-desa-rejang'
  RETURNING id INTO v_bldg_c;

  -- Blok D (18 tingkat)
  INSERT INTO public.buildings (code, name, total_floors, total_units, estate_id)
  VALUES ('DR_BLK_D', 'Blok D', 18, NULL, 'ppr-desa-rejang')
  ON CONFLICT (code) DO UPDATE SET total_floors = 18, total_units = NULL, name = 'Blok D', estate_id = 'ppr-desa-rejang'
  RETURNING id INTO v_bldg_d;

  -- Blok E (18 tingkat)
  INSERT INTO public.buildings (code, name, total_floors, total_units, estate_id)
  VALUES ('DR_BLK_E', 'Blok E', 18, NULL, 'ppr-desa-rejang')
  ON CONFLICT (code) DO UPDATE SET total_floors = 18, total_units = NULL, name = 'Blok E', estate_id = 'ppr-desa-rejang'
  RETURNING id INTO v_bldg_e;

  -- Blok F (18 tingkat)
  INSERT INTO public.buildings (code, name, total_floors, total_units, estate_id)
  VALUES ('DR_BLK_F', 'Blok F', 18, NULL, 'ppr-desa-rejang')
  ON CONFLICT (code) DO UPDATE SET total_floors = 18, total_units = NULL, name = 'Blok F', estate_id = 'ppr-desa-rejang'
  RETURNING id INTO v_bldg_f;

  -- Blok G (18 tingkat)
  INSERT INTO public.buildings (code, name, total_floors, total_units, estate_id)
  VALUES ('DR_BLK_G', 'Blok G', 18, NULL, 'ppr-desa-rejang')
  ON CONFLICT (code) DO UPDATE SET total_floors = 18, total_units = NULL, name = 'Blok G', estate_id = 'ppr-desa-rejang'
  RETURNING id INTO v_bldg_g;

  -- Blok H (18 tingkat)
  INSERT INTO public.buildings (code, name, total_floors, total_units, estate_id)
  VALUES ('DR_BLK_H', 'Blok H', 18, NULL, 'ppr-desa-rejang')
  ON CONFLICT (code) DO UPDATE SET total_floors = 18, total_units = NULL, name = 'Blok H', estate_id = 'ppr-desa-rejang'
  RETURNING id INTO v_bldg_h;

  -- Blok I (17 tingkat)
  INSERT INTO public.buildings (code, name, total_floors, total_units, estate_id)
  VALUES ('DR_BLK_I', 'Blok I', 17, NULL, 'ppr-desa-rejang')
  ON CONFLICT (code) DO UPDATE SET total_floors = 17, total_units = NULL, name = 'Blok I', estate_id = 'ppr-desa-rejang'
  RETURNING id INTO v_bldg_i;

  -- Blok J (17 tingkat)
  INSERT INTO public.buildings (code, name, total_floors, total_units, estate_id)
  VALUES ('DR_BLK_J', 'Blok J', 17, NULL, 'ppr-desa-rejang')
  ON CONFLICT (code) DO UPDATE SET total_floors = 17, total_units = NULL, name = 'Blok J', estate_id = 'ppr-desa-rejang'
  RETURNING id INTO v_bldg_j;

  -- Blok K (16 tingkat)
  INSERT INTO public.buildings (code, name, total_floors, total_units, estate_id)
  VALUES ('DR_BLK_K', 'Blok K', 16, NULL, 'ppr-desa-rejang')
  ON CONFLICT (code) DO UPDATE SET total_floors = 16, total_units = NULL, name = 'Blok K', estate_id = 'ppr-desa-rejang'
  RETURNING id INTO v_bldg_k;

  -- Blok L (15 tingkat)
  INSERT INTO public.buildings (code, name, total_floors, total_units, estate_id)
  VALUES ('DR_BLK_L', 'Blok L', 15, NULL, 'ppr-desa-rejang')
  ON CONFLICT (code) DO UPDATE SET total_floors = 15, total_units = NULL, name = 'Blok L', estate_id = 'ppr-desa-rejang'
  RETURNING id INTO v_bldg_l;

  -- ----------------------------------------------------------------------------
  -- 5. Service Zones per Building (Safely upserted without deleting existing IDs)
  -- ----------------------------------------------------------------------------
  -- 18-floor buildings (A - H): Zon Rendah (1-9), Zon Tinggi (10-18)
  INSERT INTO public.service_zones (building_id, zone_code, name, floor_start, floor_end, zone_type) VALUES
    (v_bldg_a, 'DR-A-LOW',  'Blok A Zon Rendah (Tingkat 1-9)',   1,  9, 'residential_floors'),
    (v_bldg_a, 'DR-A-HIGH', 'Blok A Zon Tinggi (Tingkat 10-18)', 10, 18, 'residential_floors'),
    (v_bldg_b, 'DR-B-LOW',  'Blok B Zon Rendah (Tingkat 1-9)',   1,  9, 'residential_floors'),
    (v_bldg_b, 'DR-B-HIGH', 'Blok B Zon Tinggi (Tingkat 10-18)', 10, 18, 'residential_floors'),
    (v_bldg_c, 'DR-C-LOW',  'Blok C Zon Rendah (Tingkat 1-9)',   1,  9, 'residential_floors'),
    (v_bldg_c, 'DR-C-HIGH', 'Blok C Zon Tinggi (Tingkat 10-18)', 10, 18, 'residential_floors'),
    (v_bldg_d, 'DR-D-LOW',  'Blok D Zon Rendah (Tingkat 1-9)',   1,  9, 'residential_floors'),
    (v_bldg_d, 'DR-D-HIGH', 'Blok D Zon Tinggi (Tingkat 10-18)', 10, 18, 'residential_floors'),
    (v_bldg_e, 'DR-E-LOW',  'Blok E Zon Rendah (Tingkat 1-9)',   1,  9, 'residential_floors'),
    (v_bldg_e, 'DR-E-HIGH', 'Blok E Zon Tinggi (Tingkat 10-18)', 10, 18, 'residential_floors'),
    (v_bldg_f, 'DR-F-LOW',  'Blok F Zon Rendah (Tingkat 1-9)',   1,  9, 'residential_floors'),
    (v_bldg_f, 'DR-F-HIGH', 'Blok F Zon Tinggi (Tingkat 10-18)', 10, 18, 'residential_floors'),
    (v_bldg_g, 'DR-G-LOW',  'Blok G Zon Rendah (Tingkat 1-9)',   1,  9, 'residential_floors'),
    (v_bldg_g, 'DR-G-HIGH', 'Blok G Zon Tinggi (Tingkat 10-18)', 10, 18, 'residential_floors'),
    (v_bldg_h, 'DR-H-LOW',  'Blok H Zon Rendah (Tingkat 1-9)',   1,  9, 'residential_floors'),
    (v_bldg_h, 'DR-H-HIGH', 'Blok H Zon Tinggi (Tingkat 10-18)', 10, 18, 'residential_floors'),
    -- 17-floor buildings (I, J): Zon Rendah (1-9), Zon Tinggi (10-17)
    (v_bldg_i, 'DR-I-LOW',  'Blok I Zon Rendah (Tingkat 1-9)',   1,  9, 'residential_floors'),
    (v_bldg_i, 'DR-I-HIGH', 'Blok I Zon Tinggi (Tingkat 10-17)', 10, 17, 'residential_floors'),
    (v_bldg_j, 'DR-J-LOW',  'Blok J Zon Rendah (Tingkat 1-9)',   1,  9, 'residential_floors'),
    (v_bldg_j, 'DR-J-HIGH', 'Blok J Zon Tinggi (Tingkat 10-17)', 10, 17, 'residential_floors'),
    -- 16-floor building (K): Zon Rendah (1-8), Zon Tinggi (9-16)
    (v_bldg_k, 'DR-K-LOW',  'Blok K Zon Rendah (Tingkat 1-8)',   1,  8, 'residential_floors'),
    (v_bldg_k, 'DR-K-HIGH', 'Blok K Zon Tinggi (Tingkat 9-16)',  9, 16, 'residential_floors'),
    -- 15-floor building (L): Zon Rendah (1-7), Zon Tinggi (8-15)
    (v_bldg_l, 'DR-L-LOW',  'Blok L Zon Rendah (Tingkat 1-7)',   1,  7, 'residential_floors'),
    (v_bldg_l, 'DR-L-HIGH', 'Blok L Zon Tinggi (Tingkat 8-15)',  8, 15, 'residential_floors')
  ON CONFLICT (building_id, zone_code) DO UPDATE SET
    name = EXCLUDED.name,
    floor_start = EXCLUDED.floor_start,
    floor_end = EXCLUDED.floor_end,
    zone_type = EXCLUDED.zone_type;

  -- ----------------------------------------------------------------------------
  -- 6. Facilities for Blok A & Blok L
  -- ----------------------------------------------------------------------------
  INSERT INTO public.facilities (building_id, facility_code, name, category, location_details, operational_status)
  VALUES 
    (v_bldg_a, 'DR-LIFT-A-01',  'Lif Penumpang 1 Blok A (G-18)', 'lift', 'Aci Lif Utama Blok A', 'operational'),
    (v_bldg_a, 'DR-LIFT-A-02',  'Lif Penumpang 2 Blok A (G-18)', 'lift', 'Aci Lif Kedua Blok A', 'operational'),
    (v_bldg_a, 'DR-PUMP-A-MAIN', 'Pam Bekalan Air Utama Blok A', 'water_supply', 'Bilik Pam Bawah Tanah Blok A', 'operational'),
    (v_bldg_a, 'DR-LIGHT-A-HIGH', 'Litar Lampu Koridor Aras 10-18', 'corridor_lighting', 'Papan Agihan DB-A-T10', 'operational'),
    (v_bldg_l, 'DR-LIFT-L-01',  'Lif Penumpang 1 Blok L (G-15)', 'lift', 'Aci Lif Utama Blok L', 'operational'),
    (v_bldg_l, 'DR-PUMP-L-MAIN', 'Pam Bekalan Air Utama Blok L', 'water_supply', 'Bilik Pam Bawah Tanah Blok L', 'operational')
  ON CONFLICT (facility_code) DO NOTHING;

END $$;
