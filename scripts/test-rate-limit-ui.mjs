import assert from 'node:assert/strict';
import fs from 'node:fs';
import postgres from 'postgres';
import { chromium } from 'playwright-core';

// Load environment from .env.staging.local
if (fs.existsSync('.env.staging.local')) {
  process.loadEnvFile('.env.staging.local');
}

const TARGET_URL = process.env.TEST_APP_URL || 'https://ppr-nadi-staging.vercel.app';
const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const RESIDENT_PASSWORD = process.env.STAGING_RESIDENT_PASSWORD;
const STAGING_DB_URL = process.env.STAGING_DATABASE_URL;

if (!RESIDENT_PASSWORD) {
  console.error('[CONFIG ERROR] STAGING_RESIDENT_PASSWORD is required.');
  process.exit(1);
}

// Format relative elapsed time (e.g. "+1.2s")
function formatOffset(startMs, nowMs = Date.now()) {
  const diffSec = ((nowMs - startMs) / 1000).toFixed(1);
  return `+${diffSec}s`;
}

function formatClock(d = new Date()) {
  return d.toTimeString().split(' ')[0] + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

/**
 * Checks existing server rate limit window via staging database read-only query.
 * NEVER resets or deletes records; waits patiently for the window to expire naturally.
 */
async function waitForExistingWindowExpiry() {
  console.log('[Pre-Check] Checking active server rate limit window on staging database...');

  if (STAGING_DB_URL) {
    let sql = null;
    try {
      sql = postgres(STAGING_DB_URL, { max: 1, ssl: 'require', connect_timeout: 5 });
      const rows = await sql.unsafe(`
        SELECT client_hash, attempts, window_start, updated_at,
               EXTRACT(EPOCH FROM (window_start + interval '60 seconds' - clock_timestamp()))::int AS remaining_seconds
        FROM public.demo_rate_limits
        ORDER BY updated_at DESC
        LIMIT 5;
      `);

      if (rows && rows.length > 0) {
        const maxRemaining = Math.max(...rows.map((r) => r.remaining_seconds || 0));
        if (maxRemaining > 0) {
          const waitTime = maxRemaining + 3; // +3s safety margin
          console.log(`[Pre-Check] Found active rate limit window on server (${maxRemaining}s remaining).`);
          console.log(`[Pre-Check] Waiting ${waitTime}s for server rate limit window to expire completely naturally...`);
          for (let remaining = waitTime; remaining > 0; remaining -= 5) {
            console.log(`  -> Menunggu window sedia ada tamat: ${remaining}s lagi...`);
            const sleepStep = Math.min(5, remaining) * 1000;
            await new Promise((r) => setTimeout(r, sleepStep));
          }
          console.log('[Pre-Check] Server rate limit window has expired cleanly.');
          return;
        }
      }
      console.log('[Pre-Check] No active unexpired window detected in database (or all existing windows expired).');
    } catch (err) {
      console.log(`[Pre-Check Note] Could not query database directly (${err.message}); falling back to standard 65s safe wait.`);
      console.log('[Pre-Check] Waiting 65s safe window with periodic updates...');
      for (let remaining = 65; remaining > 0; remaining -= 10) {
        console.log(`  -> Menunggu window sedia ada tamat: ${remaining}s lagi...`);
        const sleepStep = Math.min(10, remaining) * 1000;
        await new Promise((r) => setTimeout(r, sleepStep));
      }
      return;
    } finally {
      if (sql) await sql.end().catch(() => {});
    }
  } else {
    console.log('[Pre-Check] STAGING_DATABASE_URL not set; waiting 65s safe window...');
    for (let remaining = 65; remaining > 0; remaining -= 10) {
      console.log(`  -> Menunggu window sedia ada tamat: ${remaining}s lagi...`);
      await new Promise((r) => setTimeout(r, Math.min(10, remaining) * 1000));
    }
  }

  // Small buffer to guarantee freshness
  await new Promise((r) => setTimeout(r, 2000));
}

async function runStrictRateLimitUiVerification() {
  console.log('==============================================================================');
  console.log('PPR NADI — STRICT LIVE STAGING RATE LIMITER UI & ISOLATION VERIFICATION');
  console.log('==============================================================================');
  console.log(`[Target URL] ${TARGET_URL}`);

  // 1. Wait for any existing rate limit window on the server to expire cleanly
  await waitForExistingWindowExpiry();

  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
  });

  const runStartMs = Date.now();
  const attemptLog = [];
  let testSuiteVerdict = 'PASS';
  let failureReason = '';

  try {
    // Single isolated context with consistent client IP throughout test run
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();

    console.log('\n[Phase 1] Executing 6 Sequential Attempts to Validate Strict 5-Attempt Cap...');
    console.log('------------------------------------------------------------------------------');

    for (let attempt = 1; attempt <= 6; attempt++) {
      const attemptStartMs = Date.now();
      const offsetStr = formatOffset(runStartMs, attemptStartMs);
      const clockStr = formatClock(new Date(attemptStartMs));

      // Clear session cookies so we can access /login (prevents proxy redirecting authenticated user)
      // Note: Server rate limiter relies on IP hash, so cookie deletion never resets the count
      await context.clearCookies();

      console.log(`\n[Cubaan ${attempt}/6] ${clockStr} (${offsetStr}) Navigating to /login...`);
      await page.goto(`${TARGET_URL}/login`, { waitUntil: 'networkidle' });

      const residentDemoBtn = page.locator('button#demo-resident-btn');
      assert.ok(await residentDemoBtn.isVisible(), `Cubaan ${attempt}: Butang demo resident mesti kelihatan`);

      console.log(`[Cubaan ${attempt}/6] Menekan butang demo resident...`);
      await residentDemoBtn.click();

      // Race between successful portal redirection (/resident) and error alert on /login
      const outcome = await Promise.race([
        page.waitForURL('**/resident', { timeout: 25000 }).then(() => ({ type: 'redirected' })),
        page
          .waitForSelector('#demo-error-alert', { timeout: 25000 })
          .then(async (el) => {
            const code = (await el.getAttribute('data-error-code')) || 'UNKNOWN_ERROR';
            const text = (await el.innerText()).trim();
            return { type: 'alert', code, text };
          }),
      ]).catch((err) => ({ type: 'timeout', message: err.message }));

      if (attempt <= 5) {
        // Attempts 1–5 MUST succeed and redirect to /resident
        const expected = 'Akses Portal Penduduk (/resident)';
        if (outcome.type === 'redirected') {
          console.log(`  ✓ Cubaan ${attempt} BERJAYA: Berjaya login dan diredirect ke /resident`);
          attemptLog.push({
            cubaan: attempt,
            masa: `${clockStr} (${offsetStr})`,
            clockTime: clockStr,
            hasilDijangka: expected,
            hasilSebenar: 'Berjaya (/resident)',
            kodRalat: 'NONE',
            status: 'PASS',
          });
        } else if (outcome.type === 'alert') {
          console.error(`  ✗ Cubaan ${attempt} GAGAL: Disekat lebih awal dengan kod "${outcome.code}": "${outcome.text}"`);
          const isRateLimit = outcome.code === 'DEMO_RATE_LIMITED';
          const isLimiterDown = outcome.code === 'DEMO_LIMITER_UNAVAILABLE';
          const status = isRateLimit ? 'INCONCLUSIVE' : isLimiterDown ? 'BLOCKED' : 'FAIL';
          testSuiteVerdict = status;
          failureReason = `Cubaan ${attempt} sepatutnya berjaya tetapi disekat dengan kod ${outcome.code}.`;
          attemptLog.push({
            cubaan: attempt,
            masa: `${clockStr} (${offsetStr})`,
            clockTime: clockStr,
            hasilDijangka: expected,
            hasilSebenar: `Disekat (${outcome.code})`,
            kodRalat: outcome.code,
            status,
          });
          break;
        } else {
          console.error(`  ✗ Cubaan ${attempt} TIMEOUT: Tiada respons dalam 12s.`);
          testSuiteVerdict = 'BLOCKED';
          failureReason = `Cubaan ${attempt} timeout (${outcome.message}).`;
          attemptLog.push({
            cubaan: attempt,
            masa: `${clockStr} (${offsetStr})`,
            clockTime: clockStr,
            hasilDijangka: expected,
            hasilSebenar: 'Timeout / Rangkaian Tergendala',
            kodRalat: 'NETWORK_TIMEOUT',
            status: 'BLOCKED',
          });
          break;
        }
      } else {
        // Attempt 6 MUST be rate-limited and stay on /login with DEMO_RATE_LIMITED
        const expected = 'Disekat (DEMO_RATE_LIMITED)';
        if (outcome.type === 'alert') {
          console.log(`  [Cubaan 6 Alert] Kod ralat dikesan: "${outcome.code}", Mesej: "${outcome.text}"`);
          if (outcome.code === 'DEMO_RATE_LIMITED') {
            console.log('  ✓ Cubaan 6 TEPAT: Disekat oleh rate limiter server dengan kod DEMO_RATE_LIMITED.');
            attemptLog.push({
              cubaan: 6,
              masa: `${clockStr} (${offsetStr})`,
              clockTime: clockStr,
              hasilDijangka: expected,
              hasilSebenar: `Disekat (${outcome.code})`,
              kodRalat: outcome.code,
              status: 'PASS',
            });
          } else if (outcome.code === 'DEMO_LIMITER_UNAVAILABLE') {
            console.error('  ✗ Cubaan 6 GAGAL/BLOCKED: Ralat adalah kegagalan storan (DEMO_LIMITER_UNAVAILABLE), bukan rate limit sebenar!');
            testSuiteVerdict = 'BLOCKED';
            failureReason = 'Storan limiter tidak dapat dicapai (DEMO_LIMITER_UNAVAILABLE).';
            attemptLog.push({
              cubaan: 6,
              masa: `${clockStr} (${offsetStr})`,
              clockTime: clockStr,
              hasilDijangka: expected,
              hasilSebenar: `Kegagalan Storan (${outcome.code})`,
              kodRalat: outcome.code,
              status: 'BLOCKED',
            });
          } else {
            console.error(`  ✗ Cubaan 6 GAGAL: Kod ralat tidak dikenali: ${outcome.code}`);
            testSuiteVerdict = 'FAIL';
            failureReason = `Kod ralat tidak sah pada cubaan 6: ${outcome.code}`;
            attemptLog.push({
              cubaan: 6,
              masa: `${clockStr} (${offsetStr})`,
              clockTime: clockStr,
              hasilDijangka: expected,
              hasilSebenar: `Ralat tidak dikenali (${outcome.code})`,
              kodRalat: outcome.code,
              status: 'FAIL',
            });
          }
        } else if (outcome.type === 'redirected') {
          console.error('  ✗ Cubaan 6 GAGAL: Percubaan keenam dibenarkan masuk dan diredirect ke /resident (sepatutnya disekat)!');
          testSuiteVerdict = 'FAIL';
          failureReason = 'Percubaan keenam tidak disekat oleh rate limiter.';
          attemptLog.push({
            cubaan: 6,
            masa: `${clockStr} (${offsetStr})`,
            clockTime: clockStr,
            hasilDijangka: expected,
            hasilSebenar: 'Terlepas Had (/resident)',
            kodRalat: 'NONE',
            status: 'FAIL',
          });
        } else {
          console.error(`  ✗ Cubaan 6 TIMEOUT: Tiada respons dalam 12s.`);
          testSuiteVerdict = 'BLOCKED';
          failureReason = 'Cubaan 6 mengalami timeout.';
          attemptLog.push({
            cubaan: 6,
            masa: `${clockStr} (${offsetStr})`,
            clockTime: clockStr,
            hasilDijangka: expected,
            hasilSebenar: 'Timeout',
            kodRalat: 'TIMEOUT',
            status: 'BLOCKED',
          });
        }
      }
    }

    const totalElapsedSec = ((Date.now() - runStartMs) / 1000).toFixed(1);
    console.log(`\n[Phase 1 Selesai] Jumlah masa larian 6 cubaan: ${totalElapsedSec}s.`);

    // Check if the 6 attempts completed within the 60s server window
    if (parseFloat(totalElapsedSec) > 60.0 && testSuiteVerdict === 'PASS') {
      console.warn('[AMARAN] Larian melebihi 60 saat. Window mungkin telah berputar.');
    }

    // -------------------------------------------------------------------------
    // Phase 2: Regular Email/Password Login Isolation Verification
    // -------------------------------------------------------------------------
    console.log('\n[Phase 2] Verifying Regular Login Isolation While Demo Rate Limit Is Active...');
    console.log('------------------------------------------------------------------------------');
    let regularLoginSuccess = false;

    if (testSuiteVerdict === 'PASS') {
      console.log('Mengisi borang log masuk biasa (resident.rejang@nadi.local)...');
      await page.fill('#login-email', 'resident.rejang@nadi.local');
      await page.fill('#login-password', RESIDENT_PASSWORD);
      await page.click('#login-submit-btn');

      await page.waitForURL('**/resident', { timeout: 15000 });
      console.log('✓ Log masuk biasa BERJAYA! URL semasa:', page.url());
      regularLoginSuccess = true;

      // Verify route protection & logout
      console.log('Menguji perlindungan laluan: mengakses /management tanpa hak akses...');
      await page.goto(`${TARGET_URL}/management`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1000);
      assert.ok(page.url().includes('/resident'), 'Resident dialihkan daripada laluan pengurusan');
      console.log('✓ Perlindungan sempadan laluan berfungsi.');
    } else {
      console.log('[Phase 2 Dilangkau] Fasa 1 tidak mendapat PASS penuh, mengelakkan ujian palsu.');
    }

    // -------------------------------------------------------------------------
    // Phase 3: Final Table & Verdict Report
    // -------------------------------------------------------------------------
    console.log('\n==============================================================================');
    console.log('HASIL UJIAN URUTAN RATE LIMITER & KETERASINGAN LOGIN STAGING');
    console.log('==============================================================================');

    console.log('| Cubaan | Masa | Hasil dijangka | Hasil sebenar | Kod ralat | Status |');
    console.log('| :--- | :--- | :--- | :--- | :--- | :--- |');
    for (const r of attemptLog) {
      console.log(`| ${r.cubaan} | ${r.masa} | ${r.hasilDijangka} | ${r.hasilSebenar} | ${r.kodRalat} | ${r.status} |`);
    }

    console.log('------------------------------------------------------------------------------');
    console.log(`Keputusan Keseluruhan: ${testSuiteVerdict}`);
    if (failureReason) {
      console.log(`Punca: ${failureReason}`);
    }
    console.log(`Log Masuk Biasa Berfungsi Semasa Demo Disekat: ${regularLoginSuccess ? 'YA (PASSED)' : 'TIDAK'}`);
    console.log('==============================================================================\n');

    if (testSuiteVerdict !== 'PASS' || !regularLoginSuccess) {
      process.exit(1);
    }
  } finally {
    await browser.close();
  }
}

runStrictRateLimitUiVerification().catch((err) => {
  console.error('\n[FATAL SCRIPT ERROR]', err);
  process.exit(1);
});
