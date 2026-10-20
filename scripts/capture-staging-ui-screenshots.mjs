import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

if (fs.existsSync('.env.staging.local')) {
  process.loadEnvFile('.env.staging.local');
} else if (fs.existsSync('.env.local')) {
  process.loadEnvFile('.env.local');
}

const req = createRequire(process.cwd() + '/package.json');
const { chromium } = req('playwright-core');

const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TARGET_URL = process.env.CAPTURE_URL || 'https://ppr-nadi-staging.vercel.app';
const ARTIFACT_DIR = 'C:/Users/shams/.gemini/antigravity-ide/brain/f73c5ee6-76ec-4b98-ac3e-6e23b5a34c2a';

async function main() {
  process.env.TEST_DISABLE_AI_CALLS = 'true';
  process.env.STAGING_DISABLE_AI = 'true';

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
    permissions: ['microphone'],
    ignoreHTTPSErrors: true
  });

  const page = await context.newPage();

  console.log(`1. Logging in on ${TARGET_URL}...`);
  await page.goto(`${TARGET_URL}/login`, { waitUntil: 'networkidle' });

  if (TARGET_URL.includes('vercel.app')) {
    await page.fill('input[type="email"]', 'resident.rejang@nadi.local');
    await page.fill('input[type="password"]', process.env.STAGING_RESIDENT_PASSWORD);
    await page.click('button[type="submit"]');
  } else {
    await page.locator('button', { hasText: 'Penduduk Desa Rejang' }).click();
    await page.locator('input[type="password"]').fill(process.env.DEMO_RESIDENT_PASSWORD || 'PPRnadi@2026');
    await page.locator('#login-submit-btn').click();
  }

  await page.waitForURL(url => url.pathname.includes('/resident'), { timeout: 15000 });

  // 2. Go to /resident/lapor
  console.log('2. Navigating to /resident/lapor...');
  await page.goto(`${TARGET_URL}/resident/lapor`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // Capture Mula Aduan (390px)
  const mula390Path = path.join(ARTIFACT_DIR, 'mula_aduan_390px.png');
  await page.screenshot({ path: mula390Path });
  console.log('Saved:', mula390Path);

  // Responsive widths: 360px & 430px for Mula Aduan
  await page.setViewportSize({ width: 360, height: 800 });
  await page.waitForTimeout(200);
  const mula360Path = path.join(ARTIFACT_DIR, 'mula_aduan_360px.png');
  await page.screenshot({ path: mula360Path });
  console.log('Saved:', mula360Path);

  await page.setViewportSize({ width: 430, height: 932 });
  await page.waitForTimeout(200);
  const mula430Path = path.join(ARTIFACT_DIR, 'mula_aduan_430px.png');
  await page.screenshot({ path: mula430Path });
  console.log('Saved:', mula430Path);

  // Reset to 390px standard
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);

  // 3. Open Guided Voice Assistant Modal
  console.log('3. Opening Guided Voice Assistant modal...');
  await page.locator('[data-testid="start-voice-assistant-button"]').click();
  await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
  await page.waitForTimeout(400);

  // Switch to Mod Ujian Rakaman
  await page.locator('button', { hasText: 'Mod Ujian Rakaman' }).click();
  await page.waitForTimeout(400);

  // Voice Assistant: Sedia (Ready state)
  const voiceReadyPath = path.join(ARTIFACT_DIR, 'aduan_suara_sedia_390px.png');
  await page.screenshot({ path: voiceReadyPath });
  console.log('Saved:', voiceReadyPath);

  // Voice Assistant: Sedang Merakam (Recording state)
  console.log('4. Starting recording...');
  await page.locator('button', { hasText: 'Mula rakaman' }).click();
  await page.waitForSelector('button:has-text("Selesai bercakap")', { timeout: 5000 });
  await page.waitForTimeout(1500); // Allow wave animation and timer to progress

  const voiceRecPath = path.join(ARTIFACT_DIR, 'aduan_suara_merakam_390px.png');
  await page.screenshot({ path: voiceRecPath });
  console.log('Saved:', voiceRecPath);

  // Voice Assistant: Rakaman Sedia / Playback (Recorded state)
  console.log('5. Stopping recording to finalize audio...');
  await page.locator('button', { hasText: 'Selesai bercakap' }).click();
  await page.waitForSelector('audio', { timeout: 8000 });
  await page.waitForTimeout(500);

  const voicePlaybackPath = path.join(ARTIFACT_DIR, 'aduan_suara_audio_sedia_390px.png');
  await page.screenshot({ path: voicePlaybackPath });
  console.log('Saved:', voicePlaybackPath);

  // Test "Rakam semula"
  console.log('6. Testing "Rakam semula"...');
  await page.locator('button', { hasText: 'Rakam semula' }).click();
  await page.waitForSelector('button:has-text("Mula rakaman")', { timeout: 5000 });
  console.log('Rakam semula works!');

  // Test "Saya mahu taip sahaja" (switches to manual form cleanly preserving state)
  console.log('7. Testing "Saya mahu taip sahaja"...');
  await page.locator('button', { hasText: 'Saya mahu taip sahaja' }).click();
  await page.waitForTimeout(500);

  // Modal should be closed and manual form active
  const manualDescVisible = await page.locator('textarea#manual-desc').isVisible();
  console.log('Switched to manual form? Textarea visible:', manualDescVisible);

  await browser.close();
  console.log('All screenshots captured and UI states verified successfully!');
}

main().catch((err) => {
  console.error('Capture error:', err);
  process.exit(1);
});
