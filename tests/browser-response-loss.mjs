#!/usr/bin/env node
import { spawn as cpSpawn } from 'node:child_process';
import crypto from 'node:crypto';
import { chromium } from 'playwright-core';

// Load local environment
try {
  process.loadEnvFile('.env.local');
} catch {
  // Already loaded or provided via environment
}

const API_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:64321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY missing from environment.');
}
const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:64322/postgres';
const PSQL_PATH = 'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE_URL = process.env.TEST_APP_URL || 'http://127.0.0.1:3000';

function runPsql(sql, retries = 3) {
  return new Promise((resolve, reject) => {
    function attempt(n) {
      const proc = cpSpawn(PSQL_PATH, [DB_URL, '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql]);
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (d) => (stdout += d.toString()));
      proc.stderr.on('data', (d) => (stderr += d.toString()));
      proc.on('close', (code) => {
        if (code === 0) resolve(stdout.trim());
        else if (n > 1 && (stderr.includes('closed the connection') || stderr.includes('could not connect'))) {
          setTimeout(() => attempt(n - 1), 300);
        } else {
          reject(new Error(`psql error (${code}): ${stderr || stdout}`));
        }
      });
    }
    attempt(retries);
  });
}

const SAMPLE_TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

async function main() {
  console.log('==============================================================================');
  console.log('PPR NADI — BROWSER RESPONSE-LOSS & NETWORK INTERRUPTION RECOVERY TEST');
  console.log('==============================================================================');

  const runToken = crypto.randomBytes(4).toString('hex');
  const runId = `loss_test_${Date.now()}_${runToken}`;
  const testPassword = `LossPass_${runToken}!`;

  console.log(`[Run Identity] ${runId}`);
  console.log(`[Target URL] ${BASE_URL}`);

  // 1. Verify Local Supabase & Database target
  const dbVer = await runPsql('SELECT current_database();');
  if (dbVer !== 'postgres') {
    throw new Error(`Unexpected database: ${dbVer}. Must target local demo postgres.`);
  }

  const baselineObjCountStr = await runPsql("SELECT count(*) FROM storage.objects WHERE bucket_id = 'incident-evidence';");
  const baselineObjects = parseInt(baselineObjCountStr, 10) || 0;
  console.log(`[Baseline Storage Objects] ${baselineObjects}`);

  // Tracking for strict cleanup
  const cleanupUsers = [];
  const cleanupReports = [];
  const cleanupStoragePaths = [];

  let browser = null;
  let exitCode = 0;

  try {
    // 2. Resolve Blok A ID in PPR Sentosa Demo
    const sentosaBldgA = await runPsql("SELECT id FROM public.buildings WHERE estate_id = 'ppr-sentosa-demo' LIMIT 1;");
    if (!sentosaBldgA) throw new Error('PPR Sentosa Demo Blok A not found.');

    // 3. Create synthetic resident user
    const residentEmail = `res_loss_${runToken}@temp-test.local`;
    console.log(`\n[Step 1] Creating synthetic resident user: ${residentEmail}...`);

    const userRes = await fetch(`${API_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: residentEmail,
        password: testPassword,
        email_confirm: true,
        user_metadata: { full_name: 'Synthetic Loss Resident' },
      }),
    });
    if (!userRes.ok) {
      throw new Error(`Failed to create test user: ${userRes.statusText}`);
    }
    const userData = await userRes.json();
    const userId = userData.id;
    cleanupUsers.push(userId);

    await runPsql(`
      INSERT INTO public.profiles (id, role, full_name, assigned_estate_id, assigned_building_id, unit_number)
      VALUES ('${userId}', 'resident', 'Synthetic Loss Resident', 'ppr-sentosa-demo', '${sentosaBldgA}', '08-11');
    `);
    console.log(`  ✓ Synthetic resident created (id: ${userId})`);

    // 4. Launch Chrome via Playwright
    console.log('\n[Step 2] Launching Google Chrome...');
    browser = await chromium.launch({
      headless: true,
      executablePath: CHROME_PATH,
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();

    // 5. Browser Login
    console.log('\n[Step 3] Logging in as synthetic resident...');
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#login-email', { timeout: 10000 });
    await page.fill('#login-email', residentEmail);
    await page.fill('#login-password', testPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/resident', { timeout: 15000, waitUntil: 'domcontentloaded' });
    console.log('  ✓ Authenticated and navigated to resident dashboard');

    // 6. Navigate to /resident/lapor
    console.log('\n[Step 4] Navigating to Report Form (/resident/lapor)...');
    await page.goto(`${BASE_URL}/resident/lapor`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('form', { timeout: 10000 });

    // 7. Capture stable operation identity (client_report_id) BEFORE submission starts
    await page.waitForFunction(() => sessionStorage.getItem('ppr_client_report_id') !== null, { timeout: 10000 });
    const stableClientId = await page.evaluate(() => sessionStorage.getItem('ppr_client_report_id'));
    if (!stableClientId || stableClientId.length < 32) {
      throw new Error(`Invalid or missing ppr_client_report_id in sessionStorage: ${stableClientId}`);
    }
    console.log(`  ✓ Preserved stable operation identity (client_report_id): ${stableClientId}`);
    cleanupReports.push(stableClientId);

    // 8. Populate form fields
    console.log('\n[Step 5] Selecting incident details and attaching evidence photo...');
    await page.click('button:has-text("Lif Penumpang")');
    await page.setInputFiles('input[data-testid="file-picker-input"]', [{
      name: 'loss_evidence.png',
      mimeType: 'image/png',
      buffer: SAMPLE_TINY_PNG,
    }]);
    await page.waitForSelector('text=loss_evidence.png', { timeout: 5000 });
    await page.fill('#report-description', 'Pintu lif bergegar kuat dan tersekat di tingkat 5 semasa waktu puncak.');
    console.log('  ✓ Category, photo, and description populated in browser form');

    // 9. Attach network route interceptor
    console.log('\n[Step 6] Attaching Playwright route interceptor to simulate downstream response loss...');
    let interceptedPost = false;
    let backendCommittedReportId = null;
    let backendCommittedAttachment = null;

    await page.route('**/resident/lapor**', async (route) => {
      const req = route.request();
      if (req.method() === 'POST' && !interceptedPost) {
        interceptedPost = true;
        console.log('  [Route] Forwarding POST request to backend via route.fetch()...');
        const resp = await route.fetch();
        console.log(`  [Route] Backend processed request with HTTP status: ${resp.status()}`);

        if (resp.status() !== 200 && resp.status() !== 303) {
          console.warn(`  [Route] Unexpected backend status: ${resp.status()}`);
        }

        // Independently observe the backend commit in PostgreSQL with bounded timeout
        console.log('  [Observer] Independently querying PostgreSQL to verify persisted outcome...');
        const startTime = Date.now();
        while (Date.now() - startTime < 8000) {
          const dbRep = await runPsql(`SELECT id FROM public.incident_reports WHERE id = '${stableClientId}';`);
          const dbAtt = await runPsql(`SELECT storage_path FROM public.report_attachments WHERE report_id = '${stableClientId}' LIMIT 1;`);
          if (dbRep && dbAtt) {
            backendCommittedReportId = dbRep;
            backendCommittedAttachment = dbAtt;
            cleanupStoragePaths.push(dbAtt);
            break;
          }
          await new Promise((r) => setTimeout(r, 250));
        }

        if (!backendCommittedReportId) {
          console.error('  [Observer] Backend failed to commit report within 8 seconds!');
        } else {
          console.log(`  [Observer] Successfully observed persisted report "${backendCommittedReportId}" and attachment "${backendCommittedAttachment}".`);
        }

        // Drop the downstream response so browser receives network failure instead of application result
        console.log('  [Route] Dropping downstream response via route.abort("failed")...');
        await route.abort('failed');
        return;
      }
      await route.continue();
    });

    // 10. Click submit button
    console.log('\n[Step 7] Submitting form through browser UI via 2-step flow...');
    if (await page.locator('button[data-testid="review-report-button"]').count() > 0) {
      await page.click('button[data-testid="review-report-button"]');
    }
    await page.click('button[data-testid="submit-report-button"]');

    // 11. Verify browser experiences network failure / interruption rather than success
    console.log('\n[Step 8] Verifying browser received failure rather than success...');
    // Give browser time to process the aborted network response
    await page.waitForTimeout(2500);

    const isSuccessRendered = (await page.locator('[data-testid="report-saved-heading"]').count()) > 0;
    if (isSuccessRendered) {
      throw new Error('Browser received success state despite downstream response abortion!');
    }
    console.log('  ✓ Browser did NOT receive success state (report-saved-heading is not displayed)');

    // 12. Refresh / retry through normal UI
    console.log('\n[Step 9] Refreshing page through normal UI to trigger durable session recovery...');
    // Reload page; on mount, LaporForm reads ppr_client_report_id and calls getReportRecoveryStatusAction
    await page.reload({ waitUntil: 'domcontentloaded' });

    // 13. Recover the same report and evidence
    console.log('\n[Step 10] Verifying automatic recovery of the exact report and evidence...');
    await page.waitForSelector('[data-testid="report-saved-heading"]', { timeout: 15000 });
    console.log('  ✓ UI restored to "Laporan Telah Disimpan" view');

    const recoveredReportId = await page.locator('[data-testid="active-report-id"]').innerText();
    console.log(`  ✓ Recovered Report ID: ${recoveredReportId.trim()}`);
    if (recoveredReportId.trim() !== stableClientId) {
      throw new Error(`Report ID mismatch! Expected ${stableClientId}, got ${recoveredReportId.trim()}`);
    }

    const attachedText = await page.locator('[data-testid="status-evidence-attached"]').innerText();
    console.log(`  ✓ Recovered Evidence Status: ${attachedText.replace(/\s+/g, ' ')}`);
    if (!attachedText.includes('1 daripada 3')) {
      throw new Error(`Expected "1 daripada 3" attachments, received: ${attachedText}`);
    }

    // 14. Confirm database and Storage integrity: exactly one report, one attachment, no extra Storage objects
    console.log('\n[Step 11] Confirming database and storage consistency:');
    const userReportCountStr = await runPsql(`SELECT count(*) FROM public.incident_reports WHERE reporter_id = '${userId}';`);
    const userReportCount = parseInt(userReportCountStr, 10);
    if (userReportCount !== 1) {
      throw new Error(`Expected exactly 1 report in DB for resident, found ${userReportCount}`);
    }
    console.log('  ✓ Exactly 1 report record persisted in incident_reports');

    const reportAttCountStr = await runPsql(`SELECT count(*) FROM public.report_attachments WHERE report_id = '${stableClientId}';`);
    const reportAttCount = parseInt(reportAttCountStr, 10);
    if (reportAttCount !== 1) {
      throw new Error(`Expected exactly 1 attachment row in report_attachments, found ${reportAttCount}`);
    }
    console.log('  ✓ Exactly 1 attachment row persisted in report_attachments');

    const userStorageObjCountStr = await runPsql(`
      SELECT count(*) FROM storage.objects 
      WHERE bucket_id = 'incident-evidence' AND name LIKE '${userId}/${stableClientId}/%';
    `);
    const userStorageObjCount = parseInt(userStorageObjCountStr, 10);
    if (userStorageObjCount !== 1) {
      throw new Error(`Expected exactly 1 Storage object, found ${userStorageObjCount}`);
    }
    console.log('  ✓ Exactly 1 Storage object present in incident-evidence (zero duplicate/orphaned files)');

    // 15. Verify Idempotent Retry through UI (Submitting again against same report)
    console.log('\n[Step 12] Verifying subsequent navigation to /resident/sejarah lists the report...');
    await page.goto(`${BASE_URL}/resident/sejarah`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=Lif Penumpang', { timeout: 10000 });
    const sejarahContent = await page.content();
    if (!sejarahContent.includes('Pintu lif bergegar kuat')) {
      throw new Error('Report description not visible in history view.');
    }
    console.log('  ✓ Recovered report is accurately listed in resident history view');

    console.log('\n==============================================================================');
    console.log('ALL BROWSER RESPONSE-LOSS & RECOVERY ASSERTIONS PASSED SUCCESSFULLY');
    console.log('==============================================================================');

  } catch (err) {
    console.error('\n❌ BROWSER RESPONSE-LOSS TEST FAILED:', err.message);
    exitCode = 1;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }

    console.log('\n[Teardown] Performing strict cleanup of run-owned resources...');

    // 1. Storage objects deletion via Supabase Storage API
    if (cleanupStoragePaths.length > 0) {
      try {
        const delRes = await fetch(`${API_URL}/storage/v1/object/incident-evidence`, {
          method: 'DELETE',
          headers: {
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ prefixes: cleanupStoragePaths }),
        });
        if (!delRes.ok) {
          console.error(`Storage cleanup failed: ${delRes.statusText}`);
          exitCode = 1;
        } else {
          console.log(`  ✓ Deleted ${cleanupStoragePaths.length} run-owned Storage objects`);
        }
      } catch (stErr) {
        console.error('Storage deletion error:', stErr);
        exitCode = 1;
      }
    }

    // 2. Domain records deletion
    for (const repId of cleanupReports) {
      try {
        await runPsql(`
          DELETE FROM public.report_attachments WHERE report_id = '${repId}';
          DELETE FROM public.incident_report_links WHERE report_id = '${repId}';
          DELETE FROM public.incident_reports WHERE id = '${repId}';
        `);
      } catch (repErr) {
        console.error(`Failed to delete report ${repId}:`, repErr);
        exitCode = 1;
      }
    }

    // 3. Profiles and synthetic Auth users deletion
    for (const uId of cleanupUsers) {
      try {
        await runPsql(`
          DELETE FROM public.audit_events WHERE actor_id = '${uId}';
          DELETE FROM public.profiles WHERE id = '${uId}';
        `);
        const userDelRes = await fetch(`${API_URL}/auth/v1/admin/users/${uId}`, {
          method: 'DELETE',
          headers: {
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
          },
        });
        if (!userDelRes.ok) {
          console.error(`Failed to delete auth user ${uId}: ${userDelRes.statusText}`);
          exitCode = 1;
        } else {
          console.log(`  ✓ Deleted synthetic user ${uId}`);
        }
      } catch (uErr) {
        console.error(`User deletion error:`, uErr);
        exitCode = 1;
      }
    }

    // 4. Verify Permanent Demo Accounts Preserved
    try {
      const demoUsersCount = await runPsql(`
        SELECT count(*) FROM auth.users WHERE email IN ('resident@sentosa.local', 'manager@sentosa.local');
      `);
      if (parseInt(demoUsersCount, 10) !== 2) {
        console.error(`❌ Preservation check failed: Expected 2 permanent demo accounts, found ${demoUsersCount}`);
        exitCode = 1;
      } else {
        console.log('  ✓ Verified permanent demo accounts intact (resident@sentosa.local, manager@sentosa.local)');
      }
    } catch (demoErr) {
      console.error('Failed checking demo accounts preservation:', demoErr);
      exitCode = 1;
    }

    // 5. Verify Storage objects count returned to exact baseline
    try {
      const finalObjCountStr = await runPsql("SELECT count(*) FROM storage.objects WHERE bucket_id = 'incident-evidence';");
      const finalObjCount = parseInt(finalObjCountStr, 10) || 0;
      if (finalObjCount !== baselineObjects) {
        console.error(`❌ Storage baseline corrupted! Expected ${baselineObjects}, found ${finalObjCount}`);
        exitCode = 1;
      } else {
        console.log(`  ✓ Storage objects verified unchanged: exactly ${baselineObjects} objects remain`);
      }
    } catch (baseErr) {
      console.error('Failed checking storage baseline:', baseErr);
      exitCode = 1;
    }

    console.log(`[Teardown] Complete. Exiting with code ${exitCode}.\n`);
    process.exit(exitCode);
  }
}

main().catch((err) => {
  console.error('Fatal unhandled error in test execution:', err);
  process.exit(1);
});
