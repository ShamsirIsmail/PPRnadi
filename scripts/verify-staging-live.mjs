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

const TARGET_REPORT_ID = 'd9de05e4-0ac6-427d-80b5-9178c5e23b36';
const EXPECTED_ATTACHMENT_1_ID = '47b94966-5808-4b13-bef7-5ebe620c2c2d';
const EXPECTED_ATTACHMENT_2_ID = '98ee1829-1650-4213-8aa5-d73d75763208';
const NON_OWNED_UUID = '4e5a63de-2225-4227-b02c-77489bbe0699';

// Tracking status outcomes
const auditResults = {
  pass: [],
  fail: [],
  skipped: [],
  notExercised: [],
};

function recordPass(testName, details) {
  auditResults.pass.push({ testName, details });
  console.log(`  ✓ [PASS] ${testName}: ${details}`);
}

function recordNotExercised(testName, reason) {
  auditResults.notExercised.push({ testName, reason });
  console.log(`  ⚠️ [NOT EXERCISED] ${testName}: ${reason}`);
}

function recordSkipped(testName, reason) {
  auditResults.skipped.push({ testName, reason });
  console.log(`  ⚪ [SKIPPED] ${testName}: ${reason}`);
}

async function runStagingLiveVerification() {
  console.log('==============================================================================');
  console.log('PPR NADI — STRICT LIVE STAGING UI & IMAGE SHA-256 VERIFICATION');
  console.log('==============================================================================');
  console.log(`Target URL: ${STAGING_URL}`);
  console.log(`Target Report ID: ${TARGET_REPORT_ID}`);
  console.log(`Attachment 1 ID: ${EXPECTED_ATTACHMENT_1_ID}`);
  console.log(`Attachment 2 ID: ${EXPECTED_ATTACHMENT_2_ID}`);

  // -------------------------------------------------------------------------
  // 1. Staging DB Pre-validation (Service-role strictly for fixture reading)
  // -------------------------------------------------------------------------
  console.log('\n[Phase 1] Pre-validating staging database fixtures...');
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: usersData } = await supabase.auth.admin.listUsers();
  const residentUser = usersData?.users.find((u) => u.email === RESIDENT_EMAIL);
  assert.ok(residentUser, `Fixture Failure: Resident ${RESIDENT_EMAIL} not found on staging DB`);

  const { data: dbReport, error: repErr } = await supabase
    .from('incident_reports')
    .select('id, reporter_id, category, status, description, buildings(name), service_zones(name)')
    .eq('id', TARGET_REPORT_ID)
    .single();

  assert.ok(!repErr && dbReport, `Fixture Failure: Target report ${TARGET_REPORT_ID} not found: ${repErr?.message}`);
  assert.strictEqual(dbReport.reporter_id, residentUser.id, 'Target report does not belong to test resident');

  // Load all reports belonging to resident to calculate expected ID sets for tab filtering
  const { data: allResidentReports } = await supabase
    .from('incident_reports')
    .select('id, status')
    .eq('reporter_id', residentUser.id);

  const expectedAllIds = (allResidentReports || []).map((r) => r.id).sort();
  const expectedActiveIds = (allResidentReports || [])
    .filter((r) => ['submitted', 'reviewed', 'linked'].includes(r.status))
    .map((r) => r.id)
    .sort();
  const expectedResolvedIds = (allResidentReports || [])
    .filter((r) => r.status === 'resolved')
    .map((r) => r.id)
    .sort();
  const expectedDismissedIds = (allResidentReports || [])
    .filter((r) => r.status === 'dismissed')
    .map((r) => r.id)
    .sort();

  // Load target report attachments
  const { data: dbAttachments, error: attErr } = await supabase
    .from('report_attachments')
    .select('id, file_name, mime_type, storage_path')
    .eq('report_id', TARGET_REPORT_ID);

  assert.ok(!attErr && dbAttachments, `Fixture Failure: Attachments error: ${attErr?.message}`);
  assert.strictEqual(dbAttachments.length, 2, `Expected exactly 2 attachments, found ${dbAttachments.length}`);

  const dbAtt1 = dbAttachments.find((a) => a.id === EXPECTED_ATTACHMENT_1_ID);
  const dbAtt2 = dbAttachments.find((a) => a.id === EXPECTED_ATTACHMENT_2_ID);
  assert.ok(dbAtt1, `Attachment 1 (${EXPECTED_ATTACHMENT_1_ID}) not found in DB`);
  assert.ok(dbAtt2, `Attachment 2 (${EXPECTED_ATTACHMENT_2_ID}) not found in DB`);

  console.log(`✓ Confirmed DB fixtures: Report ${TARGET_REPORT_ID} has attachments:`);
  console.log(`  - Attachment 1: ${dbAtt1.id} (${dbAtt1.file_name})`);
  console.log(`  - Attachment 2: ${dbAtt2.id} (${dbAtt2.file_name})`);
  console.log(`✓ Fixture status counts: All=${expectedAllIds.length}, Active=${expectedActiveIds.length}, Resolved=${expectedResolvedIds.length}, Dismissed=${expectedDismissedIds.length}`);

  // Launch Chromium
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

  try {
    // -------------------------------------------------------------------------
    // 2. Resident Login via UI
    // -------------------------------------------------------------------------
    console.log('\n[Phase 2] Resident Login via UI & /resident/sejarah...');
    await page.goto(`${STAGING_URL}/login`, { waitUntil: 'domcontentloaded' });
    await page.fill('input[name="email"], input[type="email"]', RESIDENT_EMAIL);
    await page.fill('input[name="password"], input[type="password"]', RESIDENT_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/resident**', { timeout: 25000 });
    recordPass('Resident Login', 'Successfully authenticated resident via UI');

    await page.goto(`${STAGING_URL}/resident/sejarah`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('h1', { timeout: 15000 });
    const h1Text = (await page.locator('h1').textContent())?.trim();
    assert.strictEqual(h1Text, 'Aduan Saya', `Expected h1 to be 'Aduan Saya', got '${h1Text}'`);
    recordPass('Sejarah Page Load', 'H1 matches Aduan Saya');

    // -------------------------------------------------------------------------
    // 3. Tab Filters with Exact Card ID Comparison
    // -------------------------------------------------------------------------
    console.log('\n[Phase 3] Testing Tab Filters with Exact Card ID Set Matching...');

    // Helper to get card IDs from current page
    async function getDisplayedCardIds() {
      return await page.locator('a[href*="/resident/sejarah/"]').evaluateAll((elements) => {
        return elements
          .map((el) => {
            const m = el.getAttribute('href')?.match(/\/resident\/sejarah\/([0-9a-f-]{36})/i);
            return m ? m[1] : null;
          })
          .filter(Boolean);
      });
    }

    // 3A. Filter 'Semua' (All)
    const displayedAllIds = (await getDisplayedCardIds()).sort();
    assert.deepStrictEqual(
      displayedAllIds,
      expectedAllIds,
      `Displayed card IDs do not match expected all IDs: ${displayedAllIds.length} vs ${expectedAllIds.length}`
    );
    recordPass('Filter: Semua', `Exact match for all ${expectedAllIds.length} cards`);

    // 3B. Filter 'Dalam Proses' (Active)
    const activeTab = page.locator('button:has-text("Dalam Proses"), button:has-text("Dalam proses")').first();
    await activeTab.click();
    await page.waitForTimeout(400);
    assert.ok(page.url().includes('filter=active'), 'URL missing filter=active');
    const displayedActiveIds = (await getDisplayedCardIds()).sort();
    assert.deepStrictEqual(
      displayedActiveIds,
      expectedActiveIds,
      `Displayed card IDs for 'Dalam Proses' do not match expected active IDs`
    );
    recordPass('Filter: Dalam Proses', `Exact match for ${expectedActiveIds.length} active cards`);

    // 3C. Filter 'Selesai' (Resolved)
    const resolvedTab = page.locator('button:has-text("Selesai")').first();
    await resolvedTab.click();
    await page.waitForTimeout(400);
    assert.ok(page.url().includes('filter=resolved'), 'URL missing filter=resolved');
    const displayedResolvedIds = await getDisplayedCardIds();
    if (expectedResolvedIds.length === 0) {
      assert.strictEqual(displayedResolvedIds.length, 0, 'Expected 0 cards for resolved tab');
      recordNotExercised(
        'Filter: Selesai',
        '0 rekod berstatus selesai dalam fixture staging sedia ada'
      );
    } else {
      assert.deepStrictEqual(displayedResolvedIds.sort(), expectedResolvedIds);
      recordPass('Filter: Selesai', `Exact match for ${expectedResolvedIds.length} resolved cards`);
    }

    // 3D. Filter 'Ditolak' (Dismissed)
    const dismissedTab = page.locator('button:has-text("Ditolak")').first();
    await dismissedTab.click();
    await page.waitForTimeout(400);
    assert.ok(page.url().includes('filter=dismissed'), 'URL missing filter=dismissed');
    const displayedDismissedIds = await getDisplayedCardIds();
    if (expectedDismissedIds.length === 0) {
      assert.strictEqual(displayedDismissedIds.length, 0, 'Expected 0 cards for dismissed tab');
      recordNotExercised(
        'Filter: Ditolak',
        '0 rekod berstatus ditolak dalam fixture staging sedia ada'
      );
    } else {
      assert.deepStrictEqual(displayedDismissedIds.sort(), expectedDismissedIds);
      recordPass('Filter: Ditolak', `Exact match for ${expectedDismissedIds.length} dismissed cards`);
    }

    // Return to All tab
    const allTab = page.locator('button:has-text("Semua")').first();
    await allTab.click();
    await page.waitForTimeout(400);

    // -------------------------------------------------------------------------
    // 4. Bilingual Toggle (BM / EN)
    // -------------------------------------------------------------------------
    console.log('\n[Phase 4] Testing Bilingual (BM/EN) text switching on Staging...');
    const enButton = page.locator('button:has-text("EN")').first();
    if ((await enButton.count()) > 0) {
      await enButton.click();
      await page.waitForTimeout(300);
      const enH1 = (await page.locator('h1').textContent())?.trim();
      assert.strictEqual(enH1, 'My Reports', `Expected English heading 'My Reports', got '${enH1}'`);

      const bmButton = page.locator('button:has-text("BM")').first();
      await bmButton.click();
      await page.waitForTimeout(300);
      const bmH1 = (await page.locator('h1').textContent())?.trim();
      assert.strictEqual(bmH1, 'Aduan Saya', `Expected BM heading 'Aduan Saya', got '${bmH1}'`);
      recordPass('Bilingual Switching', 'H1 toggles between My Reports and Aduan Saya');
    }

    // -------------------------------------------------------------------------
    // 5. Open Target Report via UI Click & Check Metadata
    // -------------------------------------------------------------------------
    console.log('\n[Phase 5] Opening Target Report via UI click on Staging...');
    const targetCard = page.locator(`a[href*="${TARGET_REPORT_ID}"]`).first();
    assert.ok((await targetCard.count()) > 0, `Target report card for ${TARGET_REPORT_ID} not found in staging list`);
    await targetCard.click();

    await page.waitForURL(`**/${TARGET_REPORT_ID}`, { timeout: 15000 });
    const detailH1Locator = page.locator('h1:visible');
    await detailH1Locator.waitFor({ state: 'visible', timeout: 15000 });

    const visibleH1s = await page.locator('h1:visible').allTextContents();
    assert.strictEqual(visibleH1s.length, 1, `Expected 1 visible h1, found ${visibleH1s.length}`);
    assert.strictEqual(visibleH1s[0].trim(), 'Butiran Aduan', `Expected 'Butiran Aduan', got '${visibleH1s[0]}'`);

    const pageContent = await page.content();
    const shortRef = `#LPR-${TARGET_REPORT_ID.substring(0, 8).toUpperCase()}`;
    assert.ok(pageContent.includes(shortRef), `Short ref ${shortRef} not found on page`);
    assert.ok(pageContent.includes(dbReport.description), 'Report description missing');
    assert.ok(pageContent.includes('Diterima'), 'Step 1 Diterima missing');
    assert.ok(!pageContent.includes('Fasiliti telah dipulihkan sepenuhnya'), 'Premature completion text found');
    assert.ok(pageContent.includes('Menunggu tindakan pemulihan fasiliti'), 'Awaiting note missing');
    recordPass('Detail Page & Timeline', 'Metadata and timeline progression match database truth');

    // -------------------------------------------------------------------------
    // 6. Clipboard: Read-back Verification & Simulated Rejection Fallback
    // -------------------------------------------------------------------------
    console.log('\n[Phase 6] Testing Staging Clipboard (Read-back & Manual Fallback)...');
    const copyRefBtn = page.locator('button[aria-label="Salin rujukan"], button[title="Salin rujukan"]').first();

    // 6A. Successful copy read-back
    await copyRefBtn.click();
    await page.waitForTimeout(300);
    const clipboardText = await page.evaluate(async () => {
      try {
        return await navigator.clipboard.readText();
      } catch {
        return null;
      }
    });
    assert.strictEqual(clipboardText, shortRef, `Clipboard text '${clipboardText}' does not match '${shortRef}'`);
    const pageHtmlAfterCopy = await page.content();
    assert.ok(pageHtmlAfterCopy.includes('Disalin!'), 'Missing Disalin! confirmation text');
    recordPass('Clipboard Read-back', `Successfully wrote and read back '${shortRef}'`);

    // Wait for copied state to reset
    await page.waitForTimeout(2200);

    // 6B. Simulated Clipboard Failure & Manual Modal Verification
    await page.evaluate(() => {
      navigator.clipboard.writeText = () => Promise.reject(new Error('Simulated clipboard permission rejection'));
    });
    await copyRefBtn.click();
    await page.waitForTimeout(400);

    const modalDialog = page.locator('div[role="dialog"]');
    await modalDialog.waitFor({ state: 'visible', timeout: 5000 });
    const modalInput = modalDialog.locator('input[type="text"]');
    const manualVal = await modalInput.inputValue();
    assert.strictEqual(manualVal, shortRef, `Manual copy modal input does not contain '${shortRef}'`);

    const pageAfterFailure = await page.content();
    assert.ok(!pageAfterFailure.includes('Disalin!'), "False positive 'Disalin!' rendered on copy failure");

    // Close manual dialog
    const closeDialogBtn = modalDialog.locator('button').first();
    await closeDialogBtn.click();
    await modalDialog.waitFor({ state: 'hidden', timeout: 5000 });
    recordPass('Clipboard Failure Fallback', 'Manual fallback dialog triggered without false positive success text');

    // -------------------------------------------------------------------------
    // 7. Lightbox Navigation & Boundary Focus Trap (Tab & Shift+Tab)
    // -------------------------------------------------------------------------
    console.log('\n[Phase 7] Testing Lightbox Navigation & Boundary Focus Trap...');
    const thumb1 = page.locator('[data-testid="thumbnail-button-1"]');
    await thumb1.click();

    const lightboxModal = page.locator('[data-testid="lightbox-modal"]');
    await lightboxModal.waitFor({ state: 'visible', timeout: 8000 });

    // Verify counter opened on 2 of 2
    const counterText = (await page.locator('[data-testid="lightbox-counter"]').textContent())?.trim();
    assert.ok(counterText?.startsWith('2'), `Expected counter 2 of 2, got '${counterText}'`);

    // Test Boundary Focus Trap (Last element -> Tab -> First element; First element -> Shift+Tab -> Last element)
    const trapResult = await page.evaluate(async () => {
      const modal = document.querySelector('[data-testid="lightbox-modal"]');
      if (!modal) return { success: false, reason: 'Modal not found' };
      const focusables = Array.from(modal.querySelectorAll('button:not([disabled]), [tabindex="0"]'));
      if (focusables.length < 2) return { success: false, reason: 'Less than 2 focusables' };

      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      // 1. Focus the LAST element and simulate Tab
      last.focus();
      const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      window.dispatchEvent(tabEvent);
      const wrappedToFirst = document.activeElement === first;

      // 2. Focus the FIRST element and simulate Shift+Tab
      first.focus();
      const shiftTabEvent = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
      window.dispatchEvent(shiftTabEvent);
      const wrappedToLast = document.activeElement === last;

      return {
        success: wrappedToFirst && wrappedToLast,
        wrappedToFirst,
        wrappedToLast,
        firstAria: first.getAttribute('aria-label') || first.textContent,
        lastAria: last.getAttribute('aria-label') || last.textContent,
      };
    });

    assert.ok(trapResult.success, `Focus trap boundary wrapping failed: ${JSON.stringify(trapResult)}`);
    recordPass(
      'Boundary Focus Trap',
      `Tab on last element wraps to first (${trapResult.firstAria}), Shift+Tab on first element wraps to last (${trapResult.lastAria})`
    );

    // Escape to close
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    const isModalClosed = (await page.locator('[data-testid="lightbox-modal"]').count()) === 0;
    assert.ok(isModalClosed, 'Lightbox did not close on Escape key');
    const focusedTestId = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
    assert.strictEqual(focusedTestId, 'thumbnail-button-1', `Focus failed to restore to thumbnail-button-1, currently: ${focusedTestId}`);
    recordPass('Lightbox Focus Restoration', 'Focus restored precisely to thumbnail-button-1 after Escape');

    // -------------------------------------------------------------------------
    // 8. Resident Session Image Extraction & Byte Hashing
    // -------------------------------------------------------------------------
    console.log('\n[Phase 8] Extracting Images & Computing SHA-256 in Resident Session...');

    // Attachment 1 in Resident UI
    const resImg1 = page.locator(`img[alt="${dbAtt1.file_name}"]`).first();
    await resImg1.waitFor({ state: 'visible', timeout: 8000 });
    const resImg1Loaded = await resImg1.evaluate((img) => img.complete && img.naturalWidth > 0);
    assert.ok(resImg1Loaded, `Resident image 1 (${dbAtt1.file_name}) failed to load`);
    const resUrl1 = await resImg1.getAttribute('src');
    assert.ok(resUrl1 && resUrl1.includes(dbAtt1.file_name), 'Resident image 1 src invalid or missing filename');

    const resResp1 = await page.request.get(resUrl1);
    assert.strictEqual(resResp1.status(), 200, 'Resident image 1 HTTP fetch status not 200');
    assert.ok(
      resResp1.headers()['content-type']?.startsWith('image/'),
      `Resident image 1 content-type not image: ${resResp1.headers()['content-type']}`
    );
    const resBytes1 = await resResp1.body();
    const residentHash1 = crypto.createHash('sha256').update(resBytes1).digest('hex');

    // Attachment 2 in Resident UI
    const resImg2 = page.locator(`img[alt="${dbAtt2.file_name}"]`).first();
    await resImg2.waitFor({ state: 'visible', timeout: 8000 });
    const resImg2Loaded = await resImg2.evaluate((img) => img.complete && img.naturalWidth > 0);
    assert.ok(resImg2Loaded, `Resident image 2 (${dbAtt2.file_name}) failed to load`);
    const resUrl2 = await resImg2.getAttribute('src');
    assert.ok(resUrl2 && resUrl2.includes(dbAtt2.file_name), 'Resident image 2 src invalid or missing filename');

    const resResp2 = await page.request.get(resUrl2);
    assert.strictEqual(resResp2.status(), 200, 'Resident image 2 HTTP fetch status not 200');
    assert.ok(
      resResp2.headers()['content-type']?.startsWith('image/'),
      `Resident image 2 content-type not image: ${resResp2.headers()['content-type']}`
    );
    const resBytes2 = await resResp2.body();
    const residentHash2 = crypto.createHash('sha256').update(resBytes2).digest('hex');

    recordPass(
      'Resident Image Extraction',
      `Attachment 1 (${resBytes1.length} bytes, SHA-256: ${residentHash1.substring(0, 16)}...), Attachment 2 (${resBytes2.length} bytes, SHA-256: ${residentHash2.substring(0, 16)}...)`
    );

    // -------------------------------------------------------------------------
    // 9. Manager Session Login, Open Attachments via Real UI & Byte Hashing
    // -------------------------------------------------------------------------
    console.log('\n[Phase 9] Manager Session: Opening identical report & attachments via UI controls...');
    const managerContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const managerPage = await managerContext.newPage();

    // Manager login
    await managerPage.goto(`${STAGING_URL}/login`, { waitUntil: 'domcontentloaded' });
    await managerPage.fill('input[name="email"], input[type="email"]', MANAGER_EMAIL);
    await managerPage.fill('input[name="password"], input[type="password"]', MANAGER_PASSWORD);
    await managerPage.click('button[type="submit"]');
    await managerPage.waitForURL('**/management**', { timeout: 25000 });
    recordPass('Manager Login', 'Successfully authenticated manager via UI');

    await managerPage.goto(`${STAGING_URL}/management/inbox`, { waitUntil: 'domcontentloaded' });
    const managerCardLocator = managerPage.locator(`[data-testid="report-card-${TARGET_REPORT_ID}"]`);
    await managerCardLocator.waitFor({ state: 'visible', timeout: 15000 });
    recordPass('Manager Inbox Search', `Located report card ${shortRef} in manager inbox`);

    // Attachment 1 in Manager UI
    const mgrLink1 = managerCardLocator.locator('a', { hasText: dbAtt1.file_name });
    await mgrLink1.waitFor({ state: 'visible', timeout: 8000 });
    const mgrHref1 = await mgrLink1.getAttribute('href');
    assert.ok(mgrHref1 && mgrHref1.includes(dbAtt1.file_name), 'Manager attachment 1 link missing filename');

    const [mgrPopup1] = await Promise.all([
      managerContext.waitForEvent('page'),
      mgrLink1.click(),
    ]);
    await mgrPopup1.waitForLoadState('domcontentloaded');
    const mgrPopupImg1 = mgrPopup1.locator('img');
    await mgrPopupImg1.waitFor({ state: 'visible', timeout: 10000 });
    const mgrImg1Loaded = await mgrPopupImg1.evaluate((img) => img.complete && img.naturalWidth > 0);
    assert.ok(mgrImg1Loaded, `Manager image 1 (${dbAtt1.file_name}) failed to load in new tab`);

    const mgrResp1 = await mgrPopup1.request.get(mgrPopup1.url());
    assert.strictEqual(mgrResp1.status(), 200, 'Manager image 1 HTTP fetch status not 200');
    assert.ok(
      mgrResp1.headers()['content-type']?.startsWith('image/'),
      `Manager image 1 content-type not image: ${mgrResp1.headers()['content-type']}`
    );
    const mgrBytes1 = await mgrResp1.body();
    const managerHash1 = crypto.createHash('sha256').update(mgrBytes1).digest('hex');
    await mgrPopup1.close();

    // Attachment 2 in Manager UI
    const mgrLink2 = managerCardLocator.locator('a', { hasText: dbAtt2.file_name });
    await mgrLink2.waitFor({ state: 'visible', timeout: 8000 });
    const mgrHref2 = await mgrLink2.getAttribute('href');
    assert.ok(mgrHref2 && mgrHref2.includes(dbAtt2.file_name), 'Manager attachment 2 link missing filename');

    const [mgrPopup2] = await Promise.all([
      managerContext.waitForEvent('page'),
      mgrLink2.click(),
    ]);
    await mgrPopup2.waitForLoadState('domcontentloaded');
    const mgrPopupImg2 = mgrPopup2.locator('img');
    await mgrPopupImg2.waitFor({ state: 'visible', timeout: 10000 });
    const mgrImg2Loaded = await mgrPopupImg2.evaluate((img) => img.complete && img.naturalWidth > 0);
    assert.ok(mgrImg2Loaded, `Manager image 2 (${dbAtt2.file_name}) failed to load in new tab`);

    const mgrResp2 = await mgrPopup2.request.get(mgrPopup2.url());
    assert.strictEqual(mgrResp2.status(), 200, 'Manager image 2 HTTP fetch status not 200');
    assert.ok(
      mgrResp2.headers()['content-type']?.startsWith('image/'),
      `Manager image 2 content-type not image: ${mgrResp2.headers()['content-type']}`
    );
    const mgrBytes2 = await mgrResp2.body();
    const managerHash2 = crypto.createHash('sha256').update(mgrBytes2).digest('hex');
    await mgrPopup2.close();

    recordPass(
      'Manager Image Extraction',
      `Attachment 1 (${mgrBytes1.length} bytes, SHA-256: ${managerHash1.substring(0, 16)}...), Attachment 2 (${mgrBytes2.length} bytes, SHA-256: ${managerHash2.substring(0, 16)}...)`
    );

    // -------------------------------------------------------------------------
    // 10. Strict SHA-256 Match Assertions (Resident === Manager for EACH attachment)
    // -------------------------------------------------------------------------
    console.log('\n[Phase 10] Asserting Exact SHA-256 Hash Matching...');
    assert.strictEqual(
      residentHash1,
      managerHash1,
      `Attachment 1 SHA-256 mismatch! Resident: ${residentHash1} !== Manager: ${managerHash1}`
    );
    recordPass(
      'Attachment 1 Match',
      `Resident SHA-256 === Manager SHA-256 (${residentHash1})`
    );

    assert.strictEqual(
      residentHash2,
      managerHash2,
      `Attachment 2 SHA-256 mismatch! Resident: ${residentHash2} !== Manager: ${managerHash2}`
    );
    recordPass(
      'Attachment 2 Match',
      `Resident SHA-256 === Manager SHA-256 (${residentHash2})`
    );

    assert.notStrictEqual(
      residentHash1,
      residentHash2,
      'Attachment 1 and Attachment 2 hashes should not be identical'
    );
    recordPass('Attachment Differentiation', 'Attachment 1 and 2 are distinct files');

    // -------------------------------------------------------------------------
    // 11. Cross-Account Isolation Accounting
    // -------------------------------------------------------------------------
    console.log('\n[Phase 11] Checking Access Isolation & Non-owned Guard...');
    const foreignResp = await page.goto(`${STAGING_URL}/resident/sejarah/${NON_OWNED_UUID}`, {
      waitUntil: 'domcontentloaded',
    });
    const foreignStatus = foreignResp?.status();
    const foreignHtml = await page.content();
    assert.ok(
      foreignStatus === 404 || foreignHtml.includes('404') || foreignHtml.includes('tidak ditemui'),
      `Expected 404/not found for non-owned UUID, got status ${foreignStatus}`
    );
    recordPass('Non-owned UUID Guard', '404 / not found displayed without leaking data');

    // Fixture accounting for multi-resident cross account test
    recordSkipped(
      'Cross-Resident Ownership Isolation',
      'Tiada aduan milik akaun penduduk kedua (resident.sentosa@nadi.local) dalam fixture staging sedia ada; larangan mutlak mencipta data baru'
    );

    // -------------------------------------------------------------------------
    // 12. Viewport Responsiveness
    // -------------------------------------------------------------------------
    console.log('\n[Phase 12] Viewport Responsiveness on Staging...');
    await page.goto(`${STAGING_URL}/resident/sejarah/${TARGET_REPORT_ID}`, { waitUntil: 'domcontentloaded' });
    for (const width of [360, 390, 430]) {
      await page.setViewportSize({ width, height: 800 });
      await page.waitForTimeout(150);
      const isOverflowing = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth
      );
      assert.strictEqual(isOverflowing, false, `Horizontal overflow at ${width}px`);
      recordPass(`Responsive ${width}px`, 'Zero horizontal overflow');
    }

    // -------------------------------------------------------------------------
    // SUMMARY
    // -------------------------------------------------------------------------
    console.log('\n==============================================================================');
    console.log('AUDIT EXECUTION SUMMARY (STAGING LIVE)');
    console.log('==============================================================================');
    console.log(`\n[PASS] (${auditResults.pass.length} items):`);
    auditResults.pass.forEach((p, idx) => console.log(`  ${idx + 1}. ${p.testName}: ${p.details}`));

    console.log(`\n[NOT EXERCISED] (${auditResults.notExercised.length} items):`);
    auditResults.notExercised.forEach((n, idx) => console.log(`  ${idx + 1}. ${n.testName}: ${n.reason}`));

    console.log(`\n[SKIPPED] (${auditResults.skipped.length} items):`);
    auditResults.skipped.forEach((s, idx) => console.log(`  ${idx + 1}. ${s.testName}: ${s.reason}`));

    console.log(`\n[FAIL] (${auditResults.fail.length} items)`);
    assert.strictEqual(auditResults.fail.length, 0, 'Audit contained failures');

    console.log('\n🎉 ALL LIVE STAGING ASSERTIONS PASSED WITH VERIFIED BYTE-FOR-BYTE IMAGE MATCHING!');
  } finally {
    await browser.close();
  }
}

runStagingLiveVerification().catch((err) => {
  console.error('\n❌ STAGING LIVE VERIFICATION FAILED:', err.message);
  process.exit(1);
});
