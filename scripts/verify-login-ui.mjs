import { chromium } from 'playwright-core';
import path from 'node:path';

// Load local environment
try {
  process.loadEnvFile('.env.local');
} catch {
  // Already loaded
}

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE_URL = process.env.TEST_APP_URL || 'http://127.0.0.1:3000';
const RESIDENT_EMAIL = 'resident@sentosa.local';
const MANAGER_EMAIL = 'manager@sentosa.local';
const RESIDENT_PASSWORD = process.env.DEMO_RESIDENT_PASSWORD;
const MANAGER_PASSWORD = process.env.DEMO_MANAGER_PASSWORD;
const ARTIFACT_DIR = 'C:\\Users\\shams\\.gemini\\antigravity-ide\\brain\\e0ba7b5f-1fb0-41e5-9e6b-089c0ca70fe2';

if (!RESIDENT_PASSWORD || !MANAGER_PASSWORD) {
  throw new Error('DEMO_RESIDENT_PASSWORD and DEMO_MANAGER_PASSWORD are required for login verification.');
}

const VIEWPORTS = [
  { name: 'mobile-390x844', width: 390, height: 844 },
  { name: 'tablet-768x1024', width: 768, height: 1024 },
  { name: 'desktop-1366x768', width: 1366, height: 768 },
  { name: 'desktop-1440x900', width: 1440, height: 900 },
  { name: 'desktop-1920x1080', width: 1920, height: 1080 },
];

async function run() {
  console.log('==============================================================================');
  console.log('PPR NADI — DESKTOP 2-COLUMN & RESPONSIVE LOGIN VERIFICATION');
  console.log('==============================================================================');

  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    // ------------------------------------------------------------------------
    // 1. Viewport Testing & Screenshot Capture
    // ------------------------------------------------------------------------
    console.log('\n[1/5] Menguji setiap saiz skrin & mengambil screenshot...');
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });

      // Check horizontal overflow
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      if (scrollWidth > vp.width) {
        throw new Error(`Horizontal overflow dikesan pada ${vp.name}: scrollWidth=${scrollWidth}px > ${vp.width}px`);
      }

      // Check visibility of submit button on desktop 1366x768 without scrolling
      if (vp.width === 1366 && vp.height === 768) {
        const btnBox = await page.locator('#login-submit-btn').boundingBox();
        if (!btnBox || btnBox.y + btnBox.height > vp.height) {
          throw new Error(`Butang log masuk terkeluar daripada pandangan awal 1366x768 (y=${btnBox?.y}, h=${btnBox?.height})`);
        }
        console.log(`  ✓ Pada 1366×768: Butang Log masuk berada dalam pandangan tanpa skrol (bottom = ${(btnBox.y + btnBox.height).toFixed(0)}px <= ${vp.height}px)`);
      }

      // Check 2-column layout on desktop (>=1024px)
      if (vp.width >= 1024) {
        const heroBox = await page.locator('.ppr-hero-col').boundingBox();
        const contentBox = await page.locator('.ppr-content-col').boundingBox();
        if (!heroBox || !contentBox || heroBox.x >= contentBox.x) {
          throw new Error(`Susun atur dua lajur tidak aktif pada ${vp.name}: hero.x=${heroBox?.x}, content.x=${contentBox?.x}`);
        }
        // Check tagline and building name in desktop left column
        const hasLeftBuilding = await page.locator('.ppr-hero-col h2').isVisible();
        const hasLeftTagline = await page.locator('.ppr-hero-col').getByText('Community Voices. The Pulse of Change.').isVisible();
        if (!hasLeftBuilding || !hasLeftTagline) {
          throw new Error(`Teks lencana/tagline pada lajur kiri desktop tidak kelihatan pada ${vp.name}`);
        }
      }

      const shotPath = path.join(ARTIFACT_DIR, `login-${vp.name}.png`);
      await page.screenshot({ path: shotPath, fullPage: false });
      console.log(`  ✓ ${vp.name} (${vp.width}×${vp.height}) lulus — Screenshot: login-${vp.name}.png`);
    }

    // ------------------------------------------------------------------------
    // 2. Language Switching without input clearing
    // ------------------------------------------------------------------------
    console.log('\n[2/5] Menguji penukaran bahasa (BM <-> English) tanpa memadam input...');
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });

    await page.fill('#login-email', 'penduduk@sentosa.local');
    await page.fill('#login-password', 'Rahsia123!');

    // Switch to English
    await page.click("button:has-text('English')");
    await page.waitForTimeout(100);

    const emailAfterEn = await page.inputValue('#login-email');
    const passAfterEn = await page.inputValue('#login-password');
    const headingEn = await page.textContent('h1');
    const introEn = await page.locator('main p').first().textContent();

    if (emailAfterEn !== 'penduduk@sentosa.local' || passAfterEn !== 'Rahsia123!') {
      throw new Error('Input pengguna dipadam apabila menukar ke bahasa English!');
    }
    if (!headingEn.includes('Welcome back.')) {
      throw new Error(`Tajuk English tidak tepat: "${headingEn}"`);
    }
    if (!introEn.includes('Sign in to access your portal.')) {
      throw new Error(`Penerangan English tidak tepat: "${introEn}"`);
    }
    console.log('  ✓ Berjaya tukar ke English: tajuk "Welcome back.", intro neutral, input pengguna kekal.');

    // Switch back to BM
    await page.click("button:has-text('BM')");
    await page.waitForTimeout(100);

    const emailAfterBm = await page.inputValue('#login-email');
    const passAfterBm = await page.inputValue('#login-password');
    const headingBm = await page.textContent('h1');
    const introBm = await page.locator('main p').first().textContent();

    if (emailAfterBm !== 'penduduk@sentosa.local' || passAfterBm !== 'Rahsia123!') {
      throw new Error('Input pengguna dipadam apabila menukar semula ke BM!');
    }
    if (!headingBm.includes('Selamat datang.')) {
      throw new Error(`Tajuk BM tidak tepat: "${headingBm}"`);
    }
    if (!introBm.includes('Log masuk untuk mengakses portal anda.')) {
      throw new Error(`Penerangan BM tidak tepat: "${introBm}"`);
    }
    console.log('  ✓ Berjaya tukar ke BM: tajuk "Selamat datang.", intro neutral, input pengguna kekal.');

    // ------------------------------------------------------------------------
    // 3. Password Eye Toggle & Keyboard Focus
    // ------------------------------------------------------------------------
    console.log('\n[3/5] Menguji butang mata papar/sembunyi kata laluan & keyboard focus...');
    const eyeBtn = page.locator("button[aria-controls='login-password']");
    const initialAria = await eyeBtn.getAttribute('aria-label');
    const initialType = await page.getAttribute('#login-password', 'type');

    if (initialType !== 'password' || initialAria !== 'Papar kata laluan') {
      throw new Error(`Keadaan awal kata laluan tidak tepat: type=${initialType}, aria=${initialAria}`);
    }

    // Click show
    await eyeBtn.click();
    const visibleType = await page.getAttribute('#login-password', 'type');
    const visibleAria = await eyeBtn.getAttribute('aria-label');
    if (visibleType !== 'text' || visibleAria !== 'Sorok kata laluan') {
      throw new Error(`Papar kata laluan gagal: type=${visibleType}, aria=${visibleAria}`);
    }

    // Click hide
    await eyeBtn.click();
    const hiddenType = await page.getAttribute('#login-password', 'type');
    const hiddenAria = await eyeBtn.getAttribute('aria-label');
    if (hiddenType !== 'password' || hiddenAria !== 'Papar kata laluan') {
      throw new Error(`Sorok kata laluan semula gagal: type=${hiddenType}, aria=${hiddenAria}`);
    }

    // Keyboard focus test
    await page.locator('#login-email').focus();
    const isEmailFocused = await page.evaluate(() => document.activeElement.id === 'login-email');
    await page.keyboard.press('Tab');
    const isPassFocused = await page.evaluate(() => document.activeElement.id === 'login-password');
    if (!isEmailFocused || !isPassFocused) {
      throw new Error('Keyboard Tab focus pada medan input gagal.');
    }
    console.log('  ✓ Ikon mata (Papar/Sorok kata laluan) dan keyboard navigation Tab berfungsi sempurna.');

    // ------------------------------------------------------------------------
    // 4. Invalid Credentials Error Alert
    // ------------------------------------------------------------------------
    console.log('\n[4/5] Menguji pengendalian ralat kredensial tidak sah...');
    await page.fill('#login-email', 'salah@sentosa.local');
    await page.fill('#login-password', 'KataLaluanSalah123!');
    await page.click('#login-submit-btn');

    const alert = page.locator("[role='alert']");
    await alert.waitFor({ state: 'visible', timeout: 5000 });
    const errorText = await alert.textContent();
    console.log(`  ✓ Ralat dipaparkan dengan role="alert": "${errorText.trim()}"`);

    // ------------------------------------------------------------------------
    // 5. Real Auth & returnTo Redirection
    // ------------------------------------------------------------------------
    console.log('\n[5/5] Menguji log masuk sebenar dan pengalihan returnTo...');

    // Test returnTo to resident sejarah
    await page.goto(`${BASE_URL}/login?returnTo=/resident/sejarah`, { waitUntil: 'networkidle' });
    await page.fill('#login-email', RESIDENT_EMAIL);
    await page.fill('#login-password', RESIDENT_PASSWORD);
    await page.click('#login-submit-btn');

    await page.waitForURL('**/resident/sejarah', { timeout: 10000 });
    console.log('  ✓ returnTo disahkan: Berjaya dialihkan tepat ke /resident/sejarah selepas log masuk.');

    // Log out by clearing cookies
    await context.clearCookies();
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });

    // Test manager login
    await page.fill('#login-email', MANAGER_EMAIL);
    await page.fill('#login-password', MANAGER_PASSWORD);
    await page.click('#login-submit-btn');

    await page.waitForURL('**/management**', { timeout: 10000 });
    console.log('  ✓ Log masuk Pengurus disahkan: Berjaya dialihkan ke /management.');

    console.log('\n==============================================================================');
    console.log('SEMUA UJIAN DUA LAJUR DESKTOP, RESPONSIF, BAHASA & AUTH SELESAI DENGAN JAYANYA!');
    console.log('==============================================================================');
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error('\n❌ UJIAN LOGIN GAGAL:', err);
  process.exit(1);
});
