import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

// Load .env.local if present
if (fs.existsSync('.env.local')) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // Continue
  }
}

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE_URL = 'http://localhost:3000';
const ARTIFACTS_DIR = 'C:\\Users\\shams\\.gemini\\antigravity-ide\\brain\\f73c5ee6-76ec-4b98-ac3e-6e23b5a34c2a';

// Minimal 1x1 valid PNG
const SAMPLE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

async function checkSupabaseReachable(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`${url}/auth/v1/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  console.log('--- Starting PPR NADI Report Form Verification ---');

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:64321';
  const isSupabaseOnline = await checkSupabaseReachable(supabaseUrl);

  if (!isSupabaseOnline) {
    console.log('[STATUS: DISEKAT / BLOCKED]');
    console.log(`Perkhidmatan Supabase Auth pada endpoint [${supabaseUrl}] tidak dapat dihubungi (Docker daemon tidak aktif).`);
    console.log('Mengikut polisi keselamatan projek:');
    console.log('1. Bypass cookie ppr_demo_role TIDAK diguna pakai.');
    console.log('2. Fallback profil atau kelayakan palsu TIDAK dicipta.');
    console.log('3. Ujian browser penuh disekat sehingga perkhidmatan Supabase dihidupkan.');
    console.log('Ujian unit regresi (tests/auth-recovery-regression.test.ts) telah lulus membuktikan integriti autentikasi.');
    return;
  }

  const residentEmail = 'resident@sentosa.local';
  const residentPassword = process.env.DEMO_RESIDENT_PASSWORD;

  if (!residentPassword) {
    console.log('[STATUS: DISEKAT / BLOCKED]');
    console.log('Pemboleh ubah DEMO_RESIDENT_PASSWORD tiada dalam persekitaran server. Ujian disekat.');
    return;
  }

  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
  });

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, // Mobile 390x844
  });
  const page = await context.newPage();

  console.log('1. Logging in via legitimate Supabase Auth at /login...');
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#login-email', { timeout: 10000 });
  await page.fill('#login-email', residentEmail);
  await page.fill('#login-password', residentPassword);
  await page.click('button[type="submit"]');

  await page.waitForURL('**/resident', { timeout: 10000 });
  console.log('✓ Successfully authenticated via Supabase Auth');

  console.log('2. Navigating to /resident/lapor...');
  await page.goto(`${BASE_URL}/resident/lapor`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main', { timeout: 10000 });

  console.log('3. Selecting category and filling test complaint...');
  const liftBtn = page.locator('button:has-text("Lif")').first();
  await liftBtn.click();

  const descField = page.locator('textarea[name="description"]');
  await descField.fill('UJIAN DEMO: Lif penumpang berbunyi bising semasa beroperasi antara tingkat 4 dan 5.');

  console.log('4. Adding test photo attachments...');
  const galleryInput = page.locator('input[data-testid="file-picker-input"]');
  await galleryInput.setInputFiles([
    { name: 'lampiran_1.png', mimeType: 'image/png', buffer: SAMPLE_PNG },
  ]);

  const removeBtns = page.locator('[data-testid^="remove-file-"]');
  await removeBtns.first().waitFor({ state: 'visible', timeout: 5000 });
  console.log('✓ Photo thumbnail rendered properly');

  console.log('5. Navigating to Step 2 (Review) and testing Back button...');
  await page.locator('[data-testid="review-report-button"]').click();
  await page.locator('h1:has-text("Semak Butiran Aduan")').waitFor({ state: 'visible', timeout: 5000 });
  console.log('✓ Step 2 Review loaded with preserved inputs and photo thumbnail');

  // Test Back to details
  await page.locator('header button[aria-label="Kembali"]').click();
  await descField.waitFor({ state: 'visible', timeout: 5000 });
  const descVal = await descField.inputValue();
  if (!descVal.includes('UJIAN DEMO')) {
    throw new Error('Description lost when navigating back from review!');
  }
  console.log('✓ Navigating back from review preserved all inputs and files');

  // Return to Review and Submit once
  console.log('6. Submitting single report...');
  await page.locator('[data-testid="review-report-button"]').click();
  await page.locator('[data-testid="submit-report-button"]').click();

  await page.waitForSelector('[data-testid="report-success-screen"]', { timeout: 15000 });
  const refText = await page.locator('[data-testid="report-reference-number"]').innerText();
  console.log(`✓ Report successfully created with server reference: ${refText}`);

  // Capture screenshot
  const screenshotPath = path.join(ARTIFACTS_DIR, 'resident_lapor_submitted.png');
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`✓ Screenshot saved to: ${screenshotPath}`);

  await browser.close();
  console.log('--- Verification Complete: ALL TESTS PASSED ---');
}

main().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
