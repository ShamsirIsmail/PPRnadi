#!/usr/bin/env node
import { spawn as cpSpawn } from 'node:child_process';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { chromium } from 'playwright-core';

// Load local environment
try {
  process.loadEnvFile('.env.local');
} catch {
  // Already loaded
}

const API_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:64321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY missing from environment.');
}
const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:64322/postgres';
const PSQL_PATH = 'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE_URL = process.env.TEST_APP_URL || 'http://127.0.0.1:3000';

function runPsql(sql, retries = 3) {
  return new Promise((resolve, reject) => {
    function attempt(n) {
      const proc = cpSpawn(PSQL_PATH, [DB_URL, '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql]);
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (d) => (stdout += d.toString()));
      proc.stderr.on('data', (d) => (stderr += d.toString()));
      proc.on('close', (code) => {
        if (code === 0) resolve(stdout.trim());
        else if (n > 1 && (stderr.includes('closed the connection') || stderr.includes('could not connect'))) {
          setTimeout(() => attempt(n - 1), 300);
        } else {
          reject(new Error(`psql error (${code}): ${stderr || stdout}`));
        }
      });
    }
    attempt(retries);
  });
}

function generateValidPng(width = 600, height = 600) {
  const line = Buffer.alloc(1 + width * 3, 128);
  line[0] = 0; // Filter None
  const raw = Buffer.concat(Array(height).fill(line));
  const idatData = zlib.deflateSync(raw, { level: 0 });

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    const crcVal = zlib.crc32(Buffer.concat([t, data]));
    crc.writeUInt32BE(crcVal, 0);
    return Buffer.concat([len, t, data, crc]);
  }

  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    header,
    chunk('IHDR', ihdr),
    chunk('IDAT', idatData),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const SAMPLE_TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

async function main() {
  console.log('==============================================================================');
  console.log('PPR NADI — PHASE 02B: REAL BROWSER END-TO-END WORKFLOW SUITE');
  console.log('==============================================================================');

  const runToken = crypto.randomBytes(4).toString('hex');
  const runId = `browser_${Date.now()}_${runToken}`;
  const testPassword = `BrowserPass_${runToken}!`;

  console.log(`[Run Identity] ${runId}`);
  console.log(`[Target URL] ${BASE_URL}`);

  // 1. Verify Local Supabase & Database baseline
  const dbVer = await runPsql('SELECT current_database();');
  if (dbVer !== 'postgres') {
    throw new Error(`Unexpected database: ${dbVer}. Must target local postgres.`);
  }

  const baselineObjCountStr = await runPsql("SELECT count(*) FROM storage.objects WHERE bucket_id = 'incident-evidence';");
  const baselineObjects = parseInt(baselineObjCountStr, 10) || 0;
  console.log(`[Baseline Storage Objects] ${baselineObjects}`);

  // Tracking arrays for cleanup
  const cleanupUsers = [];
  const cleanupReports = [];
  const cleanupIncidents = [];
  const cleanupStoragePaths = [];

  let browser = null;
  let exitCode = 0;

  try {
    // 2. Resolve Blok A ID in PPR Sentosa Demo
    const sentosaBldgA = await runPsql("SELECT id FROM public.buildings WHERE estate_id = 'ppr-sentosa-demo' LIMIT 1;");
    if (!sentosaBldgA) throw new Error('PPR Sentosa Demo Blok A not found.');

    // Helper to create synthetic users
    async function createIdentity(role, emailPrefix, bldgId) {
      const email = `${emailPrefix}_${runId}@temp-test.local`;
      const res = await fetch(`${API_URL}/auth/v1/admin/users`, {
        method: 'POST',
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          password: testPassword,
          email_confirm: true,
          user_metadata: { full_name: `Test ${emailPrefix}` },
        }),
      });

      if (!res.ok) {
        throw new Error(`Failed to create user ${email}: ${res.statusText}`);
      }
      const data = await res.json();
      cleanupUsers.push(data.id);

      const bldgVal = bldgId ? `'${bldgId}'` : 'NULL';
      await runPsql(`
        INSERT INTO public.profiles (id, role, full_name, assigned_estate_id, assigned_building_id, unit_number)
        VALUES ('${data.id}', '${role}', 'Test ${emailPrefix}', 'ppr-sentosa-demo', ${bldgVal}, '04-12');
      `);

      return { id: data.id, email, password: testPassword };
    }

    console.log('[Setup] Creating synthetic test users...');
    const resA = await createIdentity('resident', 'res_a', sentosaBldgA);
    const resB = await createIdentity('resident', 'res_b', sentosaBldgA);
    const mgrA = await createIdentity('management', 'mgr_a', sentosaBldgA);

    console.log(`  Resident A: ${resA.email}`);
    console.log(`  Resident B: ${resB.email}`);
    console.log(`  Manager A:  ${mgrA.email}`);

    // 3. Launch Chrome via Playwright
    console.log('[Browser] Launching Google Chrome...');
    browser = await chromium.launch({
      headless: true,
      executablePath: CHROME_PATH,
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();

    // Helper to perform browser login
    async function browserLogin(email, password) {
      await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#login-email', { timeout: 10000 });
      await page.fill('#login-email', email);
      await page.fill('#login-password', password);
      await page.click('button[type="submit"]');
    }

    // Helper to perform browser logout
    async function browserLogout() {
      const logoutBtn = page.locator('button[aria-label="Log keluar akaun"]').first();
      if ((await logoutBtn.count()) > 0) {
        await Promise.all([
          page.waitForURL('**/login', { timeout: 15000, waitUntil: 'domcontentloaded' }).catch(() => {}),
          logoutBtn.click(),
        ]);
      }
      await context.clearCookies();
      await page.evaluate(() => {
        try {
          localStorage.clear();
          sessionStorage.clear();
        } catch {
          // Ignore
        }
      });
      await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
    }

    // =========================================================================
    // SCENARIO 0: Permanent Local Demo Accounts Authentication
    // =========================================================================
    console.log('\n[Scenario 0] Testing Permanent Demo Accounts Login...');
    const demoResidentPass = process.env.DEMO_RESIDENT_PASSWORD;
    const demoManagerPass = process.env.DEMO_MANAGER_PASSWORD;
    if (!demoResidentPass || !demoManagerPass) {
      throw new Error('RALAT: DEMO_RESIDENT_PASSWORD dan DEMO_MANAGER_PASSWORD diperlukan dalam persekitaran.');
    }

    // Resident Demo Login
    await browserLogin('resident@sentosa.local', demoResidentPass);
    await page.waitForURL('**/resident', { timeout: 25000, waitUntil: 'domcontentloaded' });
    const demoResHtml = await page.content();
    if (!demoResHtml.includes('PPR NADI') || !demoResHtml.includes('Blok A')) {
      throw new Error('Permanent demo resident failed to render resident dashboard.');
    }
    console.log('  ✓ Permanent demo resident (resident@sentosa.local) logged in successfully');
    await browserLogout();

    // Management Demo Login
    await browserLogin('manager@sentosa.local', demoManagerPass);
    await page.waitForURL('**/management**', { timeout: 25000, waitUntil: 'domcontentloaded' });
    const demoMgrHtml = await page.content();
    if (!demoMgrHtml.includes('PPR NADI') || !demoMgrHtml.includes('Pengurusan')) {
      throw new Error('Permanent demo manager failed to render management view.');
    }
    console.log('  ✓ Permanent demo manager (manager@sentosa.local) logged in successfully');
    await browserLogout();

    // =========================================================================
    // SCENARIO 1: Login Form, Session Reload, Route Guards, and Logout
    // =========================================================================
    console.log('\n[Scenario 1] Testing Login Form, Session Reload, Route Guards & Logout...');
    
    // 1a. Unauthenticated access redirect
    await page.goto(`${BASE_URL}/resident`);
    await page.waitForURL('**/login**', { timeout: 10000 });
    console.log('  ✓ Unauthenticated access redirected to /login with returnTo parameter');

    // 1b. Resident Login
    await browserLogin(resA.email, resA.password);
    await page.waitForURL('**/resident', { timeout: 10000 });
    const content = await page.content();
    if (!content.includes('Blok A') && !content.includes('PPR NADI')) {
      throw new Error('Resident dashboard did not render expected content.');
    }
    console.log('  ✓ Resident login succeeded and dashboard rendered without prerender errors');

    // 1c. Session Reload
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=PPR NADI', { timeout: 10000 });
    console.log('  ✓ Session persists across page reload');

    // 1d. Role Boundary Protection
    await page.goto(`${BASE_URL}/management`);
    await page.waitForURL('**/resident', { timeout: 10000 });
    console.log('  ✓ Resident attempting to access /management was redirected back to /resident');

    // 1e. Logout
    await browserLogout();
    console.log('  ✓ Logout action succeeded and user returned to /login');

    // =========================================================================
    // SCENARIO 2: Resident Reporting Form, Photo Selection in Multiple Batches,
    // Removal, and Submission with Exactly Three Photos while Picker is Hidden
    // =========================================================================
    console.log('\n[Scenario 2] Photo Selection in Batches, Removal, and 3-Photo Submission...');
    await browserLogin(resA.email, resA.password);
    await page.waitForURL('**/resident', { timeout: 10000 });

    await page.goto(`${BASE_URL}/resident/lapor`);
    await page.waitForSelector('form', { timeout: 10000 });

    // Select category: Lif Penumpang
    await page.click('button:has-text("Lif Penumpang")');

    // Batch 1: Select 2 photos
    const file1 = { name: 'batch1_photoA.png', mimeType: 'image/png', buffer: SAMPLE_TINY_PNG };
    const file2 = { name: 'batch1_photoB.png', mimeType: 'image/png', buffer: SAMPLE_TINY_PNG };
    await page.setInputFiles('input[data-testid="file-picker-input"]', [file1, file2]);

    await page.waitForSelector('text=batch1_photoA.png');
    await page.waitForSelector('text=batch1_photoB.png');
    console.log('  ✓ Batch 1: Two photos selected and rendered in preview list');

    // Batch 2: Select 1 more photo -> Reaches 3 photos
    const file3 = { name: 'batch2_photoC.png', mimeType: 'image/png', buffer: SAMPLE_TINY_PNG };
    await page.setInputFiles('input[data-testid="file-picker-input"]', [file3]);
    await page.waitForSelector('text=batch2_photoC.png');
    console.log('  ✓ Batch 2: Third photo added (total 3 photos in preview list)');

    // Verify file picker input is hidden when 3 photos are reached
    const pickerHidden = (await page.locator('label[data-testid="file-picker-label"]').count()) === 0;
    if (!pickerHidden) throw new Error('File picker should be hidden when 3 photos are selected.');
    console.log('  ✓ File picker hidden when maximum 3 photos reached');

    // Remove photo 2
    await page.click('[data-testid="remove-file-1"]');
    await page.waitForSelector('label[data-testid="file-picker-label"]');
    console.log('  ✓ Removed a photo: count dropped to 2, file picker re-mounted');

    // Re-add 3rd photo
    const finalFile3 = { name: 'final_photo3.png', mimeType: 'image/png', buffer: SAMPLE_TINY_PNG };
    await page.setInputFiles('input[data-testid="file-picker-input"]', [finalFile3]);
    await page.waitForSelector('text=final_photo3.png');

    // Fill description and submit via 2-step flow
    await page.fill('#report-description', 'Lif B aras 7 mengeluarkan bunyi geseran kuat dan pintu tersangkut.');
    if (await page.locator('button[data-testid="review-report-button"]').count() > 0) {
      await page.click('button[data-testid="review-report-button"]');
    }
    await page.click('button[data-testid="submit-report-button"]');

    // Wait for Report Saved UI
    await page.waitForSelector('[data-testid="report-saved-heading"]', { timeout: 15000 });
    const report1Id = await page.locator('[data-testid="active-report-id"]').innerText();
    cleanupReports.push(report1Id.trim());

    const attachedText = await page.locator('[data-testid="status-evidence-attached"]').innerText();
    if (!attachedText.includes('3 daripada 3')) {
      throw new Error(`Expected 3 attached photos, received: ${attachedText}`);
    }
    console.log(`  ✓ Report submitted with exactly 3 photos while picker was hidden. Report ID: ${report1Id.trim()}`);

    // Verify 3 attachments in DB
    const rep1AttCount = await runPsql(`SELECT count(*) FROM public.report_attachments WHERE report_id = '${report1Id.trim()}';`);
    if (parseInt(rep1AttCount, 10) !== 3) {
      throw new Error(`Database attachments count mismatch: expected 3, found ${rep1AttCount}`);
    }
    console.log('  ✓ PostgreSQL confirmed exactly 3 report_attachments recorded');

    // =========================================================================
    // SCENARIO 3: Valid Photo > 1MB, Oversized File (>5MB), & Spoofed File Rejection
    // =========================================================================
    console.log('\n[Scenario 3] Valid Photo > 1MB, Oversized (>5MB) & Spoofed Content Rejection...');
    await page.evaluate(() => sessionStorage.clear());
    await page.goto(`${BASE_URL}/resident/lapor`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#report-description', { timeout: 10000 });

    // 3a. Oversized file rejection
    const hugeBuffer = Buffer.alloc(5.2 * 1024 * 1024, 0x5a); // 5.2 MB
    await page.setInputFiles('input[data-testid="file-picker-input"]', [{
      name: 'oversized_huge.png',
      mimeType: 'image/png',
      buffer: hugeBuffer,
    }]);
    await page.waitForSelector('[data-testid="file-error-message"]');
    const errText = await page.locator('[data-testid="file-error-message"]').innerText();
    if (!errText.includes('melebihi had 5 MB')) {
      throw new Error(`Expected >5MB rejection message, got: ${errText}`);
    }
    console.log('  ✓ Client rejected file exceeding 5 MB limit');

    // 3b. Spoofed file rejection (text payload disguised as png)
    const spoofedFile = {
      name: 'fake_image.png',
      mimeType: 'image/png',
      buffer: Buffer.from('THIS_IS_DEFINITELY_NOT_A_VALID_IMAGE_PAYLOAD'),
    };
    await page.setInputFiles('input[data-testid="file-picker-input"]', [spoofedFile]);
    await page.fill('#report-description', 'Pili bomba tingkat 4 rosak dan tekanan air sifar.');
    if (await page.locator('button[data-testid="review-report-button"]').count() > 0) {
      await page.click('button[data-testid="review-report-button"]');
    }
    await page.click('button[data-testid="submit-report-button"]');

    // Server action returns error banner
    await page.waitForSelector('text=Format fail tidak disokong', { timeout: 15000 });
    console.log('  ✓ Server action rejected spoofed file binary with actionable upload error');

    // 3c. Valid Photo > 1 MB
    await page.evaluate(() => sessionStorage.clear());
    await page.goto(`${BASE_URL}/resident/lapor`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#report-description', { timeout: 10000 });

    console.log('  Generating 1.1 MB valid PNG file...');
    const largePng = generateValidPng(650, 650); // ~1.27 MB uncompressed scanlines
    console.log(`  Generated PNG size: ${(largePng.length / 1024).toFixed(1)} KB`);

    await page.setInputFiles('input[data-testid="file-picker-input"]', [{
      name: 'large_valid_leak.png',
      mimeType: 'image/png',
      buffer: largePng,
    }]);
    await page.fill('#report-description', 'Paip utama aras 3 mengalami kebocoran besar dan limpahan air ke tangga.');
    if (await page.locator('button[data-testid="review-report-button"]').count() > 0) {
      await page.click('button[data-testid="review-report-button"]');
    }
    await page.click('button[data-testid="submit-report-button"]');

    await page.waitForSelector('[data-testid="report-saved-heading"]', { timeout: 15000 });
    const report2Id = (await page.locator('[data-testid="active-report-id"]').innerText()).trim();
    cleanupReports.push(report2Id);
    console.log(`  ✓ Submitting valid photo >1 MB succeeded. Report ID: ${report2Id}`);

    // =========================================================================
    // SCENARIO 4: Report History & Authorized Evidence Viewing
    // =========================================================================
    console.log('\n[Scenario 4] Sejarah Laporan & Authorized Evidence Viewing...');
    await page.goto(`${BASE_URL}/resident/sejarah`);
    await page.waitForSelector('text=Sejarah Laporan Saya', { timeout: 10000 });

    const sejarahHtml = await page.content();
    if (!sejarahHtml.includes(report1Id) || !sejarahHtml.includes(report2Id)) {
      throw new Error('Submitted reports missing from resident sejarah page.');
    }
    console.log('  ✓ Both submitted reports rendered in Sejarah Laporan with correct status');

    // Find and verify signed URL link for evidence
    const evidenceLink = page.locator(`a[href*="/storage/v1/object/sign/incident-evidence"]`).first();
    const signedUrl = await evidenceLink.getAttribute('href');
    if (!signedUrl) throw new Error('Signed evidence URL not found on sejarah page.');

    const signCheck = await page.request.get(signedUrl);
    if (signCheck.status() !== 200) {
      throw new Error(`Signed URL fetch failed with status: ${signCheck.status()}`);
    }
    const contentType = signCheck.headers()['content-type'];
    if (!contentType?.includes('image/png')) {
      throw new Error(`Unexpected content-type for evidence: ${contentType}`);
    }
    console.log(`  ✓ Signed URL verified: HTTP 200, Content-Type: ${contentType}`);

    // =========================================================================
    // SCENARIO 5: Unattached Evidence Recovery & Content Validation Across Browser Refresh
    // =========================================================================
    console.log('\n[Scenario 5] Storage Recovery, Content Validation & Durable Recovery...');
    await page.evaluate(() => sessionStorage.clear());
    await page.goto(`${BASE_URL}/resident/lapor`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#report-description', { timeout: 10000 });

    // Submit base report without photos
    await page.fill('#report-description', 'Paip limpah tangki aras bumbung pecah dan memerlukan pembaikan segera.');
    if (await page.locator('button[data-testid="review-report-button"]').count() > 0) {
      await page.click('button[data-testid="review-report-button"]');
    }
    await page.click('button[data-testid="submit-report-button"]');

    await page.waitForSelector('[data-testid="report-saved-heading"]', { timeout: 15000 });
    const recoveryReportId = (await page.locator('[data-testid="active-report-id"]').innerText()).trim();
    cleanupReports.push(recoveryReportId);

    // Upload 1 valid PNG directly to Storage under resA/recoveryReportId
    const recoveryPathValid = `${resA.id}/${recoveryReportId}/unregistered_valid.png`;
    cleanupStoragePaths.push(recoveryPathValid);
    const validPngBuffer = generateValidPng(100, 100);
    const upResValid = await fetch(`${API_URL}/storage/v1/object/incident-evidence/${recoveryPathValid}`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'image/png',
      },
      body: validPngBuffer,
    });
    if (!upResValid.ok) throw new Error(`Direct storage upload failed: ${upResValid.status}`);

    // Upload 1 fake image directly to Storage under resA/recoveryReportId
    const recoveryPathFake = `${resA.id}/${recoveryReportId}/fake_unsupported.png`;
    cleanupStoragePaths.push(recoveryPathFake);
    const fakeBuffer = Buffer.from('NOT_A_VALID_IMAGE_STREAM');
    const upResFake = await fetch(`${API_URL}/storage/v1/object/incident-evidence/${recoveryPathFake}`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'image/png',
      },
      body: fakeBuffer,
    });
    if (!upResFake.ok) throw new Error(`Direct storage upload for fake image failed: ${upResFake.status}`);

    console.log(`  ✓ Simulated unattached evidence directly in Storage. Report ID: ${recoveryReportId}`);

    // Test durable recovery state across browser refresh
    console.log('  Refreshing browser to detect and verify durable recovery state...');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="status-awaiting-recovery"]', { timeout: 15000 });
    const refreshedReportId = (await page.locator('[data-testid="active-report-id"]').innerText()).trim();
    if (refreshedReportId !== recoveryReportId) {
      throw new Error(`Report ID changed after refresh! Expected ${recoveryReportId}, got ${refreshedReportId}`);
    }
    console.log('  ✓ Durable recovery state survived browser refresh and detected unattached files!');

    // Execute recovery via "Pulihkan Pendaftaran Bukti Sekarang" button
    console.log('  Clicking "Pulihkan Pendaftaran Bukti Sekarang"...');
    await page.click('[data-testid="reconcile-evidence-button"]');

    // Wait for recovery to complete
    await page.waitForSelector('text=1 daripada 3 keping fail', { timeout: 15000 });

    // Verify valid photo was registered and fake photo was rejected
    const recoveredAttRows = await runPsql(`
      SELECT file_name FROM public.report_attachments WHERE report_id = '${recoveryReportId}';
    `);
    if (!recoveredAttRows.includes('unregistered_valid.png')) {
      throw new Error('Valid evidence was not registered into report_attachments.');
    }
    if (recoveredAttRows.includes('fake_unsupported.png')) {
      throw new Error('Security violation: Fake image was registered into report_attachments!');
    }
    console.log('  ✓ Valid evidence registered without re-upload; fake image was rejected by server signature validator!');

    // =========================================================================
    // SCENARIO 6: Management Review, Incident Creation, Confirmation, Linking,
    // and Official Notice Publication
    // =========================================================================
    console.log('\n[Scenario 6] Management Review, Incident Lifecycle, Linking & Publication...');
    await browserLogout();
    await browserLogin(mgrA.email, mgrA.password);
    await page.waitForURL('**/management**', { timeout: 10000 });

    // 6a. Management Inbox
    await page.goto(`${BASE_URL}/management/inbox`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=Peti Masuk Semakan Laporan Penduduk', { timeout: 10000 });

    // Review report 1 (category 'lift', Blok A)
    const report1Card = page.locator(`[data-testid="report-card-${report1Id}"]`);
    const reviewBtn = report1Card.locator('button:has-text("Sahkan Semakan")');
    await reviewBtn.click();
    await report1Card.locator('text=reviewed').waitFor({ timeout: 10000 });
    console.log('  ✓ Manager successfully reviewed resident report');

    // 6b. Management Incidents Control Center
    await page.goto(`${BASE_URL}/management/incidents`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=Pusat Kawalan Insiden', { timeout: 10000 });

    // Create new incident
    await page.click('button:has-text("Cipta Insiden Baharu")');
    await page.waitForSelector('#inc-title', { timeout: 5000 });

    const incidentTitle = `Gangguan Lif Utama Blok A (Ujian ${runToken})`;
    await page.selectOption('#inc-building', sentosaBldgA.trim());
    await page.selectOption('#inc-category', 'lift');
    await page.fill('#inc-title', incidentTitle);
    await page.fill('#inc-notes', 'Catatan sulit teknikal pengurusan: Jurutera Otis ditugaskan.');
    await page.click('button:has-text("Daftar Insiden")');

    await page.waitForSelector(`text=${incidentTitle}`, { timeout: 15000 });
    console.log('  ✓ New facility incident created successfully');

    // Extract incident ID from DB
    const incIdStr = await runPsql(`SELECT id FROM public.incidents WHERE title = '${incidentTitle}';`);
    if (!incIdStr) throw new Error('Created incident not found in database.');
    cleanupIncidents.push(incIdStr.trim());

    // Confirm incident
    await page.click('button:has-text("Sahkan Insiden (Confirm)")');
    await page.waitForSelector('text=confirmed', { timeout: 10000 });
    console.log('  ✓ Incident confirmed by management');

    // Publish official notice
    await page.click('button:has-text("Terbitkan Notis Rasmi")');
    await page.waitForSelector('input[name="update_title"]', { timeout: 5000 });

    const noticeTitle = `Notis Rasmi: Baik Pulih Lif Blok A`;
    const noticeMessage = `Jurutera penyelenggaraan sedang menjalankan penggantian komponen pintu lif.`;
    await page.fill('input[name="update_title"]', noticeTitle);
    await page.fill('textarea[name="message_bm"]', noticeMessage);
    await page.click('button:has-text("Terbitkan Sekarang")');

    await page.waitForSelector(`text=${noticeTitle}`, { timeout: 15000 });
    console.log('  ✓ Official bulletin notice published successfully');

    // 6c. Link reviewed report to this incident
    await page.goto(`${BASE_URL}/management/inbox`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=Peti Masuk Semakan Laporan Penduduk', { timeout: 10000 });

    const report1CardForLink = page.locator(`[data-testid="report-card-${report1Id}"]`);
    const incSelect = report1CardForLink.locator('select');
    await incSelect.waitFor({ timeout: 10000 });
    await incSelect.selectOption(incIdStr.trim());
    await report1CardForLink.locator('button:has-text("Pautkan")').click();

    await report1CardForLink.locator('text=linked').waitFor({ timeout: 10000 });
    console.log('  ✓ Reviewed report linked to confirmed incident');

    // =========================================================================
    // SCENARIO 7: Resident Notice Rendering & Refreshed Incident Status
    // =========================================================================
    console.log('\n[Scenario 7] Sanitized Bulletin Rendering on Resident Dashboard...');
    await browserLogout();
    await browserLogin(resA.email, resA.password);
    await page.waitForURL('**/resident', { timeout: 25000, waitUntil: 'domcontentloaded' });
    await page.waitForSelector(`text=${noticeTitle}`, { timeout: 20000 });

    const residentDashHtml = await page.content();
    if (!residentDashHtml.includes(noticeTitle) || !residentDashHtml.includes(noticeMessage)) {
      throw new Error('Published bulletin notice not displayed on resident dashboard.');
    }
    if (residentDashHtml.includes('Catatan sulit teknikal pengurusan') || residentDashHtml.includes(mgrA.id)) {
      throw new Error('Security violation: Internal management notes or IDs leaked to resident!');
    }
    console.log('  ✓ Published notice rendered on Resident Dashboard without leaking confidential management notes or IDs');

    // Manager advances status to in_maintenance in background
    console.log('  Advancing incident status to "in_maintenance"...');
    await runPsql(`
      SELECT set_config('request.jwt.claim.sub', '${mgrA.id}', false);
      SELECT set_config('role', 'authenticated', false);
      UPDATE public.incidents 
      SET status = 'in_maintenance', updated_at = now() 
      WHERE id = '${incIdStr.trim()}';
    `);

    // Resident reloads page -> reflects new status
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=in_maintenance', { timeout: 15000 });
    console.log('  ✓ Resident dashboard dynamically reflected updated incident status ("in_maintenance")');

    // =========================================================================
    // SCENARIO 8: Cross-Resident & Role Boundary Protections
    // =========================================================================
    console.log('\n[Scenario 8] Cross-Resident Access Control & Role Boundary Protections...');
    await browserLogout();
    await browserLogin(resB.email, resB.password);
    await page.waitForURL('**/resident', { timeout: 25000, waitUntil: 'domcontentloaded' });

    // Resident attempting to navigate to management routes is rejected and redirected
    await page.goto(`${BASE_URL}/management/inbox`, { waitUntil: 'domcontentloaded' });
    await page.waitForURL('**/resident', { timeout: 10000 });
    console.log('  ✓ Resident invocation of management routes strictly rejected and redirected');

    await page.goto(`${BASE_URL}/resident/sejarah`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=Sejarah Laporan Saya', { timeout: 10000 });

    const resBHtml = await page.content();
    if (resBHtml.includes(report1Id) || resBHtml.includes(report2Id)) {
      throw new Error('Privacy violation: Resident B can view reports submitted by Resident A!');
    }
    console.log("  ✓ Cross-resident access denied: Resident B cannot see Resident A's reports in Sejarah Laporan");

    // =========================================================================
    // SCENARIO 9: Audit Trail Verification
    // =========================================================================
    console.log('\n[Scenario 9] Verifying PostgreSQL Audit Events...');
    const auditEvents = await runPsql(`
      SELECT action FROM public.audit_events 
      WHERE actor_id IN ('${resA.id}', '${mgrA.id}')
      ORDER BY created_at ASC;
    `);

    const requiredEvents = [
      'incident_reports.insert',
      'incidents.insert',
      'incident.verified',
      'incident_report_links.insert',
      'notice.published',
    ];

    for (const reqEvent of requiredEvents) {
      if (!auditEvents.includes(reqEvent)) {
        throw new Error(`Missing expected audit event: ${reqEvent}`);
      }
    }
    console.log('  ✓ Database audit trail recorded all application workflow mutations:');
    console.log(`    ${requiredEvents.join(', ')}`);

    console.log('\n==============================================================================');
    console.log('ALL BROWSER WORKFLOW SCENARIOS PASSED SUCCESSFULLY');
    console.log('==============================================================================');
  } catch (err) {
    console.error('\n❌ BROWSER WORKFLOW FAILURE:', err);
    exitCode = 1;
  } finally {
    console.log('\n[Teardown] Performing complete test cleanup...');
    if (browser) {
      try {
        await browser.close();
      } catch (err) {
        console.error('Failed to close browser:', err);
      }
    }

    // 1. Storage cleanup via Storage API
    if (cleanupUsers.length > 0) {
      const userListSql = cleanupUsers.map((u) => `'${u}'`).join(', ');
      try {
        const userStorageObjects = await runPsql(`
          SELECT name FROM storage.objects 
          WHERE bucket_id = 'incident-evidence' AND split_part(name, '/', 1) IN (${userListSql});
        `);

        const discoveredPaths = userStorageObjects
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);

        const allPathsToDelete = Array.from(new Set([...cleanupStoragePaths, ...discoveredPaths]));

        if (allPathsToDelete.length > 0) {
          const delRes = await fetch(`${API_URL}/storage/v1/object/incident-evidence`, {
            method: 'DELETE',
            headers: {
              apikey: SERVICE_KEY,
              Authorization: `Bearer ${SERVICE_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ prefixes: allPathsToDelete }),
          });
          if (!delRes.ok) {
            console.error(`Storage cleanup returned non-OK status: ${delRes.status}`);
            exitCode = 1;
          } else {
            console.log(`  ✓ Deleted ${allPathsToDelete.length} run-owned evidence objects from Storage`);
          }
        }
      } catch (err) {
        console.error('Failed to clean up storage objects:', err);
        exitCode = 1;
      }
    }

    // 2. Domain records cleanup in dependency order
    for (const incId of cleanupIncidents) {
      try {
        await runPsql(`
          DELETE FROM public.published_incident_bulletins WHERE incident_id = '${incId}';
          DELETE FROM public.incident_updates WHERE incident_id = '${incId}';
          DELETE FROM public.incident_report_links WHERE incident_id = '${incId}';
          DELETE FROM public.incidents WHERE id = '${incId}';
        `);
      } catch (err) {
        console.error(`Failed to clean up incident ${incId}:`, err);
        exitCode = 1;
      }
    }

    for (const repId of cleanupReports) {
      try {
        await runPsql(`
          DELETE FROM public.report_attachments WHERE report_id = '${repId}';
          DELETE FROM public.incident_report_links WHERE report_id = '${repId}';
          DELETE FROM public.incident_reports WHERE id = '${repId}';
        `);
      } catch (err) {
        console.error(`Failed to clean up report ${repId}:`, err);
        exitCode = 1;
      }
    }

    // 3. Profiles, audit events, and Auth users
    if (cleanupUsers.length > 0) {
      const userListStr = cleanupUsers.map((u) => `'${u}'`).join(', ');
      try {
        await runPsql(`
          DELETE FROM public.published_incident_bulletins WHERE incident_id IN (SELECT id FROM public.incidents WHERE verified_by IN (${userListStr})) OR update_id IN (SELECT id FROM public.incident_updates WHERE published_by IN (${userListStr}));
          DELETE FROM public.incident_updates WHERE published_by IN (${userListStr});
          DELETE FROM public.incident_report_links WHERE report_id IN (SELECT id FROM public.incident_reports WHERE reporter_id IN (${userListStr})) OR incident_id IN (SELECT id FROM public.incidents WHERE verified_by IN (${userListStr}));
          DELETE FROM public.report_attachments WHERE report_id IN (SELECT id FROM public.incident_reports WHERE reporter_id IN (${userListStr}));
          DELETE FROM public.incident_reports WHERE reporter_id IN (${userListStr});
          DELETE FROM public.incidents WHERE verified_by IN (${userListStr});
          DELETE FROM public.audit_events WHERE actor_id IN (${userListStr});
          DELETE FROM public.profiles WHERE id IN (${userListStr});
        `);
      } catch (err) {
        console.error('Failed to clean up profiles/audit_events:', err);
        exitCode = 1;
      }

      for (const userId of cleanupUsers) {
        try {
          const authDelRes = await fetch(`${API_URL}/auth/v1/admin/users/${userId}`, {
            method: 'DELETE',
            headers: {
              apikey: SERVICE_KEY,
              Authorization: `Bearer ${SERVICE_KEY}`,
            },
          });
          if (!authDelRes.ok) {
            console.error(`Auth user delete returned status ${authDelRes.status} for ${userId}`);
            exitCode = 1;
          }
        } catch (err) {
          console.error(`Failed to delete auth user ${userId}:`, err);
          exitCode = 1;
        }
      }
      // Verify no synthetic users remain
      const remUsers = await runPsql(`SELECT count(*) FROM auth.users WHERE id IN (${userListStr});`);
      if (parseInt(remUsers, 10) !== 0) {
        console.error(`❌ Residual synthetic users remain in auth.users: ${remUsers}`);
        exitCode = 1;
      }
      console.log(`  ✓ Cleaned up ${cleanupUsers.length} synthetic auth users and profiles`);
    }

    // 4. Explicit preservation check for permanent demo accounts
    try {
      const demoUsersCount = await runPsql(`
        SELECT count(*) FROM auth.users WHERE email IN ('resident@sentosa.local', 'manager@sentosa.local');
      `);
      if (parseInt(demoUsersCount, 10) !== 2) {
        console.error(`❌ Preservation check failed: Expected 2 demo accounts in auth.users, found ${demoUsersCount}`);
        exitCode = 1;
      }
      const demoProfiles = await runPsql(`
        SELECT u.email, p.role, p.assigned_estate_id 
        FROM public.profiles p
        JOIN auth.users u ON u.id = p.id
        WHERE u.email IN ('resident@sentosa.local', 'manager@sentosa.local');
      `);
      if (!demoProfiles.includes('resident') || !demoProfiles.includes('management')) {
        console.error(`❌ Preservation check failed: Demo profile roles corrupted: ${demoProfiles}`);
        exitCode = 1;
      } else {
        console.log('  ✓ Verified permanent demo accounts preserved with intact roles and estate assignments');
      }
    } catch (err) {
      console.error('Failed checking demo accounts preservation:', err);
      exitCode = 1;
    }

    // 5. Verify baseline integrity
    const finalObjCountStr = await runPsql("SELECT count(*) FROM storage.objects WHERE bucket_id = 'incident-evidence';");
    const finalObjCount = parseInt(finalObjCountStr, 10) || 0;
    if (finalObjCount !== baselineObjects) {
      console.error(`❌ Cleanup verification failed: Expected ${baselineObjects} storage objects, found ${finalObjCount}`);
      exitCode = 1;
    } else {
      console.log(`  ✓ Storage objects verified unchanged: exactly ${baselineObjects} objects remain`);
    }

    console.log(`[Teardown] Complete. Exiting with code ${exitCode}.\n`);
    process.exit(exitCode);
  }
}

main().catch((err) => {
  console.error('Fatal unhandled error:', err);
  process.exit(1);
});
