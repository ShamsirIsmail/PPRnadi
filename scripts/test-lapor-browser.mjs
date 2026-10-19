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
    console.log('[STATUS: DISEKAT / BLOCKED] Supabase Auth tidak aktif pada endpoint. Ujian pelayar login disekat.');
    return;
  }

  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
  });

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();

  console.log('Navigating to /login...');
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });

  console.log('Attempting login as resident via Supabase Auth...');
  await page.waitForSelector('#login-email', { timeout: 10000 });
  await page.fill('#login-email', 'resident@sentosa.local');
  await page.fill('#login-password', process.env.DEMO_RESIDENT_PASSWORD || '');
  await page.click('button[type="submit"]');

  await page.waitForTimeout(4000);
  console.log('Current URL after login attempt:', page.url());

  await browser.close();
}

main().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
