import { chromium } from 'playwright-core';
import path from 'node:path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE_URL = 'http://localhost:3000';
const ARTIFACTS_DIR = 'C:\\Users\\shams\\.gemini\\antigravity-ide\\brain\\f73c5ee6-76ec-4b98-ac3e-6e23b5a34c2a';

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, // iPhone mobile
  });
  const page = await context.newPage();

  // 1. Verify unauthenticated attempt to /resident/lapor redirects to login
  await page.goto(`${BASE_URL}/resident/lapor`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL('**/login?returnTo=%2Fresident%2Flapor', { timeout: 10000 });
  console.log('✓ Verified unauthenticated access redirected to:', page.url());

  // Capture screenshot of login screen at 390x844 (BM)
  const screenshotBm = path.join(ARTIFACTS_DIR, 'login_mobile_bm.png');
  await page.screenshot({ path: screenshotBm, fullPage: false });
  console.log('✓ Saved BM mobile screenshot:', screenshotBm);

  // 2. Toggle language to English
  const langBtn = page.locator('button:has-text("English")');
  if (await langBtn.count() > 0) {
    await langBtn.click();
    await page.waitForTimeout(500);
    const screenshotEn = path.join(ARTIFACTS_DIR, 'login_mobile_en.png');
    await page.screenshot({ path: screenshotEn, fullPage: false });
    console.log('✓ Saved EN mobile screenshot:', screenshotEn);
  }

  await browser.close();
}

main().catch(console.error);
