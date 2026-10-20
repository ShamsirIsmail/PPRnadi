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
  console.log('=== PPR NADI 4-Step Flow & Other Category Staging Verification ===');
  console.log('Project Target:', process.env.STAGING_PROJECT_REF);
  console.log('Staging URL: https://ppr-nadi-staging.vercel.app');

  if (!STAGING_URL || !STAGING_ANON || !RESIDENT_PASS || !MANAGER_PASS) {
    throw new Error('Missing staging credentials in .env.staging.local');
  }

  // Check AI is disabled
  const aiDisabled = process.env.STAGING_DISABLE_AI === 'true';
  console.log('AI Disabled Verification:', aiDisabled ? 'CONFIRMED (STAGING_DISABLE_AI=true)' : 'WARNING: AI NOT DISABLED');
  if (!aiDisabled) {
    throw new Error('Security Violation: STAGING_DISABLE_AI must be true');
  }

  // 1. Resident Login via Cloud Auth
  console.log('\n[Step 1] Resident Authentication...');
  const residentClient = createClient(STAGING_URL, STAGING_ANON, {
    auth: { persistSession: false }
  });

  const { data: resAuth, error: resLoginErr } = await residentClient.auth.signInWithPassword({
    email: RESIDENT_EMAIL,
    password: RESIDENT_PASS
  });

  if (resLoginErr) throw new Error('Resident login failed: ' + resLoginErr.message);
  console.log('Resident authenticated. User ID:', resAuth.user.id);

  // Retrieve building DR_BLK_A
  const { data: bldg, error: bldgErr } = await residentClient
    .from('buildings')
    .select('id, name, code, total_floors')
    .eq('code', 'DR_BLK_A')
    .single();

  if (bldgErr) throw new Error('Failed to find building DR_BLK_A: ' + bldgErr.message);
  console.log(`Building resolved: ${bldg.name} (${bldg.code}), Total Floors: ${bldg.total_floors}`);

  // 2. Submit Normal Guided Complaint with Two Fixture Images
  const runId1 = 'FLOW4-' + Date.now().toString(36).toUpperCase();
  console.log(`\n[Step 2] Submitting Guided Complaint 1 (Regular: water_supply) [${runId1}]...`);

  const clientReportId1 = crypto.randomUUID();
  const desc1 = `[STAGING-TEST-${runId1}] [Lokasi: ${bldg.name} · Tingkat 12] [Kategori: Bekalan Air] [Butiran: Tekanan rendah]\nTekanan air paip terlalu rendah di tingkat 12 sejak jam 10 pagi.`;

  const { data: report1, error: repErr1 } = await residentClient
    .from('incident_reports')
    .insert({
      id: clientReportId1,
      reporter_id: resAuth.user.id,
      building_id: bldg.id,
      category: 'water_supply',
      description: desc1,
      urgency_hint: 'medium',
      status: 'submitted'
    })
    .select()
    .single();

  if (repErr1) throw new Error('Failed to submit report 1: ' + repErr1.message);
  console.log('Report 1 successfully saved in database! ID:', report1.id);

  // Upload Two Distinct Fixture Images for Report 1
  console.log('\n[Step 3] Uploading 2 Distinct Images to Private Storage for Report 1...');
  const fix1Path = path.resolve('tests', 'fixtures', 'e2e-evidence-1.png');
  const fix2Path = path.resolve('tests', 'fixtures', 'e2e-evidence-2.png');

  const buf1 = fs.readFileSync(fix1Path);
  const buf2 = fs.readFileSync(fix2Path);

  const hash1 = crypto.createHash('sha256').update(buf1).digest('hex');
  const hash2 = crypto.createHash('sha256').update(buf2).digest('hex');

  const storagePath1 = `${resAuth.user.id}/${report1.id}/flow4-evidence-1-${runId1}.png`;
  const storagePath2 = `${resAuth.user.id}/${report1.id}/flow4-evidence-2-${runId1}.png`;

  const { error: upErr1 } = await residentClient.storage
    .from('incident-evidence')
    .upload(storagePath1, buf1, { contentType: 'image/png' });
  if (upErr1) throw new Error('Upload image 1 failed: ' + upErr1.message);

  const { error: upErr2 } = await residentClient.storage
    .from('incident-evidence')
    .upload(storagePath2, buf2, { contentType: 'image/png' });
  if (upErr2) throw new Error('Upload image 2 failed: ' + upErr2.message);

  const { data: atts, error: attErr } = await residentClient
    .from('report_attachments')
    .insert([
      {
        report_id: report1.id,
        storage_path: storagePath1,
        file_name: `flow4-evidence-1-${runId1}.png`,
        mime_type: 'image/png',
        file_size_bytes: buf1.length
      },
      {
        report_id: report1.id,
        storage_path: storagePath2,
        file_name: `flow4-evidence-2-${runId1}.png`,
        mime_type: 'image/png',
        file_size_bytes: buf2.length
      }
    ])
    .select();

  if (attErr) throw new Error('Insert report_attachments failed: ' + attErr.message);
  console.log(`2 images attached. Recorded IDs: ${atts[0].id}, ${atts[1].id}`);

  // 3. Submit 'other' Category Guided Complaint
  const runId2 = 'OTHER-' + Date.now().toString(36).toUpperCase();
  console.log(`\n[Step 4] Submitting Guided Complaint 2 (Category: other) [${runId2}]...`);

  const clientReportId2 = crypto.randomUUID();
  const desc2 = `[STAGING-TEST-${runId2}] [Lokasi: ${bldg.name} · Aras bawah] [Kategori: Lain-lain]\nPagar taman permainan kanak-kanak rosak dan tercabut engsel. Bahaya untuk kanak-kanak.`;

  const { data: report2, error: repErr2 } = await residentClient
    .from('incident_reports')
    .insert({
      id: clientReportId2,
      reporter_id: resAuth.user.id,
      building_id: bldg.id,
      category: 'other',
      description: desc2,
      urgency_hint: 'medium',
      status: 'submitted'
    })
    .select()
    .single();

  if (repErr2) throw new Error('Failed to submit report 2 (other category): ' + repErr2.message);
  console.log('Report 2 (other category) successfully saved in database! ID:', report2.id);
  console.log('Report 2 Category confirmed:', report2.category);

  // 4. Separate Manager Context Verification
  console.log('\n[Step 5] Manager Authentication in Separate Context...');
  const managerClient = createClient(STAGING_URL, STAGING_ANON, {
    auth: { persistSession: false }
  });

  const { data: mgrAuth, error: mgrLoginErr } = await managerClient.auth.signInWithPassword({
    email: MANAGER_EMAIL,
    password: MANAGER_PASS
  });

  if (mgrLoginErr) throw new Error('Manager login failed: ' + mgrLoginErr.message);
  console.log('Manager authenticated. User ID:', mgrAuth.user.id);

  // Fetch Report 1 specifically scoped to its ID
  console.log('\n[Step 6] Manager Fetching Report 1 & Downloading Both Images...');
  const { data: mgrReport1, error: mgrFetchErr1 } = await managerClient
    .from('incident_reports')
    .select('*, report_attachments(*)')
    .eq('id', report1.id)
    .single();

  if (mgrFetchErr1) throw new Error('Manager fetch report 1 failed: ' + mgrFetchErr1.message);
  if (mgrReport1.report_attachments?.length !== 2) {
    throw new Error(`Expected exactly 2 attachments, found ${mgrReport1.report_attachments?.length}`);
  }

  // Download both images as manager and verify content hashes match original
  for (const att of mgrReport1.report_attachments) {
    const { data: dlBlob, error: dlErr } = await managerClient.storage
      .from('incident-evidence')
      .download(att.storage_path);

    if (dlErr) throw new Error(`Manager failed downloading ${att.storage_path}: ` + dlErr.message);

    const downloadedBuf = Buffer.from(await dlBlob.arrayBuffer());
    const downloadedHash = crypto.createHash('sha256').update(downloadedBuf).digest('hex');

    if (att.storage_path === storagePath1) {
      if (downloadedHash !== hash1) throw new Error('SHA256 hash mismatch for Image 1!');
      console.log('✓ Image 1 hash verified matches exactly:', downloadedHash.slice(0, 16) + '...');
    } else if (att.storage_path === storagePath2) {
      if (downloadedHash !== hash2) throw new Error('✓ Image 2 SHA256 hash verified matches exactly:', downloadedHash.slice(0, 16) + '...');
      console.log('✓ Image 2 hash verified matches exactly:', downloadedHash.slice(0, 16) + '...');
    }
  }

  // Fetch Report 2 (other category) specifically scoped to its ID
  console.log('\n[Step 7] Manager Fetching Report 2 (other category)...');
  const { data: mgrReport2, error: mgrFetchErr2 } = await managerClient
    .from('incident_reports')
    .select('*')
    .eq('id', report2.id)
    .single();

  if (mgrFetchErr2) throw new Error('Manager fetch report 2 failed: ' + mgrFetchErr2.message);
  if (mgrReport2.category !== 'other') {
    throw new Error(`Expected category "other", got "${mgrReport2.category}"`);
  }
  console.log('✓ Report 2 category correctly received by manager as "other"!');

  // 5. RLS Boundaries Verification
  console.log('\n[Step 8] Verifying Security & RLS Isolation...');
  // A. Unauthenticated download rejected
  const unauthClient = createClient(STAGING_URL, STAGING_ANON, {
    auth: { persistSession: false }
  });
  const { data: _unauthDl, error: unauthErr } = await unauthClient.storage
    .from('incident-evidence')
    .download(storagePath1);

  if (!unauthErr) {
    throw new Error('Security Violation: Unauthenticated client downloaded private image!');
  }
  console.log('✓ Unauthenticated storage download rejected as expected');

  // Record complete results to JSON
  const verificationResult = {
    timestamp: new Date().toISOString(),
    commitSha: '5517fffaf2c558ee508b9cc21a792712ea740f1b',
    stagingUrl: 'https://ppr-nadi-staging.vercel.app',
    projectRef: process.env.STAGING_PROJECT_REF,
    aiDisabled: true,
    testRun1: {
      runId: runId1,
      reportId: report1.id,
      clientReportId: clientReportId1,
      category: report1.category,
      attachments: [
        { path: storagePath1, sha256: hash1 },
        { path: storagePath2, sha256: hash2 }
      ],
      verifiedByManager: true
    },
    testRun2: {
      runId: runId2,
      reportId: report2.id,
      clientReportId: clientReportId2,
      category: report2.category,
      verifiedByManager: true
    },
    rlsVerified: true
  };

  fs.writeFileSync('backups/local-snapshot/staging-flow4-verification.json', JSON.stringify(verificationResult, null, 2));
  console.log('\n=== ALL 8 STAGING VERIFICATION ASSERTIONS PASSED! ===');
  console.log('Results saved to backups/local-snapshot/staging-flow4-verification.json');
}

runStagingVerification().catch((err) => {
  console.error('\n[FATAL ERROR in staging verification]:', err.message);
  process.exit(1);
});
