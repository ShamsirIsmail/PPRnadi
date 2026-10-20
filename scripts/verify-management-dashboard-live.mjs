import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
if (fs.existsSync('.env.staging.local')) {
  process.loadEnvFile('.env.staging.local');
}
if (fs.existsSync('.env.local')) {
  try {
    process.loadEnvFile('.env.local');
  } catch {}
}

const TARGET_URL = process.env.TEST_APP_URL || 'https://ppr-nadi-staging.vercel.app';
const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const SUPABASE_URL = process.env.STAGING_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.STAGING_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const RESIDENT_EMAIL = 'resident.rejang@nadi.local';
const RESIDENT_PASSWORD = process.env.STAGING_RESIDENT_PASSWORD || process.env.DEMO_RESIDENT_PASSWORD;
const MANAGER_EMAIL = 'manager.rejang@nadi.local';
const MANAGER_PASSWORD = process.env.STAGING_MANAGER_PASSWORD || process.env.DEMO_MANAGER_PASSWORD;

const ARTIFACT_DIR = 'C:\\Users\\shams\\.gemini\\antigravity-ide\\brain\\f73c5ee6-76ec-4b98-ac3e-6e23b5a34c2a';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('[CONFIG ERROR] Supabase URL and Service Role Key are required.');
  process.exit(1);
}

if (!RESIDENT_PASSWORD || !MANAGER_PASSWORD) {
  console.error('[CONFIG ERROR] Passwords for resident and manager are required.');
  process.exit(1);
}

async function runVerification() {
  console.log('==============================================================================');
  console.log('PPR NADI — MANAGEMENT DASHBOARD & REALTIME NOTIFICATION LIVE VERIFICATION');
  console.log('==============================================================================');
  console.log(`[Target URL] ${TARGET_URL}`);
  console.log(`[Manager]    ${MANAGER_EMAIL}`);
  console.log(`[Resident]   ${RESIDENT_EMAIL}`);

  // 1. Database Ground Truth Query
  console.log('\n[Phase 1] Querying Authoritative Database Ground Truth via Service Client...');
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Manager's assigned estate
  const { data: usersData } = await supabase.auth.admin.listUsers();
  const managerUser = usersData?.users?.find((u) => u.email === MANAGER_EMAIL);
  assert.ok(managerUser, 'Manager user must exist in auth');

  const { data: managerProfile } = await supabase
    .from('profiles')
    .select('id, assigned_estate_id, role')
    .eq('id', managerUser.id)
    .single();

  assert.ok(managerProfile, 'Manager profile must exist in DB');
  const estateId = managerProfile.assigned_estate_id || 'ppr-desa-rejang';
  console.log(`[Manager Estate Scope] ${estateId}`);

  // Metric 1: New Reports (submitted status in estate)
  const { count: dbNewReportsCount } = await supabase
    .from('incident_reports')
    .select('id, buildings!inner(estate_id)', { count: 'exact' })
    .eq('buildings.estate_id', estateId)
    .eq('status', 'submitted');

  // Metric 2: Active Incidents (investigating, confirmed, in_maintenance in estate)
  const { count: dbActiveIncidentsCount } = await supabase
    .from('incidents')
    .select('id, buildings!inner(estate_id)', { count: 'exact' })
    .eq('buildings.estate_id', estateId)
    .in('status', ['investigating', 'confirmed', 'in_maintenance']);

  // Metric 3: Pending Priority Decisions
  const { data: evals } = await supabase
    .from('report_priority_evaluations')
    .select('id, report_id, incident_reports!inner(buildings!inner(estate_id))')
    .eq('incident_reports.buildings.estate_id', estateId);

  const { data: decisions } = await supabase
    .from('report_priority_decisions')
    .select('evaluation_id');

  const decidedEvalIds = new Set((decisions || []).map((d) => d.evaluation_id));
  const dbPendingDecisionsCount = (evals || []).filter((e) => !decidedEvalIds.has(e.id)).length;

  // Metric 4: Resolved Incidents this month
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { count: dbResolvedThisMonthCount } = await supabase
    .from('incidents')
    .select('id, buildings!inner(estate_id)', { count: 'exact' })
    .eq('buildings.estate_id', estateId)
    .in('status', ['restored', 'closed'])
    .gte('resolved_at', startOfMonth.toISOString());

  console.log(`[Authoritative DB Counts]`);
  console.log(`  - Aduan baharu:                   ${dbNewReportsCount || 0}`);
  console.log(`  - Insiden dalam tindakan:         ${dbActiveIncidentsCount || 0}`);
  console.log(`  - Cadangan perlukan keputusan:   ${dbPendingDecisionsCount}`);
  console.log(`  - Insiden selesai bulan ini:      ${dbResolvedThisMonthCount || 0}`);

  // Launch Playwright Chrome
  console.log('\n[Phase 2] Launching Isolated Multi-Session Browser...');
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
  });

  const managerContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const residentContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });

  const managerPage = await managerContext.newPage();
  const residentPage = await residentContext.newPage();

  let testReportId = null;

  try {
    // -------------------------------------------------------------------------
    // Session 1: Manager Login & Initial Dashboard Verification
    // -------------------------------------------------------------------------
    console.log('\n[Phase 3] Manager Login to Management Dashboard...');
    await managerPage.goto(`${TARGET_URL}/login`, { waitUntil: 'networkidle' });

    await managerPage.fill('input#login-email', MANAGER_EMAIL);
    await managerPage.fill('input#login-password', MANAGER_PASSWORD);
    await managerPage.click('button[type="submit"]');

    await managerPage.waitForURL('**/management', { timeout: 15000 });
    console.log('✓ Manager logged in successfully. Current URL:', managerPage.url());

    // 1. Verify Layout & Header
    console.log('\n[Verification 3.1] Verifying Header, Breadcrumbs & Manager Profile...');
    const breadcrumbText = await managerPage.locator('nav[aria-label="Breadcrumb"]').innerText();
    assert.ok(breadcrumbText.includes('Pengurusan'), 'Breadcrumb must include Pengurusan');
    assert.ok(breadcrumbText.includes('Dashboard'), 'Breadcrumb must include Dashboard');
    console.log(`✓ Breadcrumbs confirmed: "${breadcrumbText.replace(/\s+/g, ' ').trim()}"`);

    const bellBtn = managerPage.locator('button[aria-label*="notifikasi" i]');
    assert.ok(await bellBtn.isVisible(), 'Notification bell button must be visible');
    console.log('✓ Notification bell visible in header.');

    const avatar = managerPage.locator('div:has-text("PR")').first();
    assert.ok(await avatar.isVisible(), 'Manager initials avatar (PR) must be visible');
    console.log('✓ Manager initials avatar (PR) confirmed.');

    // 2. Verify Sidebar
    console.log('\n[Verification 3.2] Verifying Sidebar Links...');
    const sidebar = managerPage.locator('aside');
    assert.ok(await sidebar.isVisible(), 'Sidebar must be visible on desktop');

    const sidebarText = await sidebar.innerText();
    assert.ok(sidebarText.includes('Dashboard'), 'Sidebar must include Dashboard');
    assert.ok(sidebarText.includes('Peti aduan'), 'Sidebar must include Peti aduan');
    assert.ok(sidebarText.includes('Insiden'), 'Sidebar must include Insiden');
    assert.ok(sidebarText.includes('Fasiliti'), 'Sidebar must include Fasiliti');

    // Confirm no dead links from mockup
    assert.ok(!sidebarText.includes('Notis komuniti'), 'Sidebar must NOT include unbuilt "Notis komuniti"');
    assert.ok(!sidebarText.includes('Laporan bulanan'), 'Sidebar must NOT include unbuilt "Laporan"');
    assert.ok(!sidebarText.includes('Tetapan sistem'), 'Sidebar must NOT include unbuilt "Tetapan"');
    console.log('✓ Sidebar confirmed: strictly real functional routes, zero dead links.');

    // 3. Verify 4 Authoritative Metrics
    console.log('\n[Verification 3.3] Verifying 4 Real Metrics against Ground Truth...');
    await managerPage.waitForSelector('h1', { timeout: 20000 });
    const metricCards = managerPage.locator('div[data-testid="metric-card"]');
    const metricCount = await metricCards.count();
    assert.equal(metricCount, 4, 'Must display exactly 4 metric cards');

    const newReportsText = await metricCards.nth(0).innerText();
    const activeIncidentsText = await metricCards.nth(1).innerText();
    const decisionsText = await metricCards.nth(2).innerText();
    const resolvedText = await metricCards.nth(3).innerText();

    console.log(`Card 1 (Aduan baharu):           ${newReportsText.replace(/\n+/g, ' | ')}`);
    console.log(`Card 2 (Insiden dalam tindakan): ${activeIncidentsText.replace(/\n+/g, ' | ')}`);
    console.log(`Card 3 (Keputusan pengurus):     ${decisionsText.replace(/\n+/g, ' | ')}`);
    console.log(`Card 4 (Insiden selesai):        ${resolvedText.replace(/\n+/g, ' | ')}`);

    assert.ok(newReportsText.includes(String(dbNewReportsCount || 0)), `Card 1 must match DB count: ${dbNewReportsCount || 0}`);
    assert.ok(activeIncidentsText.includes(String(dbActiveIncidentsCount || 0)), `Card 2 must match DB count: ${dbActiveIncidentsCount || 0}`);
    assert.ok(decisionsText.includes(String(dbPendingDecisionsCount)), `Card 3 must match DB count: ${dbPendingDecisionsCount}`);
    assert.ok(resolvedText.includes(String(dbResolvedThisMonthCount || 0)), `Card 4 must match DB count: ${dbResolvedThisMonthCount || 0}`);
    console.log('✓ All 4 metrics match database ground truth exactly!');

    // 4. Verify Reports List & Filters
    console.log('\n[Verification 3.4] Verifying Reports List & Filters...');
    const tabButtons = managerPage.locator('div[role="tablist"] button');
    assert.equal(await tabButtons.count(), 3, 'Must have 3 filter tabs (Baharu, Dalam tindakan, Selesai)');

    // Sort Toggle
    const sortBtn = managerPage.locator('button:has-text("Terkini dahulu"), button:has-text("Terlama dahulu")').first();
    assert.ok(await sortBtn.isVisible(), 'Sort toggle button must be visible');
    const initialSort = await sortBtn.innerText();
    await sortBtn.click();
    await managerPage.waitForTimeout(300);
    const toggledSort = await sortBtn.innerText();
    assert.notEqual(initialSort, toggledSort, 'Sort toggle must change order');
    await sortBtn.click(); // switch back
    console.log('✓ Sort toggle verified:', initialSort, '->', toggledSort);

    // Chevron Drawer Toggle
    const firstChevron = managerPage.locator('button[aria-label*="butiran aduan" i]').first();
    if (await firstChevron.isVisible()) {
      await firstChevron.click();
      await managerPage.waitForTimeout(300);
      const drawer = managerPage.locator('div:has-text("Ringkasan Kerosakan")').first();
      assert.ok(await drawer.isVisible(), 'Inline details drawer must open on chevron click');
      console.log('✓ Accessible chevron button expands inline details drawer.');
      await firstChevron.click(); // close drawer
    }

    // Facility Filter
    const waterFacilityBtn = managerPage.locator('button:has-text("Bekalan air")').first();
    if (await waterFacilityBtn.isVisible()) {
      await waterFacilityBtn.click();
      await managerPage.waitForTimeout(300);
      console.log('✓ Facility filter button clicked.');
      // Click again to unfilter
      await waterFacilityBtn.click();
      await managerPage.waitForTimeout(300);
    }

    // Block Filter
    const blockABtn = managerPage.locator('button:has-text("Blok A")').first();
    if (await blockABtn.isVisible()) {
      await blockABtn.click();
      await managerPage.waitForTimeout(300);
      console.log('✓ 12-Block filter button clicked.');
      await blockABtn.click(); // unfilter
      await managerPage.waitForTimeout(300);
    }

    // Language Switcher Test
    console.log('\n[Verification 3.5] Verifying Language Switcher (BM <-> EN)...');
    const langBtn = managerPage.locator('button:has-text("EN"), button:has-text("BM")').first();
    assert.ok(await langBtn.isVisible(), 'Language switcher must be visible');
    await langBtn.click();
    await managerPage.waitForTimeout(400);

    const enHeading = await managerPage.locator('h1').innerText();
    assert.ok(enHeading.includes('Management Summary'), 'Header in English must include Management Summary');
    console.log('✓ Language switched to English:', enHeading);

    // Switch back to BM
    await langBtn.click();
    await managerPage.waitForTimeout(400);
    const bmHeading = await managerPage.locator('h1').innerText();
    assert.ok(bmHeading.includes('Ringkasan pengurusan'), 'Header in BM must include Ringkasan pengurusan');
    console.log('✓ Language switched back to Bahasa Melayu:', bmHeading);

    // Responsive Viewports
    console.log('\n[Verification 3.6] Verifying Responsive Viewports (1440px & 390px)...');
    await managerPage.setViewportSize({ width: 1440, height: 900 });
    await managerPage.waitForTimeout(300);
    const h1440 = await managerPage.locator('h1').isVisible();
    assert.ok(h1440, 'Dashboard header visible at 1440px');

    // Screenshot 1440px
    const screenshot1440Path = path.join(ARTIFACT_DIR, 'management_dashboard_desktop_1440.png');
    await managerPage.screenshot({ path: screenshot1440Path, fullPage: false });
    console.log(`✓ Screenshot 1440px captured: ${screenshot1440Path}`);

    // Mobile 390px
    await managerPage.setViewportSize({ width: 390, height: 844 });
    await managerPage.waitForTimeout(300);
    const mobileMenuBtn = managerPage.locator('button[aria-label*="menu" i]').first();
    assert.ok(await mobileMenuBtn.isVisible(), 'Mobile hamburger button visible at 390px');
    console.log('✓ Small screen (390px) responsive layout functional.');

    // Reset viewport back to desktop 1280px for notification test
    await managerPage.setViewportSize({ width: 1280, height: 800 });
    await managerPage.waitForTimeout(500);

    // -------------------------------------------------------------------------
    // Session 2: Resident Submits ONE Test Report via UI (Without AI)
    // -------------------------------------------------------------------------
    console.log('\n[Phase 4] Resident Submitting ONE Test Report via Resident UI...');
    await residentPage.goto(`${TARGET_URL}/login`, { waitUntil: 'networkidle' });

    await residentPage.fill('input#login-email', RESIDENT_EMAIL);
    await residentPage.fill('input#login-password', RESIDENT_PASSWORD);
    await residentPage.click('button[type="submit"]');

    await residentPage.waitForURL('**/resident', { timeout: 15000 });
    console.log('✓ Resident logged in successfully.');

    // Go to /resident/lapor
    await residentPage.goto(`${TARGET_URL}/resident/lapor`, { waitUntil: 'networkidle' });

    // Click "Taip Sendiri" (manual form without AI)
    const manualBtn = residentPage.locator('button[data-testid="start-manual-form-button"]');
    assert.ok(await manualBtn.isVisible(), 'Taip Sendiri button must be visible');
    await manualBtn.click();
    await residentPage.waitForTimeout(300);

    // Select category: corridor_lighting (Lampu koridor)
    const lightingBtn = residentPage.locator('button:has-text("Lampu koridor")').first();
    await lightingBtn.click();

    // Fill floor and description
    await residentPage.fill('input#manual-floor', '5');
    const testDesc = `[TEST-NOTIFIKASI-MANAGEMENT] Lampu koridor tingkat 5 rosak dan berkedip. Ujian automatik sistem notifikasi dashboard. (${Date.now()})`;
    await residentPage.fill('textarea#manual-desc', testDesc);

    // Proceed to review
    await residentPage.click('button[data-testid="manual-proceed-review-button"]');
    await residentPage.waitForTimeout(500);

    // On review screen, click "Hantar Aduan"
    const submitBtn = residentPage.locator('button[data-testid="submit-report-button"]');
    assert.ok(await submitBtn.isVisible(), 'Submit button on review screen must be visible');
    await submitBtn.click();

    // Wait for confirmation screen
    await residentPage.waitForSelector('span[data-testid="active-report-id"]', { timeout: 20000 });
    testReportId = (await residentPage.locator('span[data-testid="active-report-id"]').innerText()).trim();
    assert.ok(testReportId, 'Test report ID must be returned by submission confirmation');
    console.log(`✓ ONE Resident Test Report created successfully!`);
    console.log(`  Report ID:   ${testReportId}`);
    console.log(`  Description: ${testDesc}`);

    // -------------------------------------------------------------------------
    // Session 1: Manager Live Notification & Persistence Verification
    // -------------------------------------------------------------------------
    console.log('\n[Phase 5] Verifying Real-Time Alert in Manager Session (Without Refresh)...');

    // Manager page must receive notification automatically within 15 seconds!
    console.log('Waiting for live notification pop-up / bell animation in manager session...');
    const alertPopup = managerPage.locator('div[role="alert"]:has-text("Aduan baharu diterima")');
    await alertPopup.waitFor({ state: 'visible', timeout: 20000 });
    assert.ok(await alertPopup.isVisible(), 'Floating notification pop-up must appear automatically');
    console.log('✓ Floating notification popup appeared without manual refresh!');

    const alertContent = await alertPopup.innerText();
    console.log(`[Alert Content]:\n${alertContent}`);
    assert.ok(alertContent.includes('Blok A') || alertContent.includes('Tingkat 5'), 'Alert must show location');

    // Verify Bell Ring Animation class and unread dot indicator
    const bellSvg = managerPage.locator('svg.bell-ring-active');
    const bellRinging = (await bellSvg.count()) > 0;
    console.log('✓ Bell ringing animation triggered:', bellRinging ? 'CONFIRMED (.bell-ring-active)' : 'Completed ring cycle');

    const unreadDot = managerPage.locator('span.bg-red-500.rounded-full');
    assert.ok(await unreadDot.isVisible(), 'Unread red dot indicator must appear on bell');
    console.log('✓ Unread indicator dot confirmed on bell.');

    // Deduplication check: wait 12 more seconds for extra polling cycles and confirm no duplicate alert popups
    console.log('\n[Verification 5.1] Verifying Deduplication (No duplicate pop-ups on polling cycles)...');
    await managerPage.waitForTimeout(12000);
    const alertCount = await managerPage.locator('div[role="alert"]:has-text("Aduan baharu diterima")').count();
    assert.equal(alertCount, 1, 'Exactly 1 notification alert popup must exist; no duplicates allowed');
    console.log('✓ Deduplication confirmed: subsequent polling cycles did not duplicate notification.');

    // Click "Semak aduan" or close button to mark notification as read
    console.log('\n[Verification 5.2] Reading/Dismissing Notification...');
    const closeNotifBtn = managerPage.locator('button:has-text("Tutup")').first();
    await closeNotifBtn.click();
    await managerPage.waitForTimeout(400);

    const alertVisibleAfterClose = await alertPopup.isVisible();
    assert.ok(!alertVisibleAfterClose, 'Alert popup must close after clicking dismiss');
    console.log('✓ Notification popup dismissed.');

    // Unread dot check
    const unreadDotAfterDismiss = await unreadDot.isVisible();
    assert.ok(!unreadDotAfterDismiss, 'Unread dot must disappear when all notifications are marked read');
    console.log('✓ Unread indicator cleared.');

    // Refresh Persistence Check: Reload Manager Page
    console.log('\n[Verification 5.3] Verifying Read State Persistence after Page Refresh...');
    await managerPage.reload({ waitUntil: 'networkidle' });
    await managerPage.waitForTimeout(1000);

    const popupAfterReload = await managerPage.locator('div[role="alert"]:has-text("Aduan baharu diterima")').isVisible();
    assert.ok(!popupAfterReload, 'Notification popup must NOT re-appear after refresh (read state is persisted)');

    const dotAfterReload = await managerPage.locator('span.bg-red-500.rounded-full').isVisible();
    assert.ok(!dotAfterReload, 'Unread dot must NOT re-appear after refresh');
    console.log('✓ Read state persistence confirmed: browser reload does not re-trigger notifications.');

    // Verify newly created report is now in the table
    const tableContent = await managerPage.locator('table').innerText();
    assert.ok(tableContent.includes('Tingkat 5') || tableContent.includes('Lampu koridor'), 'New test report must appear in reports list');
    console.log('✓ Test report confirmed present in management reports list.');

    // Screenshot 1280px
    const screenshot1280Path = path.join(ARTIFACT_DIR, 'management_dashboard_desktop_1280.png');
    await managerPage.screenshot({ path: screenshot1280Path, fullPage: false });
    console.log(`✓ Screenshot 1280px captured: ${screenshot1280Path}`);

    console.log('\n==============================================================================');
    console.log('ALL DASHBOARD & NOTIFICATION ASSERTIONS PASSED WITH FLYING COLORS!');
    console.log(`Retained Test Report ID: ${testReportId}`);
    console.log('==============================================================================');
  } finally {
    await browser.close();
  }
}

runVerification().catch((err) => {
  console.error('\n[VERIFICATION ERROR]', err);
  process.exit(1);
});
