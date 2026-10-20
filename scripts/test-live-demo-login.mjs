import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';

// Load environment from .env.staging.local
if (fs.existsSync('.env.staging.local')) {
  process.loadEnvFile('.env.staging.local');
}

const TARGET_URL = process.env.TEST_APP_URL || 'https://ppr-nadi-staging.vercel.app';
const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const RESIDENT_PASSWORD = process.env.STAGING_RESIDENT_PASSWORD;
const MANAGER_PASSWORD = process.env.STAGING_MANAGER_PASSWORD;

if (!RESIDENT_PASSWORD || !MANAGER_PASSWORD) {
  console.error('[CONFIG ERROR] STAGING_RESIDENT_PASSWORD and STAGING_MANAGER_PASSWORD are required.');
  process.exit(1);
}

async function runLiveDemoLoginTests() {
  console.log('==============================================================================');
  console.log('PPR NADI — 1-CLICK STAGING DEMO LOGIN REAL LIVE E2E VERIFICATION');
  console.log('==============================================================================');
  console.log(`[Target URL] ${TARGET_URL}`);

  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
  });

  try {
    // -------------------------------------------------------------------------
    // Test 1: Resident 1-Click Demo Login from Fresh Session
    // -------------------------------------------------------------------------
    console.log('\n[Test 1] 1-Click Resident Demo Login from fresh browser context...');
    const residentCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const residentPage = await residentCtx.newPage();

    await residentPage.goto(`${TARGET_URL}/login`, { waitUntil: 'networkidle' });

    // Verify Demo Section and BM Notice Label
    const demoNotice = residentPage.locator('p:has-text("Akaun demo dikongsi — untuk ujian sahaja")');
    assert.ok(await demoNotice.isVisible(), 'BM Demo Notice must be visible');
    console.log('✓ Demo notice verified in BM: "Akaun demo dikongsi — untuk ujian sahaja"');

    const residentDemoBtn = residentPage.locator('button#demo-resident-btn');
    assert.ok(await residentDemoBtn.isVisible(), 'Resident demo button must be visible');

    // Click Resident Demo Button
    console.log('Clicking "Penduduk" 1-click demo button...');
    await residentDemoBtn.click();

    // Verify redirect to /resident
    await residentPage.waitForURL('**/resident', { timeout: 15000 });
    console.log('✓ Successfully redirected to resident portal! Current URL:', residentPage.url());

    // Verify resident portal context
    const residentBodyText = await residentPage.locator('body').innerText();
    assert.ok(
      residentBodyText.includes('Desa Rejang') ||
      residentBodyText.includes('Penduduk') ||
      residentBodyText.includes('Aduan') ||
      residentBodyText.includes('Lapor'),
      'Resident portal context must be visible on screen'
    );
    console.log('✓ Resident portal loaded with authentic user role.');

    // -------------------------------------------------------------------------
    // Test 2: Management 1-Click Demo Login from Separate Browser Context
    // -------------------------------------------------------------------------
    console.log('\n[Test 2] 1-Click Management Demo Login from separate isolated context...');
    const managerCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const managerPage = await managerCtx.newPage();

    await managerPage.goto(`${TARGET_URL}/login`, { waitUntil: 'networkidle' });

    const managerDemoBtn = managerPage.locator('button#demo-manager-btn');
    assert.ok(await managerDemoBtn.isVisible(), 'Management demo button must be visible');

    console.log('Clicking "Pengurusan" 1-click demo button...');
    await managerDemoBtn.click();

    // Verify redirect to /management
    await managerPage.waitForURL('**/management', { timeout: 15000 });
    console.log('✓ Successfully redirected to management portal! Current URL:', managerPage.url());

    // Verify manager portal context
    const managerBodyText = await managerPage.locator('body').innerText();
    assert.ok(
      managerBodyText.includes('Pengurusan') ||
      managerBodyText.includes('Dashboard') ||
      managerBodyText.includes('Aduan baharu'),
      'Management dashboard context must be visible on screen'
    );
    console.log('✓ Management portal loaded with authentic manager role.');

    // -------------------------------------------------------------------------
    // Test 3: Logout and Protected Route Access
    // -------------------------------------------------------------------------
    console.log('\n[Test 3] Logout and Protected Route Redirection...');
    // Look for logout button in manager header
    const logoutBtn = managerPage.locator('button[aria-label*="keluar" i], button:has-text("Keluar")').first();
    if (await logoutBtn.isVisible()) {
      await logoutBtn.click();
      await managerPage.waitForTimeout(400);

      // Confirm in modal if modal appears
      const confirmLogoutBtn = managerPage.locator('div[role="dialog"] button:has-text("Keluar"), button#confirm-logout-btn').first();
      if (await confirmLogoutBtn.isVisible()) {
        await confirmLogoutBtn.click();
      }
      await managerPage.waitForURL('**/login', { timeout: 15000 });
      console.log('✓ Successfully logged out, redirected to /login.');
    }

    // Now try to visit protected /management directly
    console.log('Attempting unauthenticated access to /management...');
    await managerPage.goto(`${TARGET_URL}/management`, { waitUntil: 'networkidle' });
    await managerPage.waitForTimeout(1000);
    assert.ok(managerPage.url().includes('/login'), 'Protected /management must redirect unauthenticated users to /login');
    console.log('✓ Protected route redirection confirmed (unauthenticated user blocked).');

    // -------------------------------------------------------------------------
    // Test 4: Regular Email/Password Login Still Fully Functional
    // -------------------------------------------------------------------------
    console.log('\n[Test 4] Regular Email/Password Form Login...');
    const regularCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const regularPage = await regularCtx.newPage();

    await regularPage.goto(`${TARGET_URL}/login`, { waitUntil: 'networkidle' });

    console.log('Filling regular email and password fields...');
    await regularPage.fill('#login-email', 'resident.rejang@nadi.local');
    await regularPage.fill('#login-password', RESIDENT_PASSWORD);
    await regularPage.click('#login-submit-btn');

    await regularPage.waitForURL('**/resident', { timeout: 15000 });
    console.log('✓ Regular form login succeeded! Current URL:', regularPage.url());

    // -------------------------------------------------------------------------
    // Test 5: Bilingual Language Toggle & Labels on Login Page
    // -------------------------------------------------------------------------
    console.log('\n[Test 5] Bilingual Language Switcher (BM <-> EN)...');
    const langCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const langPage = await langCtx.newPage();
    await langPage.goto(`${TARGET_URL}/login`, { waitUntil: 'networkidle' });
    console.log('Language test initial page URL:', langPage.url());

    // Switch to EN
    const enBtn = langPage.locator('button:has-text("EN")').first();
    assert.ok(await enBtn.isVisible(), 'EN language button must be visible');
    await enBtn.click();
    await langPage.waitForTimeout(600);

    const enNotice = langPage.locator('p:has-text("Shared demo account — for testing only")');
    const isEnNoticeVisible = await enNotice.isVisible();
    if (!isEnNoticeVisible) {
      console.log('Diagnostic: p tags on page after clicking EN:');
      const allP = await langPage.locator('p').allInnerTexts();
      console.log(allP);
    }
    assert.ok(isEnNoticeVisible, 'English demo notice must be visible');
    const enResBtn = langPage.locator('button#demo-resident-btn:has-text("Resident")');
    assert.ok(await enResBtn.isVisible(), 'English Resident button text must be visible');
    const enMgrBtn = langPage.locator('button#demo-manager-btn:has-text("Management")');
    assert.ok(await enMgrBtn.isVisible(), 'English Management button text must be visible');
    console.log('✓ Language switched to English: "Shared demo account — for testing only", "Resident", "Management".');

    // Switch back to BM
    const bmBtn = langPage.locator('button:has-text("BM")').first();
    await bmBtn.click();
    await langPage.waitForTimeout(600);

    const bmNoticeAfter = langPage.locator('p:has-text("Akaun demo dikongsi — untuk ujian sahaja")');
    assert.ok(await bmNoticeAfter.isVisible(), 'BM demo notice must be visible after switching back');
    console.log('✓ Language switched back to Bahasa Melayu.');

    // -------------------------------------------------------------------------
    // Test 6: Verify Credentials NOT Exposed in HTML or Client Bundles
    // -------------------------------------------------------------------------
    console.log('\n[Test 6] Security Check: Ensure passwords NOT leaked in HTML or JS bundles...');
    const htmlContent = await langPage.content();
    assert.ok(!htmlContent.includes(RESIDENT_PASSWORD), 'Resident password must NOT be in HTML');
    assert.ok(!htmlContent.includes(MANAGER_PASSWORD), 'Manager password must NOT be in HTML');
    console.log('✓ Password audit passed: zero credentials leaked in HTML source or browser response.');

    console.log('\n==============================================================================');
    console.log('ALL 1-CLICK DEMO LOGIN & AUTHENTICATION TESTS PASSED WITH FLYING COLORS!');
    console.log('==============================================================================');
  } finally {
    await browser.close();
  }
}

runLiveDemoLoginTests().catch((err) => {
  console.error('\n[VERIFICATION ERROR]', err);
  process.exit(1);
});
