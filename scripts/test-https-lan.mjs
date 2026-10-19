import { createRequire } from 'module';
import fs from 'fs';
if (fs.existsSync('.env.local')) {
  process.loadEnvFile('.env.local');
}

const req = createRequire(process.cwd() + '/package.json');
const { chromium } = req('playwright-core');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const RESIDENT_PASSWORD = process.env.DEMO_RESIDENT_PASSWORD;
const MANAGER_PASSWORD = process.env.DEMO_MANAGER_PASSWORD;

async function testHttps() {
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--ignore-certificate-errors']
  });

  // 1. Resident session
  const residentContext = await browser.newContext();
  const resPage = await residentContext.newPage();
  
  console.log('1. Navigating to https://192.168.0.115:3000/login...');
  await resPage.goto('https://192.168.0.115:3000/login', { waitUntil: 'networkidle' });
  console.log('Page title:', await resPage.title());
  
  const isSecure = await resPage.evaluate(() => window.isSecureContext);
  console.log('isSecureContext:', isSecure);

  console.log('2. Logging in as resident (Farid)...');
  await resPage.locator('button', { hasText: 'Penduduk Desa Rejang' }).click();
  await resPage.locator('input[type="password"]').fill(RESIDENT_PASSWORD);
  await resPage.locator('#login-submit-btn').click();
  await resPage.waitForURL('**/resident', { timeout: 15000 });
  console.log('Resident login successful! Landed at:', resPage.url());

  console.log('3. Navigating to resident report page...');
  await resPage.goto('https://192.168.0.115:3000/resident/lapor', { waitUntil: 'networkidle' });
  console.log('Resident lapor page reached! URL:', resPage.url());

  // 2. Manager session (isolated context)
  const managerContext = await browser.newContext();
  const mgrPage = await managerContext.newPage();

  console.log('4. Logging in as manager (Siti)...');
  await mgrPage.goto('https://192.168.0.115:3000/login', { waitUntil: 'networkidle' });
  await mgrPage.locator('button', { hasText: 'Pengurus Desa Rejang' }).click();
  await mgrPage.locator('input[type="password"]').fill(MANAGER_PASSWORD);
  await mgrPage.locator('#login-submit-btn').click();
  await mgrPage.waitForURL('**/management', { timeout: 15000 });
  console.log('Manager login successful! Landed at:', mgrPage.url());

  await browser.close();
  console.log('HTTPS verification 100% complete and working for both roles!');
}

testHttps().catch(err => {
  console.error('HTTPS verification failed:', err);
  process.exit(1);
});
