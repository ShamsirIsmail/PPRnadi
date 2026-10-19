import { chromium } from 'playwright-core';
import path from 'node:path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE_URL = 'http://localhost:3000';
const ARTIFACTS_DIR = 'C:\\Users\\shams\\.gemini\\antigravity-ide\\brain\\f73c5ee6-76ec-4b98-ac3e-6e23b5a34c2a';

async function main() {
  console.log('--- Starting Priority Explainer Panel Verification ---');

  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });

  await context.addCookies([
    {
      name: 'ppr_demo_role',
      value: 'management',
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  const page = await context.newPage();
  page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err));

  console.log('1. Navigating to /management/inbox as manager...');
  await page.goto(`${BASE_URL}/management/inbox`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main', { timeout: 15000 });
  console.log('✓ Successfully loaded /management/inbox');

  // Verify that the priority explainer panel exists and is hydrated
  const panelLocator = page.locator('[data-testid^="priority-explainer-"]').first();
  await panelLocator.waitFor({ state: 'visible', timeout: 8000 });
  await page.waitForSelector('[data-hydrated="true"]', { timeout: 8000 });
  console.log('✓ Found hydrated priority explainer panel on report card');

  // Test expanding the panel
  console.log('2. Testing interactive panel expansion and demo cases...');
  const expandBtn = panelLocator.locator('[data-testid^="generate-priority-btn-"], [data-testid^="toggle-explainer-btn-"]').first();
  await expandBtn.click();
  await page.waitForTimeout(1000);
  console.log('Panel text after expand click:\n', await panelLocator.innerText());
  await panelLocator.locator('[data-testid="explainer-step-tab-2"]').waitFor({ state: 'visible', timeout: 10000 });

  console.log('✓ Panel expanded and evaluated recommendation step');

  // Switch to Lift demo fixture if available or test tabs
  const liftDemoBtn = panelLocator.locator('button:has-text("Lif (Orang terperangkap)")');
  if (await liftDemoBtn.count() > 0) {
    await liftDemoBtn.click();
    await page.waitForTimeout(500);
    console.log('✓ Selected Lift demo fixture (Rule S-01)');
  }

  // Verify Step 2: Bukti
  console.log('3. Navigating to Step 2 (Bukti)...');
  await panelLocator.locator('[data-testid="explainer-step-tab-1"]').click();
  await page.waitForTimeout(400);
  const factSafety = panelLocator.locator('[data-testid^="fact-item-"]').first();
  await factSafety.waitFor({ state: 'visible', timeout: 5000 });
  console.log('✓ Step 2 (Bukti) displays extracted facts with source quotes');

  // Verify Step 3: Cadangan
  console.log('4. Navigating to Step 3 (Cadangan)...');
  await panelLocator.locator('[data-testid="explainer-step-tab-2"]').click();
  await page.waitForTimeout(400);
  const ruleCard = panelLocator.locator('text=S-01 · Isyarat keselamatan dilaporkan');
  await ruleCard.waitFor({ state: 'visible', timeout: 3000 });
  console.log('✓ Step 3 (Cadangan) displays Rule S-01 and immediate_review tier');

  // Verify Step 4: Keputusan
  console.log('5. Navigating to Step 4 (Keputusan) and testing override reason...');
  await panelLocator.locator('[data-testid="explainer-step-tab-3"]').click();
  await page.waitForTimeout(400);

  // Change decision to "Semakan biasa" (overriding "Semak serta-merta")
  await panelLocator.locator('[data-testid="manager-decision-select"]').selectOption('standard_review');

  // Click confirm without reason -> expect validation message
  await panelLocator.locator('[data-testid="confirm-decision-btn"]').click();
  await page.waitForTimeout(400);
  const errorMsg = panelLocator.locator('text=Nyatakan sebab / catatan apabila mengubah cadangan sistem');
  await errorMsg.waitFor({ state: 'visible', timeout: 3000 });
  console.log('✓ Override without reason is strictly rejected as expected');

  // Provide reason and confirm
  console.log('6. Providing override reason and confirming manager decision...');
  await panelLocator.locator('[data-testid="override-reason-textarea"]').fill('Pemeriksaan tapak jam 10 pagi mendapati lif telah dikosongkan.');
  await panelLocator.locator('[data-testid="confirm-decision-btn"]').click();
  await page.waitForTimeout(600);

  const successMsg = panelLocator.locator('text=Keputusan pengurus disahkan');
  await successMsg.waitFor({ state: 'visible', timeout: 5000 });
  console.log('✓ Manager decision successfully recorded and audit message displayed');

  // Capture screenshot of the Priority Explainer Panel
  const screenshotPath = path.join(ARTIFACTS_DIR, 'priority_explainer_panel.png');
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`✓ Screenshot of Priority Explainer Panel saved to: ${screenshotPath}`);

  await browser.close();
  console.log('--- Priority Explainer Verification Complete: ALL TESTS PASSED ---');
}

main().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
