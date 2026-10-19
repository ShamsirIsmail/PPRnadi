import { chromium } from 'playwright-core';
import path from 'node:path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE_URL = 'http://localhost:3000';
const ARTIFACTS_DIR = 'C:\\Users\\shams\\.gemini\\antigravity-ide\\brain\\f73c5ee6-76ec-4b98-ac3e-6e23b5a34c2a';

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 950 } });

  await context.addCookies([
    { name: 'ppr_demo_role', value: 'management', domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
  ]);

  const page = await context.newPage();
  await page.goto(`${BASE_URL}/management/inbox`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main', { timeout: 15000 });
  await page.waitForSelector('[data-hydrated="true"]', { timeout: 8000 });

  const panelLocator = page.locator('[data-testid^="priority-explainer-"]').first();
  const expandBtn = panelLocator.locator('[data-testid^="generate-priority-btn-"], [data-testid^="toggle-explainer-btn-"]').first();
  await expandBtn.click();
  await page.waitForTimeout(1000);

  // Click Step 3 (Cadangan)
  await panelLocator.locator('[data-testid="explainer-step-tab-2"]').click();
  await page.waitForTimeout(500);

  const screenshotPath = path.join(ARTIFACTS_DIR, 'priority_explainer_cadangan.png');
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`Saved screenshot: ${screenshotPath}`);

  await browser.close();
}

main().catch(console.error);
