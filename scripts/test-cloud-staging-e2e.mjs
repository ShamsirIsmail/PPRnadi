import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

// Load .env.staging.local
if (fs.existsSync('.env.staging.local')) {
  process.loadEnvFile('.env.staging.local');
}

const STAGING_URL = process.env.STAGING_SUPABASE_URL;
const STAGING_ANON = process.env.STAGING_SUPABASE_ANON_KEY;
const RESIDENT_EMAIL = 'resident.rejang@nadi.local';
const RESIDENT_PASS = process.env.STAGING_RESIDENT_PASSWORD;
const MANAGER_EMAIL = 'manager.rejang@nadi.local';
const MANAGER_PASS = process.env.STAGING_MANAGER_PASSWORD;

async function runStagingVerification() {
  console.log('=== PPR NADI Cloud Staging Verification ===');
  console.log('Project Target:', process.env.STAGING_PROJECT_REF);

  if (!STAGING_URL || !STAGING_ANON || !RESIDENT_PASS || !MANAGER_PASS) {
    throw new Error('Missing staging credentials in .env.staging.local');
  }

  // 1. Resident Login
  console.log('\n1. Testing Resident Login via Cloud Auth...');
  const residentClient = createClient(STAGING_URL, STAGING_ANON, {
    auth: { persistSession: false }
  });

  const { data: resAuth, error: resLoginErr } = await residentClient.auth.signInWithPassword({
    email: RESIDENT_EMAIL,
    password: RESIDENT_PASS
  });

  if (resLoginErr) throw new Error('Resident login failed: ' + resLoginErr.message);
  console.log('Resident authenticated successfully. User ID:', resAuth.user.id);

  // Verify resident profile
  const { data: resProfile, error: profErr } = await residentClient
    .from('profiles')
    .select('*')
    .eq('id', resAuth.user.id)
    .single();

  if (profErr) throw new Error('Failed to read resident profile: ' + profErr.message);
  console.log('Resident Profile verified:', resProfile.full_name, 'Estate:', resProfile.assigned_estate_id);

  // 2. Submit Manual Incident Report with unique Run ID
  const runId = 'RUN-' + Date.now().toString(36).toUpperCase();
  console.log(`\n2. Submitting Manual Complaint [${runId}]...`);

  // Query Blok A building
  const { data: bldg, error: bldgErr } = await residentClient
    .from('buildings')
    .select('id, code')
    .eq('code', 'DR_BLK_A')
    .single();

  if (bldgErr) throw new Error('Failed to find building DR_BLK_A: ' + bldgErr.message);

  const { data: report, error: repErr } = await residentClient
    .from('incident_reports')
    .insert({
      reporter_id: resAuth.user.id,
      building_id: bldg.id,
      category: 'corridor_lighting',
      description: `[STAGING-TEST-${runId}] Lampu koridor tingkat 5 berkelip dan padam. Ujian staging automatik tanpa AI.`,
      urgency_hint: 'medium',
      status: 'submitted'
    })
    .select()
    .single();

  if (repErr) throw new Error('Failed to submit report: ' + repErr.message);
  console.log('Report submitted successfully! Report ID:', report.id);

  // 3. Upload Two Distinct Fixture Images
  console.log('\n3. Uploading Two Distinct Fixture Images to Private Storage...');
  const fix1Path = path.resolve('tests', 'fixtures', 'e2e-evidence-1.png');
  const fix2Path = path.resolve('tests', 'fixtures', 'e2e-evidence-2.png');

  const buf1 = fs.readFileSync(fix1Path);
  const buf2 = fs.readFileSync(fix2Path);

  const hash1 = crypto.createHash('sha256').update(buf1).digest('hex');
  const hash2 = crypto.createHash('sha256').update(buf2).digest('hex');

  const storagePath1 = `${resAuth.user.id}/${report.id}/fixture-1-${runId}.png`;
  const storagePath2 = `${resAuth.user.id}/${report.id}/fixture-2-${runId}.png`;

  // Upload file 1
  const { error: upErr1 } = await residentClient.storage
    .from('incident-evidence')
    .upload(storagePath1, buf1, { contentType: 'image/png' });
  if (upErr1) throw new Error('Upload fixture 1 failed: ' + upErr1.message);

  // Upload file 2
  const { error: upErr2 } = await residentClient.storage
    .from('incident-evidence')
    .upload(storagePath2, buf2, { contentType: 'image/png' });
  if (upErr2) throw new Error('Upload fixture 2 failed: ' + upErr2.message);

  // Insert attachment metadata
  const { data: attachments, error: attErr } = await residentClient
    .from('report_attachments')
    .insert([
      {
        report_id: report.id,
        storage_path: storagePath1,
        file_name: `fixture-1-${runId}.png`,
        mime_type: 'image/png',
        file_size_bytes: buf1.length
      },
      {
        report_id: report.id,
        storage_path: storagePath2,
        file_name: `fixture-2-${runId}.png`,
        mime_type: 'image/png',
        file_size_bytes: buf2.length
      }
    ])
    .select();

  if (attErr) throw new Error('Insert report_attachments failed: ' + attErr.message);
  console.log('Two attachments recorded in database:');
  for (const a of attachments) {
    console.log(`  - ID: ${a.id}, Path: ${a.storage_path}`);
  }

  // 4. Manager Login in Separate Browser/Client Context
  console.log('\n4. Testing Manager Login in Separate Context...');
  const managerClient = createClient(STAGING_URL, STAGING_ANON, {
    auth: { persistSession: false }
  });

  const { data: mgrAuth, error: mgrLoginErr } = await managerClient.auth.signInWithPassword({
    email: MANAGER_EMAIL,
    password: MANAGER_PASS
  });

  if (mgrLoginErr) throw new Error('Manager login failed: ' + mgrLoginErr.message);
  console.log('Manager authenticated successfully. User ID:', mgrAuth.user.id);

  // 5. Manager Views the Same Report & Both Images
  console.log('\n5. Manager Fetching Complaint & Generating Signed URLs for Images...');
  const { data: mgrReport, error: mgrFetchErr } = await managerClient
    .from('incident_reports')
    .select('*, report_attachments(*)')
    .eq('id', report.id)
    .single();

  if (mgrFetchErr) throw new Error('Manager failed to view report: ' + mgrFetchErr.message);
  console.log('Manager retrieved report:', mgrReport.id, 'Status:', mgrReport.status);
  console.log('Attachments count:', mgrReport.report_attachments?.length);

  if (mgrReport.report_attachments?.length !== 2) {
    throw new Error('Expected exactly 2 attachments retrieved by manager.');
  }

  // Download both images via manager client to verify content hash
  for (const att of mgrReport.report_attachments) {
    const { data: dlBlob, error: dlErr } = await managerClient.storage
      .from('incident-evidence')
      .download(att.storage_path);

    if (dlErr) throw new Error(`Manager download failed for ${att.storage_path}: ` + dlErr.message);

    const downloadedBuf = Buffer.from(await dlBlob.arrayBuffer());
    const downloadedHash = crypto.createHash('sha256').update(downloadedBuf).digest('hex');

    if (att.storage_path === storagePath1) {
      if (downloadedHash !== hash1) throw new Error('Hash mismatch on fixture 1!');
      console.log('Fixture 1 verified with SHA256 match:', downloadedHash.substring(0, 16) + '...');
    } else if (att.storage_path === storagePath2) {
      if (downloadedHash !== hash2) throw new Error('Hash mismatch on fixture 2!');
      console.log('Fixture 2 verified with SHA256 match:', downloadedHash.substring(0, 16) + '...');
    }
  }

  // 6. Test Unauthenticated / Alien Access Rejection
  console.log('\n6. Testing RLS: Unauthenticated user cannot access private bucket...');
  const unauthClient = createClient(STAGING_URL, STAGING_ANON, {
    auth: { persistSession: false }
  });

  const { data: unauthDl, error: unauthErr } = await unauthClient.storage
    .from('incident-evidence')
    .download(storagePath1);

  if (!unauthErr) {
    throw new Error('Security Violation: Unauthenticated client successfully downloaded private image!');
  }
  console.log('Unauthenticated access correctly rejected with error:', unauthErr.message);

  // Write verification summary
  const summary = {
    timestamp: new Date().toISOString(),
    status: 'PASSED',
    projectRef: process.env.STAGING_PROJECT_REF,
    runId,
    reportId: report.id,
    residentEmail: RESIDENT_EMAIL,
    managerEmail: MANAGER_EMAIL,
    attachments: [
      { id: attachments[0].id, path: storagePath1, sha256: hash1 },
      { id: attachments[1].id, path: storagePath2, sha256: hash2 }
    ],
    verifiedByManager: true,
    rlsPrivateEnforced: true
  };

  fs.writeFileSync('backups/local-snapshot/staging-cloud-verification.json', JSON.stringify(summary, null, 2));
  console.log('\n=== ALL CLOUD STAGING VERIFICATION TESTS PASSED! ===');
  console.log('Summary saved to backups/local-snapshot/staging-cloud-verification.json');
}

runStagingVerification().catch(err => {
  console.error('\n[FATAL ERROR in staging verification]:', err.message);
  process.exit(1);
});
