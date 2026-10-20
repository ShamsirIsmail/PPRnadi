import { chromium } from 'playwright-core';
import fs from 'node:fs';

if (fs.existsSync('.env.staging.local')) process.loadEnvFile('.env.staging.local');

const STAGING_URL = 'https://ppr-nadi-staging.vercel.app';
const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const EMAIL = 'resident.rejang@nadi.local';
const PASSWORD = process.env.STAGING_RESIDENT_PASSWORD || 'ResidentPPR@2026!';

async function verifyLiveStaging() {
  console.log('Testing Live Staging Deployment on Vercel...');
  console.log('URL:', STAGING_URL);

  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
  });

  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });

  try {
    // 1. Login
    await page.goto(`${STAGING_URL}/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('input[name="email"], input[type="email"]');
    await page.fill('input[name="email"], input[type="email"]', EMAIL);
    await page.fill('input[name="password"], input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');

    await page.waitForURL('**/resident**', { timeout: 25000, waitUntil: 'domcontentloaded' });
    console.log('✓ Staging login successful');

    // 2. Go to /resident/sejarah
    await page.goto(`${STAGING_URL}/resident/sejarah`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('h1', { timeout: 15000 });
    const h1 = await page.locator('h1').textContent();
    console.log('✓ Sejarah page loaded with heading:', h1?.trim());
    const body = await page.locator('main').innerHTML();
    console.log('MAIN CONTENT:', body.substring(0, 500));

    // 3. Check cards
    const cards = page.locator('a[href*="/resident/sejarah/"]');
    const count = await cards.count();
    console.log(`✓ Found ${count} report cards on staging`);

    // 4. Capture screenshot of live staging list
    await page.screenshot({ path: 'staging_live_sejarah_list_390px.png' });
    console.log('✓ Saved staging_live_sejarah_list_390px.png');

    // 5. Navigate to first detail card
    if (count > 0) {
      await cards.first().click();
      await page.waitForSelector('h1', { timeout: 15000 });
      const detailH1 = await page.locator('h1').textContent();
      console.log('✓ Detail page loaded with heading:', detailH1?.trim());
      await page.screenshot({ path: 'staging_live_detail_390px.png' });
      console.log('✓ Saved staging_live_detail_390px.png');
    }

    console.log('🎉 LIVE STAGING VERIFICATION PASSED!');
  } finally {
    await browser.close();
  }
}

verifyLiveStaging().catch(err => {
  console.error('Staging verification error:', err.message);
  process.exit(1);
});
