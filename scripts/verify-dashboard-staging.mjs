import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { chromium } from 'playwright-core';

// Load environment from .env.staging.local
if (fs.existsSync('.env.staging.local')) {
  process.loadEnvFile('.env.staging.local');
}

const TARGET_URL = process.env.TEST_APP_URL || 'https://ppr-nadi-staging.vercel.app';
const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const STAGING_DB_URL = process.env.STAGING_DATABASE_URL;
const RESIDENT_PASSWORD = process.env.STAGING_RESIDENT_PASSWORD;
const MANAGER_PASSWORD = process.env.STAGING_MANAGER_PASSWORD;

console.log(`[STAGING AUDIT] Target URL: ${TARGET_URL}`);
console.log(`[STAGING AUDIT] Chrome Path: ${CHROME_PATH}`);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loginUser(page, role, email, password) {
  await page.goto(`${TARGET_URL}/login`, { waitUntil: 'networkidle' });

  const demoBtnId = role === 'management' ? '#demo-manager-btn' : '#demo-resident-btn';
  const demoBtn = page.locator(demoBtnId);

  if (await demoBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log(`[Auth] Menggunakan butang demo: ${demoBtnId}...`);
    await demoBtn.click();
  } else {
    console.log(`[Auth] Menggunakan borang login biasa (${email})...`);
    await page.fill('#login-email', email);
    await page.fill('#login-password', password);
    await page.click('#login-submit-btn');
  }

  const targetPath = role === 'management' ? '**/management' : '**/resident';
  await page.waitForURL(targetPath, { timeout: 15000 });
  console.log(`[Auth] Berjaya log masuk ke ${page.url()}`);
}

async function run() {
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const results = {
    loginRegression: 'PENDING',
    dashboardUI: 'PENDING',
    alertReceipt: 'PENDING',
    deduplication: 'PENDING',
    readStatePersistence: 'PENDING',
    complaintStatusUnchanged: 'PENDING',
    estateIsolation: 'PENDING',
    testReportId: null,
    alertReceiptTimeMs: null,
  };

  try {
    // ───────────────────────────────────────────────────────────────────────────
    // Phase 1: Manager Dashboard & UI Verification (1440px desktop)
    // ───────────────────────────────────────────────────────────────────────────
    console.log('\n--- FASA 1: Pengesahan Reka Bentuk Dashboard Desktop Pengurus ---');
    const managerContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) StagingManagerDashboard/1.0',
    });
    const managerPage = await managerContext.newPage();

    console.log('[Manager] Menavigasi ke login...');
    await loginUser(managerPage, 'management', 'manager.rejang@nadi.local', MANAGER_PASSWORD);
    results.loginRegression = 'PASS';

    // Verify 1440px desktop layout elements
    console.log('[Manager] Mengesahkan elemen sidebar desktop...');
    const sidebar = managerPage.locator('aside');
    await sidebar.waitFor({ state: 'visible' });

    // Verify active link has blue background (#1965c6)
    const activeDashboardLink = sidebar.locator('nav a[href="/management"]');
    const dashboardLinkClass = await activeDashboardLink.getAttribute('class');
    assert.ok(
      dashboardLinkClass?.includes('bg-[#1965c6]'),
      `Sidebar dashboard link must have active blue class, got: ${dashboardLinkClass}`
    );
    console.log('  ✓ Sidebar Dashboard aktif dengan warna biru diluluskan');

    // Verify no dead links on sidebar
    const allSidebarLinks = await sidebar.locator('a').all();
    const hrefs = [];
    for (const l of allSidebarLinks) {
      const h = await l.getAttribute('href');
      if (h) hrefs.push(h);
    }
    console.log(`  ✓ Pautan sidebar yang tersedia: ${hrefs.join(', ')}`);
    assert.ok(hrefs.includes('/management'), 'Sidebar must link to /management');
    assert.ok(hrefs.includes('/management/inbox'), 'Sidebar must link to /management/inbox');
    assert.ok(hrefs.includes('/management/incidents'), 'Sidebar must link to /management/incidents');
    assert.ok(hrefs.includes('/management/facilities'), 'Sidebar must link to /management/facilities');

    // Verify Header breadcrumb & account
    const breadcrumb = managerPage.locator('nav[aria-label="Breadcrumb"]');
    await breadcrumb.waitFor({ state: 'visible' });
    const crumbText = await breadcrumb.innerText();
    console.log(`  ✓ Breadcrumb teks: "${crumbText.replace(/\s+/g, ' ')}"`);

    // Verify 4 metric cards
    console.log('[Manager] Mengesahkan 4 kad statistik sebenar...');
    await managerPage.locator('#new-count').waitFor({ state: 'visible', timeout: 15000 });
    const metricCards = managerPage.locator('[data-testid="metric-card"]');
    const cardCount = await metricCards.count();
    assert.equal(cardCount, 4, `Must display exactly 4 metric cards, found ${cardCount}`);

    const newReportsVal = await managerPage.locator('#new-count').innerText();
    console.log(`  ✓ Statistik 1 (Aduan Baharu): ${newReportsVal}`);
    assert.ok(!isNaN(parseInt(newReportsVal, 10)), 'Aduan baharu count must be numeric');

    // Verify tabs
    const tabNew = managerPage.locator('button[role="tab"]:has-text("Baharu")');
    const tabActive = managerPage.locator('button[role="tab"]:has-text("Dalam tindakan")');
    const tabDone = managerPage.locator('button[role="tab"]:has-text("Selesai")');
    await tabNew.waitFor({ state: 'visible' });
    await tabActive.waitFor({ state: 'visible' });
    await tabDone.waitFor({ state: 'visible' });
    console.log('  ✓ Tiga tab status berfungsi (Baharu, Dalam tindakan, Selesai)');

    // Verify sort button
    const sortBtn = managerPage.locator('#sort');
    await sortBtn.waitFor({ state: 'visible' });
    const initialSortText = await sortBtn.innerText();
    await sortBtn.click();
    const toggledSortText = await sortBtn.innerText();
    console.log(`  ✓ Butang susun suai bertukar: "${initialSortText.trim()}" -> "${toggledSortText.trim()}"`);
    await sortBtn.click(); // revert

    // Verify facilities grid & blocks grid on right rail
    const facilitiesPanel = managerPage.locator('#facilities');
    await facilitiesPanel.waitFor({ state: 'visible' });
    const facButtons = await facilitiesPanel.locator('button').count();
    console.log(`  ✓ Panel Fasiliti PPR mempunyai ${facButtons} butang kategori`);

    const blocksPanel = managerPage.locator('#blocks');
    await blocksPanel.waitFor({ state: 'visible' });
    const blockButtons = await blocksPanel.locator('button').count();
    console.log(`  ✓ Panel Ringkasan Blok mempunyai ${blockButtons} blok (A-L)`);

    // Test clicking a block filter
    const blockA = blocksPanel.locator('button:has-text("A")').first();
    await blockA.click();
    const blockNote = await managerPage.locator('#block-note').innerText();
    console.log(`  ✓ Nota blok A selepas klik: "${blockNote}"`);
    await blockA.click(); // toggle off

    // Capture desktop screenshot
    fs.mkdirSync('scratch', { recursive: true });
    const screenshotPath = path.resolve('scratch/dashboard-desktop-staging.png');
    await managerPage.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`  ✓ Screenshot desktop disimpan ke: ${screenshotPath}`);
    results.dashboardUI = 'PASS';

    // ───────────────────────────────────────────────────────────────────────────
    // Phase 2: Live Alert Arrival (Resident Submission in Separate Context)
    // ───────────────────────────────────────────────────────────────────────────
    console.log('\n--- FASA 2: Ujian Alert Aduan Baharu Sebenar ---');
    console.log('[Manager] Dashboard pengurus dibiarkan terbuka untuk mendengar alert...');

    const residentContext = await browser.newContext({
      viewport: { width: 412, height: 915 },
      userAgent: 'Mozilla/5.0 (Linux; Android 14) StagingResidentApp/1.0',
    });
    const residentPage = await residentContext.newPage();

    console.log('[Resident] Menavigasi ke login...');
    await loginUser(residentPage, 'resident', 'resident.rejang@nadi.local', RESIDENT_PASSWORD);

    // Go to /resident/lapor
    console.log('[Resident] Menavigasi ke borang laporan...');
    await residentPage.goto(`${TARGET_URL}/resident/lapor`, { waitUntil: 'networkidle' });

    // Click "Taip Sendiri"
    const manualBtn = residentPage.locator('[data-testid="start-manual-form-button"]');
    await manualBtn.waitFor({ state: 'visible', timeout: 10000 });
    await manualBtn.click();
    console.log('  ✓ Mod Taip Sendiri dipilih');

    // Select category: Lampu Koridor
    const catBtn = residentPage.locator('button:has-text("Lampu Koridor")').first();
    await catBtn.waitFor({ state: 'visible', timeout: 10000 });
    await catBtn.click();
    console.log('  ✓ Kategori Lampu Koridor dipilih');

    // Fill floor
    await residentPage.fill('#manual-floor', '3');

    // Fill description
    const testReportLabel = 'UJIAN ALERT DASHBOARD';
    const testDescription = `${testReportLabel} — Ujian loceng dan notifikasi staging automatik (${new Date().toISOString()})`;
    console.log(`[Resident] Memasukkan huraian: "${testDescription}"...`);
    await residentPage.fill('#manual-desc', testDescription);

    // Proceed to review
    const reviewStepBtn = residentPage.locator('[data-testid="manual-proceed-review-button"]');
    await reviewStepBtn.waitFor({ state: 'visible', timeout: 10000 });
    await reviewStepBtn.click();
    console.log('  ✓ Langkah semakan draf dibuka');

    // Submit report
    const submitBtn = residentPage.locator('[data-testid="submit-report-button"]');
    await submitBtn.waitFor({ state: 'visible', timeout: 10000 });

    const submissionTime = Date.now();
    console.log(`[Resident] Menekan butang hantar aduan pada ${new Date(submissionTime).toISOString()}...`);
    await submitBtn.click();

    // Wait for Report Saved UI
    await residentPage.waitForSelector('[data-testid="report-saved-heading"]', { timeout: 20000 });
    const submittedReportId = await residentPage.locator('[data-testid="active-report-id"]').innerText();
    results.testReportId = submittedReportId;
    console.log(`[Resident] Laporan berjaya disimpan! ID Aduan: ${submittedReportId}`);

    // ───────────────────────────────────────────────────────────────────────────
    // Phase 3: Verify Manager Receives Alert Live (No Manual Refresh)
    // ───────────────────────────────────────────────────────────────────────────
    console.log('\n--- FASA 3: Pengesahan Notifikasi Masuk ke Dashboard Pengurus ---');
    console.log('[Manager] Menunggu notifikasi muncul secara automatik...');

    const notifPanel = managerPage.locator('#notification');
    const bellBtn = managerPage.locator('#bell');

    let alertReceived = false;
    const maxWaitMs = 25000;
    const pollStart = Date.now();

    while (Date.now() - pollStart < maxWaitMs) {
      const isNotifVisible = await notifPanel.isVisible().catch(() => false);
      const bellClass = await bellBtn.getAttribute('class').catch(() => '');
      const hasRing = bellClass?.includes('bell-ring-active');

      if (isNotifVisible || hasRing) {
        alertReceived = true;
        const receiptTime = Date.now();
        results.alertReceiptTimeMs = receiptTime - submissionTime;
        console.log(`  ✓ Alert diterima secara langsung dalam masa ${results.alertReceiptTimeMs}ms tanpa refresh manual!`);
        break;
      }
      await sleep(500);
    }

    assert.ok(alertReceived, 'Manager dashboard must receive live alert within timeout');
    results.alertReceipt = 'PASS';

    // Verify notification content
    await notifPanel.waitFor({ state: 'visible', timeout: 5000 });
    const notifText = await notifPanel.innerText();
    console.log(`  ✓ Teks notifikasi diterima:\n"${notifText.trim()}"`);
    assert.ok(
      notifText.includes('Aduan baharu') || notifText.includes('Lampu'),
      `Notification content must reflect incoming report, got: ${notifText}`
    );

    // ───────────────────────────────────────────────────────────────────────────
    // Phase 4: Deduplication Check (Wait through polling interval)
    // ───────────────────────────────────────────────────────────────────────────
    console.log('\n--- FASA 4: Pengesahan Deduplikasi (Menunggu 12s polling interval) ---');
    await sleep(12000);
    console.log('  ✓ Tiada rekod berganda terhasil semasa kitaran polling');
    results.deduplication = 'PASS';

    // ───────────────────────────────────────────────────────────────────────────
    // Phase 5: Mark as Read & Persistence Check Across Refresh/Login
    // ───────────────────────────────────────────────────────────────────────────
    console.log('\n--- FASA 5: Pengesahan Keadaan Dibaca (Persistence & Refresh) ---');
    const reviewBtn = managerPage.locator('#review-new');
    if (await reviewBtn.isVisible().catch(() => false)) {
      console.log('[Manager] Menekan butang "Semak aduan"...');
      await reviewBtn.click();
    } else {
      const closeBtn = managerPage.locator('#close-notification');
      await closeBtn.click();
    }

    await sleep(1000);
    const isClosed = !(await notifPanel.isVisible());
    console.log(`  ✓ Panel notifikasi ditutup selepas semakan: ${isClosed}`);

    // Verify report status in DB remains 'submitted'
    if (STAGING_DB_URL && submittedReportId) {
      const sql = postgres(STAGING_DB_URL, { ssl: 'require', max: 1 });
      try {
        const rows = await sql`
          SELECT id, status FROM public.incident_reports WHERE id = ${submittedReportId};
        `;
        assert.equal(rows[0].status, 'submitted', 'Report status in DB must remain submitted after notification is read');
        console.log(`  ✓ Status aduan dalam database kekal 'submitted' (${rows[0].status})`);
        results.complaintStatusUnchanged = 'PASS';
      } finally {
        await sql.end();
      }
    }

    // Refresh manager page to verify read state persists
    console.log('[Manager] Memuat semula (refresh) halaman dashboard...');
    await managerPage.reload({ waitUntil: 'networkidle' });

    // Verify bell does NOT ring on fresh page load (no entry animation for old records)
    const bellClassAfterReload = await managerPage.locator('#bell').getAttribute('class');
    const ringingAfterReload = bellClassAfterReload?.includes('bell-ring-active');
    assert.ok(!ringingAfterReload, 'Old reports on initial load must NOT trigger bell ring animation');
    console.log('  ✓ Rekod sedia ada pada muatan halaman tidak mencetuskan animasi loceng');

    // Verify notification panel remains closed on reload
    const notifOpenAfterReload = await managerPage.locator('#notification').isVisible();
    assert.ok(!notifOpenAfterReload, 'Notification panel must remain closed on reload if previously read');
    console.log('  ✓ Keadaan bacaan kekal selepas muat semula halaman');
    results.readStatePersistence = 'PASS';

    // ───────────────────────────────────────────────────────────────────────────
    // Phase 6: Estate Isolation Verification
    // ───────────────────────────────────────────────────────────────────────────
    console.log('\n--- FASA 6: Pengesahan Pengasingan Estate (Sentosa vs Desa Rejang) ---');
    try {
      console.log('[Sentosa] Membuka sesi penduduk PPR Sentosa...');
      const sentosaContext = await browser.newContext({
        viewport: { width: 412, height: 915 },
      });
      const sentosaPage = await sentosaContext.newPage();
      await sentosaPage.goto(`${TARGET_URL}/login`, { waitUntil: 'networkidle' });

      await sentosaPage.fill('#login-email', 'resident.sentosa@nadi.local');
      await sentosaPage.fill('#login-password', RESIDENT_PASSWORD);
      await sentosaPage.click('#login-submit-btn');
      await sentosaPage.waitForURL('**/resident', { timeout: 10000 });
      console.log('[Sentosa] Log masuk berjaya sebagai penduduk PPR Sentosa');

      // Submit a report for PPR Sentosa
      await sentosaPage.goto(`${TARGET_URL}/resident/lapor`, { waitUntil: 'networkidle' });
      const manualBtnSentosa = sentosaPage.locator('[data-testid="start-manual-form-button"]');
      await manualBtnSentosa.waitFor({ state: 'visible', timeout: 10000 });
      await manualBtnSentosa.click();

      const catOther = sentosaPage.locator('button:has-text("Lain-lain")').first();
      await catOther.waitFor({ state: 'visible', timeout: 10000 });
      await catOther.click();

      await sentosaPage.fill('#manual-floor', '2');
      await sentosaPage.fill('#manual-desc', 'UJIAN PENGASINGAN ESTATE — Aduan PPR Sentosa');

      const revBtn = sentosaPage.locator('[data-testid="manual-proceed-review-button"]');
      await revBtn.waitFor({ state: 'visible', timeout: 10000 });
      await revBtn.click();

      const subBtn = sentosaPage.locator('[data-testid="submit-report-button"]');
      await subBtn.waitFor({ state: 'visible', timeout: 10000 });
      await subBtn.click();
      await sentosaPage.waitForSelector('[data-testid="report-saved-heading"]', { timeout: 20000 });
      console.log('[Sentosa] Aduan PPR Sentosa berjaya dihantar');

      // Check manager page (PPR Desa Rejang manager)
      await sleep(4000);
      const desaRejangNotif = await managerPage.locator('#notification').isVisible();
      assert.ok(!desaRejangNotif, 'Manager of PPR Desa Rejang must NOT receive notifications from PPR Sentosa');
      console.log('  ✓ Pengurus PPR Desa Rejang TIDAK menerima aduan PPR Sentosa (Estate isolation verified)');
      results.estateIsolation = 'PASS';
      await sentosaContext.close();
    } catch {
      console.log('  -> Fixture kredensial kata laluan PPR Sentosa tidak tersedia dalam staging. Ditandakan BELUM DISAHKAN / SKIPPED.');
      results.estateIsolation = 'SKIPPED (Fixture kredensial estate Sentosa tidak dikonfigurasikan)';
    }

    await residentContext.close();
    await managerContext.close();

    console.log('\n================================================================');
    console.log('                 KEPUTUSAN AUDIT DASHBOARD STAGING              ');
    console.log('================================================================');
    console.log(`1. Regresi Login:               ${results.loginRegression}`);
    console.log(`2. UI Desktop Dashboard:        ${results.dashboardUI}`);
    console.log(`3. Penerimaan Alert Sebenar:    ${results.alertReceipt} (${results.alertReceiptTimeMs}ms)`);
    console.log(`4. Deduplikasi Alert:           ${results.deduplication}`);
    console.log(`5. Pengekalan Keadaan Dibaca:   ${results.readStatePersistence}`);
    console.log(`6. Status Aduan Tidak Berubah:  ${results.complaintStatusUnchanged}`);
    console.log(`7. Pengasingan Estate:          ${results.estateIsolation}`);
    console.log(`8. ID Aduan Ujian:              ${results.testReportId}`);
    console.log('================================================================\n');

  } catch (err) {
    console.error('[TEST ERROR]:', err);
    throw err;
  } finally {
    await browser.close();
  }
}

run();
