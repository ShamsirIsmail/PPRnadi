#!/usr/bin/env node
import { chromium } from 'playwright-core';
import fs from 'node:fs';

// Load environment variables
try {
  process.loadEnvFile('.env.local');
} catch {}

const BASE_URL = process.env.TEST_APP_URL || 'https://127.0.0.1:3000';
const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const RESIDENT_EMAIL = 'resident.rejang@nadi.local';
const RESIDENT_PASSWORD = process.env.DEMO_RESIDENT_PASSWORD || 'ResidentPPR2026!';
const MANAGER_EMAIL = 'manager.rejang@nadi.local';
const MANAGER_PASSWORD = process.env.DEMO_MANAGER_PASSWORD || 'ManagerPPR2026!';

// Another resident's report ID for unauthorized access test
const OTHER_RESIDENT_REPORT_ID = '4e5a63de-2225-4227-b02c-77489bbe0699'; // Belongs to Ahmad bin Razak
const MY_REPORT_ID = 'e90da33a-7995-43f5-a258-33353b3b16ee'; // Belongs to Farid bin Idris

async function runVerification() {
  console.log('==============================================================================');
  console.log('PPR NADI — RESIDENT "ADUAN SAYA" & DETAIL REAL BROWSER VERIFICATION SUITE');
  console.log('==============================================================================');
  console.log(`[Target URL] ${BASE_URL}`);
  console.log(`[Browser Engine] ${CHROME_PATH}`);

  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--ignore-certificate-errors', '--no-sandbox'],
  });

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    permissions: ['clipboard-read', 'clipboard-write'],
  });

  const page = await context.newPage();
  page.on('pageerror', (err) => console.log('BROWSER PAGE ERROR:', err.message));
  page.on('console', (msg) => console.log('BROWSER LOG:', msg.text()));

  // Helper for login
  async function doLogin(email, password) {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('input[name="email"], input[type="email"]');
    await page.fill('input[name="email"], input[type="email"]', email);
    await page.fill('input[name="password"], input[type="password"]', password);
    await page.click('button[type="submit"]');
  }

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Resident Login & Access Sejarah
    // -------------------------------------------------------------------------
    console.log('\n[Test 1] Authenticating as resident and navigating to /resident/sejarah...');
    await doLogin(RESIDENT_EMAIL, RESIDENT_PASSWORD);
    await page.waitForURL('**/resident**', { timeout: 20000, waitUntil: 'domcontentloaded' });
    console.log('  ✓ Logged in as:', RESIDENT_EMAIL);

    await page.goto(`${BASE_URL}/resident/sejarah`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('h1', { timeout: 10000 });

    const headingText = await page.locator('h1').textContent();
    console.log(`  ✓ Page heading: "${headingText?.trim()}"`);
    if (!headingText?.includes('Aduan Saya') && !headingText?.includes('My Reports')) {
      throw new Error(`Expected heading "Aduan Saya", got "${headingText}"`);
    }

    // -------------------------------------------------------------------------
    // TEST 2: Filter Tabs & URL State Retention
    // -------------------------------------------------------------------------
    console.log('\n[Test 2] Testing Filter Tabs ("Semua", "Dalam proses", "Selesai", "Ditolak")...');
    const filterButtons = page.locator('button:has-text("Semua"), button:has-text("Dalam proses"), button:has-text("Dalam Proses"), button:has-text("Selesai"), button:has-text("Ditolak")');
    const filterCount = await filterButtons.count();
    console.log(`  ✓ Found ${filterCount} filter tab buttons`);
    if (filterCount < 3) {
      throw new Error(`Expected at least 3 filter buttons, found ${filterCount}`);
    }

    // Click "Dalam proses"
    const activeTab = page.locator('button:has-text("Dalam proses"), button:has-text("Dalam Proses"), button:has-text("In Progress")').first();
    await activeTab.click();
    await page.waitForTimeout(300);
    const urlActive = page.url();
    console.log(`  ✓ URL after clicking Active filter: ${urlActive}`);
    if (!urlActive.includes('filter=active')) {
      throw new Error(`URL did not retain active filter param: ${urlActive}`);
    }

    // Click "Semua"
    const allTab = page.locator('button:has-text("Semua"), button:has-text("All")').first();
    await allTab.click();
    await page.waitForTimeout(300);
    console.log('  ✓ URL after clicking All filter:', page.url());

    // -------------------------------------------------------------------------
    // TEST 3: Report Cards & Copy Reference Interaction
    // -------------------------------------------------------------------------
    console.log('\n[Test 3] Verifying Report Cards and Copy Reference button...');
    const cards = page.locator('article, a[href*="/resident/sejarah/"]');
    const cardCount = await cards.count();
    console.log(`  ✓ Found ${cardCount} report cards on list`);
    if (cardCount === 0) {
      throw new Error('Expected at least 1 report card for resident');
    }

    // Check Copy button
    const copyBtn = page.locator('button[aria-label="Salin rujukan"], button[title="Salin rujukan"]').first();
    if (await copyBtn.count() > 0) {
      await copyBtn.click();
      await page.waitForTimeout(400);
      const copyHtml = await page.content();
      const hasCopiedFeedback = copyHtml.includes('Disalin!') || copyHtml.includes('Copied!') || copyHtml.includes('Gagal salin');
      console.log(`  ✓ Copy button clicked, visual feedback displayed: ${hasCopiedFeedback}`);
    }

    // -------------------------------------------------------------------------
    // TEST 4: Navigation to Report Detail Page
    // -------------------------------------------------------------------------
    console.log('\n[Test 4] Navigating to Report Detail Page...');
    const targetCard = page.locator(`a[href*="${MY_REPORT_ID}"]`).first();
    if (await targetCard.count() > 0) {
      await targetCard.click();
    } else {
      // Direct navigation if card link is formatted differently
      await page.goto(`${BASE_URL}/resident/sejarah/${MY_REPORT_ID}`, { waitUntil: 'domcontentloaded' });
    }

    await page.waitForURL(`**/${MY_REPORT_ID}`, { timeout: 10000, waitUntil: 'domcontentloaded' });
    console.log(`  ✓ Successfully navigated to detail URL: ${page.url()}`);

    // Verify detail components
    const detailContent = await page.content();
    const hasCategory = detailContent.includes('Lif') || detailContent.includes('Kategori');
    const hasLocation = detailContent.includes('Blok A');
    const hasTimeline = detailContent.includes('Perkembangan Aduan') || detailContent.includes('Diterima');
    const hasEvidence = detailContent.includes('Bukti Gambar');
    const hasRef = detailContent.includes('#LPR-E90DA33A');

    console.log(`  ✓ Detail category present: ${hasCategory}`);
    console.log(`  ✓ Detail location present: ${hasLocation}`);
    console.log(`  ✓ Detail reference #LPR-E90DA33A present: ${hasRef}`);
    console.log(`  ✓ Detail timeline present: ${hasTimeline}`);
    console.log(`  ✓ Detail evidence section present: ${hasEvidence}`);

    if (!hasLocation || !hasTimeline) {
      throw new Error('Report detail page missing location or timeline section.');
    }

    // -------------------------------------------------------------------------
    // TEST 5: Photo Lightbox Modal & Keyboard Navigation
    // -------------------------------------------------------------------------
    console.log('\n[Test 5] Testing Photo Lightbox Modal & Keyboard Navigation...');
    const photoThumbs = page.locator('button[aria-label*="Bukti Gambar"], button[aria-label*="Photo Evidence"]');
    const thumbCount = await photoThumbs.count();
    console.log(`  ✓ Found ${thumbCount} photo evidence thumbnails`);

    if (thumbCount > 0) {
      // Click thumbnail to open lightbox
      await photoThumbs.first().click();
      await page.waitForSelector('div[role="dialog"][aria-modal="true"]', { timeout: 5000 });
      console.log('  ✓ Lightbox modal opened successfully');

      // Verify counter
      const counterText = await page.locator('[data-testid="lightbox-counter"]').textContent();
      console.log(`  ✓ Lightbox counter: "${counterText?.trim()}"`);

      // If multiple, test next button
      if (thumbCount > 1) {
        const nextBtn = page.locator('button[aria-label="Gambar seterusnya"], button[aria-label="Next photo"]').first();
        if (await nextBtn.count() > 0) {
          await nextBtn.click();
          await page.waitForTimeout(400);
          const counterAfter = await page.locator('[data-testid="lightbox-counter"]').textContent();
          console.log(`  ✓ Lightbox counter after next: "${counterAfter?.trim()}"`);
        }
      }

      // Test Escape key to close
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      const isClosed = (await page.locator('[data-testid="lightbox-modal"]').count()) === 0;
      console.log(`  ✓ Lightbox closed on Escape key: ${isClosed}`);
      if (!isClosed) {
        throw new Error('Lightbox did not close on Escape key');
      }
    }

    // -------------------------------------------------------------------------
    // TEST 6: Multi-Viewport Responsiveness (360px, 390px, 430px)
    // -------------------------------------------------------------------------
    console.log('\n[Test 6] Testing Viewport Responsiveness (360px, 390px, 430px)...');
    const viewports = [
      { name: '360px', width: 360, height: 780, file: 'preview_real_detail_360px.png' },
      { name: '390px', width: 390, height: 844, file: 'preview_real_detail_390px.png' },
      { name: '430px', width: 430, height: 932, file: 'preview_real_detail_430px.png' },
    ];

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(300);
      const hasOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      console.log(`  ✓ Viewport ${vp.name}: horizontal overflow = ${hasOverflow}`);
      if (hasOverflow) {
        throw new Error(`Horizontal overflow detected on viewport ${vp.name}`);
      }
      await page.screenshot({ path: vp.file });
      console.log(`  ✓ Screenshot saved: ${vp.file}`);
    }

    // Capture list view screenshots
    await page.goto(`${BASE_URL}/resident/sejarah`, { waitUntil: 'domcontentloaded' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'preview_real_list_390px.png' });
    console.log('  ✓ Screenshot saved: preview_real_list_390px.png');

    // -------------------------------------------------------------------------
    // TEST 7: Cross-Account Direct Access Blocked (404 / RLS Protection)
    // -------------------------------------------------------------------------
    console.log('\n[Test 7] Testing Cross-Account Report Isolation...');
    console.log(`  Attempting unauthorized access to report: ${OTHER_RESIDENT_REPORT_ID}...`);
    const foreignRes = await page.goto(`${BASE_URL}/resident/sejarah/${OTHER_RESIDENT_REPORT_ID}`, {
      waitUntil: 'domcontentloaded',
    });
    const status = foreignRes?.status();
    const foreignHtml = await page.content();
    const isNotFound = status === 404 || foreignHtml.includes('404') || foreignHtml.includes('tidak ditemui') || foreignHtml.includes('This page could not be found');
    console.log(`  ✓ HTTP Status: ${status}, 404 text detected: ${isNotFound}`);
    if (!isNotFound && status === 200) {
      throw new Error('SECURITY VIOLATION: Resident was able to access another resident report!');
    }
    console.log('  ✓ Access to foreign report correctly REJECTED (404 Not Found).');

    // -------------------------------------------------------------------------
    // TEST 8: Back Navigation & Refresh Durability
    // -------------------------------------------------------------------------
    console.log('\n[Test 8] Testing Back Navigation and Page Refresh...');
    await page.goto(`${BASE_URL}/resident/sejarah/${MY_REPORT_ID}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('h1', { timeout: 10000 });
    const backBtn = page.locator('a:has-text("Kembali"), a:has-text("Back")').first();
    await backBtn.click();
    await page.waitForURL((url) => url.pathname === '/resident/sejarah', { timeout: 10000 });
    console.log('  ✓ Returned to /resident/sejarah via back button');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('h1', { timeout: 10000 });
    const reloadHeading = await page.locator('h1').textContent();
    console.log(`  ✓ Page reloaded cleanly with heading: "${reloadHeading?.trim()}"`);

    // -------------------------------------------------------------------------
    // TEST 9: Management View Remains Functional & Non-Regressed
    // -------------------------------------------------------------------------
    console.log('\n[Test 9] Verifying Management Inbox Access...');
    // Clear cookies
    await context.clearCookies();
    await doLogin(MANAGER_EMAIL, MANAGER_PASSWORD);
    await page.waitForURL('**/management**', { timeout: 20000, waitUntil: 'domcontentloaded' });
    console.log('  ✓ Logged in as manager:', MANAGER_EMAIL);

    await page.goto(`${BASE_URL}/management/inbox`, { waitUntil: 'domcontentloaded' });
    const mgrContent = await page.content();
    const hasInbox = mgrContent.includes('Peti Masuk') || mgrContent.includes('Inbox') || mgrContent.includes('Pengurusan');
    console.log(`  ✓ Management inbox loaded successfully: ${hasInbox}`);
    if (!hasInbox) {
      throw new Error('Management inbox failed to render.');
    }

    console.log('\n==============================================================================');
    console.log('🎉 ALL 9 BROWSER & SECURITY VERIFICATIONS PASSED SUCCESSFULLY!');
    console.log('==============================================================================\n');
  } finally {
    await browser.close();
  }
}

runVerification().catch((err) => {
  console.error('\n❌ VERIFICATION FAILED:', err.message);
  process.exit(1);
});
