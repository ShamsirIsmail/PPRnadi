import { chromium } from 'playwright-core';
import fs from 'node:fs';

if (fs.existsSync('.env.local')) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // Continue
  }
}

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE_URL = 'http://localhost:3000';
const SAMPLE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

async function checkSupabase(url) {
  try {
    const res = await fetch(`${url}/auth/v1/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function test() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:64321';
  const online = await checkSupabase(supabaseUrl);
  if (!online) {
    console.log('[STATUS: DISEKAT / BLOCKED] Perkhidmatan Supabase tidak aktif. Ujian pelayar file-input disekat.');
    return;
  }

  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Login via Supabase auth
  await page.goto(`${BASE_URL}/login`);
  await page.fill('#login-email', 'resident@sentosa.local');
  await page.fill('#login-password', process.env.DEMO_RESIDENT_PASSWORD || '');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/resident', { timeout: 10000 });

  await page.goto(`${BASE_URL}/resident/lapor`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main');

  console.log('Testing filechooser with gallery button/label...');
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.click('[data-testid="file-picker-label"]');
  const fileChooser = await fileChooserPromise;
  console.log('Got fileChooser! Setting files...');
  const photo1 = { name: 'bukti_lampu_padam.png', mimeType: 'image/png', buffer: SAMPLE_PNG };
  await fileChooser.setFiles([photo1]);

  await page.waitForTimeout(1000);

  const removeButtons = await page.$$('[data-testid^="remove-file-"]');
  console.log('Number of remove buttons found:', removeButtons.length);

  await browser.close();
}

test().catch(console.error);
