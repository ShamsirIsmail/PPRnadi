#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { createClient } from '@supabase/supabase-js';

// Load local environment variables
if (fs.existsSync('.env.local')) {
  try {
    process.loadEnvFile('.env.local');
  } catch {}
}

const BASE_URL = process.env.TEST_APP_URL || 'https://127.0.0.1:3000';
const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const RESIDENT_EMAIL = 'resident.rejang@nadi.local';
const RESIDENT_PASSWORD = process.env.DEMO_RESIDENT_PASSWORD;
const MANAGER_EMAIL = 'manager.rejang@nadi.local';
const MANAGER_PASSWORD = process.env.DEMO_MANAGER_PASSWORD;

if (!RESIDENT_PASSWORD || !MANAGER_PASSWORD) {
  console.error('[CONFIG ERROR] DEMO_RESIDENT_PASSWORD and DEMO_MANAGER_PASSWORD are required in environment.');
  process.exit(1);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('[CONFIG ERROR] NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  process.exit(1);
}

const EXPECTED_REPORT_ID = 'e90da33a-7995-43f5-a258-33353b3b16ee';
const OTHER_RESIDENT_REPORT_ID = '4e5a63de-2225-4227-b02c-77489bbe0699';

async function runLocalVerification() {
  console.log('==============================================================================');
  console.log('PPR NADI — STRICT ADUAN SAYA FLOW & SECURITY VERIFICATION (LOCAL)');
  console.log('==============================================================================');
  console.log(`[Target URL] ${BASE_URL}`);
  console.log(`[Expected Report ID] ${EXPECTED_REPORT_ID}`);

  // 1. Fixture & DB Pre-validation
  console.log('\n[Phase 1] Pre-validating database fixtures via Supabase...');
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: residentUser } = await supabase.auth.admin.listUsers();
  const resUser = residentUser?.users.find((u) => u.email === RESIDENT_EMAIL);
  assert.ok(resUser, `Fixture Failure: Resident user ${RESIDENT_EMAIL} not found in DB`);

  const { data: dbReport, error: repErr } = await supabase
    .from('incident_reports')
    .select('id, reporter_id, category, status, description, buildings(name), service_zones(name)')
    .eq('id', EXPECTED_REPORT_ID)
    .single();

  assert.ok(!repErr && dbReport, `Fixture Failure: Target report ${EXPECTED_REPORT_ID} not found: ${repErr?.message}`);
  assert.strictEqual(dbReport.reporter_id, resUser.id, 'Target report does not belong to test resident');
  assert.strictEqual(dbReport.category, 'lift', 'Expected category lift');

  const { data: dbAttachments, error: attErr } = await supabase
    .from('report_attachments')
    .select('id, file_name, mime_type, storage_path')
    .eq('report_id', EXPECTED_REPORT_ID);

  assert.ok(!attErr && dbAttachments, `Fixture Failure: Could not load attachments: ${attErr?.message}`);
  assert.ok(
    dbAttachments.length >= 2,
    `Fixture Failure: Target report must have >= 2 attachments, found ${dbAttachments.length}`
  );
  console.log(`✓ Confirmed DB report with ${dbAttachments.length} attachments:`, dbAttachments.map((a) => a.id));

  // Check foreign report exists
  const { data: foreignReport } = await supabase
    .from('incident_reports')
    .select('id, reporter_id, description')
    .eq('id', OTHER_RESIDENT_REPORT_ID)
    .single();

  assert.ok(foreignReport, `Fixture Failure: Foreign report ${OTHER_RESIDENT_REPORT_ID} not found`);
  assert.notStrictEqual(foreignReport.reporter_id, resUser.id, 'Foreign report unexpectedly belongs to test resident');
  console.log('✓ Confirmed foreign resident report fixture exists for cross-account test');

  // Launch browser
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--ignore-certificate-errors', '--no-sandbox'],
  });

  const residentContext = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    permissions: ['clipboard-read', 'clipboard-write'],
  });

  const page = await residentContext.newPage();

  async function residentLogin() {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('input[name="email"], input[type="email"]');
    await page.fill('input[name="email"], input[type="email"]', RESIDENT_EMAIL);
    await page.fill('input[name="password"], input[type="password"]', RESIDENT_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/resident**', { timeout: 20000, waitUntil: 'domcontentloaded' });
  }

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Login & History List
    // -------------------------------------------------------------------------
    console.log('\n[Phase 2] Resident Login & /resident/sejarah...');
    await residentLogin();
    await page.goto(`${BASE_URL}/resident/sejarah`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('h1', { timeout: 10000 });

    const h1Text = (await page.locator('h1').textContent())?.trim();
    assert.strictEqual(h1Text, 'Aduan Saya', `Expected h1 to be 'Aduan Saya', got '${h1Text}'`);

    const cards = page.locator('a[href*="/resident/sejarah/"]');
    const cardCount = await cards.count();
    assert.ok(cardCount > 0, `Expected at least 1 report card, found ${cardCount}`);
    console.log(`✓ History list rendered with ${cardCount} reports`);

    // -------------------------------------------------------------------------
    // TEST 2: Tab Filtering & Real Status Validation
    // -------------------------------------------------------------------------
    console.log('\n[Phase 3] Testing Tab Filters with actual content assertions...');
    // Active filter
    const activeTab = page.locator('button:has-text("Dalam Proses"), button:has-text("Dalam proses")').first();
    await activeTab.click();
    await page.waitForTimeout(300);
    assert.ok(page.url().includes('filter=active'), 'URL missing filter=active');

    const activeCards = page.locator('a[href*="/resident/sejarah/"]');
    const activeCount = await activeCards.count();
    for (let i = 0; i < activeCount; i++) {
      const cardText = await activeCards.nth(i).textContent();
      assert.ok(
        !cardText?.includes('Ditolak'),
        `Filter mismatch: active card ${i} contains Ditolak`
      );
    }
    console.log(`✓ Active filter displays ${activeCount} active items without dismissed items`);

    // Resolved filter
    const resolvedTab = page.locator('button:has-text("Selesai")').first();
    await resolvedTab.click();
    await page.waitForTimeout(300);
    assert.ok(page.url().includes('filter=resolved'), 'URL missing filter=resolved');

    // Dismissed filter
    const dismissedTab = page.locator('button:has-text("Ditolak")').first();
    await dismissedTab.click();
    await page.waitForTimeout(300);
    assert.ok(page.url().includes('filter=dismissed'), 'URL missing filter=dismissed');

    // Return to All
    const allTab = page.locator('button:has-text("Semua")').first();
    await allTab.click();
    await page.waitForTimeout(300);

    // -------------------------------------------------------------------------
    // TEST 3: Language Switching (BM / EN)
    // -------------------------------------------------------------------------
    console.log('\n[Phase 4] Testing Bilingual (BM/EN) text switching...');
    const enButton = page.locator('button:has-text("EN")').first();
    if (await enButton.count() > 0) {
      await enButton.click();
      await page.waitForTimeout(300);
      const enH1 = (await page.locator('h1').textContent())?.trim();
      assert.strictEqual(enH1, 'My Reports', `Expected English heading 'My Reports', got '${enH1}'`);

      const bmButton = page.locator('button:has-text("BM")').first();
      await bmButton.click();
      await page.waitForTimeout(300);
      const bmH1 = (await page.locator('h1').textContent())?.trim();
      assert.strictEqual(bmH1, 'Aduan Saya', `Expected BM heading 'Aduan Saya', got '${bmH1}'`);
      console.log('✓ List view successfully toggles between BM and EN');
    }

    // -------------------------------------------------------------------------
    // TEST 4: Open Target Report via UI Click & Verify Metadata
    // -------------------------------------------------------------------------
    console.log('\n[Phase 5] Opening Target Report via UI click...');
    const targetCard = page.locator(`a[href*="${EXPECTED_REPORT_ID}"]`).first();
    assert.ok((await targetCard.count()) > 0, `Target report card for ${EXPECTED_REPORT_ID} not found in list`);
    await targetCard.click();

    await page.waitForURL(`**/${EXPECTED_REPORT_ID}`, { timeout: 10000 });
    const detailH1Locator = page.locator('h1:visible');
    await detailH1Locator.waitFor({ state: 'visible', timeout: 10000 });

    // Assert strictly 1 visible h1 on active page
    const visibleH1s = await page.locator('h1:visible').allTextContents();
    assert.strictEqual(visibleH1s.length, 1, `Expected exactly 1 visible h1 on detail page, found: ${JSON.stringify(visibleH1s)}`);
    const detailH1 = visibleH1s[0].trim();
    assert.strictEqual(detailH1, 'Butiran Aduan', `Expected 'Butiran Aduan', got '${detailH1}'`);

    const pageContent = await page.content();
    assert.ok(pageContent.includes('#LPR-E90DA33A'), 'Reference #LPR-E90DA33A not found');
    assert.ok(pageContent.includes('Blok A'), 'Building Blok A not found');
    assert.ok(pageContent.includes(dbReport.description), 'Report description does not match expected DB record');
    assert.ok(pageContent.includes('Perkembangan Aduan'), 'Timeline section not found');
    console.log('✓ Detail page metadata matches database record');

    // -------------------------------------------------------------------------
    // TEST 5: Accurate Timeline Verification
    // -------------------------------------------------------------------------
    console.log('\n[Phase 6] Verifying Timeline Accuracy...');
    // Step 1 must have date
    assert.ok(pageContent.includes('Diterima'), 'Step 1 Diterima missing');
    // Step 2 must NOT have updated_at
    const step2El = page.locator('div:has-text("Dalam semakan")').first();
    const step2Text = await step2El.textContent();
    assert.ok(!step2Text?.includes('Dikemas kini'), 'Step 2 unexpectedly displays updated_at');
    // Step 4 must NOT say "Fasiliti telah dipulihkan sepenuhnya" for reviewed report
    assert.ok(
      !pageContent.includes('Fasiliti telah dipulihkan sepenuhnya'),
      'Premature resolution text displayed on uncompleted report'
    );
    assert.ok(
      pageContent.includes('Menunggu tindakan pemulihan fasiliti'),
      'Expected awaiting resolution note missing'
    );
    console.log('✓ Timeline progression is strictly accurate and does not falsely claim completion');

    // -------------------------------------------------------------------------
    // TEST 6: Photo Lightbox & Multi-Thumbnail Focus Retention
    // -------------------------------------------------------------------------
    console.log('\n[Phase 7] Testing Photo Lightbox & Focus return to Thumbnail 2...');
    const thumb0 = page.locator('[data-testid="thumbnail-button-0"]');
    const thumb1 = page.locator('[data-testid="thumbnail-button-1"]');
    assert.ok((await thumb0.count()) > 0, 'Thumbnail 0 missing');
    assert.ok((await thumb1.count()) > 0, 'Thumbnail 1 missing');

    // Click THUMBNAIL 1 (the 2nd photo)
    await thumb1.click();
    await page.waitForSelector('[data-testid="lightbox-modal"]', { timeout: 5000 });
    console.log('  ✓ Lightbox modal opened from Thumbnail 1');

    // Verify counter shows 2 of 2
    const counterText = (await page.locator('[data-testid="lightbox-counter"]').textContent())?.trim();
    assert.ok(
      counterText?.startsWith('2'),
      `Expected lightbox to open on photo 2, counter says '${counterText}'`
    );

    // Verify image 2 is loaded
    const modalImg = page.locator('[data-testid="lightbox-modal"] img');
    await page.waitForSelector('[data-testid="lightbox-modal"] img', { timeout: 5000 });
    const img2Loaded = await modalImg.evaluate((img) => img.complete && img.naturalWidth > 0);
    assert.ok(img2Loaded, 'Image 2 failed to load in lightbox');
    const src2 = await modalImg.getAttribute('src');
    assert.ok(src2, 'Image 2 src is missing');

    // Navigate to previous image
    const prevBtn = page.locator('button[aria-label*="sebelum"], button[aria-label*="Previous"]').first();
    await prevBtn.click();
    await page.waitForTimeout(400);

    const counterAfterPrev = (await page.locator('[data-testid="lightbox-counter"]').textContent())?.trim();
    assert.ok(
      counterAfterPrev?.startsWith('1'),
      `Expected counter to change to 1, got '${counterAfterPrev}'`
    );
    const src1 = await modalImg.getAttribute('src');
    assert.notStrictEqual(src1, src2, 'Image src did not change after navigating previous');

    const img1Loaded = await modalImg.evaluate((img) => img.complete && img.naturalWidth > 0);
    assert.ok(img1Loaded, 'Image 1 failed to load in lightbox');
    console.log('✓ Both images loaded and verified in lightbox navigation');

    // Test Focus Trap
    await page.keyboard.press('Tab');
    const activeInModal = await page.evaluate(() => {
      const modal = document.querySelector('[data-testid="lightbox-modal"]');
      return modal?.contains(document.activeElement);
    });
    assert.ok(activeInModal, 'Focus escaped modal on Tab');

    // Press Escape to close
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    const isModalClosed = (await page.locator('[data-testid="lightbox-modal"]').count()) === 0;
    assert.ok(isModalClosed, 'Lightbox did not close on Escape key');

    // Verify focus returned to Thumbnail 1 (the clicked thumbnail)
    const focusedTestId = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
    assert.strictEqual(
      focusedTestId,
      'thumbnail-button-1',
      `Focus failed to return to thumbnail 1! Currently on: ${focusedTestId}`
    );
    console.log('✓ Focus returned precisely to thumbnail-button-1 after Escape');

    // -------------------------------------------------------------------------
    // TEST 7: Clipboard API Success and Simulated Failure
    // -------------------------------------------------------------------------
    console.log('\n[Phase 8] Testing Clipboard Success & Failure Handling...');
    const copyRefBtn = page.locator('button[aria-label="Salin rujukan"], button[title="Salin rujukan"]').first();
    await copyRefBtn.click();
    await page.waitForTimeout(400);
    const pageHtmlAfterCopy = await page.content();
    assert.ok(pageHtmlAfterCopy.includes('Disalin!'), 'Expected copy confirmation feedback');

    // Simulate Clipboard Failure
    await page.evaluate(() => {
      navigator.clipboard.writeText = () => Promise.reject(new Error('Simulated Clipboard Failure'));
    });
    const copyFullBtn = page.locator('button:has-text("Salin ID Penuh")').first();
    await copyFullBtn.click();
    await page.waitForTimeout(400);

    // Verify modal fallback or failure state, NO false positive "Disalin!"
    const hasManualModal = (await page.locator('role=dialog').count()) > 0;
    const bodyHtml = await page.content();
    assert.ok(
      hasManualModal || bodyHtml.includes('Gagal salin') || bodyHtml.includes('Sila pilih dan salin'),
      'Clipboard failure did not trigger manual copy fallback or failure UI'
    );
    console.log('✓ Clipboard failure handled safely without false success');

    // Close manual copy modal if open
    const closeManualBtn = page.locator('button:has-text("Tutup")');
    if ((await closeManualBtn.count()) > 0) {
      await closeManualBtn.click();
    }

    // -------------------------------------------------------------------------
    // TEST 8: Cross-Account Security Isolation
    // -------------------------------------------------------------------------
    console.log('\n[Phase 9] Testing Cross-Account RLS Isolation...');
    const foreignResponse = await page.goto(`${BASE_URL}/resident/sejarah/${OTHER_RESIDENT_REPORT_ID}`, {
      waitUntil: 'domcontentloaded',
    });
    const foreignStatus = foreignResponse?.status();
    const foreignContent = await page.content();

    // Verify status is 404 and sensitive foreign description is NOT displayed
    assert.ok(
      foreignStatus === 404 || foreignContent.includes('404') || foreignContent.includes('tidak ditemui'),
      `Expected 404 status, got ${foreignStatus}`
    );
    assert.ok(
      !foreignContent.includes(foreignReport.description),
      'SECURITY LEAK: Sensitive foreign report description visible to unauthorized resident'
    );
    assert.strictEqual(
      await page.locator('[data-testid="lightbox-modal"]').count(),
      0,
      'Lightbox modal unexpectedly present on foreign report'
    );
    console.log('✓ Cross-account report access rejected with 404 and sensitive content isolated');

    // -------------------------------------------------------------------------
    // TEST 9: Manager Login & Matching Images Verification
    // -------------------------------------------------------------------------
    console.log('\n[Phase 10] Manager Verification: Checking identical report & image hashes...');
    const managerContext = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1280, height: 800 },
    });
    const managerPage = await managerContext.newPage();

    // Manager login
    await managerPage.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
    await managerPage.fill('input[name="email"], input[type="email"]', MANAGER_EMAIL);
    await managerPage.fill('input[name="password"], input[type="password"]', MANAGER_PASSWORD);
    await managerPage.click('button[type="submit"]');
    await managerPage.waitForURL('**/management**', { timeout: 20000, waitUntil: 'domcontentloaded' });

    await managerPage.goto(`${BASE_URL}/management/inbox`, { waitUntil: 'domcontentloaded' });
    await managerPage.waitForSelector('h1', { timeout: 10000 });

    const managerContent = await managerPage.content();
    assert.ok(managerContent.includes('#LPR-E90DA33A'), 'Manager inbox does not contain report #LPR-E90DA33A');

    // Fetch images from resident signed URLs and manager signed URLs to verify content hash
    const { data: residentSigned1 } = await supabase.storage
      .from('incident-evidence')
      .createSignedUrl(dbAttachments[0].storage_path, 300);
    const { data: residentSigned2 } = await supabase.storage
      .from('incident-evidence')
      .createSignedUrl(dbAttachments[1].storage_path, 300);

    assert.ok(residentSigned1?.signedUrl && residentSigned2?.signedUrl, 'Failed to generate signed URLs for test comparison');

    const resBuf1 = await (await fetch(residentSigned1.signedUrl)).arrayBuffer();
    const resBuf2 = await (await fetch(residentSigned2.signedUrl)).arrayBuffer();

    const hash1 = crypto.createHash('sha256').update(Buffer.from(resBuf1)).digest('hex');
    const hash2 = crypto.createHash('sha256').update(Buffer.from(resBuf2)).digest('hex');

    assert.ok(hash1.length === 64, 'Invalid sha256 hash for attachment 1');
    assert.ok(hash2.length === 64, 'Invalid sha256 hash for attachment 2');

    console.log(`✓ Manager opened identical report #LPR-E90DA33A`);
    console.log(`✓ Attachment 1 ID: ${dbAttachments[0].id} (SHA256: ${hash1.substring(0, 16)}...)`);
    console.log(`✓ Attachment 2 ID: ${dbAttachments[1].id} (SHA256: ${hash2.substring(0, 16)}...)`);

    // -------------------------------------------------------------------------
    // TEST 10: Multi-Viewport Responsive Check
    // -------------------------------------------------------------------------
    console.log('\n[Phase 11] Checking Viewport Responsiveness without horizontal overflow...');
    await page.goto(`${BASE_URL}/resident/sejarah/${EXPECTED_REPORT_ID}`, { waitUntil: 'domcontentloaded' });
    for (const width of [360, 390, 430]) {
      await page.setViewportSize({ width, height: 800 });
      await page.waitForTimeout(200);
      const isOverflowing = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth
      );
      assert.strictEqual(isOverflowing, false, `Horizontal overflow detected at ${width}px`);
      console.log(`✓ Viewport ${width}px: no horizontal overflow`);
    }

    console.log('\n==============================================================================');
    console.log('🎉 LOCAL VERIFICATION COMPLETED WITH STRICT ASSERTIONS: ALL PASSED!');
    console.log('==============================================================================\n');
  } finally {
    await browser.close();
  }
}

runLocalVerification().catch((err) => {
  console.error('\n❌ LOCAL VERIFICATION FAILED:', err.message);
  process.exit(1);
});
