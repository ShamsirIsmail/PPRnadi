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
const SAMPLE_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:64321';
  let isOnline = false;
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/health`, { signal: AbortSignal.timeout(1500) });
    isOnline = res.ok;
  } catch {
    isOnline = false;
  }

  if (!isOnline) {
    console.log('[STATUS: DISEKAT / BLOCKED] Supabase tidak aktif. Ujian pelayar disekat.');
    return;
  }

  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/login`);
  await page.fill('#login-email', 'resident@sentosa.local');
  await page.fill('#login-password', process.env.DEMO_RESIDENT_PASSWORD || '');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/resident', { timeout: 10000 });

  await page.goto(`${BASE_URL}/resident/lapor`);
  await page.waitForSelector('main');

  await page.setInputFiles('input[data-testid="file-picker-input"]', [{ name: 'test.png', mimeType: 'image/png', buffer: SAMPLE_PNG }]);
  await page.waitForTimeout(1000);

  const thumbCount = await page.locator('[data-testid^="remove-file-"]').count();
  console.log('Thumbnail remove buttons count:', thumbCount);

  await browser.close();
}

main().catch(console.error);
