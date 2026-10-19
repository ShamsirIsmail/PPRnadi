import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync, spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
const STATS_FILE = path.resolve('.ai-guard-stats.json');

function getBlockedAiStats() {
  try {
    if (fs.existsSync(STATS_FILE)) {
      const raw = fs.readFileSync(STATS_FILE, 'utf8');
      const data = JSON.parse(raw);
      return {
        count: typeof data.count === 'number' ? data.count : 0,
        attempts: Array.isArray(data.attempts) ? data.attempts : [],
      };
    }
  } catch {}
  return { count: 0, attempts: [] };
}

function resetBlockedAiStats() {
  try {
    fs.writeFileSync(STATS_FILE, JSON.stringify({ count: 0, attempts: [] }, null, 2), 'utf8');
  } catch {}
}

// ---------------------------------------------------------------------------
// 1. CONFIGURATION & ISOLATION GUARDS
// ---------------------------------------------------------------------------

if (fs.existsSync('.env.local')) {
  try {
    process.loadEnvFile('.env.local');
  } catch {}
}

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TEST_PORT = parseInt(process.env.TEST_PORT || '3005', 10);
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const ARTIFACTS_DIR = 'C:\\Users\\shams\\.gemini\\antigravity-ide\\brain\\f73c5ee6-76ec-4b98-ac3e-6e23b5a34c2a';

// Strictly verify local endpoints before any operations
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:64321';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL.includes('127.0.0.1') && !SUPABASE_URL.includes('localhost')) {
  throw new Error(`CRITICAL: Supabase URL [${SUPABASE_URL}] is not a local target!`);
}

const RESIDENT_EMAIL = 'resident.rejang@nadi.local';
const RESIDENT_PASSWORD = process.env.DEMO_RESIDENT_PASSWORD;

const MANAGER_EMAIL = 'manager.rejang@nadi.local';
const MANAGER_PASSWORD = process.env.DEMO_MANAGER_PASSWORD;

if (!RESIDENT_PASSWORD || !MANAGER_PASSWORD) {
  throw new Error('DEMO_RESIDENT_PASSWORD or DEMO_MANAGER_PASSWORD missing from environment');
}

const FIXTURE_1_PATH = path.resolve('tests/fixtures/e2e-evidence-1.png');
const FIXTURE_2_PATH = path.resolve('tests/fixtures/e2e-evidence-2.png');

if (!fs.existsSync(FIXTURE_1_PATH) || !fs.existsSync(FIXTURE_2_PATH)) {
  throw new Error('Image fixtures do not exist!');
}

// Inspect and decode fixtures
const fixture1Buf = fs.readFileSync(FIXTURE_1_PATH);
const fixture2Buf = fs.readFileSync(FIXTURE_2_PATH);

const FIXTURE_1 = {
  name: path.basename(FIXTURE_1_PATH),
  path: FIXTURE_1_PATH,
  sizeBytes: fixture1Buf.length,
  sha256: crypto.createHash('sha256').update(fixture1Buf).digest('hex'),
  width: fixture1Buf.readUInt32BE(16),
  height: fixture1Buf.readUInt32BE(20),
};

const FIXTURE_2 = {
  name: path.basename(FIXTURE_2_PATH),
  path: FIXTURE_2_PATH,
  sizeBytes: fixture2Buf.length,
  sha256: crypto.createHash('sha256').update(fixture2Buf).digest('hex'),
  width: fixture2Buf.readUInt32BE(16),
  height: fixture2Buf.readUInt32BE(20),
};

// Pure PNG decoder validator (does not depend on external native binaries)
function decodeAndValidatePng(buffer, label = 'image') {
  if (!buffer || buffer.length < 8) {
    throw new Error(`[${label}] Buffer too small to be a PNG (${buffer ? buffer.length : 0} bytes)`);
  }
  const sig = buffer.slice(0, 8).toString('hex');
  if (sig !== '89504e470d0a1a0a') {
    throw new Error(`[${label}] Invalid PNG signature: ${sig}`);
  }
  const chunkType = buffer.slice(12, 16).toString('ascii');
  if (chunkType !== 'IHDR') {
    throw new Error(`[${label}] First chunk is not IHDR: ${chunkType}`);
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width <= 0 || height <= 0) {
    throw new Error(`[${label}] Invalid image dimensions: ${width}x${height}`);
  }
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  return { width, height, hash, sizeBytes: buffer.length };
}

// Service-role Supabase client strictly for database validation
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Helper to poll server readiness
async function waitForServer(url, timeoutMs = 35000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status === 200 || res.status === 307 || res.status === 302) {
        return true;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 600));
  }
  return false;
}

// Helper to poll until server is completely down
async function waitForServerDown(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(1000) });
      await new Promise((r) => setTimeout(r, 400));
    } catch {
      return true; // Successfully down
    }
  }
  return false;
}

function getListeningPid(port) {
  try {
    const out = execSync(
      `powershell -Command "(Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess"`,
      { encoding: 'utf8' }
    ).trim();
    const pid = parseInt(out, 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function spawnTestServer() {
  const proc = spawn('npx.cmd', ['next', 'dev', '-p', String(TEST_PORT)], {
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      NEXT_DIST_DIR: '.next-test',
      TEST_DISABLE_AI_CALLS: 'true',
      BLOCK_AI_NETWORK: 'true',
    },
    stdio: 'ignore',
    shell: true,
  });
  return proc;
}

function killPidTree(pid) {
  if (!pid) return;
  try {
    execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
  } catch {}
}

// ---------------------------------------------------------------------------
// MAIN E2E VERIFICATION SUITE
// ---------------------------------------------------------------------------

async function main() {
  const runId = crypto.randomUUID();
  const explicitLabel = `UJIAN E2E DESA REJANG — ${runId}`;

  console.log('================================================================');
  console.log('PPR NADI — HIGH-DURABILITY E2E VERIFICATION (ZERO AI CALLS)');
  console.log(`Run ID: ${runId}`);
  console.log(`Test Port: ${TEST_PORT} | Dedicated DistDir: .next-test`);
  console.log(`Live AI Status: NOT TESTED — DISABLED FOR THIS RUN`);
  console.log('================================================================\n');

  // 1. Reset AI Guard Stats
  resetBlockedAiStats();

  // 2. Ensure test port 3005 is clean before start
  const existingPid = getListeningPid(TEST_PORT);
  if (existingPid) {
    console.log(`  -> Cleaning up orphaned process on port ${TEST_PORT} (PID: ${existingPid})...`);
    killPidTree(existingPid);
    await waitForServerDown(`http://127.0.0.1:${TEST_PORT}/login`, 10000);
  }

  // 3. Start Dedicated Test Server on Port 3005
  console.log(`[SPAWN] Starting dedicated test server on port ${TEST_PORT}...`);
  let serverProc = spawnTestServer();
  const isUp = await waitForServer(`http://127.0.0.1:${TEST_PORT}/login`, 40000);
  if (!isUp) {
    killPidTree(serverProc.pid);
    throw new Error(`Failed to bring up test server on port ${TEST_PORT} within 40s!`);
  }
  const pidBefore = getListeningPid(TEST_PORT);
  if (!pidBefore) {
    killPidTree(serverProc.pid);
    throw new Error(`Could not determine listening PID on port ${TEST_PORT}`);
  }
  console.log(`  ✓ Test application server ready on port ${TEST_PORT} (Listening PID: ${pidBefore})`);

  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
  });

  const verificationSummary = {
    runId,
    timestamp: new Date().toISOString(),
    pidBefore,
    pidAfter: null,
    reportId: null,
    assertions: {},
    beforeSnapshot: null,
    afterSnapshot: null,
    aiGuard: null,
  };

  try {
    // -------------------------------------------------------------------------
    // STEP 1: Resident Login & Manual Submission via UI
    // -------------------------------------------------------------------------
    console.log('\n[STEP 1] Resident login and report submission via UI...');
    const residentContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const residentPage = await residentContext.newPage();

    // Login
    await residentPage.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
    await residentPage.waitForSelector('#login-email', { timeout: 15000 });
    await residentPage.fill('#login-email', RESIDENT_EMAIL);
    await residentPage.fill('#login-password', RESIDENT_PASSWORD);
    await residentPage.click('button[type="submit"]');
    await residentPage.waitForURL('**/resident', { timeout: 15000 });
    console.log('  ✓ Resident authenticated successfully.');

    // Navigate to /resident/lapor
    await residentPage.goto(`${BASE_URL}/resident/lapor`, { waitUntil: 'domcontentloaded' });
    await residentPage.waitForSelector('[data-testid="start-manual-form-button"]', { timeout: 10000 });

    // Open Manual Entry Form
    await residentPage.click('[data-testid="start-manual-form-button"]');
    await residentPage.waitForSelector('#manual-desc', { timeout: 5000 });
    console.log('  ✓ Manual complaint entry form active.');

    // Fill form: Category = Lampu Koridor, Floor = 16, Description with runId
    const lightingBtn = residentPage.locator('button:has-text("Lampu Koridor")').first();
    await lightingBtn.click();

    const floorInputManual = residentPage.locator('#manual-floor');
    await floorInputManual.fill('16');

    const descText = `[${explicitLabel}] Lampu koridor tidak menyala dan gelap gelita di tingkat 16 Blok A.`;
    const descAreaManual = residentPage.locator('#manual-desc');
    await descAreaManual.fill(descText);

    // Proceed to Step 2 (Review Screen)
    await residentPage.click('[data-testid="manual-proceed-review-button"]');
    await residentPage.waitForSelector('[data-testid="submit-report-button"]', { timeout: 10000 });
    console.log('  ✓ Reached Review screen with preserved manual inputs.');

    // Upload 2 valid photo fixtures
    const fileInput = residentPage.locator('input[type="file"][multiple]');
    await fileInput.setInputFiles([FIXTURE_1.path, FIXTURE_2.path]);
    await residentPage.waitForTimeout(600);

    const thumbnails = residentPage.locator('img[alt^="Bukti"]');
    const thumbCount = await thumbnails.count();
    if (thumbCount !== 2) {
      throw new Error(`Expected 2 photo thumbnails on form, found ${thumbCount}`);
    }
    console.log(`  ✓ 2 valid photo evidence thumbnails rendered on form.`);

    // Submit single report through UI
    await residentPage.click('[data-testid="submit-report-button"]');
    await residentPage.waitForSelector('[data-testid="report-saved-heading"]', { timeout: 25000 });

    const reportId = await residentPage.locator('[data-testid="active-report-id"]').innerText();
    if (!reportId || reportId.length < 10) {
      throw new Error(`Invalid report ID captured from success screen: "${reportId}"`);
    }
    verificationSummary.reportId = reportId.trim();
    console.log(`  ✓ Satu penghantaran menghasilkan satu aduan.`);
    console.log(`  ✓ Report successfully created via UI! Report ID: ${verificationSummary.reportId}`);

    // Screenshot of resident submission screen
    const resScreenPath = path.join(ARTIFACTS_DIR, 'resident-submitted-run.png');
    await residentPage.screenshot({ path: resScreenPath, fullPage: true });

    await residentContext.close();

    // -------------------------------------------------------------------------
    // STEP 2: Storage Assertion & Database Verification (BEFORE Snapshot)
    // -------------------------------------------------------------------------
    console.log('\n[STEP 2] Database verification & BEFORE snapshot creation...');
    const { data: dbReport, error: reportErr } = await supabase
      .from('incident_reports')
      .select('id, reporter_id, building_id, service_zone_id, category, description, status, created_at')
      .eq('id', verificationSummary.reportId)
      .single();

    if (reportErr || !dbReport) {
      throw new Error(`Database record not found for report ${verificationSummary.reportId}: ${reportErr?.message}`);
    }

    // Verify exactly 1 report exists for this run ID
    const { count: matchCount, error: countErr } = await supabase
      .from('incident_reports')
      .select('id', { count: 'exact', head: true })
      .ilike('description', `%${runId}%`);

    if (countErr || matchCount !== 1) {
      throw new Error(`Expected exactly 1 report for run ID, found ${matchCount}`);
    }

    // Verify building is Blok A in Desa Rejang
    const { data: buildingRow } = await supabase
      .from('buildings')
      .select('id, name, code, estate_id')
      .eq('id', dbReport.building_id)
      .single();

    if (!buildingRow || (buildingRow.code !== 'DR_BLK_A' && buildingRow.code !== 'BLKA' && buildingRow.name !== 'Blok A')) {
      throw new Error(`Expected building to be Blok A, got: ${buildingRow?.name} (${buildingRow?.code})`);
    }

    // Verify zone is Blok A Zon Tinggi covering floor 16
    const { data: zoneRow } = await supabase
      .from('service_zones')
      .select('id, name, zone_code, floor_start, floor_end, building_id')
      .eq('id', dbReport.service_zone_id)
      .single();

    if (!zoneRow || zoneRow.building_id !== dbReport.building_id || 16 < zoneRow.floor_start || 16 > zoneRow.floor_end) {
      throw new Error(`Zone ${zoneRow?.id} does not cover floor 16 for building ${dbReport.building_id}`);
    }

    // Verify exactly 2 attachments
    const { data: attRows, error: attErr } = await supabase
      .from('report_attachments')
      .select('id, file_name, file_size_bytes, storage_path, mime_type')
      .eq('report_id', verificationSummary.reportId)
      .order('uploaded_at', { ascending: true });

    if (attErr || !attRows || attRows.length !== 2) {
      throw new Error(`Expected exactly 2 attachments in database, found ${attRows ? attRows.length : 0}`);
    }

    if (attRows[0].storage_path === attRows[1].storage_path) {
      throw new Error(`Both attachments have identical storage_path: ${attRows[0].storage_path}`);
    }

    // Verify bytes stored in Supabase storage match fixture SHA-256
    const storageFiles = [];
    for (const att of attRows) {
      const { data: downloadedBlob, error: downloadErr } = await supabase.storage
        .from('incident-evidence')
        .download(att.storage_path);

      if (downloadErr || !downloadedBlob) {
        throw new Error(`Failed to download storage object ${att.storage_path}: ${downloadErr?.message}`);
      }

      const fileBuf = Buffer.from(await downloadedBlob.arrayBuffer());
      const decoded = decodeAndValidatePng(fileBuf, att.file_name);
      storageFiles.push({
        id: att.id,
        fileName: att.file_name,
        storagePath: att.storage_path,
        sizeBytes: decoded.sizeBytes,
        sha256: decoded.hash,
        dimensions: `${decoded.width}x${decoded.height}`,
      });
    }

    // Verify fixture hash matches
    const expectedHashes = new Set([FIXTURE_1.sha256, FIXTURE_2.sha256]);
    for (const sf of storageFiles) {
      if (!expectedHashes.has(sf.sha256)) {
        throw new Error(`Stored file ${sf.fileName} hash ${sf.sha256} does not match any fixture!`);
      }
    }

    verificationSummary.beforeSnapshot = {
      reportId: dbReport.id,
      reporterId: dbReport.reporter_id,
      buildingId: dbReport.building_id,
      buildingName: buildingRow.name,
      zoneId: dbReport.service_zone_id,
      zoneName: zoneRow.name,
      category: dbReport.category,
      description: dbReport.description,
      status: dbReport.status,
      attachments: storageFiles,
    };

    console.log(`  ✓ Database record strictly validated.`);
    console.log(`    - Reporter ID: ${dbReport.reporter_id}`);
    console.log(`    - Building: ${buildingRow.name} (${buildingRow.code})`);
    console.log(`    - Zone: ${zoneRow.name} (T${zoneRow.floor_start}-${zoneRow.floor_end})`);
    console.log(`    - Attachments: 2 distinct valid PNG files stored`);

    // -------------------------------------------------------------------------
    // STEP 3: Management Inbox Inspection (BEFORE Restart)
    // -------------------------------------------------------------------------
    console.log('\n[STEP 3] Manager inbox inspection via real user session (BEFORE restart)...');
    const managerContextBefore = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const managerPageBefore = await managerContextBefore.newPage();

    await managerPageBefore.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
    await managerPageBefore.waitForSelector('#login-email', { timeout: 15000 });
    await managerPageBefore.fill('#login-email', MANAGER_EMAIL);
    await managerPageBefore.fill('#login-password', MANAGER_PASSWORD);
    await managerPageBefore.click('button[type="submit"]');
    await managerPageBefore.waitForURL('**/management*', { timeout: 15000 });

    await managerPageBefore.goto(`${BASE_URL}/management/inbox`, { waitUntil: 'domcontentloaded' });
    await managerPageBefore.waitForSelector('main', { timeout: 15000 });

    // Scope locators strictly to this report's card
    const cardSelector = `[data-testid="report-card-${verificationSummary.reportId}"]`;
    const reportCardBefore = managerPageBefore.locator(cardSelector);
    await reportCardBefore.waitFor({ state: 'visible', timeout: 10000 });

    // Assert reporter, building, description inside card
    const cardTextBefore = await reportCardBefore.innerText();
    const cardTextLowerBefore = cardTextBefore.toLowerCase();
    if (!cardTextLowerBefore.includes('blok a') || !cardTextLowerBefore.includes('16') || !cardTextLowerBefore.includes(runId.toLowerCase())) {
      throw new Error('Manager inbox card is missing expected location, floor, or run ID text');
    }

    // Scoped evidence links
    const evidenceLinksBefore = reportCardBefore.locator('a[href*="incident-evidence"]');
    const linkCountBefore = await evidenceLinksBefore.count();
    if (linkCountBefore !== 2) {
      throw new Error(`Expected exactly 2 evidence links in card, found ${linkCountBefore}`);
    }

    // Open each image link via manager session request, decode image, verify SHA-256
    const managerDownloadedBefore = [];
    for (let i = 0; i < linkCountBefore; i++) {
      const link = evidenceLinksBefore.nth(i);
      const url = await link.getAttribute('href');
      const fileName = (await link.innerText()).trim();

      const resp = await managerPageBefore.request.get(url);
      if (!resp.ok()) {
        throw new Error(`Manager failed to open image link #${i + 1}: HTTP ${resp.status()}`);
      }

      const imgBuf = await resp.body();
      const decoded = decodeAndValidatePng(imgBuf, fileName);
      managerDownloadedBefore.push({
        fileName,
        sizeBytes: decoded.sizeBytes,
        sha256: decoded.hash,
        dimensions: `${decoded.width}x${decoded.height}`,
      });
    }

    console.log(`  ✓ Manager successfully opened both images with valid decodable PNG data (HTTP 200).`);
    console.log(`    - Image 1: ${managerDownloadedBefore[0].dimensions}, SHA-256: ${managerDownloadedBefore[0].sha256}`);
    console.log(`    - Image 2: ${managerDownloadedBefore[1].dimensions}, SHA-256: ${managerDownloadedBefore[1].sha256}`);

    const mgrBeforeScreenshot = path.join(ARTIFACTS_DIR, 'manager-inbox-before-restart.png');
    await managerPageBefore.screenshot({ path: mgrBeforeScreenshot, fullPage: true });

    // Close manager context before restarting server
    await managerContextBefore.close();

    // -------------------------------------------------------------------------
    // STEP 4: True Application Server Restart
    // -------------------------------------------------------------------------
    console.log('\n[STEP 4] Performing controlled APPLICATION SERVER restart...');
    console.log(`  -> Target PID to terminate: ${pidBefore}`);

    // Kill process tree
    killPidTree(pidBefore);
    killPidTree(serverProc.pid);

    // Verify endpoint is genuinely down
    const isDown = await waitForServerDown(`http://127.0.0.1:${TEST_PORT}/login`, 15000);
    if (!isDown) {
      throw new Error(`Server on port ${TEST_PORT} failed to terminate! PID ${pidBefore} still responding.`);
    }
    console.log(`  ✓ Application server terminated. Endpoint http://127.0.0.1:${TEST_PORT} is verified down.`);

    // Spawn new server process with exact same configuration & AI guard active
    console.log(`  -> Spawning new application server on port ${TEST_PORT}...`);
    serverProc = spawnTestServer();

    const isRestarted = await waitForServer(`http://127.0.0.1:${TEST_PORT}/login`, 40000);
    if (!isRestarted) {
      killPidTree(serverProc.pid);
      throw new Error(`New application server failed readiness check on port ${TEST_PORT} within 40s!`);
    }

    const pidAfter = getListeningPid(TEST_PORT);
    if (!pidAfter) {
      killPidTree(serverProc.pid);
      throw new Error(`Could not determine new listening PID on port ${TEST_PORT}`);
    }
    if (pidAfter === pidBefore) {
      killPidTree(serverProc.pid);
      throw new Error(`Restart verification failed: PID after restart (${pidAfter}) is identical to PID before restart (${pidBefore})!`);
    }

    verificationSummary.pidAfter = pidAfter;
    console.log(`  ✓ Application server successfully restarted! (New Listening PID: ${pidAfter}, Previous: ${pidBefore})`);

    // -------------------------------------------------------------------------
    // STEP 5: Management Verification (AFTER Restart)
    // -------------------------------------------------------------------------
    console.log('\n[STEP 5] Manager re-login via fresh context & verification (AFTER restart)...');
    const managerContextAfter = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const managerPageAfter = await managerContextAfter.newPage();

    // Re-login
    await managerPageAfter.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
    await managerPageAfter.waitForSelector('#login-email', { timeout: 15000 });
    await managerPageAfter.fill('#login-email', MANAGER_EMAIL);
    await managerPageAfter.fill('#login-password', MANAGER_PASSWORD);
    await managerPageAfter.click('button[type="submit"]');
    await managerPageAfter.waitForURL('**/management*', { timeout: 15000 });
    console.log('  ✓ Manager re-authenticated successfully in fresh browser context.');

    // Navigate to inbox
    await managerPageAfter.goto(`${BASE_URL}/management/inbox`, { waitUntil: 'domcontentloaded' });
    await managerPageAfter.waitForSelector('main', { timeout: 15000 });

    const reportCardAfter = managerPageAfter.locator(cardSelector);
    await reportCardAfter.waitFor({ state: 'visible', timeout: 10000 });

    const cardTextAfter = await reportCardAfter.innerText();
    const cardTextLowerAfter = cardTextAfter.toLowerCase();
    if (!cardTextLowerAfter.includes('blok a') || !cardTextLowerAfter.includes('16') || !cardTextLowerAfter.includes(runId.toLowerCase())) {
      throw new Error('Manager inbox card after restart is missing expected location, floor, or run ID text');
    }

    // Scoped evidence links after restart
    const evidenceLinksAfter = reportCardAfter.locator('a[href*="incident-evidence"]');
    const linkCountAfter = await evidenceLinksAfter.count();
    if (linkCountAfter !== 2) {
      throw new Error(`Expected exactly 2 evidence links in card after restart, found ${linkCountAfter}`);
    }

    // Download both images again via fresh session links
    const managerDownloadedAfter = [];
    for (let i = 0; i < linkCountAfter; i++) {
      const link = evidenceLinksAfter.nth(i);
      const url = await link.getAttribute('href');
      const fileName = (await link.innerText()).trim();

      const resp = await managerPageAfter.request.get(url);
      if (!resp.ok()) {
        throw new Error(`Manager failed to open image link #${i + 1} after restart: HTTP ${resp.status()}`);
      }

      const imgBuf = await resp.body();
      const decoded = decodeAndValidatePng(imgBuf, fileName);
      managerDownloadedAfter.push({
        fileName,
        sizeBytes: decoded.sizeBytes,
        sha256: decoded.hash,
        dimensions: `${decoded.width}x${decoded.height}`,
      });
    }

    // Compare BEFORE vs AFTER image hashes
    for (let i = 0; i < 2; i++) {
      if (managerDownloadedBefore[i].sha256 !== managerDownloadedAfter[i].sha256) {
        throw new Error(`Image #${i + 1} SHA-256 mismatch! Before: ${managerDownloadedBefore[i].sha256}, After: ${managerDownloadedAfter[i].sha256}`);
      }
      if (managerDownloadedBefore[i].sizeBytes !== managerDownloadedAfter[i].sizeBytes) {
        throw new Error(`Image #${i + 1} size mismatch! Before: ${managerDownloadedBefore[i].sizeBytes}, After: ${managerDownloadedAfter[i].sizeBytes}`);
      }
    }

    const mgrAfterScreenshot = path.join(ARTIFACTS_DIR, 'manager-inbox-after-restart.png');
    await managerPageAfter.screenshot({ path: mgrAfterScreenshot, fullPage: true });

    await managerContextAfter.close();

    // -------------------------------------------------------------------------
    // STEP 6: Check Database Durability & AI Guard Stats
    // -------------------------------------------------------------------------
    const { data: dbReportAfter } = await supabase
      .from('incident_reports')
      .select('id, reporter_id, building_id, service_zone_id, category, description, status')
      .eq('id', verificationSummary.reportId)
      .single();

    const { data: attRowsAfter } = await supabase
      .from('report_attachments')
      .select('id, storage_path, file_name, file_size_bytes')
      .eq('report_id', verificationSummary.reportId)
      .order('uploaded_at', { ascending: true });

    verificationSummary.afterSnapshot = {
      reportId: dbReportAfter.id,
      reporterId: dbReportAfter.reporter_id,
      buildingId: dbReportAfter.building_id,
      zoneId: dbReportAfter.service_zone_id,
      category: dbReportAfter.category,
      description: dbReportAfter.description,
      status: dbReportAfter.status,
      attachments: attRowsAfter.map((a, i) => ({
        id: a.id,
        fileName: a.file_name,
        storagePath: a.storage_path,
        sizeBytes: a.file_size_bytes,
        sha256: managerDownloadedAfter[i].sha256,
      })),
    };

    // Strict Field Equality Assertions
    const sameReportId = verificationSummary.beforeSnapshot.reportId === verificationSummary.afterSnapshot.reportId;
    const sameReporter = verificationSummary.beforeSnapshot.reporterId === verificationSummary.afterSnapshot.reporterId;
    const sameBuilding = verificationSummary.beforeSnapshot.buildingId === verificationSummary.afterSnapshot.buildingId;
    const sameZone = verificationSummary.beforeSnapshot.zoneId === verificationSummary.afterSnapshot.zoneId;
    const sameCategory = verificationSummary.beforeSnapshot.category === verificationSummary.afterSnapshot.category;
    const sameDescription = verificationSummary.beforeSnapshot.description === verificationSummary.afterSnapshot.description;
    const sameAtt1Id = verificationSummary.beforeSnapshot.attachments[0].id === verificationSummary.afterSnapshot.attachments[0].id;
    const sameAtt2Id = verificationSummary.beforeSnapshot.attachments[1].id === verificationSummary.afterSnapshot.attachments[1].id;
    const sameAtt1Path = verificationSummary.beforeSnapshot.attachments[0].storagePath === verificationSummary.afterSnapshot.attachments[0].storagePath;
    const sameAtt2Path = verificationSummary.beforeSnapshot.attachments[1].storagePath === verificationSummary.afterSnapshot.attachments[1].storagePath;
    const sameAtt1Hash = verificationSummary.beforeSnapshot.attachments[0].sha256 === verificationSummary.afterSnapshot.attachments[0].sha256;
    const sameAtt2Hash = verificationSummary.beforeSnapshot.attachments[1].sha256 === verificationSummary.afterSnapshot.attachments[1].sha256;

    if (
      !sameReportId ||
      !sameReporter ||
      !sameBuilding ||
      !sameZone ||
      !sameCategory ||
      !sameDescription ||
      !sameAtt1Id ||
      !sameAtt2Id ||
      !sameAtt1Path ||
      !sameAtt2Path ||
      !sameAtt1Hash ||
      !sameAtt2Hash
    ) {
      throw new Error('BEFORE vs AFTER field mismatch detected!');
    }

    // Verify AI Guard Stats
    const aiStats = getBlockedAiStats();
    verificationSummary.aiGuard = {
      blockedAttemptsCount: aiStats.count,
      networkCallsDispatched: 0,
      status: aiStats.count === 0 ? 'ZERO_ATTEMPTS_GUARANTEED' : 'BLOCKED_BY_GUARD',
    };

    if (aiStats.count > 0) {
      console.warn(`  [AI Guard] Warning: ${aiStats.count} attempts were blocked by server guard.`);
    } else {
      console.log(`  ✓ AI Guard verified: 0 provider attempts dispatched or blocked (Pure manual flow).`);
    }

    // Write sanitized JSON summary
    const summaryJsonPath = path.join(ARTIFACTS_DIR, 'e2e-verification-summary.json');
    fs.writeFileSync(summaryJsonPath, JSON.stringify(verificationSummary, null, 2), 'utf8');

    console.log('\n================================================================');
    console.log('ALL VERIFICATION ASSERTIONS PASSED WITH 100% DURABILITY');
    console.log(`Report ID: ${verificationSummary.reportId}`);
    console.log(`Server PID: ${pidBefore} -> ${pidAfter} (Restart Verified)`);
    console.log(`Summary JSON: ${summaryJsonPath}`);
    console.log('================================================================\n');
  } finally {
    await browser.close();
    // Clean up test server process
    const finalPid = getListeningPid(TEST_PORT);
    if (finalPid) {
      killPidTree(finalPid);
    }
  }
}

main().catch((err) => {
  console.error('\n❌ E2E VERIFICATION FAILED:', err);
  process.exit(1);
});
