import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

// Load .env.staging.local
if (fs.existsSync('.env.staging.local')) {
  process.loadEnvFile('.env.staging.local');
}

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const STAGING_URL = 'https://ppr-nadi-staging.vercel.app';
const RESIDENT_EMAIL = 'resident.rejang@nadi.local';
const RESIDENT_PASS = process.env.STAGING_RESIDENT_PASSWORD;
if (!RESIDENT_PASS) {
  console.error('Configuration error: STAGING_RESIDENT_PASSWORD is required in environment.');
  process.exit(1);
}

const ARTIFACT_DIR = 'C:\\Users\\shams\\.gemini\\antigravity-ide\\brain\\f73c5ee6-76ec-4b98-ac3e-6e23b5a34c2a';

async function captureScreenshots() {
  console.log('=== Capturing 4-Step Guided Flow Screenshots on Staging ===');
  console.log('Target URL:', STAGING_URL);
  console.log('Using Chrome:', CHROME_PATH);

  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
  });

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  });

  const page = await context.newPage();

  try {
    // 1. Login
    console.log('Navigating to login page...');
    await page.goto(`${STAGING_URL}/login`, { waitUntil: 'networkidle', timeout: 30000 });

    console.log('Filling resident credentials...');
    await page.fill('input[type="email"]', RESIDENT_EMAIL);
    await page.fill('input[type="password"]', RESIDENT_PASS);
    await page.click('button[type="submit"]');

    console.log('Waiting for resident dashboard...');
    await page.waitForURL('**/resident', { timeout: 30000 });

    // 2. Navigate to Lapor
    console.log('Navigating to Lapor page...');
    await page.goto(`${STAGING_URL}/resident/lapor`, { waitUntil: 'networkidle', timeout: 30000 });

    // 3. Click Aduan Berpandu on start screen
    console.log('Selecting Aduan Berpandu...');
    const guidedBtn = page.locator('button:has-text("Aduan berpandu")');
    await guidedBtn.waitFor({ state: 'visible', timeout: 10000 });
    await guidedBtn.click();

    // STEP 1: LOKASI
    console.log('At Step 1: Lokasi...');
    await page.waitForSelector('text=Langkah 1 daripada 4', { timeout: 10000 });
    // Select Tingkat 12
    const floorBtn = page.locator('button:has-text("12")').first();
    if (await floorBtn.isVisible()) {
      await floorBtn.click();
    }
    await page.waitForTimeout(600);
    const step1Path = path.join(ARTIFACT_DIR, 'step1_lokasi_390px.png');
    await page.screenshot({ path: step1Path, fullPage: false });
    console.log('Saved:', step1Path);

    // Click Seterusnya to Step 2
    console.log('Navigating to Step 2: Masalah...');
    await page.click('button:has-text("Seterusnya")');

    // STEP 2: MASALAH
    console.log('At Step 2: Masalah...');
    await page.waitForSelector('text=Langkah 2 daripada 4', { timeout: 10000 });
    // Click category Bekalan Air
    await page.click('button:has-text("Bekalan Air")');
    await page.waitForTimeout(400);
    // Click sub-issue Tekanan rendah
    await page.click('button:has-text("Tekanan rendah")');
    await page.waitForTimeout(600);
    const step2Path = path.join(ARTIFACT_DIR, 'step2_masalah_390px.png');
    await page.screenshot({ path: step2Path, fullPage: false });
    console.log('Saved:', step2Path);

    // Click Seterusnya to Step 3
    console.log('Navigating to Step 3: Bukti...');
    await page.click('button:has-text("Seterusnya")');

    // STEP 3: BUKTI
    console.log('At Step 3: Bukti...');
    await page.waitForSelector('text=Langkah 3 daripada 4', { timeout: 10000 });
    await page.waitForTimeout(600);
    const step3Path = path.join(ARTIFACT_DIR, 'step3_bukti_390px.png');
    await page.screenshot({ path: step3Path, fullPage: false });
    console.log('Saved:', step3Path);

    // Click Semak tanpa gambar to Step 4
    console.log('Navigating to Step 4: Semak...');
    const checkBtn = page.locator('button:has-text("Semak tanpa gambar")');
    await checkBtn.waitFor({ state: 'visible', timeout: 10000 });
    await checkBtn.click();

    // STEP 4: SEMAK
    console.log('At Step 4: Semak...');
    await page.waitForSelector('text=Langkah 4 daripada 4', { timeout: 10000 });
    await page.waitForTimeout(600);
    const step4Path = path.join(ARTIFACT_DIR, 'step4_semak_390px.png');
    await page.screenshot({ path: step4Path, fullPage: false });
    console.log('Saved:', step4Path);

    console.log('=== ALL 4 STEPS CAPTURED SUCCESSFULLY ON STAGING! ===');
  } finally {
    await browser.close();
  }
}

captureScreenshots().catch((err) => {
  console.error('[ERROR capturing screenshots]:', err.message);
  process.exit(1);
});
