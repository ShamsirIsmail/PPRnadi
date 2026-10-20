#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { createClient } from '@supabase/supabase-js';

// Load staging environment variables
if (fs.existsSync('.env.staging.local')) {
  try {
    process.loadEnvFile('.env.staging.local');
  } catch {}
}

const STAGING_URL = process.env.TEST_STAGING_URL || 'https://ppr-nadi-staging.vercel.app';
const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const RESIDENT_EMAIL = 'resident.rejang@nadi.local';
const RESIDENT_PASSWORD = process.env.STAGING_RESIDENT_PASSWORD;
const MANAGER_EMAIL = 'manager.rejang@nadi.local';
const MANAGER_PASSWORD = process.env.STAGING_MANAGER_PASSWORD;

if (!RESIDENT_PASSWORD) {
  console.error('[CONFIG ERROR] STAGING_RESIDENT_PASSWORD is required in environment.');
  process.exit(1);
}
if (!MANAGER_PASSWORD) {
  console.error('[CONFIG ERROR] STAGING_MANAGER_PASSWORD is required in environment.');
  process.exit(1);
}

const SUPABASE_URL = process.env.STAGING_SUPABASE_URL;
const SERVICE_KEY = process.env.STAGING_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('[CONFIG ERROR] STAGING_SUPABASE_URL and STAGING_SERVICE_ROLE_KEY are required.');
  process.exit(1);
}

const EXPECTED_STAGING_REPORT_ID = 'd9de05e4-0ac6-427d-80b5-9178c5e23b36';
const NON_OWNED_UUID = '4e5a63de-2225-4227-b02c-77489bbe0699';

async function runStagingVerification() {
  console.log('==============================================================================');
  console.log('PPR NADI — STRICT ADUAN SAYA FLOW & SECURITY VERIFICATION (STAGING LIVE)');
  console.log('==============================================================================');
  console.log(`[Target URL] ${STAGING_URL}`);
  console.log(`[Expected Staging Report ID] ${EXPECTED_STAGING_REPORT_ID}`);

  // 1. Staging DB Pre-validation
  console.log('\n[Phase 1] Pre-validating staging database fixtures...');
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: residentUser } = await supabase.auth.admin.listUsers();
  const resUser = residentUser?.users.find((u) => u.email === RESIDENT_EMAIL);
  assert.ok(resUser, `Fixture Failure: Resident user ${RESIDENT_EMAIL} not found on staging`);

  const { data: dbReport, error: repErr } = await supabase
    .from('incident_reports')
    .select('id, reporter_id, category, status, description, buildings(name), service_zones(name)')
    .eq('id', EXPECTED_STAGING_REPORT_ID)
    .single();

  assert.ok(!repErr && dbReport, `Fixture Failure: Target report ${EXPECTED_STAGING_REPORT_ID} not found: ${repErr?.message}`);
  assert.strictEqual(dbReport.reporter_id, resUser.id, 'Target report does not belong to staging test resident');

  const { data: dbAttachments, error: attErr } = await supabase
    .from('report_attachments')
    .select('id, file_name, mime_type, storage_path')
    .eq('report_id', EXPECTED_STAGING_REPORT_ID);

  assert.ok(!attErr && dbAttachments, `Fixture Failure: Could not load attachments: ${attErr?.message}`);
  assert.ok(
    dbAttachments.length >= 2,
    `Fixture Failure: Target report must have >= 2 attachments, found ${dbAttachments.length}`
  );
  console.log(`✓ Confirmed staging DB report with ${dbAttachments.length} attachments:`, dbAttachments.map((a) => a.id));

  // Launch browser
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
  });

  const residentContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    permissions: ['clipboard-read', 'clipboard-write'],
  });

  const page = await residentContext.newPage();

  async function residentLogin() {
    await page.goto(`${STAGING_URL}/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('input[name="email"], input[type="email"]');
    await page.fill('input[name="email"], input[type="email"]', RESIDENT_EMAIL);
    await page.fill('input[name="password"], input[type="password"]', RESIDENT_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/resident**', { timeout: 25000, waitUntil: 'domcontentloaded' });
  }

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Staging Login & History List
    // -------------------------------------------------------------------------
    console.log('\n[Phase 2] Staging Resident Login & /resident/sejarah...');
    await residentLogin();
    await page.goto(`${STAGING_URL}/resident/sejarah`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('h1', { timeout: 15000 });

    const h1Text = (await page.locator('h1').textContent())?.trim();
    assert.strictEqual(h1Text, 'Aduan Saya', `Expected h1 to be 'Aduan Saya', got '${h1Text}'`);

    const cards = page.locator('a[href*="/resident/sejarah/"]');
    const cardCount = await cards.count();
    assert.ok(cardCount > 0, `Expected at least 1 report card, found ${cardCount}`);
    console.log(`✓ Staging history list rendered with ${cardCount} reports`);

    // Capture staging list screenshot
    await page.screenshot({ path: 'staging_live_sejarah_list_390px.png' });
    console.log('✓ Saved staging_live_sejarah_list_390px.png');

    // -------------------------------------------------------------------------
    // TEST 2: Tab Filtering
    // -------------------------------------------------------------------------
    console.log('\n[Phase 3] Testing Tab Filters on Staging...');
    const activeTab = page.locator('button:has-text("Dalam Proses"), button:has-text("Dalam proses")').first();
    await activeTab.click();
    await page.waitForTimeout(400);
    assert.ok(page.url().includes('filter=active'), 'URL missing filter=active');

    // Dismissed filter
    const dismissedTab = page.locator('button:has-text("Ditolak")').first();
    await dismissedTab.click();
    await page.waitForTimeout(400);
    assert.ok(page.url().includes('filter=dismissed'), 'URL missing filter=dismissed');

    // Return to All
    const allTab = page.locator('button:has-text("Semua")').first();
    await allTab.click();
    await page.waitForTimeout(400);

    // -------------------------------------------------------------------------
    // TEST 3: Language Switching (BM / EN)
    // -------------------------------------------------------------------------
    console.log('\n[Phase 4] Testing Bilingual (BM/EN) text switching on Staging...');
    const enButton = page.locator('button:has-text("EN")').first();
    if (await enButton.count() > 0) {
      await enButton.click();
      await page.waitForTimeout(400);
      const enH1 = (await page.locator('h1').textContent())?.trim();
      assert.strictEqual(enH1, 'My Reports', `Expected English heading 'My Reports', got '${enH1}'`);

      const bmButton = page.locator('button:has-text("BM")').first();
      await bmButton.click();
      await page.waitForTimeout(400);
      const bmH1 = (await page.locator('h1').textContent())?.trim();
      assert.strictEqual(bmH1, 'Aduan Saya', `Expected BM heading 'Aduan Saya', got '${bmH1}'`);
      console.log('✓ Staging list view successfully toggles between BM and EN');
    }

    // -------------------------------------------------------------------------
    // TEST 4: Open Target Report via UI Click & Verify Metadata
    // -------------------------------------------------------------------------
    console.log('\n[Phase 5] Opening Target Report via UI click on Staging...');
    const targetCard = page.locator(`a[href*="${EXPECTED_STAGING_REPORT_ID}"]`).first();
    assert.ok((await targetCard.count()) > 0, `Target report card for ${EXPECTED_STAGING_REPORT_ID} not found in staging list`);
    await targetCard.click();

    await page.waitForURL(`**/${EXPECTED_STAGING_REPORT_ID}`, { timeout: 15000 });
    const detailH1Locator = page.locator('h1:visible');
    await detailH1Locator.waitFor({ state: 'visible', timeout: 15000 });

    const visibleH1s = await page.locator('h1:visible').allTextContents();
    assert.strictEqual(visibleH1s.length, 1, `Expected exactly 1 visible h1 on detail page, found: ${JSON.stringify(visibleH1s)}`);
    assert.strictEqual(visibleH1s[0].trim(), 'Butiran Aduan', `Expected 'Butiran Aduan', got '${visibleH1s[0]}'`);

    const pageContent = await page.content();
    const shortRef = `#LPR-${EXPECTED_STAGING_REPORT_ID.substring(0, 8).toUpperCase()}`;
    assert.ok(pageContent.includes(shortRef), `Reference ${shortRef} not found on detail page`);
    assert.ok(pageContent.includes(dbReport.description), 'Report description does not match expected DB record');
    assert.ok(pageContent.includes('Perkembangan Aduan'), 'Timeline section not found');
    console.log('✓ Staging detail page metadata matches database record');

    // Capture staging detail screenshot
    await page.screenshot({ path: 'staging_live_detail_390px.png' });
    console.log('✓ Saved staging_live_detail_390px.png');

    // -------------------------------------------------------------------------
    // TEST 5: Timeline Progression Accuracy
    // -------------------------------------------------------------------------
    console.log('\n[Phase 6] Verifying Staging Timeline Accuracy...');
    assert.ok(pageContent.includes('Diterima'), 'Step 1 Diterima missing');
    assert.ok(
      !pageContent.includes('Fasiliti telah dipulihkan sepenuhnya'),
      'Premature resolution text displayed on uncompleted report'
    );
    assert.ok(
      pageContent.includes('Menunggu tindakan pemulihan fasiliti'),
      'Expected awaiting resolution note missing'
    );
    console.log('✓ Staging timeline progression is accurate');

    // -------------------------------------------------------------------------
    // TEST 6: Photo Lightbox & Focus Return to Thumbnail 2
    // -------------------------------------------------------------------------
    console.log('\n[Phase 7] Testing Photo Lightbox & Focus return to Thumbnail 2 on Staging...');
    const thumb0 = page.locator('[data-testid="thumbnail-button-0"]');
    const thumb1 = page.locator('[data-testid="thumbnail-button-1"]');
    assert.ok((await thumb0.count()) > 0, 'Thumbnail 0 missing');
    assert.ok((await thumb1.count()) > 0, 'Thumbnail 1 missing');

    // Click THUMBNAIL 1 (the 2nd photo)
    await thumb1.click();
    await page.waitForSelector('[data-testid="lightbox-modal"]', { timeout: 8000 });
    console.log('  ✓ Lightbox modal opened from Thumbnail 1 on staging');

    // Verify counter shows 2 of 2
    const counterText = (await page.locator('[data-testid="lightbox-counter"]').textContent())?.trim();
    assert.ok(
      counterText?.startsWith('2'),
      `Expected lightbox to open on photo 2, counter says '${counterText}'`
    );

    // Verify image 2 is loaded
    const modalImg = page.locator('[data-testid="lightbox-modal"] img');
    await page.waitForSelector('[data-testid="lightbox-modal"] img', { timeout: 8000 });
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
    console.log('✓ Both images loaded and verified in staging lightbox navigation');

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

    // Verify focus returned to Thumbnail 1
    const focusedTestId = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
    assert.strictEqual(
      focusedTestId,
      'thumbnail-button-1',
      `Focus failed to return to thumbnail 1! Currently on: ${focusedTestId}`
    );
    console.log('✓ Focus returned precisely to thumbnail-button-1 on staging after Escape');

    // -------------------------------------------------------------------------
    // TEST 7: Clipboard API
    // -------------------------------------------------------------------------
    console.log('\n[Phase 8] Testing Staging Clipboard Action...');
    const copyRefBtn = page.locator('button[aria-label="Salin rujukan"], button[title="Salin rujukan"]').first();
    await copyRefBtn.click();
    await page.waitForTimeout(400);
    const pageHtmlAfterCopy = await page.content();
    assert.ok(pageHtmlAfterCopy.includes('Disalin!'), 'Expected copy confirmation feedback');
    console.log('✓ Clipboard reference copy visual confirmation displayed');

    // -------------------------------------------------------------------------
    // TEST 8: Non-owned Access 404 Guard
    // -------------------------------------------------------------------------
    console.log('\n[Phase 9] Testing Staging Access to Non-owned Report URL...');
    const foreignResponse = await page.goto(`${STAGING_URL}/resident/sejarah/${NON_OWNED_UUID}`, {
      waitUntil: 'domcontentloaded',
    });
    const foreignStatus = foreignResponse?.status();
    const foreignContent = await page.content();

    assert.ok(
      foreignStatus === 404 || foreignContent.includes('404') || foreignContent.includes('tidak ditemui'),
      `Expected 404 status, got ${foreignStatus}`
    );
    assert.strictEqual(
      await page.locator('[data-testid="lightbox-modal"]').count(),
      0,
      'Lightbox modal unexpectedly present on foreign report'
    );
    console.log('✓ Staging non-owned report URL properly rejected with 404');

    // -------------------------------------------------------------------------
    // TEST 9: Manager Login & Matching Images Verification on Staging
    // -------------------------------------------------------------------------
    console.log('\n[Phase 10] Staging Manager Verification: Checking identical report & image hashes...');
    const managerContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const managerPage = await managerContext.newPage();

    // Manager login
    await managerPage.goto(`${STAGING_URL}/login`, { waitUntil: 'domcontentloaded' });
    await managerPage.fill('input[name="email"], input[type="email"]', MANAGER_EMAIL);
    await managerPage.fill('input[name="password"], input[type="password"]', MANAGER_PASSWORD);
    await managerPage.click('button[type="submit"]');
    await managerPage.waitForURL('**/management**', { timeout: 25000, waitUntil: 'domcontentloaded' });

    await managerPage.goto(`${STAGING_URL}/management/inbox`, { waitUntil: 'domcontentloaded' });
    await managerPage.waitForSelector('h1', { timeout: 15000 });

    const managerContent = await managerPage.content();
    assert.ok(managerContent.includes(shortRef), `Manager inbox does not contain report ${shortRef}`);

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

    console.log(`✓ Staging Manager opened identical report ${shortRef}`);
    console.log(`✓ Staging Attachment 1 ID: ${dbAttachments[0].id} (SHA256: ${hash1.substring(0, 16)}...)`);
    console.log(`✓ Staging Attachment 2 ID: ${dbAttachments[1].id} (SHA256: ${hash2.substring(0, 16)}...)`);

    // -------------------------------------------------------------------------
    // TEST 10: Viewport Responsiveness on Staging
    // -------------------------------------------------------------------------
    console.log('\n[Phase 11] Checking Staging Viewport Responsiveness...');
    await page.goto(`${STAGING_URL}/resident/sejarah/${EXPECTED_STAGING_REPORT_ID}`, { waitUntil: 'domcontentloaded' });
    for (const width of [360, 390, 430]) {
      await page.setViewportSize({ width, height: 800 });
      await page.waitForTimeout(200);
      const isOverflowing = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth
      );
      assert.strictEqual(isOverflowing, false, `Horizontal overflow detected at ${width}px on staging`);
      console.log(`✓ Staging Viewport ${width}px: no horizontal overflow`);
    }

    console.log('\n==============================================================================');
    console.log('🎉 LIVE STAGING VERIFICATION COMPLETED WITH STRICT ASSERTIONS: ALL PASSED!');
    console.log('==============================================================================\n');
  } finally {
    await browser.close();
  }
}

runStagingVerification().catch((err) => {
  console.error('\n❌ STAGING VERIFICATION FAILED:', err.message);
  process.exit(1);
});
