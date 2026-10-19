import { spawn as cpSpawn } from 'node:child_process';
import fs from 'node:fs';

// Automatically load local environment file if present
if (fs.existsSync('.env.local')) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // Continue if environment already has variables
  }
}

const API_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:64321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:64322/postgres';
const PSQL_PATH = 'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe';

if (!SERVICE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is required in environment or .env.local.');
}

const RESIDENT_PASSWORD = process.env.DEMO_RESIDENT_PASSWORD;
const MANAGER_PASSWORD = process.env.DEMO_MANAGER_PASSWORD;
const OTHER_PASSWORD = process.env.DEMO_OTHER_RESIDENT_PASSWORD || RESIDENT_PASSWORD;
const UNASSIGNED_PASSWORD = process.env.DEMO_UNASSIGNED_PASSWORD || RESIDENT_PASSWORD;

if (!RESIDENT_PASSWORD || !MANAGER_PASSWORD) {
  throw new Error('DEMO_RESIDENT_PASSWORD and DEMO_MANAGER_PASSWORD must be configured in environment or .env.local.');
}

function runPsql(sql) {
  return new Promise((resolve, reject) => {
    const proc = cpSpawn(PSQL_PATH, [DB_URL, '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql]);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`psql error (${code}): ${stderr || stdout}`));
    });
  });
}

const DEMO_ACCOUNTS = [
  {
    email: 'resident@sentosa.local',
    password: RESIDENT_PASSWORD,
    fullName: 'Ahmad bin Razak (Penduduk Blok A)',
    role: 'resident',
    estateId: 'ppr-sentosa-demo',
    buildingCode: 'BLK_A',
    unitNumber: '05-01',
  },
  {
    email: 'manager@sentosa.local',
    password: MANAGER_PASSWORD,
    fullName: 'Siti Nurhaliza (Pengurus PPR Sentosa)',
    role: 'management',
    estateId: 'ppr-sentosa-demo',
    buildingCode: null,
    unitNumber: null,
  },
  {
    email: 'resident.other@lestari.local',
    password: OTHER_PASSWORD,
    fullName: 'Chong Wei (Penduduk PPR Lestari)',
    role: 'resident',
    estateId: 'test-estate-b',
    buildingCode: 'BLDG_TEST_B',
    unitNumber: '08-12',
  },
  {
    email: 'resident.rejang@nadi.local',
    password: RESIDENT_PASSWORD,
    fullName: 'Farid bin Idris (Penduduk Blok A)',
    role: 'resident',
    estateId: 'ppr-desa-rejang',
    buildingCode: 'DR_BLK_A',
    unitNumber: '17-02',
  },
  {
    email: 'manager.rejang@nadi.local',
    password: MANAGER_PASSWORD,
    fullName: 'Hafizah binti Zainal (Pengurus PPR Desa Rejang)',
    role: 'management',
    estateId: 'ppr-desa-rejang',
    buildingCode: null,
    unitNumber: null,
  },
  {
    email: 'unassigned@sentosa.local',
    password: UNASSIGNED_PASSWORD,
    fullName: 'Pengguna Baru (Belum Disahkan)',
    role: 'resident',
    estateId: null,
    buildingCode: null,
    unitNumber: null,
  },
];

async function main() {
  console.log('================================================================');
  console.log('PPR NADI: PROVISIONING LOCAL DEMO IDENTITIES (PHASE 02B)');
  console.log('================================================================\n');

  // Verify target is local
  const apiUrlObj = new URL(API_URL);
  if (!['127.0.0.1', 'localhost'].includes(apiUrlObj.hostname) || apiUrlObj.port !== '64321') {
    throw new Error(`Refusing to run against non-local API target: ${API_URL}`);
  }

  const dbCheck = await runPsql('SELECT current_database(), version();');
  if (!dbCheck.includes('postgres') || !dbCheck.includes('PostgreSQL')) {
    throw new Error(`Unexpected database verification response: ${dbCheck}`);
  }
  console.log('✅ Verified local PPR NADI instance (port 64321 / 64322)');

  for (const acc of DEMO_ACCOUNTS) {
    // 1. Check if user exists via Supabase Auth Admin API
    const listRes = await fetch(`${API_URL}/auth/v1/admin/users`, {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
    });

    if (!listRes.ok) {
      throw new Error(`Failed to list auth users: ${listRes.status} ${await listRes.text()}`);
    }

    const { users } = await listRes.json();
    const existing = users.find((u) => u.email === acc.email);

    let userId = null;

    if (existing) {
      userId = existing.id;
      // Reuse existing account without resetting password unnecessarily
      const updateRes = await fetch(`${API_URL}/auth/v1/admin/users/${userId}`, {
        method: 'PUT',
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email_confirm: true,
          user_metadata: { full_name: acc.fullName },
        }),
      });

      if (!updateRes.ok) {
        throw new Error(`Failed to update user ${acc.email}: ${updateRes.status} ${await updateRes.text()}`);
      }
      console.log(`✅ Updated existing auth user: ${acc.email} (${userId})`);
    } else {
      // Create user
      const createRes = await fetch(`${API_URL}/auth/v1/admin/users`, {
        method: 'POST',
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: acc.email,
          password: acc.password,
          email_confirm: true,
          user_metadata: { full_name: acc.fullName },
        }),
      });

      if (!createRes.ok) {
        throw new Error(`Failed to create user ${acc.email}: ${createRes.status} ${await createRes.text()}`);
      }

      const created = await createRes.json();
      userId = created.id;
      console.log(`✅ Created auth user: ${acc.email} (${userId})`);
    }

    // 2. Resolve building ID if code provided
    let buildingId = null;
    if (acc.buildingCode) {
      const bRes = await runPsql(`SELECT id FROM public.buildings WHERE code = '${acc.buildingCode}';`);
      if (bRes) buildingId = bRes;
    }

    // 3. Upsert profile in PostgreSQL (using trusted administrator execution)
    const estateVal = acc.estateId ? `'${acc.estateId}'` : 'NULL';
    const bldgVal = buildingId ? `'${buildingId}'` : 'NULL';
    const unitVal = acc.unitNumber ? `'${acc.unitNumber}'` : 'NULL';

    await runPsql(`
      INSERT INTO public.profiles (id, role, full_name, assigned_estate_id, assigned_building_id, unit_number)
      VALUES ('${userId}', '${acc.role}', '${acc.fullName}', ${estateVal}, ${bldgVal}, ${unitVal})
      ON CONFLICT (id) DO UPDATE SET
        role = EXCLUDED.role,
        full_name = EXCLUDED.full_name,
        assigned_estate_id = EXCLUDED.assigned_estate_id,
        assigned_building_id = EXCLUDED.assigned_building_id,
        unit_number = EXCLUDED.unit_number;
    `);

    console.log(`   -> Profile synced: [${acc.role}] ${acc.fullName} (Estate: ${acc.estateId || 'None'})`);
  }

  console.log('\n================================================================');
  console.log('LOCAL DEMO IDENTITIES READY');
  console.log('================================================================');
  console.log('Resident:    resident@sentosa.local        (Blok A, PPR Sentosa)');
  console.log('Manager:     manager@sentosa.local         (Management, PPR Sentosa)');
  console.log('Other Est:   resident.other@lestari.local  (Blok B, PPR Lestari)');
  console.log('Unassigned:  unassigned@sentosa.local      (No assigned building)\n');
}

main().catch((err) => {
  console.error('❌ Provisioning failed:', err);
  process.exit(1);
});
