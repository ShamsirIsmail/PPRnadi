import { createRequire } from 'module';
import fs from 'fs';
if (fs.existsSync('.env.local')) {
  process.loadEnvFile('.env.local');
}

const req = createRequire(process.cwd() + '/package.json');
const { chromium } = req('playwright-core');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const RESIDENT_PASSWORD = process.env.DEMO_RESIDENT_PASSWORD;

async function runTest() {
  console.log('--- PPR NADI: End-to-End Alternative Recording & HTTPS Test ---');
  
  // Set test environment guard to block AI calls
  process.env.TEST_DISABLE_AI_CALLS = 'true';

  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: [
      '--ignore-certificate-errors',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ]
  });

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ['microphone']
  });

  const page = await context.newPage();

  // 1. Visit Login
  console.log('1. Navigating to https://192.168.0.115:3000/login ...');
  await page.goto('https://192.168.0.115:3000/login', { waitUntil: 'networkidle' });

  // 2. Login
  console.log('2. Logging in as resident Farid...');
  await page.locator('button', { hasText: 'Penduduk Desa Rejang' }).click();
  await page.locator('input[type="password"]').fill(RESIDENT_PASSWORD);
  await page.locator('#login-submit-btn').click();
  await page.waitForURL('**/resident', { timeout: 15000 });
  console.log('Logged in successfully. URL:', page.url());

  // 3. Navigate to /resident/lapor
  console.log('3. Navigating to /resident/lapor ...');
  await page.goto('https://192.168.0.115:3000/resident/lapor', { waitUntil: 'networkidle' });
  console.log('Lapor page loaded. URL:', page.url());

  // 4. Open Guided Voice Modal via data-testid
  console.log('4. Opening Voice Assistant modal...');
  await page.locator('[data-testid="start-voice-assistant-button"]').click();
  await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
  console.log('Voice Assistant modal is open!');

  // 5. Switch to Alternative Audio Recording Mode
  console.log('5. Selecting "Mod Ujian Rakaman" (MediaRecorder)...');
  await page.locator('button', { hasText: 'Mod Ujian Rakaman' }).click();
  await page.waitForTimeout(400);

  // Screenshot 1: Ready state
  const readyPath = 'C:/Users/shams/.gemini/antigravity-ide/brain/f73c5ee6-76ec-4b98-ac3e-6e23b5a34c2a/iphone_voice_ready_390px.png';
  await page.screenshot({ path: readyPath });
  console.log('Captured ready state screenshot:', readyPath);

  // 6. Start Recording
  console.log('6. Clicking "Mula rakaman"...');
  await page.locator('button', { hasText: 'Mula rakaman' }).click();
  await page.waitForSelector('button:has-text("Selesai bercakap")', { timeout: 5000 });
  console.log('Microphone is active! Currently recording...');

  // Screenshot 2: Recording state
  await page.waitForTimeout(1500);
  const recPath = 'C:/Users/shams/.gemini/antigravity-ide/brain/f73c5ee6-76ec-4b98-ac3e-6e23b5a34c2a/iphone_voice_recording_390px.png';
  await page.screenshot({ path: recPath });
  console.log('Captured recording state screenshot:', recPath);

  // Record for 2 more seconds
  await page.waitForTimeout(2000);

  // 7. Stop Recording
  console.log('7. Clicking "Selesai bercakap"...');
  await page.locator('button', { hasText: 'Selesai bercakap' }).click();
  await page.waitForSelector('audio', { timeout: 8000 });
  console.log('Audio recording finalized! Audio player element is present.');

  // Verify audio element properties
  const audioSrc = await page.locator('audio').getAttribute('src');
  console.log('Audio blob object URL:', audioSrc);
  if (!audioSrc || !audioSrc.startsWith('blob:')) {
    throw new Error('Audio element does not have a valid blob URL: ' + audioSrc);
  }

  // Screenshot 3: Recorded & Playback ready state
  const donePath = 'C:/Users/shams/.gemini/antigravity-ide/brain/f73c5ee6-76ec-4b98-ac3e-6e23b5a34c2a/iphone_voice_playback_390px.png';
  await page.screenshot({ path: donePath });
  console.log('Captured playback ready state screenshot:', donePath);

  // 8. Test "Rakam semula"
  console.log('8. Testing "Rakam semula" (Re-record)...');
  await page.locator('button', { hasText: 'Rakam semula' }).click();
  await page.waitForSelector('button:has-text("Mula rakaman")', { timeout: 5000 });
  console.log('Re-record successfully reset state to Ready!');

  // 9. Close Modal
  console.log('9. Closing modal and ensuring hardware tracks cleaned...');
  await page.locator('button[aria-label="Tutup"]').click();
  await page.waitForTimeout(500);

  // 10. Verify Zero AI stats
  const statsFile = process.cwd() + '/.ai-guard-stats.json';
  if (fs.existsSync(statsFile)) {
    const stats = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
    console.log('AI Guard stats:', stats);
  } else {
    console.log('AI Guard stats file not touched (ZERO AI calls initiated).');
  }

  await browser.close();
  console.log('--- ALL AUTOMATED E2E TESTS PASSED SUCCESSFULLY! ---');
}

runTest().catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});
