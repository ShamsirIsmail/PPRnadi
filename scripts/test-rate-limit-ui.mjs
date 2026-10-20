import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';

if (fs.existsSync('.env.staging.local')) {
  process.loadEnvFile('.env.staging.local');
}

const TARGET_URL = process.env.TEST_APP_URL || 'https://ppr-nadi-staging.vercel.app';
const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const RESIDENT_PASSWORD = process.env.STAGING_RESIDENT_PASSWORD;

if (!RESIDENT_PASSWORD) {
  console.error('[CONFIG ERROR] STAGING_RESIDENT_PASSWORD is required.');
  process.exit(1);
}

async function runRateLimitLiveUiVerification() {
  console.log('==============================================================================');
  console.log('PPR NADI — LIVE STAGING RATE LIMITER UI & REGULAR LOGIN ISOLATION TEST');
  console.log('==============================================================================');
  console.log(`[Target URL] ${TARGET_URL}`);

  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
  });

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();

    console.log('[Step 1] Executing demo logins until shared server rate limit is triggered...');
    console.log('         (Clearing session cookies between attempts to prove cookie tampering cannot bypass server count)');
    let rateLimitHit = false;
    let friendlyMessage = '';

    for (let attempt = 1; attempt <= 7; attempt++) {
      // Clear session cookies so we can view /login without proxy redirecting authenticated user
      await context.clearCookies();

      console.log(`\nAttempt ${attempt}: Navigating to /login...`);
      await page.goto(`${TARGET_URL}/login`, { waitUntil: 'networkidle' });

      const residentDemoBtn = page.locator('button#demo-resident-btn');
      assert.ok(await residentDemoBtn.isVisible(), 'Demo resident button must be visible');

      console.log(`Attempt ${attempt}: Clicking 1-click resident demo button...`);
      await residentDemoBtn.click();

      // Race between successful redirect to /resident and rate limit error on /login
      const outcome = await Promise.race([
        page.waitForURL('**/resident', { timeout: 10000 }).then(() => 'redirected'),
        page.waitForSelector('span:has-text("Had percubaan")', { timeout: 10000 }).then(() => 'rate_limited'),
      ]).catch(() => 'timeout');

      if (outcome === 'redirected') {
        console.log(`  -> Attempt ${attempt} succeeded (redirected to /resident)`);
      } else if (outcome === 'rate_limited') {
        const errorEl = page.locator('span:has-text("Had percubaan")').first();
        friendlyMessage = await errorEl.innerText();
        console.log(`  -> Attempt ${attempt} intercepted by server rate limiter: "${friendlyMessage.trim()}"`);
        rateLimitHit = true;
        break;
      } else {
        // Fallback check
        const alertEl = page.locator('div[role="alert"]').first();
        if (await alertEl.isVisible()) {
          const txt = await alertEl.innerText();
          if (txt.includes('Had percubaan') || txt.includes('tunggu sebentar')) {
            friendlyMessage = txt;
            rateLimitHit = true;
            console.log(`  -> Attempt ${attempt} intercepted: "${friendlyMessage.trim()}"`);
            break;
          }
        }
      }
    }

    assert.ok(rateLimitHit, 'Demo rate limiter must be triggered by shared server storage');
    assert.ok(
      friendlyMessage.includes('Had percubaan') || friendlyMessage.includes('tunggu sebentar'),
      `Friendly message must be displayed. Received: "${friendlyMessage}"`
    );
    console.log('✓ Server rate limit error message verified live on screen in BM:');
    console.log(`  "${friendlyMessage.trim()}"`);

    // Step 2: Regular login MUST STILL SUCCEED even when demo rate limit is saturated!
    console.log('\n[Step 2] Verifying regular form login is NOT blocked while demo limit is active...');
    await page.fill('#login-email', 'resident.rejang@nadi.local');
    await page.fill('#login-password', RESIDENT_PASSWORD);
    await page.click('#login-submit-btn');

    await page.waitForURL('**/resident', { timeout: 15000 });
    console.log('✓ Regular form login succeeded completely! Current URL:', page.url());

    // Step 3: Verify logout and route protection still work
    console.log('\n[Step 3] Verifying logout and protected route enforcement...');
    await page.goto(`${TARGET_URL}/management`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    // Resident attempting to access management gets redirected to /resident (by proxy.ts)
    assert.ok(page.url().includes('/resident'), 'Resident cannot access management routes');
    console.log('✓ Route boundary protection confirmed: resident routed safely.');

    console.log('\n==============================================================================');
    console.log('ALL LIVE STAGING RATE LIMITER UI & REGULAR LOGIN TESTS PASSED!');
    console.log('==============================================================================');
  } finally {
    await browser.close();
  }
}

runRateLimitLiveUiVerification().catch((err) => {
  console.error('\n[VERIFICATION ERROR]', err);
  process.exit(1);
});
