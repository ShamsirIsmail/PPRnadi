import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';

const BASE_URL = process.env.APP_BASE_URL || 'http://127.0.0.1:3000';
const OUT_DIR = path.resolve('docs/screenshots');

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

// Find Chrome path
function getChromePath() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return undefined;
}

async function capture() {
  const chromePath = getChromePath();
  console.log('[Screenshots] Launching browser...');
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromePath,
  });

  // 1. Mobile viewport (390 x 844)
  console.log('[Screenshots] Capturing mobile screens (390px)...');
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
  });
  const mobilePage = await mobileContext.newPage();

  // 1a. Login BM
  await mobilePage.goto(`${BASE_URL}/login`);
  await mobilePage.waitForSelector('#login-email');
  await mobilePage.screenshot({ path: path.join(OUT_DIR, '01_mobile_login_bm.png'), fullPage: true });

  // 1b. Login EN
  await mobilePage.click('button:has-text("EN")');
  await mobilePage.waitForTimeout(300);
  await mobilePage.screenshot({ path: path.join(OUT_DIR, '02_mobile_login_en.png'), fullPage: true });

  // Reset to BM and login as resident
  await mobilePage.click('button:has-text("BM")');
  await mobilePage.fill('#login-email', 'resident@sentosa.local');
  await mobilePage.fill('#login-password', 'ResidentPPR2026!');
  await mobilePage.click('button[type="submit"]');
  await mobilePage.waitForURL('**/resident');
  await mobilePage.waitForTimeout(500);

  // 1c. Resident Home BM
  await mobilePage.screenshot({ path: path.join(OUT_DIR, '03_resident_home_bm.png'), fullPage: true });

  // 1d. Resident Home EN
  await mobilePage.click('button:has-text("EN")');
  await mobilePage.waitForTimeout(300);
  await mobilePage.screenshot({ path: path.join(OUT_DIR, '04_resident_home_en.png'), fullPage: true });

  // 1e. Resident Report Form BM
  await mobilePage.click('button:has-text("BM")');
  await mobilePage.goto(`${BASE_URL}/resident/lapor`);
  await mobilePage.waitForSelector('#report-description');
  await mobilePage.screenshot({ path: path.join(OUT_DIR, '05_resident_lapor_bm.png'), fullPage: true });

  // 1f. Resident Report Form EN
  await mobilePage.click('button:has-text("EN")');
  await mobilePage.waitForTimeout(300);
  await mobilePage.screenshot({ path: path.join(OUT_DIR, '06_resident_lapor_en.png'), fullPage: true });

  // 1g. Resident History BM
  await mobilePage.click('button:has-text("BM")');
  await mobilePage.goto(`${BASE_URL}/resident/sejarah`);
  await mobilePage.waitForSelector('text=Sejarah Laporan Saya');
  await mobilePage.screenshot({ path: path.join(OUT_DIR, '07_resident_sejarah_bm.png'), fullPage: true });

  // 1h. Resident History EN
  await mobilePage.click('button:has-text("EN")');
  await mobilePage.waitForTimeout(300);
  await mobilePage.screenshot({ path: path.join(OUT_DIR, '08_resident_sejarah_en.png'), fullPage: true });

  await mobileContext.close();

  // 2. Desktop viewport (1440 x 900)
  console.log('[Screenshots] Capturing desktop screens (1440px)...');
  const desktopContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1.5,
  });
  const desktopPage = await desktopContext.newPage();

  // 2a. Desktop Login
  await desktopPage.goto(`${BASE_URL}/login`);
  await desktopPage.waitForSelector('#login-email');
  await desktopPage.screenshot({ path: path.join(OUT_DIR, '09_desktop_login.png') });

  // Login as manager
  await desktopPage.fill('#login-email', 'manager@sentosa.local');
  await desktopPage.fill('#login-password', 'ManagerPPR2026!');
  await desktopPage.click('button[type="submit"]');
  await desktopPage.waitForURL('**/management**');
  await desktopPage.waitForTimeout(500);

  // 2b. Management Overview BM
  await desktopPage.screenshot({ path: path.join(OUT_DIR, '10_desktop_management_overview.png'), fullPage: true });

  // 2c. Management Inbox BM
  await desktopPage.goto(`${BASE_URL}/management/inbox`);
  await desktopPage.waitForSelector('text=Peti Masuk Semakan Laporan Penduduk');
  await desktopPage.screenshot({ path: path.join(OUT_DIR, '11_desktop_management_inbox_bm.png'), fullPage: true });

  // 2d. Management Inbox EN
  await desktopPage.click('button:has-text("EN")');
  await desktopPage.waitForTimeout(300);
  await desktopPage.screenshot({ path: path.join(OUT_DIR, '12_desktop_management_inbox_en.png'), fullPage: true });

  // 2e. Management Incidents BM
  await desktopPage.click('button:has-text("BM")');
  await desktopPage.goto(`${BASE_URL}/management/incidents`);
  await desktopPage.waitForSelector('text=Pusat Kawalan Insiden');
  await desktopPage.screenshot({ path: path.join(OUT_DIR, '13_desktop_management_incidents_bm.png'), fullPage: true });

  // 2f. Management Incidents EN
  await desktopPage.click('button:has-text("EN")');
  await desktopPage.waitForTimeout(300);
  await desktopPage.screenshot({ path: path.join(OUT_DIR, '14_desktop_management_incidents_en.png'), fullPage: true });

  await desktopContext.close();
  await browser.close();
  console.log('[Screenshots] Successfully captured all 14 screens in docs/screenshots/');
}

capture().catch((err) => {
  console.error('[Screenshots] Failed:', err);
  process.exit(1);
});
