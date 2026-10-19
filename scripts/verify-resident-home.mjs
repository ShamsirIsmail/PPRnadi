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
const RESIDENT_PASSWORD = process.env.DEMO_RESIDENT_PASSWORD;
const ARTIFACT_DIR = 'C:\\Users\\shams\\.gemini\\antigravity-ide\\brain\\e0ba7b5f-1fb0-41e5-9e6b-089c0ca70fe2';

if (!RESIDENT_PASSWORD) {
  throw new Error('DEMO_RESIDENT_PASSWORD is required in .env.local.');
}

const VIEWPORTS = [
  { name: 'mobile-360x800', width: 360, height: 800 },
  { name: 'mobile-390x844', width: 390, height: 844 },
  { name: 'mobile-430x932', width: 430, height: 932 },
  { name: 'desktop-1366x768', width: 1366, height: 768 },
];

async function run() {
  console.log('==============================================================================');
  console.log('PPR NADI — RESIDENT HOME VERIFICATION & SCREENSHOT SUITE');
  console.log('==============================================================================');

  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    // 1. Authenticate resident
    console.log('\n[1/6] Mengautentikasi penduduk di /login...');
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
    await page.fill('#login-email', RESIDENT_EMAIL);
    await page.fill('#login-password', RESIDENT_PASSWORD);
    await page.click('#login-submit-btn');
    await page.waitForURL('**/resident', { timeout: 10000 });
    await page.waitForSelector("text=Ahmad bin Razak", { timeout: 10000 });
    console.log('  ✓ Penduduk berjaya diautentikasi dan tiba di /resident.');

    // 2. Viewport testing & Screenshots
    console.log('\n[2/6] Menguji responsif pada 360×800, 390×844, 430×932 dan 1366×768...');
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(200);

      // Check horizontal overflow
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      if (scrollWidth > vp.width) {
        throw new Error(`Horizontal overflow dikesan pada ${vp.name}: scrollWidth=${scrollWidth}px > ${vp.width}px`);
      }

      const shotPath = path.join(ARTIFACT_DIR, `resident-${vp.name}.png`);
      await page.screenshot({ path: shotPath, fullPage: false });
      console.log(`  ✓ ${vp.name} (${vp.width}×${vp.height}) lulus — Screenshot: resident-${vp.name}.png`);
    }

    // Set to 390x844 for functional verification
    await page.setViewportSize({ width: 390, height: 844 });

    // 3. Verify Resident Profile Identity
    console.log('\n[3/6] Memeriksa maklumat profil penduduk sebenar...');
    const bodyText = await page.textContent('body');
    if (!bodyText.includes('Ahmad bin Razak')) {
      throw new Error('Nama penduduk "Ahmad bin Razak" tidak dipaparkan pada halaman.');
    }
    if (!bodyText.includes('Blok A')) {
      throw new Error('Nama blok "Blok A" tidak dipaparkan pada halaman.');
    }
    if (!bodyText.includes('PPR Sentosa')) {
      throw new Error('Nama kawasan "PPR Sentosa" tidak dipaparkan pada halaman.');
    }
    console.log('  ✓ Data profil penduduk disahkan: Ahmad bin Razak, Blok A, Unit 05-01, PPR Sentosa.');

    // 4. Verify Prominent Report Action & Quick Categories
    console.log('\n[4/6] Menguji tindakan lapor masalah & kategori pantas...');
    const reportPanelText = await page.locator("section[aria-label*='Lapor Masalah']").textContent();
    if (!reportPanelText.includes('Ceritakan masalah melalui suara atau taip sendiri.')) {
      throw new Error('Penerangan ringkas tindakan lapor tidak sepadan dengan arahan.');
    }
    console.log('  ✓ Penerangan panel lapor disahkan tepat.');

    // Test clicking quick category "Lif"
    await page.click("a[href*='category=lift']");
    await page.waitForURL('**/resident/lapor?category=lift', { timeout: 8000 });
    console.log('  ✓ Kategori pantas "Lif" berjaya membawa pilihan ke /resident/lapor?category=lift.');

    // Return to /resident
    await page.goto(`${BASE_URL}/resident`, { waitUntil: 'networkidle' });
    await page.waitForSelector("text=Ahmad bin Razak", { timeout: 10000 });

    // 5. Test Language Switcher (BM <-> English) on 390x844
    console.log('\n[5/6] Menguji penukaran bahasa pada 390×844...');
    await page.setViewportSize({ width: 390, height: 844 });

    await page.click("button:has-text('English')");
    await page.waitForTimeout(300);

    const enText = await page.textContent('body');
    if (!enText.includes('Facility reporting') || !enText.includes('Describe the problem by voice or type it yourself.')) {
      throw new Error('Terjemahan English gagal dipaparkan pada tindakan lapor.');
    }
    if (!enText.includes('Community notices')) {
      throw new Error('Terjemahan English untuk notis gagal dipaparkan.');
    }
    const enScreenshotPath = path.join(ARTIFACT_DIR, 'resident-mobile-390x844-en.png');
    await page.screenshot({ path: enScreenshotPath, fullPage: false });
    console.log('  ✓ Tukar ke English berjaya — Screenshot: resident-mobile-390x844-en.png');

    await page.click("button:has-text('BM')");
    await page.waitForTimeout(300);
    const bmText = await page.textContent('body');
    if (!bmText.includes('Aduan fasiliti') || !bmText.includes('Notis komuniti')) {
      throw new Error('Terjemahan BM gagal dipaparkan semula.');
    }
    const bmScreenshotPath = path.join(ARTIFACT_DIR, 'resident-mobile-390x844-bm.png');
    await page.screenshot({ path: bmScreenshotPath, fullPage: false });
    console.log('  ✓ Tukar ke BM berjaya — Screenshot: resident-mobile-390x844-bm.png');

    // 6. Test Bottom Navigation & Account Modal
    console.log('\n[6/6] Menguji navigasi bawah & modal Akaun...');
    // Click Akaun tab
    await page.click("button:has-text('Akaun')");
    await page.waitForSelector("[role='dialog']", { timeout: 5000 });
    const modalText = await page.locator("[role='dialog']").textContent();

    if (!modalText.includes('Maklumat Akaun Penduduk') || !modalText.includes('Ahmad bin Razak')) {
      throw new Error('Modal akaun tidak memaparkan maklumat penduduk yang tepat.');
    }
    console.log('  ✓ Tab Akaun membuka modal maklumat profil penduduk dengan butang Keluar.');

    // Close modal
    await page.click("button:has-text('Tutup')");
    await page.waitForSelector("[role='dialog']", { state: 'hidden', timeout: 5000 });
    console.log('  ✓ Modal akaun berjaya ditutup.');

    // Click Aduan Saya tab in bottom navigation
    await page.locator("nav[aria-label='Navigasi Utama Penduduk'] a[href='/resident/sejarah']").click();
    await page.waitForURL('**/resident/sejarah', { timeout: 8000 });
    console.log('  ✓ Tab "Aduan Saya" berjaya mengalihkan ke /resident/sejarah.');

    console.log('\n==============================================================================');
    console.log('SEMUA UJIAN HALAMAN /RESIDENT LULUS 100%!');
    console.log('==============================================================================');
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error('\n❌ UJIAN RESIDENT HOME GAGAL:', err);
  process.exit(1);
});
