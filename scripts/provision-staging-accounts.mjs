import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

/**
 * Provision staging demo accounts using Supabase Auth Admin API.
 * Never hardcodes passwords; reads from env or generates cryptographically secure random ones.
 */

async function main() {
  const supabaseUrl = process.env.STAGING_SUPABASE_URL;
  const serviceRoleKey = process.env.STAGING_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing STAGING_SUPABASE_URL or STAGING_SERVICE_ROLE_KEY.');
    process.exit(1);
  }

  // Safety guard against local
  if (supabaseUrl.includes('127.0.0.1') || supabaseUrl.includes('localhost')) {
    console.error('Safety guard: STAGING_SUPABASE_URL is pointing to localhost!');
    process.exit(1);
  }

  const residentPass = process.env.STAGING_RESIDENT_PASSWORD || ('NadiRes_' + crypto.randomBytes(8).toString('hex') + '!');
  const managerPass = process.env.STAGING_MANAGER_PASSWORD || ('NadiMgr_' + crypto.randomBytes(8).toString('hex') + '!');

  const sb = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  console.log('[Staging Provision] Checking buildings in database...');
  const { data: buildings, error: bldgErr } = await sb
    .from('buildings')
    .select('id, code, name')
    .eq('estate_id', 'ppr-desa-rejang');

  if (bldgErr || !buildings || buildings.length === 0) {
    console.error('[Staging Provision] Error: Desa Rejang buildings not found. Run db migrations first!', bldgErr);
    process.exit(1);
  }

  const blokA = buildings.find(b => b.code === 'DR_BLK_A');

  const accounts = [
    {
      email: 'resident.rejang@nadi.local',
      password: residentPass,
      fullName: 'Ahmad bin Razak (Penduduk Blok A)',
      role: 'resident',
      estateId: 'ppr-desa-rejang',
      buildingId: blokA?.id,
      unitNumber: '05-01'
    },
    {
      email: 'manager.rejang@nadi.local',
      password: managerPass,
      fullName: 'Siti Nurhaliza (Pengurus PPR Desa Rejang)',
      role: 'management',
      estateId: 'ppr-desa-rejang',
      buildingId: null,
      unitNumber: null
    }
  ];

  console.log('[Staging Provision] Creating staging demo users...');
  const credentials = [];

  for (const acc of accounts) {
    // Check if user already exists
    const { data: { users } } = await sb.auth.admin.listUsers();
    let user = users.find(u => u.email === acc.email);

    if (!user) {
      const { data: created, error: createErr } = await sb.auth.admin.createUser({
        email: acc.email,
        password: acc.password,
        email_confirm: true,
        user_metadata: { full_name: acc.fullName, role: acc.role }
      });

      if (createErr) {
        console.error(`Failed to create ${acc.email}:`, createErr.message);
        continue;
      }
      user = created.user;
      console.log(`[Staging Provision] Created user ${acc.email} (${user.id})`);
    } else {
      console.log(`[Staging Provision] User ${acc.email} already exists (${user.id})`);
      // Update password
      await sb.auth.admin.updateUserById(user.id, { password: acc.password });
    }

    // Upsert user_profile
    const { error: profErr } = await sb.from('user_profiles').upsert({
      id: user.id,
      full_name: acc.fullName,
      role: acc.role,
      assigned_estate_id: acc.estateId,
      assigned_building_id: acc.buildingId,
      unit_number: acc.unitNumber
    });

    if (profErr) {
      console.error(`Failed to upsert profile for ${acc.email}:`, profErr.message);
    } else {
      console.log(`[Staging Provision] Upserted profile for ${acc.email}`);
    }

    credentials.push({
      email: acc.email,
      password: acc.password,
      role: acc.role
    });
  }

  // Ensure storage bucket 'incident-evidence' exists and is private
  const { data: buckets } = await sb.storage.listBuckets();
  if (!buckets?.some(b => b.name === 'incident-evidence')) {
    console.log('[Staging Provision] Creating private bucket incident-evidence...');
    const { error: bErr } = await sb.storage.createBucket('incident-evidence', {
      public: false,
      fileSizeLimit: 5242880, // 5MB
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp']
    });
    if (bErr) console.error('Failed to create bucket:', bErr.message);
    else console.log('[Staging Provision] Created private bucket incident-evidence');
  } else {
    console.log('[Staging Provision] Bucket incident-evidence already exists (private)');
  }

  console.log('\n[Staging Provision] SUCCESS!');
  console.log('Credentials configured securely for staging testing.');
}

main().catch(err => {
  console.error('[Staging Provision Exception]:', err);
  process.exit(1);
});
