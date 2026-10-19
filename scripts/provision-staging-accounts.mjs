import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

/**
 * PPR NADI — Staging Demo Account Provisioning Script
 * Strictly adheres to cloud staging security rules:
 * - Uses public.profiles table.
 * - Requires STAGING_RESIDENT_PASSWORD and STAGING_MANAGER_PASSWORD from environment.
 * - Does not change passwords of existing accounts.
 * - Verifies DR_BLK_A building exists before proceeding.
 * - Verifies storage bucket incident-evidence is strictly private.
 * - Fails with exit code 1 if any mandatory step encounters an error.
 */

// Load .env.staging.local if present
if (fs.existsSync('.env.staging.local')) {
  try {
    process.loadEnvFile('.env.staging.local');
  } catch {}
}

const EXPECTED_REF = 'mhtlcvvqwxkhkeqhzbrk';

async function main() {
  const projectRef = process.env.STAGING_PROJECT_REF;
  const supabaseUrl = process.env.STAGING_SUPABASE_URL;
  const serviceRoleKey = process.env.STAGING_SERVICE_ROLE_KEY;
  const residentPassword = process.env.STAGING_RESIDENT_PASSWORD;
  const managerPassword = process.env.STAGING_MANAGER_PASSWORD;

  // 1. Validate required environment inputs
  if (!projectRef) {
    console.error('[Error] STAGING_PROJECT_REF is required.');
    process.exit(1);
  }
  if (projectRef !== EXPECTED_REF) {
    console.error(`[Error] Safety Violation: STAGING_PROJECT_REF [${projectRef}] does not match allowed staging reference [${EXPECTED_REF}].`);
    process.exit(1);
  }
  if (!supabaseUrl) {
    console.error('[Error] STAGING_SUPABASE_URL is required.');
    process.exit(1);
  }
  if (!serviceRoleKey) {
    console.error('[Error] STAGING_SERVICE_ROLE_KEY is required.');
    process.exit(1);
  }
  if (!residentPassword || !managerPassword) {
    console.error('[Error] STAGING_RESIDENT_PASSWORD and STAGING_MANAGER_PASSWORD are required from secure environment. Auto-generated passwords are not permitted.');
    process.exit(1);
  }

  // 2. Reject any local/loopback target
  const lowerUrl = supabaseUrl.toLowerCase();
  if (
    lowerUrl.includes('localhost') ||
    lowerUrl.includes('127.0.0.1') ||
    lowerUrl.includes('::1') ||
    lowerUrl.includes('0.0.0.0')
  ) {
    console.error('[Error] Safety Violation: STAGING_SUPABASE_URL points to local loopback interface.');
    process.exit(1);
  }
  if (!lowerUrl.includes(EXPECTED_REF)) {
    console.error(`[Error] Safety Violation: STAGING_SUPABASE_URL does not contain project reference [${EXPECTED_REF}].`);
    process.exit(1);
  }

  console.log(`[Staging Provision] Connecting to staging project: ${EXPECTED_REF}...`);
  const sb = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // 3. Verify PPR Desa Rejang and DR_BLK_A building exist
  console.log('[Staging Provision] Verifying Desa Rejang building schema...');
  const { data: buildings, error: bldgErr } = await sb
    .from('buildings')
    .select('id, code, name, estate_id')
    .eq('estate_id', 'ppr-desa-rejang');

  if (bldgErr) {
    console.error('[Error] Failed to query buildings table:', bldgErr.message);
    process.exit(1);
  }
  if (!buildings || buildings.length === 0) {
    console.error('[Error] No buildings found for estate "ppr-desa-rejang". Please run database migrations first.');
    process.exit(1);
  }

  const blokA = buildings.find(b => b.code === 'DR_BLK_A');
  if (!blokA) {
    console.error('[Error] Required building DR_BLK_A was not found in Desa Rejang building list.');
    process.exit(1);
  }
  console.log(`[Staging Provision] Found building DR_BLK_A: ${blokA.id}`);

  // 4. Provision demo accounts
  const demoSpecs = [
    {
      email: 'resident.rejang@nadi.local',
      password: residentPassword,
      fullName: 'Ahmad bin Razak (Penduduk Blok A)',
      role: 'resident',
      estateId: 'ppr-desa-rejang',
      buildingId: blokA.id,
      unitNumber: '05-01'
    },
    {
      email: 'manager.rejang@nadi.local',
      password: managerPassword,
      fullName: 'Siti Nurhaliza (Pengurus PPR Desa Rejang)',
      role: 'management',
      estateId: 'ppr-desa-rejang',
      buildingId: null,
      unitNumber: null
    }
  ];

  // List existing users
  const { data: userListData, error: listUserErr } = await sb.auth.admin.listUsers();
  if (listUserErr) {
    console.error('[Error] Failed to list Auth users:', listUserErr.message);
    process.exit(1);
  }
  const existingUsers = userListData.users || [];

  for (const spec of demoSpecs) {
    let user = existingUsers.find(u => u.email === spec.email);

    if (!user) {
      console.log(`[Staging Provision] Creating user ${spec.email}...`);
      const { data: createData, error: createErr } = await sb.auth.admin.createUser({
        email: spec.email,
        password: spec.password,
        email_confirm: true,
        user_metadata: {
          full_name: spec.fullName,
          role: spec.role
        }
      });

      if (createErr || !createData?.user) {
        console.error(`[Error] Failed to create user ${spec.email}:`, createErr?.message);
        process.exit(1);
      }
      user = createData.user;
      console.log(`[Staging Provision] Created user ${spec.email} (ID: ${user.id})`);
    } else {
      console.log(`[Staging Provision] User ${spec.email} already exists (ID: ${user.id}). Preserving existing credentials.`);
    }

    // Upsert into public.profiles (strictly matching table schema)
    console.log(`[Staging Provision] Upserting public.profiles for ${spec.email}...`);
    const { error: profileErr } = await sb
      .from('profiles')
      .upsert({
        id: user.id,
        role: spec.role,
        full_name: spec.fullName,
        assigned_estate_id: spec.estateId,
        assigned_building_id: spec.buildingId,
        unit_number: spec.unitNumber,
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });

    if (profileErr) {
      console.error(`[Error] Failed to upsert public.profiles for ${spec.email}:`, profileErr.message);
      process.exit(1);
    }
    console.log(`[Staging Provision] Verified profile for ${spec.email}`);
  }

  // 5. Verify storage bucket 'incident-evidence' exists and is strictly private
  console.log('[Staging Provision] Checking storage bucket "incident-evidence"...');
  const { data: buckets, error: bucketListErr } = await sb.storage.listBuckets();
  if (bucketListErr) {
    console.error('[Error] Failed to list storage buckets:', bucketListErr.message);
    process.exit(1);
  }

  const evidenceBucket = buckets?.find(b => b.name === 'incident-evidence');
  if (!evidenceBucket) {
    console.log('[Staging Provision] Creating private bucket "incident-evidence"...');
    const { error: createBucketErr } = await sb.storage.createBucket('incident-evidence', {
      public: false,
      fileSizeLimit: 5242880, // 5MB limit
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp']
    });
    if (createBucketErr) {
      console.error('[Error] Failed to create bucket "incident-evidence":', createBucketErr.message);
      process.exit(1);
    }
    console.log('[Staging Provision] Created private bucket "incident-evidence".');
  } else {
    if (evidenceBucket.public === true) {
      console.error('[Error] Security Violation: Storage bucket "incident-evidence" is marked as public! Attempting to set to private...');
      const { error: updateBucketErr } = await sb.storage.updateBucket('incident-evidence', {
        public: false
      });
      if (updateBucketErr) {
        console.error('[Error] Failed to secure bucket to private:', updateBucketErr.message);
        process.exit(1);
      }
      console.log('[Staging Provision] Successfully switched bucket "incident-evidence" to private.');
    } else {
      console.log('[Staging Provision] Verified storage bucket "incident-evidence" is private.');
    }
  }

  console.log('[Staging Provision] All provisioning steps completed successfully.');
}

main().catch(err => {
  console.error('[Fatal Error in provision-staging-accounts]:', err.message);
  process.exit(1);
});
