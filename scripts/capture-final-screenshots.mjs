import { chromium } from 'playwright-core';
import path from 'path';
import fs from 'fs';

if (fs.existsSync('.env.staging.local')) {
  try {
    process.loadEnvFile('.env.staging.local');
  } catch {}
}

const ARTIFACT_DIR = 'C:/Users/shams/.gemini/antigravity-ide/brain/f73c5ee6-76ec-4b98-ac3e-6e23b5a34c2a';
const STAGING_URL = 'https://ppr-nadi-staging.vercel.app';
const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const RESIDENT_EMAIL = 'resident.rejang@nadi.local';
const RESIDENT_PASSWORD = process.env.STAGING_RESIDENT_PASSWORD;

async function run() {
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
  });

  try {
    // 1. Mobile Login (390px)
    console.log('Capturing Mobile Login...');
    const mobileCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
    });
    const mobilePage = await mobileCtx.newPage();
    await mobilePage.goto(`${STAGING_URL}/login`, { waitUntil: 'networkidle' });
    await mobilePage.screenshot({
      path: path.join(ARTIFACT_DIR, 'login_mobile_approved_hero.png'),
      fullPage: true,
    });

    // 2. Desktop Login (1280px)
    console.log('Capturing Desktop Login...');
    const desktopCtx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1.5,
    });
    const desktopPage = await desktopCtx.newPage();
    await desktopPage.goto(`${STAGING_URL}/login`, { waitUntil: 'networkidle' });
    await desktopPage.screenshot({
      path: path.join(ARTIFACT_DIR, 'login_desktop_approved_layout.png'),
      fullPage: true,
    });

    // 3. Resident Home (Utama) (390px)
    console.log('Logging in resident for Home & Logout captures...');
    await mobilePage.fill('input[type="email"]', RESIDENT_EMAIL);
    await mobilePage.fill('input[type="password"]', RESIDENT_PASSWORD);
    await mobilePage.click('button[type="submit"]');
    await mobilePage.waitForURL('**/resident', { timeout: 30000 });
    await mobilePage.waitForLoadState('networkidle');

    await mobilePage.waitForSelector('text=Buat aduan baharu', { timeout: 15000 });
    await mobilePage.screenshot({
      path: path.join(ARTIFACT_DIR, 'resident_home_approved_utama.png'),
      fullPage: true,
    });

    // 4. Resident Logout Confirmation Dialog (triggered from Home residence line)
    console.log('Triggering Logout Confirmation from Home...');
    const logoutBtn = mobilePage.locator('button:has-text("Log keluar")').first();
    await logoutBtn.click();
    await mobilePage.waitForSelector('text=Anda mahu log keluar?', { timeout: 5000 });
    await mobilePage.screenshot({
      path: path.join(ARTIFACT_DIR, 'logout_confirmation_dialog.png'),
    });

    // Dismiss dialog
    await mobilePage.click('button:has-text("Kekal di sini")');
    await mobilePage.waitForTimeout(300);

    // 5. Resident Account Modal (via bottom nav Akaun button)
    console.log('Opening Resident Account Modal...');
    await mobilePage.click('button[aria-label="Akaun"]');
    await mobilePage.waitForSelector('text=Maklumat Akaun', { timeout: 5000 });
    await mobilePage.screenshot({
      path: path.join(ARTIFACT_DIR, 'resident_account_modal.png'),
    });

    console.log('All screenshots captured successfully!');
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error('Screenshot capture failed:', err);
  process.exit(1);
});
