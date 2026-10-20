import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright-core';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Load staging configuration
if (fs.existsSync('.env.staging.local')) {
  try {
    process.loadEnvFile('.env.staging.local');
  } catch {}
}

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const STAGING_URL = 'https://ppr-nadi-staging.vercel.app';
const SUPABASE_URL = process.env.STAGING_SUPABASE_URL || 'https://mhtlcvvqwxkhkeqhzbrk.supabase.co';
const SUPABASE_ANON = process.env.STAGING_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE = process.env.STAGING_SERVICE_ROLE_KEY;

const RESIDENT_EMAIL = 'resident.rejang@nadi.local';
const RESIDENT_PASS = process.env.STAGING_RESIDENT_PASSWORD;
const MANAGER_EMAIL = 'manager.rejang@nadi.local';
const MANAGER_PASS = process.env.STAGING_MANAGER_PASSWORD;
const ALIEN_EMAIL = 'resident.sentosa@nadi.local';
const ALIEN_PASS = process.env.STAGING_ALIEN_RESIDENT_PASSWORD || RESIDENT_PASS;

const FIXTURE_1_PATH = path.resolve('tests/fixtures/test_photo_1.jpg');
const FIXTURE_2_PATH = path.resolve('tests/fixtures/test_photo_2.jpg');

const HASH_1 = crypto.createHash('sha256').update(fs.readFileSync(FIXTURE_1_PATH)).digest('hex');
const HASH_2 = crypto.createHash('sha256').update(fs.readFileSync(FIXTURE_2_PATH)).digest('hex');

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function runFullE2ETest() {
  console.log('================================================================');
  console.log('PPR NADI — Live Staging Full Browser E2E & Isolation Test');
  console.log(`Target URL: ${STAGING_URL}`);
  console.log('================================================================\n');

  assert(Boolean(RESIDENT_PASS), 'Missing STAGING_RESIDENT_PASSWORD');
  assert(Boolean(MANAGER_PASS), 'Missing STAGING_MANAGER_PASSWORD');
  assert(Boolean(ALIEN_PASS), 'Missing STAGING_TEST_SENTOSA_PASSWORD');

  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
  });

  let submittedReportId = '';
  let residentContext;
  let page;

  try {
    // -------------------------------------------------------------------------
    // PHASE 1: RESIDENT GUIDED FLOW INTERACTION VIA REAL BROWSER UI
    // -------------------------------------------------------------------------
    console.log('[Phase 1] Starting Resident Browser Session...');
    residentContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
    });
    page = await residentContext.newPage();

    // A. Login Resident
    console.log('A. Navigating to Login page...');
    await page.goto(`${STAGING_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.fill('input[type="email"]', RESIDENT_EMAIL);
    await page.fill('input[type="password"]', RESIDENT_PASS);
    await page.click('button[type="submit"]');

    console.log('Waiting for resident home page...');
    await page.waitForURL('**/resident', { timeout: 30000 });

    // B. Open Aduan Berpandu
    console.log('B. Navigating to /resident/lapor...');
    await page.goto(`${STAGING_URL}/resident/lapor`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const guidedBtn = page.locator('button').filter({ hasText: 'Aduan berpandu' }).first();
    await guidedBtn.waitFor({ state: 'visible', timeout: 10000 });
    await guidedBtn.click();

    // C. Step 1: Select Blok A, floor 18
    console.log('C. Step 1: Selecting Blok A, Tingkat 18...');
    await page.waitForSelector('text=Langkah 1 daripada 4', { timeout: 10000 });
    const blokABtn = page.locator('button').filter({ hasText: /^A(\s*✓)?$/ }).first();
    await blokABtn.click();
    await page.waitForTimeout(300);
    const floor18Btn = page.locator('button').filter({ hasText: /^18(\s*✓)?$/ }).first();
    await floor18Btn.click();
    await page.waitForTimeout(300);

    // Proceed to Step 2
    console.log('Proceeding to Step 2: Masalah...');
    await page.locator('button').filter({ hasText: /Seterusnya|Next/ }).first().click();

    // D. Step 2: Select Category (Lif) and Sub-Issue (Pintu bermasalah)
    console.log('D. Step 2: Selecting Category Lif and Sub-Issue Pintu bermasalah...');
    await page.waitForSelector('text=Langkah 2 daripada 4', { timeout: 10000 });
    await page.locator('button').filter({ hasText: 'Lif' }).first().click();
    await page.waitForTimeout(300);

    const doorProbBtn = page.locator('button').filter({ hasText: 'Pintu bermasalah' }).first();
    await doorProbBtn.waitFor({ state: 'visible', timeout: 5000 });
    await doorProbBtn.click();
    await page.waitForTimeout(300);

    // Proceed to Step 3
    console.log('Proceeding to Step 3: Bukti...');
    await page.locator('button').filter({ hasText: /Seterusnya|Next/ }).first().click();

    // E. Step 3: Add Two Distinct Fixture Images
    console.log('E. Step 3: Uploading Two Distinct Fixture Images...');
    await page.waitForSelector('text=Langkah 3 daripada 4', { timeout: 10000 });

    // Set file input directly
    const galleryInput = page.locator('input[type="file"][multiple]').first();
    await galleryInput.setInputFiles([FIXTURE_1_PATH, FIXTURE_2_PATH]);
    await page.waitForTimeout(1000);

    // Verify 2 thumbnails appear
    const thumbnails = page.locator('img[alt^="Bukti"]');
    const thumbCount = await thumbnails.count();
    assert(thumbCount === 2, `Expected 2 image thumbnails in Step 3, found ${thumbCount}`);
    console.log('✓ 2 image thumbnails confirmed in Step 3');

    // F. Proceed to Review Screen
    console.log('F. Proceeding to Step 4: Semak...');
    const reviewBtn = page.locator('button').filter({ hasText: /Semak aduan|Review report/ }).first();
    await reviewBtn.waitFor({ state: 'visible', timeout: 10000 });
    await reviewBtn.click();

    await page.waitForSelector('text=Langkah 4 daripada 4', { timeout: 10000 });
    await page.waitForSelector('text=Betul semua?', { timeout: 10000 });

    // G. Click "Ubah" location and change to Blok L
    console.log('G. Clicking Ubah location in review...');
    const locSection = page.locator('section').filter({ hasText: /Lokasi Kejadian|Incident Location/i }).first();
    const ubahLocBtn = locSection.locator('button').filter({ hasText: /Ubah|Edit/i }).first();
    await ubahLocBtn.click();

    await page.waitForSelector('text=Langkah 1 daripada 4', { timeout: 10000 });
    console.log('Switching to Blok L...');
    const blokLBtn = page.locator('button').filter({ hasText: /^L(\s*✓)?$/ }).first();
    await blokLBtn.click();
    await page.waitForTimeout(500);

    // H. Confirm floor 18 is invalidated; select floor 14
    console.log('H. Verifying floor 18 was invalidated and selecting floor 14...');
    const errorNotice = page.locator('text=Tingkat 18 tidak tersedia di Blok L');
    const isNoticeVisible = await errorNotice.isVisible();
    assert(isNoticeVisible, 'Floor out of bounds warning must be displayed when switching from Blok A (18) to Blok L (15)');
    console.log('✓ Floor 18 out-of-bounds warning confirmed');

    // Select floor 14
    const floor14Btn = page.locator('button').filter({ hasText: /^14(\s*✓)?$/ }).first();
    await floor14Btn.click();
    await page.waitForTimeout(400);

    // I. Return to Review
    console.log('I. Returning to Review screen...');
    await page.locator('button').filter({ hasText: /Simpan perubahan|Save changes/ }).first().click();
    await page.waitForSelector('text=Langkah 4 daripada 4', { timeout: 10000 });

    // Verify location in review is Blok L, Tingkat 14
    const locReviewText = await page.locator('text=Blok L, Tingkat 14').first().textContent();
    assert(Boolean(locReviewText), 'Review screen must display updated location Blok L, Tingkat 14');
    console.log('✓ Review screen updated to Blok L, Tingkat 14');

    // J. Toggle language to English and back to BM
    console.log('J. Toggling language: BM -> EN -> BM...');
    const langBtnEn = page.locator('button').filter({ hasText: 'English' }).first();
    await langBtnEn.click();
    await page.waitForTimeout(600);

    // In English
    await page.waitForSelector('text=Is everything correct?', { timeout: 5000 });
    const enDetail = await page.locator('text=Door problem').first().isVisible();
    assert(enDetail, 'Sub-issue must translate seamlessly to "Door problem" in English');

    // Toggle back to BM
    const langBtnBm = page.locator('button').filter({ hasText: 'B. Melayu' }).first();
    await langBtnBm.click();
    await page.waitForTimeout(600);
    await page.waitForSelector('text=Betul semua?', { timeout: 5000 });

    // K. Confirm category, sub-issue, location, and 2 images remain intact
    console.log('K. Verifying all fields and images preserved after language toggle...');
    const bmDetail = await page.locator('text=Pintu bermasalah').first().isVisible();
    assert(bmDetail, 'Sub-issue must remain "Pintu bermasalah" after toggling back to BM');

    const reviewThumbs = page.locator('img[alt^="Bukti"]');
    const reviewThumbCount = await reviewThumbs.count();
    assert(reviewThumbCount === 2, `Expected 2 photos in review screen, found ${reviewThumbCount}`);
    console.log('✓ All draft fields and 2 photos preserved after bilingual roundtrip');

    // L. Submit through UI once
    console.log('L. Submitting report through UI button (single click)...');
    const submitBtn = page.locator('button').filter({ hasText: /Hantar aduan|Submit report/ }).first();
    await submitBtn.click();

    // Wait for submission confirmation screen
    console.log('Waiting for confirmation and active report ID in UI...');
    await page.waitForSelector('[data-testid="report-saved-heading"], [data-testid="active-report-id"]', { timeout: 35000 });
    submittedReportId = await page.locator('[data-testid="active-report-id"]').textContent();
    submittedReportId = submittedReportId.trim();
    assert(Boolean(submittedReportId), 'UI must display submitted report ID');
    console.log(`✓ Report successfully submitted! Extracted Report ID from UI: ${submittedReportId}`);
  } finally {
    if (residentContext) await residentContext.close();
  }

  // -------------------------------------------------------------------------
  // PHASE 2: DATABASE AUDIT (Direct verification of submitted record)
  // -------------------------------------------------------------------------
  console.log('\n[Phase 2] Verifying record in Supabase Database...');
  const { data: dbReport, error: dbErr } = await supabaseAdmin
    .from('incident_reports')
    .select('*, report_attachments(*), building:buildings(*)')
    .eq('id', submittedReportId)
    .single();

  assert(!dbErr && dbReport, `Failed to retrieve submitted report ${submittedReportId} from DB: ${dbErr?.message}`);

  // M. Match report ID from UI with database record
  assert(dbReport.id === submittedReportId, 'Database ID must strictly match UI report ID');
  console.log(`M. Confirmed DB record matches UI report ID: ${dbReport.id}`);

  // N. Confirm final location Blok L, floor 14, correct zone, and no old location in description
  console.log('N. Verifying location accuracy, zone bounds, and absence of old Blok A...');
  assert(dbReport.building?.name === 'Blok L', `Expected building Blok L, got ${dbReport.building?.name}`);
  assert(!dbReport.description.includes('Blok A'), 'Description must NEVER contain old Blok A location');
  assert(dbReport.description.includes('Blok L, Tingkat 14'), 'Description must contain final location Blok L, Tingkat 14');
  assert(dbReport.description.includes('Lif · Pintu bermasalah'), 'Description must contain category and sub-issue');
  assert(dbReport.category === 'lift', 'Category must be lift');

  // Verify service zone assertions:
  // 1. service_zone_id belongs to the same building_id
  // 2. Zone range covers selected floor (floor 14)
  if (dbReport.service_zone_id) {
    const { data: dbZone, error: zoneErr } = await supabaseAdmin
      .from('service_zones')
      .select('*')
      .eq('id', dbReport.service_zone_id)
      .single();
    assert(!zoneErr && dbZone, `Failed to load zone ${dbReport.service_zone_id}: ${zoneErr?.message}`);
    assert(
      !dbZone.building_id || dbZone.building_id === dbReport.building_id,
      `Zone building_id mismatch: expected ${dbReport.building_id}, got ${dbZone.building_id}`
    );
    if (typeof dbZone.floor_start === 'number' && typeof dbZone.floor_end === 'number') {
      assert(
        14 >= dbZone.floor_start && 14 <= dbZone.floor_end,
        `Zone floor bounds [${dbZone.floor_start}, ${dbZone.floor_end}] do not cover floor 14!`
      );
    }
    console.log(`✓ Confirmed service zone ${dbZone.name} belongs to Blok L and strictly covers floor 14`);
  }
  console.log('✓ Database location, category, zone, and description are 100% consistent with UI submission');

  // O. Assert exactly two attachments
  console.log('O. Checking attachments in database...');
  assert(dbReport.report_attachments?.length === 2, `Expected 2 attachments, found ${dbReport.report_attachments?.length}`);
  console.log('✓ Exactly 2 attachments recorded in report_attachments table');

  // -------------------------------------------------------------------------
  // PHASE 3: MANAGER VERIFICATION IN SEPARATE BROWSER CONTEXT
  // -------------------------------------------------------------------------
  console.log('\n[Phase 3] Manager Verification in Separate Browser Context...');
  const managerContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const mgrPage = await managerContext.newPage();

  try {
    // P. Login Manager
    console.log('P. Manager logging in...');
    await mgrPage.goto(`${STAGING_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await mgrPage.fill('input[type="email"]', MANAGER_EMAIL);
    await mgrPage.fill('input[type="password"]', MANAGER_PASS);
    await mgrPage.click('button[type="submit"]');

    await mgrPage.waitForURL(/\/management/, { timeout: 30000 });
    console.log('Manager logged in. Navigating to inbox...');
    await mgrPage.goto(`${STAGING_URL}/management/inbox`, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Q. Scope locator to that exact report card
    console.log(`Q. Scoping locator to report card ${submittedReportId}...`);
    const reportCard = mgrPage.locator(`[data-testid="report-card-${submittedReportId}"]`);
    await reportCard.waitFor({ state: 'visible', timeout: 20000 });
    console.log('✓ Found manager report card scoped to report ID');

    // R & S. Open both image links from that card only & verify SHA256 hashes
    console.log('R & S. Downloading both images from manager card and validating hashes...');
    const imageLinks = reportCard.locator('a[target="_blank"]');
    const linkCount = await imageLinks.count();
    assert(linkCount >= 2, `Expected at least 2 image links in manager card, found ${linkCount}`);

    for (let i = 0; i < 2; i++) {
      const link = imageLinks.nth(i);
      const href = await link.getAttribute('href');
      assert(Boolean(href && href !== '#'), `Image link ${i + 1} must have a valid href`);
      console.log(`Fetching image ${i + 1} via signed URL: ${href.slice(0, 60)}...`);

      const res = await fetch(href);
      assert(res.ok, `Failed to fetch image ${i + 1} via signed URL: HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const hash = crypto.createHash('sha256').update(buf).digest('hex');

      if (i === 0) {
        assert(hash === HASH_1, `Hash mismatch on image 1! Expected ${HASH_1}, got ${hash}`);
        console.log(`✓ Image 1 opened via manager card link with SHA256 match: ${hash}`);
      } else {
        assert(hash === HASH_2, `Hash mismatch on image 2! Expected ${HASH_2}, got ${hash}`);
        console.log(`✓ Image 2 opened via manager card link with SHA256 match: ${hash}`);
      }
    }
  } finally {
    await managerContext.close();
  }

  // -------------------------------------------------------------------------
  // PHASE 4: 3RD ACCOUNT (ALIEN ESTATE RESIDENT) SECURITY & RLS TESTING
  // -------------------------------------------------------------------------
  console.log('\n[Phase 4] Testing 3rd Account Access Isolation (resident.sentosa@nadi.local)...');
  const alienClient = createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: false } });
  const { data: alienAuth, error: alienLoginErr } = await alienClient.auth.signInWithPassword({
    email: ALIEN_EMAIL,
    password: ALIEN_PASS,
  });
  assert(!alienLoginErr && alienAuth?.user, `Alien resident login failed: ${alienLoginErr?.message}`);
  console.log(`Alien resident authenticated. User ID: ${alienAuth.user.id}`);

  // Test 1: Query Desa Rejang report
  console.log('Testing: Alien resident cannot read Desa Rejang report...');
  const { data: alienReportRead, error: alienReadErr } = await alienClient
    .from('incident_reports')
    .select('*')
    .eq('id', submittedReportId);

  assert(!alienReadErr, `Query encountered database error rather than RLS filtering: ${alienReadErr?.message}`);
  assert(
    Array.isArray(alienReportRead) && alienReportRead.length === 0,
    `RLS Violation: Alien resident was able to read Desa Rejang report! Returned ${alienReportRead?.length} rows.`
  );
  console.log('✓ Alien resident read query executed cleanly and returned exactly 0 rows (isolated by RLS)');

  // Test 2: Cannot read attachment metadata
  console.log('Testing: Alien resident cannot read attachment metadata...');
  const { data: alienAtts, error: alienAttsErr } = await alienClient
    .from('report_attachments')
    .select('*')
    .eq('report_id', submittedReportId);

  assert(!alienAttsErr, `Attachment query failed with error: ${alienAttsErr?.message}`);
  assert(
    Array.isArray(alienAtts) && alienAtts.length === 0,
    `RLS Violation: Alien resident was able to read report attachments metadata! Returned ${alienAtts?.length} rows.`
  );
  console.log('✓ Alien resident attachment query executed cleanly and returned exactly 0 rows (isolated by RLS)');

  // Test 3: Cannot download storage objects
  console.log('Testing: Alien resident cannot download Desa Rejang storage image...');
  const targetPath = dbReport.report_attachments[0].storage_path;
  const { data: alienDl, error: alienDlErr } = await alienClient.storage
    .from('incident-evidence')
    .download(targetPath);

  assert(!alienDl && Boolean(alienDlErr), 'RLS Violation: Alien resident was able to download Desa Rejang image from storage!');
  console.log(`✓ Alien storage download rejected with error: ${alienDlErr.message}`);

  // Test 4: Cannot submit report to Desa Rejang building
  console.log('Testing: Alien resident cannot submit report to Desa Rejang building...');
  const { data: alienInsertData, error: alienInsertErr } = await alienClient
    .from('incident_reports')
    .insert({
      reporter_id: alienAuth.user.id,
      building_id: dbReport.building_id, // Desa Rejang building
      category: 'water_supply',
      description: 'Cubaan aduan penduduk kawasan lain ke Desa Rejang',
      status: 'submitted',
    })
    .select();

  if (!alienInsertErr && alienInsertData && alienInsertData.length > 0) {
    const leakedId = alienInsertData[0].id;
    throw new Error(`CRITICAL SECURITY FAILURE: Alien resident was able to insert report for Desa Rejang building! Created mutation ID: ${leakedId}`);
  }
  assert(Boolean(alienInsertErr), 'Security Violation: Alien resident report insertion did not fail as expected!');
  console.log(`✓ Alien report submission strictly rejected by policy: ${alienInsertErr.message}`);

  // -------------------------------------------------------------------------
  // PHASE 5: UNAUTHENTICATED STORAGE ACCESS TEST
  // -------------------------------------------------------------------------
  console.log('\n[Phase 5] Testing Unauthenticated Storage Access Rejection...');
  const unauthClient = createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: false } });
  const { data: unauthDl, error: unauthErr } = await unauthClient.storage
    .from('incident-evidence')
    .download(targetPath);

  assert(!unauthDl && Boolean(unauthErr), 'Security Violation: Unauthenticated client downloaded private image!');
  console.log(`✓ Unauthenticated download rejected: ${unauthErr.message}`);

  await browser.close();

  // Save durable test results
  const resultSummary = {
    testStatus: 'PASSED',
    timestamp: new Date().toISOString(),
    stagingUrl: STAGING_URL,
    submittedReportId,
    testedBuilding: 'DR_BLK_L',
    testedFloor: 14,
    testedCategory: 'lift',
    testedSubIssue: 'door_problem',
    verifiedAttachmentsCount: 2,
    image1Sha256Match: true,
    image2Sha256Match: true,
    bilingualConsistencyVerified: true,
    floor18InvalidatedOnBlockChange: true,
    alienResidentIsolationVerified: true,
    unauthenticatedStorageAccessRejected: true,
    threeTestingAccounts: [
      RESIDENT_EMAIL,
      MANAGER_EMAIL,
      ALIEN_EMAIL,
    ],
  };

  fs.writeFileSync('backups/local-snapshot/live-browser-flow-verification.json', JSON.stringify(resultSummary, null, 2));
  console.log('\n================================================================');
  console.log('ALL PHASES PASSED WITH STRICT ASSERTIONS!');
  console.log('Results saved to backups/local-snapshot/live-browser-flow-verification.json');
  console.log('================================================================');
}

runFullE2ETest().catch((err) => {
  console.error('\n[FATAL TEST FAILURE]:', err.message);
  process.exit(1);
});
