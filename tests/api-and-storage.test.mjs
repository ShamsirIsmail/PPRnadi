import { spawn as cpSpawn } from 'node:child_process';
import crypto from 'node:crypto';

try {
  process.loadEnvFile('.env.local');
} catch {
  // env already loaded or missing
}

const API_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:64321';
const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:64322/postgres';
const PSQL_PATH = process.env.PSQL_PATH || 'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SERVICE_KEY || !ANON_KEY) {
  throw new Error('Supabase credentials missing from .env.local');
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

// 1x1 transparent PNG (68 bytes)
const SAMPLE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

let passedCount = 0;
let totalCount = 0;

function assert(condition, message) {
  totalCount++;
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  passedCount++;
  console.log(`✅ PASS: ${message}`);
}

async function main() {
  console.log('================================================================');
  console.log('PHASE 02A: REAL AUTH SESSIONS, API & STORAGE SECURITY VALIDATION');
  console.log('================================================================\n');

  // Verify connection target is strictly local PPR NADI
  assert(API_URL.startsWith('http://127.0.0.1:64321'), 'API target verified as isolated local PPR NADI instance');

  // Unique run namespace
  const runToken = crypto.randomBytes(4).toString('hex');
  const runId = `run_${Date.now()}_${runToken}`;
  const testPassword = `PprNadi_Test_${runToken}!`;

  console.log(`Run Namespace: ${runId}`);

  // Track created resources for reliable cleanup
  const cleanupUsers = [];
  const cleanupStoragePaths = [];

  const estateA = `estate_a_${runId}`;
  const estateB = `estate_b_${runId}`;
  const bldgAId = crypto.randomUUID();
  const bldgBId = crypto.randomUUID();
  const zoneAId = crypto.randomUUID();
  const zoneBId = crypto.randomUUID();
  const facAId = crypto.randomUUID();
  const facBId = crypto.randomUUID();

  let userResA, userMgrA, userResB, userMgrB, userUnassigned;
  let tokenResA, tokenMgrA, tokenResB, tokenMgrB, tokenUnassigned;
  const reportAId = crypto.randomUUID();

  try {
    // -------------------------------------------------------------------------
    // Task 4: Real Supabase Auth Sessions Provisioning
    // -------------------------------------------------------------------------
    console.log('\n--- Provisioning Synthetic Users via Auth Admin API ---');

    async function createAuthUser(emailRole, emailDomain) {
      const email = `${emailRole}_${runId}@${emailDomain}`;
      const res = await fetch(`${API_URL}/auth/v1/admin/users`, {
        method: 'POST',
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password: testPassword, email_confirm: true }),
      });
      if (res.status !== 200) {
        const err = await res.text();
        throw new Error(`Failed to create user ${email}: ${res.status} ${err}`);
      }
      const data = await res.json();
      cleanupUsers.push(data.id);
      return { id: data.id, email };
    }

    userResA = await createAuthUser('res_a', 'sentosa.local');
    userMgrA = await createAuthUser('mgr_a', 'sentosa.local');
    userResB = await createAuthUser('res_b', 'harmoni.local');
    userMgrB = await createAuthUser('mgr_b', 'harmoni.local');
    userUnassigned = await createAuthUser('unassigned', 'test.local');

    assert(cleanupUsers.length === 5, 'Created 5 synthetic users via Supabase Auth Admin API');

    // Trusted Database Setup: Provision infrastructure and profiles
    console.log('\n--- Trusted Profile & Infrastructure Provisioning ---');
    await runPsql(`
      INSERT INTO public.buildings (id, estate_id, code, name, total_floors, total_units)
      VALUES 
        ('${bldgAId}', '${estateA}', 'BLD_A_${runToken}', 'Block A ${runToken}', 15, 180),
        ('${bldgBId}', '${estateB}', 'BLD_B_${runToken}', 'Block B ${runToken}', 12, 144);

      INSERT INTO public.profiles (id, role, full_name, assigned_estate_id, assigned_building_id, unit_number)
      VALUES
        ('${userResA.id}', 'resident', 'Resident A ${runToken}', '${estateA}', '${bldgAId}', '04-12'),
        ('${userMgrA.id}', 'management', 'Manager A ${runToken}', '${estateA}', NULL, NULL),
        ('${userResB.id}', 'resident', 'Resident B ${runToken}', '${estateB}', '${bldgBId}', '08-05'),
        ('${userMgrB.id}', 'management', 'Manager B ${runToken}', '${estateB}', NULL, NULL),
        ('${userUnassigned.id}', 'resident', 'Unassigned ${runToken}', NULL, NULL, NULL);

      INSERT INTO public.service_zones (id, building_id, zone_code, name, floor_start, floor_end, zone_type)
      VALUES 
        ('${zoneAId}', '${bldgAId}', 'ZA_${runToken}', 'Zone A', 1, 7, 'residential_floors'),
        ('${zoneBId}', '${bldgBId}', 'ZB_${runToken}', 'Zone B', 8, 12, 'residential_floors');

      INSERT INTO public.facilities (id, building_id, facility_code, name, category)
      VALUES 
        ('${facAId}', '${bldgAId}', 'PUMP_A_${runToken}', 'Pump A', 'water_supply'),
        ('${facBId}', '${bldgBId}', 'PUMP_B_${runToken}', 'Pump B', 'water_supply');
    `);
    console.log('✅ Trusted profiles and infrastructure provisioned in PostgreSQL');

    // Authenticate through standard Auth endpoint to get real access tokens
    console.log('\n--- Authenticating via Supabase Auth Token Endpoint ---');
    async function loginUser(email) {
      const res = await fetch(`${API_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: testPassword }),
      });
      if (res.status !== 200) {
        throw new Error(`Failed to login ${email}: ${res.status}`);
      }
      const data = await res.json();
      return data.access_token;
    }

    tokenResA = await loginUser(userResA.email);
    tokenMgrA = await loginUser(userMgrA.email);
    tokenResB = await loginUser(userResB.email);
    tokenMgrB = await loginUser(userMgrB.email);
    tokenUnassigned = await loginUser(userUnassigned.email);

    assert(Boolean(tokenResA && tokenMgrA && tokenResB && tokenMgrB && tokenUnassigned),
      'Obtained real Supabase Auth session tokens for all 5 synthetic identities');

    // -------------------------------------------------------------------------
    // Task 1 & Task 5: PostgREST & Storage Security Assertions
    // -------------------------------------------------------------------------
    console.log('\n--- 1. Testing Anonymous Access Denied ---');
    {
      const resGet = await fetch(`${API_URL}/rest/v1/incident_reports`, {
        headers: { apikey: ANON_KEY },
      });
      assert(resGet.status === 200 || resGet.status === 401, `Anon GET reports status is ${resGet.status}`);
      const data = await resGet.json();
      if (resGet.status === 401) {
        assert(data.message || data.code, 'Anon request rejected with 401 Unauthorized structured error');
      } else {
        assert(Array.isArray(data) && data.length === 0, 'Anon query returns 0 rows due to RLS');
      }

      const resPost = await fetch(`${API_URL}/rest/v1/incident_reports`, {
        method: 'POST',
        headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reporter_id: userResA.id,
          building_id: bldgAId,
          category: 'water_supply',
          description: 'Anon forged report attempt',
        }),
      });
      assert(resPost.status === 401 || resPost.status === 403, `Anon report submission denied with HTTP ${resPost.status}`);
    }

    console.log('\n--- 2. Unassigned Authenticated User Isolation ---');
    {
      const resBld = await fetch(`${API_URL}/rest/v1/buildings?id=eq.${bldgAId}`, {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${tokenUnassigned}` },
      });
      assert(resBld.status === 200, 'Unassigned query executed');
      const bldData = await resBld.json();
      assert(bldData.length === 0, 'Unassigned user receives 0 buildings');

      const resSubmit = await fetch(`${API_URL}/rest/v1/incident_reports`, {
        method: 'POST',
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${tokenUnassigned}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reporter_id: userUnassigned.id,
          building_id: bldgAId,
          category: 'water_supply',
          description: 'Unassigned user cannot submit reports',
        }),
      });
      assert(resSubmit.status === 400 || resSubmit.status === 403, `Unassigned report submission rejected with HTTP ${resSubmit.status}`);
      const err = await resSubmit.json();
      assert(err.code === '42501' || err.message?.includes('assigned building'), 'Error explicitly cites assigned building requirement');
    }

    console.log('\n--- 3. Resident A Creates Valid Incident Report ---');
    {
      const res = await fetch(`${API_URL}/rest/v1/incident_reports`, {
        method: 'POST',
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${tokenResA}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          id: reportAId,
          reporter_id: userResA.id,
          building_id: bldgAId,
          service_zone_id: zoneAId,
          category: 'water_supply',
          description: 'Low water pressure at unit 04-12 synthetic test',
          status: 'submitted',
        }),
      });
      assert(res.status === 201, `Report created successfully with HTTP ${res.status}`);
      const created = await res.json();
      assert(created[0].id === reportAId, 'Report ID matches requested UUID');
      assert(created[0].status === 'submitted', 'Report initial status is strictly submitted');
    }

    console.log('\n--- 4. Resident Report Isolation ---');
    {
      const resB = await fetch(`${API_URL}/rest/v1/incident_reports?id=eq.${reportAId}`, {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${tokenResB}` },
      });
      assert(resB.status === 200, 'Query executed');
      const dataB = await resB.json();
      assert(dataB.length === 0, 'Resident B receives 0 rows for Resident A report');

      const resMgrB = await fetch(`${API_URL}/rest/v1/incident_reports?id=eq.${reportAId}`, {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${tokenMgrB}` },
      });
      const dataMgrB = await resMgrB.json();
      assert(dataMgrB.length === 0, 'Cross-estate Manager B receives 0 rows for Estate A report');

      const resMgrA = await fetch(`${API_URL}/rest/v1/incident_reports?id=eq.${reportAId}`, {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${tokenMgrA}` },
      });
      const dataMgrA = await resMgrA.json();
      assert(dataMgrA.length === 1 && dataMgrA[0].id === reportAId, 'Assigned Manager A receives Resident A report');
    }

    console.log('\n--- 5. Storage Upload Security Boundaries ---');
    const validPath = `${userResA.id}/${reportAId}/photo1.png`;
    cleanupStoragePaths.push(validPath);

    {
      // 5.1 Anon upload rejected
      const resAnon = await fetch(`${API_URL}/storage/v1/object/incident-evidence/${validPath}`, {
        method: 'POST',
        headers: { apikey: ANON_KEY, 'Content-Type': 'image/png' },
        body: SAMPLE_PNG,
      });
      assert(resAnon.status === 400 || resAnon.status === 401 || resAnon.status === 403,
        `Anonymous upload rejected with HTTP ${resAnon.status} (never 500)`);

      // 5.2 Resident B upload to Resident A report path rejected
      const resCross = await fetch(`${API_URL}/storage/v1/object/incident-evidence/${validPath}`, {
        method: 'POST',
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${tokenResB}`,
          'Content-Type': 'image/png',
        },
        body: SAMPLE_PNG,
      });
      assert(resCross.status === 400 || resCross.status === 403,
        `Resident B upload to Resident A path rejected with HTTP ${resCross.status} (never 500)`);

      // 5.3 Resident A upload to unowned/non-existent report rejected
      const fakeReportId = crypto.randomUUID();
      const fakePath = `${userResA.id}/${fakeReportId}/photo1.png`;
      const resFake = await fetch(`${API_URL}/storage/v1/object/incident-evidence/${fakePath}`, {
        method: 'POST',
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${tokenResA}`,
          'Content-Type': 'image/png',
        },
        body: SAMPLE_PNG,
      });
      assert(resFake.status === 400 || resFake.status === 403,
        `Resident A upload to unowned report rejected with HTTP ${resFake.status} (never 500)`);

      // 5.4 Disallowed MIME type rejected
      const resMime = await fetch(`${API_URL}/storage/v1/object/incident-evidence/${userResA.id}/${reportAId}/doc.txt`, {
        method: 'POST',
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${tokenResA}`,
          'Content-Type': 'text/plain',
        },
        body: 'plain text disallowed',
      });
      assert(resMime.status === 400 || resMime.status === 415,
        `Disallowed MIME type rejected with HTTP ${resMime.status} (never 500)`);
      const mimeErr = await resMime.json();
      assert(mimeErr.error === 'invalid_mime_type' || mimeErr.statusCode === '415', 'MIME rejection structured error confirmed');

      // 5.5 Oversized file (> 5MB) rejected
      const bigBuf = Buffer.alloc(5500000, 0);
      const resBig = await fetch(`${API_URL}/storage/v1/object/incident-evidence/${userResA.id}/${reportAId}/big.png`, {
        method: 'POST',
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${tokenResA}`,
          'Content-Type': 'image/png',
        },
        body: bigBuf,
      });
      assert(resBig.status === 400, `Oversized file (>5MB) rejected with HTTP ${resBig.status} (never 500)`);
      const bigErr = await resBig.json();
      assert(bigErr.error === 'Payload too large' || bigErr.statusCode === '413', 'Size rejection structured error confirmed');

      // 5.6 Valid synthetic PNG upload succeeds
      const resValid = await fetch(`${API_URL}/storage/v1/object/incident-evidence/${validPath}`, {
        method: 'POST',
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${tokenResA}`,
          'Content-Type': 'image/png',
        },
        body: SAMPLE_PNG,
      });
      assert(resValid.status === 200, `Resident A valid PNG upload succeeded with HTTP ${resValid.status}`);
    }

    console.log('\n--- 6. Attachment Metadata Matching & Three-File Limit ---');
    {
      // 6.1 Mismatched file size rejected
      const resWrongSize = await fetch(`${API_URL}/rest/v1/report_attachments`, {
        method: 'POST',
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${tokenResA}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          report_id: reportAId,
          storage_path: validPath,
          file_name: 'photo1.png',
          mime_type: 'image/png',
          file_size_bytes: 999999, // Mismatched
        }),
      });
      assert(resWrongSize.status === 400 || resWrongSize.status === 409,
        `Attachment with mismatched size rejected with HTTP ${resWrongSize.status} (never 500)`);
      const sizeErr = await resWrongSize.json();
      assert(sizeErr.code === 'P0001' || sizeErr.message?.includes('match an existing upload'),
        'Trigger P0001 error confirmed for size mismatch');

      // 6.2 Mismatched MIME type rejected
      const resWrongMime = await fetch(`${API_URL}/rest/v1/report_attachments`, {
        method: 'POST',
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${tokenResA}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          report_id: reportAId,
          storage_path: validPath,
          file_name: 'photo1.png',
          mime_type: 'image/jpeg', // Mismatched
          file_size_bytes: SAMPLE_PNG.length,
        }),
      });
      assert(resWrongMime.status === 400 || resWrongMime.status === 409,
        `Attachment with mismatched MIME rejected with HTTP ${resWrongMime.status} (never 500)`);

      // 6.3 Valid attachment 1 succeeds
      const resAtt1 = await fetch(`${API_URL}/rest/v1/report_attachments`, {
        method: 'POST',
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${tokenResA}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          report_id: reportAId,
          storage_path: validPath,
          file_name: 'photo1.png',
          mime_type: 'image/png',
          file_size_bytes: SAMPLE_PNG.length,
        }),
      });
      assert(resAtt1.status === 201, `Attachment 1 registered with exact metadata (HTTP ${resAtt1.status})`);

      // Upload and register attachments 2 and 3
      const path2 = `${userResA.id}/${reportAId}/photo2.png`;
      const path3 = `${userResA.id}/${reportAId}/photo3.png`;
      const path4 = `${userResA.id}/${reportAId}/photo4.png`;
      cleanupStoragePaths.push(path2, path3, path4);

      for (const p of [path2, path3, path4]) {
        const upRes = await fetch(`${API_URL}/storage/v1/object/incident-evidence/${p}`, {
          method: 'POST',
          headers: { apikey: ANON_KEY, Authorization: `Bearer ${tokenResA}`, 'Content-Type': 'image/png' },
          body: SAMPLE_PNG,
        });
        assert(upRes.status === 200, `Uploaded prerequisite ${p.split('/').pop()} (HTTP 200)`);
      }

      const resAtt2 = await fetch(`${API_URL}/rest/v1/report_attachments`, {
        method: 'POST',
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${tokenResA}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          report_id: reportAId,
          storage_path: path2,
          file_name: 'photo2.png',
          mime_type: 'image/png',
          file_size_bytes: SAMPLE_PNG.length,
        }),
      });
      assert(resAtt2.status === 201, 'Attachment 2 registered (HTTP 201)');

      const resAtt3 = await fetch(`${API_URL}/rest/v1/report_attachments`, {
        method: 'POST',
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${tokenResA}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          report_id: reportAId,
          storage_path: path3,
          file_name: 'photo3.png',
          mime_type: 'image/png',
          file_size_bytes: SAMPLE_PNG.length,
        }),
      });
      assert(resAtt3.status === 201, 'Attachment 3 registered (HTTP 201)');

      // 6.4 4th attachment rejected strictly by trigger
      const resAtt4 = await fetch(`${API_URL}/rest/v1/report_attachments`, {
        method: 'POST',
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${tokenResA}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          report_id: reportAId,
          storage_path: path4,
          file_name: 'photo4.png',
          mime_type: 'image/png',
          file_size_bytes: SAMPLE_PNG.length,
        }),
      });
      assert(resAtt4.status === 400 || resAtt4.status === 409,
        `4th attachment rejected with HTTP ${resAtt4.status} (never 500)`);
      const att4Err = await resAtt4.json();
      assert(att4Err.code === 'P0001' || att4Err.message?.includes('Maximum three evidence attachments'),
        'Trigger P0001 error confirmed for attachment cap');
    }

    console.log('\n--- 7. Storage Immutability: Denied Overwrite & Deletion ---');
    {
      // 7.1 Denied Overwrite via PUT
      const modifiedContent = Buffer.from('TAMPERED_CONTENT_ATTEMPT');
      const resPut = await fetch(`${API_URL}/storage/v1/object/incident-evidence/${validPath}`, {
        method: 'PUT',
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${tokenResA}`,
          'Content-Type': 'image/png',
        },
        body: modifiedContent,
      });
      assert(resPut.status === 400 || resPut.status === 403,
        `Storage PUT overwrite denied with HTTP ${resPut.status} (never 500)`);

      // Verify content remains original PNG
      const resCheck1 = await fetch(`${API_URL}/storage/v1/object/authenticated/incident-evidence/${validPath}`, {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${tokenResA}` },
      });
      const checkBuf1 = Buffer.from(await resCheck1.arrayBuffer());
      assert(Buffer.compare(checkBuf1, SAMPLE_PNG) === 0, 'Object content confirmed unchanged after attempted overwrite');

      // 7.2 Denied Deletion via DELETE
      const resDel = await fetch(`${API_URL}/storage/v1/object/incident-evidence/${validPath}`, {
        method: 'DELETE',
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${tokenResA}` },
      });
      assert(resDel.status === 400 || resDel.status === 403,
        `Storage DELETE operation denied with HTTP ${resDel.status} (never 500)`);

      // Verify object still exists and content intact
      const resCheck2 = await fetch(`${API_URL}/storage/v1/object/authenticated/incident-evidence/${validPath}`, {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${tokenResA}` },
      });
      assert(resCheck2.status === 200, 'Object confirmed still exists after attempted delete');
      const checkBuf2 = Buffer.from(await resCheck2.arrayBuffer());
      assert(Buffer.compare(checkBuf2, SAMPLE_PNG) === 0, 'Object content verified identical after attempted delete');
    }

    console.log('\n--- 8. Storage Read Authorization & Signed URLs ---');
    {
      // 8.1 Direct authenticated download
      const resA = await fetch(`${API_URL}/storage/v1/object/authenticated/incident-evidence/${validPath}`, {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${tokenResA}` },
      });
      assert(resA.status === 200, `Owner Resident A direct download succeeded (HTTP ${resA.status})`);

      const resMgrA = await fetch(`${API_URL}/storage/v1/object/authenticated/incident-evidence/${validPath}`, {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${tokenMgrA}` },
      });
      assert(resMgrA.status === 200, `Assigned Manager A direct download succeeded (HTTP ${resMgrA.status})`);

      const resB = await fetch(`${API_URL}/storage/v1/object/authenticated/incident-evidence/${validPath}`, {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${tokenResB}` },
      });
      assert(resB.status === 400 || resB.status === 403 || resB.status === 404,
        `Resident B direct download denied with HTTP ${resB.status}`);

      const resMgrB = await fetch(`${API_URL}/storage/v1/object/authenticated/incident-evidence/${validPath}`, {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${tokenMgrB}` },
      });
      assert(resMgrB.status === 400 || resMgrB.status === 403 || resMgrB.status === 404,
        `Manager B direct download denied with HTTP ${resMgrB.status}`);

      // 8.2 Signed URL issuance authorization
      // Owner (Resident A) can request signed URL
      const signResA = await fetch(`${API_URL}/storage/v1/object/sign/incident-evidence/${validPath}`, {
        method: 'POST',
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${tokenResA}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ expiresIn: 60 }),
      });
      assert(signResA.status === 200, `Owner Resident A issued signed URL (HTTP ${signResA.status})`);
      const signDataA = await signResA.json();
      assert(typeof signDataA.signedURL === 'string', 'Received valid signed URL structure');

      // Manager A can request signed URL
      const signResMgrA = await fetch(`${API_URL}/storage/v1/object/sign/incident-evidence/${validPath}`, {
        method: 'POST',
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${tokenMgrA}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ expiresIn: 60 }),
      });
      assert(signResMgrA.status === 200, `Assigned Manager A issued signed URL (HTTP ${signResMgrA.status})`);

      // Resident B cannot request signed URL
      const signResB = await fetch(`${API_URL}/storage/v1/object/sign/incident-evidence/${validPath}`, {
        method: 'POST',
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${tokenResB}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ expiresIn: 60 }),
      });
      assert(signResB.status === 400 || signResB.status === 403 || signResB.status === 404,
        `Resident B signed URL issuance denied with HTTP ${signResB.status}`);

      // Manager B cannot request signed URL
      const signResMgrB = await fetch(`${API_URL}/storage/v1/object/sign/incident-evidence/${validPath}`, {
        method: 'POST',
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${tokenMgrB}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ expiresIn: 60 }),
      });
      assert(signResMgrB.status === 400 || signResMgrB.status === 403 || signResMgrB.status === 404,
        `Cross-estate Manager B signed URL issuance denied with HTTP ${signResMgrB.status}`);

      // 8.3 Download via Bearer Signed URL (No user JWT required)
      const bearerUrl = signDataA.signedURL.startsWith('http')
        ? signDataA.signedURL
        : `${API_URL}/storage/v1${signDataA.signedURL}`;

      const resBearer = await fetch(bearerUrl);
      assert(resBearer.status === 200, `Download through valid signed URL succeeded with HTTP ${resBearer.status}`);
      const bearerBuf = Buffer.from(await resBearer.arrayBuffer());
      assert(Buffer.compare(bearerBuf, SAMPLE_PNG) === 0, 'Bearer download verified exact content byte match');
    }

    console.log('\n--- 9. Publication Workflow & Sanitized Read Model ---');
    const incId = crypto.randomUUID();
    const incNumber = `INC_${runToken}`;
    const updId = crypto.randomUUID();

    {
      // 9.1 Manager creates incident
      const resCreateInc = await fetch(`${API_URL}/rest/v1/incidents`, {
        method: 'POST',
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${tokenMgrA}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          id: incId,
          incident_number: incNumber,
          building_id: bldgAId,
          primary_facility_id: facAId,
          title: 'Pump Failure Block A',
          category: 'water_supply',
          status: 'investigating',
          internal_notes: 'CONFIDENTIAL_MANAGEMENT_NOTES_SENTINEL',
        }),
      });
      assert(resCreateInc.status === 201, `Manager A created incident (HTTP ${resCreateInc.status})`);

      // 9.2 Premature publication denied while incident is investigating
      const resPremature = await fetch(`${API_URL}/rest/v1/incident_updates`, {
        method: 'POST',
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${tokenMgrA}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          incident_id: incId,
          update_title: 'Premature Notice',
          message_bm: 'Notis awal sebelum verifikasi rasmi.',
          stage: 'investigation',
          is_published: true,
        }),
      });
      assert(resPremature.status === 400 || resPremature.status === 409,
        `Premature publication rejected with HTTP ${resPremature.status} (never 500)`);
      const premErr = await resPremature.json();
      assert(premErr.code === 'P0001' || premErr.message?.includes('verified incident'),
        'Trigger P0001 verified incident requirement confirmed');

      // 9.3 Verify incident
      const resVerify = await fetch(`${API_URL}/rest/v1/incidents?id=eq.${incId}`, {
        method: 'PATCH',
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${tokenMgrA}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({ status: 'confirmed' }),
      });
      assert(resVerify.status === 200, `Incident confirmed and verified (HTTP ${resVerify.status})`);
      const verifiedData = await resVerify.json();
      assert(verifiedData[0].verified_by === userMgrA.id, 'verified_by stamped to Manager A automatically');

      // 9.4 Triage report and link to incident
      await fetch(`${API_URL}/rest/v1/incident_reports?id=eq.${reportAId}`, {
        method: 'PATCH',
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${tokenMgrA}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'reviewed' }),
      });

      const resLink = await fetch(`${API_URL}/rest/v1/incident_report_links`, {
        method: 'POST',
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${tokenMgrA}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ incident_id: incId, report_id: reportAId }),
      });
      assert(resLink.status === 201, `Report linked to incident atomically (HTTP ${resLink.status})`);

      // 9.5 Publish official update
      const resPub = await fetch(`${API_URL}/rest/v1/incident_updates`, {
        method: 'POST',
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${tokenMgrA}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          id: updId,
          incident_id: incId,
          update_title: 'Gangguan Bekalan Air Blok A',
          message_bm: 'Pasukan kontraktor sedang membaiki pam utama aras bawah tanah.',
          stage: 'contractor_assigned',
          is_published: true,
        }),
      });
      assert(resPub.status === 201, `Official notice published successfully (HTTP ${resPub.status})`);
    }

    console.log('\n--- 10. Sanitized Read Model & Direct Private Query Isolation ---');
    {
      // 10.1 Resident A queries published bulletins -> exactly 1 row with clean fields
      const resBulletin = await fetch(`${API_URL}/rest/v1/published_incident_bulletins?incident_number=eq.${incNumber}`, {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${tokenResA}` },
      });
      assert(resBulletin.status === 200, 'Resident A fetched published bulletin');
      const bulletins = await resBulletin.json();
      assert(bulletins.length === 1, 'Resident A sees published bulletin');

      const b = bulletins[0];
      const privateKeys = ['internal_notes', 'restoration_evidence', 'verified_by', 'published_by', 'reporter_id'];
      for (const pk of privateKeys) {
        assert(!(pk in b), `Sanitized bulletin does not expose private column: ${pk}`);
      }
      assert(b.update_title === 'Gangguan Bekalan Air Blok A', 'Bulletin update title confirmed');
      assert(b.incident_status === 'confirmed', 'Bulletin status reflects confirmed incident');

      // 10.2 Cross-estate Resident B cannot see Estate A bulletin
      const resBulletinB = await fetch(`${API_URL}/rest/v1/published_incident_bulletins?incident_number=eq.${incNumber}`, {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${tokenResB}` },
      });
      const bulletinsB = await resBulletinB.json();
      assert(bulletinsB.length === 0, 'Resident B denied reading Estate A bulletin');

      // 10.3 Direct query to private incidents table remains denied after publication
      const resPrivInc = await fetch(`${API_URL}/rest/v1/incidents?id=eq.${incId}`, {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${tokenResA}` },
      });
      assert(resPrivInc.status === 200, 'Query executed');
      const privIncData = await resPrivInc.json();
      assert(privIncData.length === 0, 'Resident direct query to private incidents table returns 0 rows');

      // 10.4 Direct query to private updates table remains denied after publication
      const resPrivUpd = await fetch(`${API_URL}/rest/v1/incident_updates?id=eq.${updId}`, {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${tokenResA}` },
      });
      const privUpdData = await resPrivUpd.json();
      assert(privUpdData.length === 0, 'Resident direct query to private updates table returns 0 rows');

      // 10.5 Direct client write on published_incident_bulletins rejected
      // Using an otherwise completely valid, well-formed payload to ensure rejection is due to permissions
      const resMutateBulletin = await fetch(`${API_URL}/rest/v1/published_incident_bulletins`, {
        method: 'POST',
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${tokenResA}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          update_id: crypto.randomUUID(),
          incident_id: incId,
          estate_id: estateA,
          incident_number: incNumber,
          building_id: bldgAId,
          building_name: 'Block A',
          building_code: `BLD_A_${runToken}`,
          category: 'water_supply',
          severity: 'major',
          incident_status: 'confirmed',
          update_title: 'Forged Bulletin Attempt',
          message_bm: 'Cubaan memasukkan buletin secara haram oleh klien.',
          stage: 'contractor_assigned',
          published_at: new Date().toISOString(),
        }),
      });
      assert(resMutateBulletin.status === 401 || resMutateBulletin.status === 403,
        `Client write on bulletin projection denied with HTTP ${resMutateBulletin.status} (never 500)`);
      const mutErr = await resMutateBulletin.json();
      assert(mutErr.code === '42501' || mutErr.message?.includes('permission denied'),
        'Structured 42501 permission denied confirmed for bulletin client mutation');
    }

    console.log('\n================================================================');
    console.log(`REAL AUTH & API/STORAGE SUITE: ${passedCount} / ${totalCount} PASSED`);
    console.log('================================================================\n');

  } finally {
    console.log('--- Cleaning Up Test Run Resources ---');
    // Clean up storage objects
    for (const sp of cleanupStoragePaths) {
      try {
        await fetch(`${API_URL}/storage/v1/object/incident-evidence/${sp}`, {
          method: 'DELETE',
          headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
        });
      } catch { /* ignore cleanup error */ }
    }

    // Clean up SQL entities for this run
    try {
      await runPsql(`
        DELETE FROM public.published_incident_bulletins WHERE estate_id = '${estateA}';
        DELETE FROM public.incident_report_links WHERE report_id = '${reportAId}';
        DELETE FROM public.report_attachments WHERE report_id = '${reportAId}';
        DELETE FROM public.incident_reports WHERE building_id IN ('${bldgAId}', '${bldgBId}');
        DELETE FROM public.incident_updates WHERE published_by = '${userMgrA?.id}';
        DELETE FROM public.incidents WHERE building_id IN ('${bldgAId}', '${bldgBId}');
        DELETE FROM public.facilities WHERE building_id IN ('${bldgAId}', '${bldgBId}');
        DELETE FROM public.service_zones WHERE building_id IN ('${bldgAId}', '${bldgBId}');
        DELETE FROM public.profiles WHERE id IN (${cleanupUsers.map((u) => `'${u}'`).join(',') || "''"});
        DELETE FROM public.buildings WHERE id IN ('${bldgAId}', '${bldgBId}');
        DELETE FROM public.audit_events WHERE estate_id IN ('${estateA}', '${estateB}');
      `);
      console.log('✅ Cleaned up SQL domain entities for this run');
    } catch (e) {
      console.warn('Cleanup warning for SQL entities:', e.message);
    }

    // Clean up Auth users via Admin API
    for (const uid of cleanupUsers) {
      try {
        await fetch(`${API_URL}/auth/v1/admin/users/${uid}`, {
          method: 'DELETE',
          headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
        });
      } catch { /* ignore user delete error */ }
    }
    console.log(`✅ Cleaned up ${cleanupUsers.length} synthetic auth users`);
  }
}

main().catch((err) => {
  console.error('\n❌ Fatal Test Runner Error:', err);
  process.exit(1);
});
