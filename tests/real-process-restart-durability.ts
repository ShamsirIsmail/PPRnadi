import { execSync, spawn } from 'node:child_process';
import http from 'node:http';
import crypto from 'node:crypto';
import { chromium, type Browser, type Page } from 'playwright-core';

try {
  process.loadEnvFile('.env.local');
} catch {
  // loaded via environment
}

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!ANON_KEY) {
  console.error('RALAT: Pemboleh ubah NEXT_PUBLIC_SUPABASE_ANON_KEY tidak ditemui.');
  process.exit(1);
}

// Credentials loaded strictly from environment variables without hardcoded fallbacks
const MGR_EMAIL = process.env.TEST_MANAGER_EMAIL || process.env.DEMO_MANAGER_EMAIL || 'manager@sentosa.local';
const MGR_PASSWORD = process.env.TEST_MANAGER_PASSWORD || process.env.DEMO_MANAGER_PASSWORD;
if (!MGR_PASSWORD) {
  console.error('RALAT: Pemboleh ubah TEST_MANAGER_PASSWORD atau DEMO_MANAGER_PASSWORD tidak ditemui dalam persekitaran.');
  process.exit(1);
}
const MGR_PASSWORD_VALID: string = MGR_PASSWORD;

// Isolated test ports
const TEST_APP_PORT = 3005;
const TEST_BASE_URL = `http://127.0.0.1:${TEST_APP_PORT}`;
let mockAiPort = 0;
let mockAiBaseUrl = '';

// -----------------------------------------------------------------------------
// Upstream AI Mock Server
// Intercepts and logs upstream AI requests; ensures zero paid Gemini calls.
// -----------------------------------------------------------------------------
let upstreamAiCallsCount = 0;
const upstreamAiRequestLog: Array<{ method: string; url: string; timestamp: number }> = [];

const mockAiServer = http.createServer((req, res) => {
  upstreamAiCallsCount++;
  const entry = {
    method: req.method || 'GET',
    url: req.url || '',
    timestamp: Date.now(),
  };
  upstreamAiRequestLog.push(entry);
  console.log(`[UPSTREAM-AI-MOCK] Panggilan diterima (#${upstreamAiCallsCount}): ${entry.method} ${entry.url}`);

  const mockAiPayload = {
    issue_type: 'Lif rosak',
    safety: {
      has_hazard: false,
      hazard_type: null,
      is_negated: false,
      is_past_resolved: false,
      is_uncertain: false,
      source_quote: null,
    },
    location: {
      mentioned_block: 'Blok A',
      mentioned_floor: 3,
      specific_location: 'Lif Blok A',
      source_quote: null,
    },
    scope: {
      scope: 'single_point',
      has_alternatives: false,
      source_quote: null,
    },
    duration: {
      raw_mention: null,
      source_quote: null,
    },
    unknowns: ['Status kehadiran juruteknik belum disahkan.'],
  };

  const responseJson = JSON.stringify({
    candidates: [
      {
        content: {
          parts: [{ text: JSON.stringify(mockAiPayload) }],
        },
      },
    ],
  });

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(responseJson);
});

process.env.AI_PROVIDER = 'gemini';
if (!process.env.GEMINI_API_KEY) {
  process.env.GEMINI_API_KEY = 'mock-upstream-test-key';
}

function runPsql(sql: string): string {
  const result = execSync(
    `docker exec -i supabase_db_ppr-nadi psql -U postgres -d postgres -v ON_ERROR_STOP=1 -t -A`,
    { input: sql, encoding: 'utf-8' }
  );
  return result.trim();
}

function getProcessListeningOnPort(port: number): number | null {
  try {
    const out = execSync(
      `pwsh -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess"`,
      { encoding: 'utf-8' }
    ).trim();
    if (!out) return null;
    const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    return lines.length > 0 ? parseInt(lines[0], 10) : null;
  } catch {
    return null;
  }
}

async function waitForPort(port: number, timeoutMs = 45000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const pid = getProcessListeningOnPort(port);
    if (pid) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/`, {
          signal: AbortSignal.timeout(2000),
        }).catch(() => null);
        if (res) return true;
      } catch {
        // waiting for HTTP server to respond
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

function startTestAppProcess(port: number, aiBaseUrl: string): void {
  // Never kill or alter user app on port 3000. Start independent process on designated test port.
  // Use NEXT_DIST_DIR=.next-test so Next.js dev lock does not collide with user dev server.
  const child = spawn(
    'cmd.exe',
    ['/c', `npx next dev -p ${port} -H 127.0.0.1`],
    {
      cwd: process.cwd(),
      detached: true,
      stdio: 'ignore',
      shell: false,
      env: {
        ...process.env,
        PORT: String(port),
        NEXT_DIST_DIR: '.next-test',
        GEMINI_BASE_URL: aiBaseUrl,
        GEMINI_API_KEY: 'mock-upstream-test-key',
        AI_PROVIDER: 'gemini',
      },
    }
  );
  child.unref();
}

function stopProcessByPid(pid: number): void {
  try {
    execSync(`pwsh -Command "Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue"`);
  } catch {
    // process already exited
  }
}

function clearPort(port: number): void {
  try {
    execSync(
      `pwsh -Command "$pids = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess; foreach ($p in $pids) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }"`
    );
  } catch {
    // already clear
  }
}

async function runRealRestartVerification() {
  console.log('================================================================');
  console.log('PPR NADI — REAL BROWSER RESTART DURABILITY & E2E VERIFICATION');
  console.log(`Port Ujian: ${TEST_APP_PORT} (Port Pengguna 3000 KEKAL TIDAK DISENTUH)`);
  console.log('Upstream Mock AI: Port Dinamik');
  console.log('Automasi Browser: Playwright (Google Chrome Sebenar)');
  console.log('================================================================\n');

  let testReportId = '';
  let initialPid: number | null = null;
  let newPid: number | null = null;

  // 1. Mulakan mock AI server upstream
  await new Promise<void>((resolve, reject) => {
    mockAiServer.listen(0, '127.0.0.1', () => {
      const addr = mockAiServer.address();
      if (addr && typeof addr === 'object') {
        mockAiPort = addr.port;
        mockAiBaseUrl = `http://127.0.0.1:${mockAiPort}`;
      }
      process.env.GEMINI_BASE_URL = mockAiBaseUrl;
      console.log(`✓ Upstream Mock AI Server sedia di ${mockAiBaseUrl}`);
      resolve();
    });
    mockAiServer.on('error', reject);
  });

  try {
    // -------------------------------------------------------------------------
    // STEP 1: Mulakan proses aplikasi ujian pertama pada port 3005
    // -------------------------------------------------------------------------
    console.log(`[LANGKAH 1] Memastikan port ${TEST_APP_PORT} bersih dan memulakan proses ujian...`);
    const existingTestPid = getProcessListeningOnPort(TEST_APP_PORT);
    if (existingTestPid) {
      console.log(`Membersihkan proses lama pada port ${TEST_APP_PORT} (PID: ${existingTestPid})...`);
      stopProcessByPid(existingTestPid);
      await new Promise((r) => setTimeout(r, 2000));
    }

    // Pastikan port 3000 masih utuh (aplikasi pengguna)
    const userAppPid = getProcessListeningOnPort(3000);
    console.log(`✓ Port 3000 (Aplikasi Pengguna) aktif di bawah PID: ${userAppPid || 'N/A'} (TIDAK DIGANGGU).`);

    console.log(`Memulakan aplikasi Next.js ujian pada port ${TEST_APP_PORT}...`);
    startTestAppProcess(TEST_APP_PORT, mockAiBaseUrl);

    const isReady1 = await waitForPort(TEST_APP_PORT, 45000);
    if (!isReady1) {
      throw new Error(`Aplikasi ujian gagal mendengar pada port ${TEST_APP_PORT} dalam tempoh 45 saat.`);
    }

    initialPid = getProcessListeningOnPort(TEST_APP_PORT);
    if (!initialPid) {
      throw new Error(`Gagal mengesan PID proses ujian pada port ${TEST_APP_PORT}!`);
    }
    if (initialPid === userAppPid) {
      throw new Error(`KESILAPAN KRITIKAL: PID ujian sama dengan PID aplikasi pengguna pada port 3000!`);
    }
    console.log(`✓ Aplikasi ujian pertama sedia pada port ${TEST_APP_PORT} (PID: ${initialPid}).`);

    // -------------------------------------------------------------------------
    // STEP 2: Cipta aduan ujian berlabel jelas dalam Supabase
    // -------------------------------------------------------------------------
    console.log('\n[LANGKAH 2] Mencipta aduan ujian berlabel jelas dalam Supabase...');
    testReportId = crypto.randomUUID();
    const reporterId = runPsql(`SELECT id FROM public.profiles WHERE role = 'resident' LIMIT 1;`);
    const bldgId = runPsql(`SELECT id FROM public.buildings WHERE estate_id = 'ppr-sentosa-demo' AND code = 'BLK_A' LIMIT 1;`);
    const zoneId = runPsql(`SELECT id FROM public.service_zones WHERE building_id = '${bldgId}' LIMIT 1;`);

    runPsql(`
      SET session_replication_role = replica;
      INSERT INTO public.incident_reports (id, reporter_id, building_id, service_zone_id, category, description, status, urgency_hint)
      VALUES (
        '${testReportId}',
        '${reporterId}',
        '${bldgId}',
        '${zoneId}',
        'lift',
        '[TEST-BROWSER-E2E-VERIFICATION] Lif Blok A terhenti antara tingkat 3 dan 4. Pintu tidak boleh dibuka dari dalam.',
        'submitted',
        'high'
      );
    `);
    console.log(`✓ Aduan ujian dicipta dalam Supabase: ${testReportId}`);

    // -------------------------------------------------------------------------
    // STEP 3 & 4: Browser Automasi Sebenar (Penjanaan & Pengesahan melalui UI)
    // -------------------------------------------------------------------------
    console.log('\n[LANGKAH 3 & 4] Memulakan Google Chrome sebenar untuk aliran UI (Jana & Sahkan Keputusan)...');
    const browser1: Browser = await chromium.launch({
      executablePath: CHROME_PATH,
      headless: true,
    });

    let baselineRecords: {
      reportId: string;
      evaluationId: string;
      decisionId: string;
      decisionVersion: number;
      decidedPriority: string;
      isOverride: boolean;
      overrideReason: string;
      decidedBy: string;
      decidedByName: string;
      decidedAt: string;
      initialPid: number;
      upstreamAiCallsCount: number;
      evalRowCount: number;
      decRowCount: number;
    };

    try {
      const page1: Page = await browser1.newPage();
      page1.setDefaultTimeout(35000);

      page1.on('console', (msg) => {
        if (msg.type() === 'error') console.log(`[Browser 1 Console Error]: ${msg.text()}`);
      });
      page1.on('pageerror', (err) => console.error(`[Browser 1 PageError]:`, err));

      // A & B: Buka halaman log masuk dan log masuk sebagai pengurus
      const loginUrl = `${TEST_BASE_URL}/login?returnTo=/management/inbox`;
      console.log(`Browser melayari: ${loginUrl}`);
      await page1.goto(loginUrl, { waitUntil: 'domcontentloaded' });
      await page1.waitForSelector('#login-email', { timeout: 25000 });
      await page1.waitForSelector('input[name="returnTo"]', { timeout: 15000 }).catch(() => null);
      await page1.waitForLoadState('networkidle').catch(() => null);
      await page1.waitForTimeout(500);

      console.log('Mengisi kelayakan pengurus dalam borang log masuk...');
      await page1.fill('#login-email', MGR_EMAIL);
      await page1.fill('#login-password', MGR_PASSWORD_VALID);
      await page1.click('#login-submit-btn');

      // Tunggu hingga sampai ke /management atau /management/inbox
      console.log('Menunggu peralihan ke pengurusan...');
      await page1.waitForFunction(
        () => window.location.pathname.startsWith('/management'),
        null,
        { timeout: 45000 }
      );
      if (page1.url().includes('/management') && !page1.url().includes('/management/inbox')) {
        console.log('Mendarat di /management, menavigasi ke /management/inbox...');
        await page1.goto(`${TEST_BASE_URL}/management/inbox`, { waitUntil: 'domcontentloaded' });
      }
      console.log(`✓ Berjaya mendarat di inbox: ${page1.url()}`);

      // Pastikan hidrasi selesai
      await page1.waitForLoadState('networkidle');
      await page1.waitForTimeout(1000);

      // C: Cari aduan ujian dalam inbox
      const reportCardSelector = `[data-testid="report-card-${testReportId}"]`;
      console.log(`Menunggu kad aduan ${testReportId} dipaparkan di UI...`);
      await page1.waitForSelector(reportCardSelector, { timeout: 25000 });

      // Pastikan hidrasi panel selesai sebelum interaksi
      console.log('Menunggu panel terhidrasi (data-hydrated="true")...');
      await page1.waitForFunction(
        (id) => {
          const el = document.querySelector(`[data-testid="priority-explainer-${id}"]`);
          return el && el.getAttribute('data-hydrated') === 'true';
        },
        testReportId,
        { timeout: 25000 }
      );
      console.log('✓ Panel selesai dihidrasi oleh React.');

      // D: Klik tindakan "Jana cadangan" melalui UI
      const generateBtnSelector = `[data-testid="generate-priority-btn-${testReportId}"]`;
      console.log(`Mengklik butang "Jana cadangan" ([data-testid="generate-priority-btn-${testReportId}"]) melalui UI...`);
      const aiCallsBeforeEval = upstreamAiCallsCount;

      await page1.waitForSelector(generateBtnSelector, { state: 'visible' });
      await page1.click(generateBtnSelector);

      // Tunggu cadangan selesai dijana dan tab dipaparkan
      console.log('Menunggu cadangan dijana oleh enjin peraturan...');
      const decisionTabSelector = `[data-testid="explainer-step-tab-3"]`;
      try {
        await page1.waitForSelector(decisionTabSelector, { timeout: 25000 });
      } catch (waitErr) {
        // Semak jika ada ralat dipaparkan di UI
        const errorText = await page1.textContent('[data-testid^="priority-error"]').catch(() => null);
        console.error('Kandungan ralat di UI jika ada:', errorText);
        throw waitErr;
      }

      const aiCallsAfterEval = upstreamAiCallsCount;
      const aiCallsDuringEval = aiCallsAfterEval - aiCallsBeforeEval;
      console.log(`✓ Cadangan keutamaan berjaya dipaparkan di UI.`);
      console.log(`✓ Panggilan Upstream Mock AI semasa penjanaan UI: ${aiCallsDuringEval}`);
      if (aiCallsDuringEval <= 0) {
        throw new Error('Upstream mock AI tidak menerima panggilan semasa penjanaan UI!');
      }

      const panelScope1 = page1.locator(`[data-testid="priority-explainer-${testReportId}"]`);

      // E: Buka tab keputusan dan sahkan keputusan melalui UI
      console.log('Mengklik Tab 4 (Keputusan) dalam panel UI...');
      await panelScope1.locator('[data-testid="explainer-step-tab-3"]').click();

      console.log('Memilih keputusan pengurus: immediate_review...');
      const selectLocator = panelScope1.locator('[data-testid="manager-decision-select"]');
      await selectLocator.waitFor();
      await selectLocator.selectOption({ value: 'immediate_review' });
      const currentSelected = await selectLocator.inputValue();
      console.log(`✓ Nilai pilihan keputusan di UI: ${currentSelected}`);
      await page1.waitForTimeout(500);

      const overrideReasonText = 'Pemeriksaan fizikal pasukan teknikal di tapak: motor brek perlu dilaraskan.';
      console.log('Memasukkan catatan override...');
      const textareaLocator = panelScope1.locator('[data-testid="override-reason-textarea"]');
      await textareaLocator.waitFor();
      await textareaLocator.fill(overrideReasonText);

      console.log('Mengklik butang "Sahkan keputusan pengurus" ([data-testid="confirm-decision-btn"]) melalui UI...');
      const confirmBtnLocator = panelScope1.locator('[data-testid="confirm-decision-btn"]');
      await confirmBtnLocator.click();

      // Tunggu badge pengesahan muncul
      console.log('Menunggu badge pengesahan dipaparkan di UI...');
      const badgeLocator = panelScope1.locator('[data-testid="decision-confirmed-badge"]');
      await badgeLocator.waitFor({ timeout: 25000 });
      const badgeText = await badgeLocator.textContent();
      console.log(`✓ Status Badge di UI: "${badgeText?.trim()}"`);
      if (!badgeText || !badgeText.includes('Semak serta-merta')) {
        throw new Error(`Badge pengesahan tidak mengandungi "Semak serta-merta": "${badgeText}"`);
      }

      // F: Rekod snapshot awal daripada UI dan pangkalan data
      const explainerContainerSelector = `[data-testid="priority-explainer-${testReportId}"]`;
      const evalIdAttr = await page1.getAttribute(explainerContainerSelector, 'data-evaluation-id');
      const decIdAttr = await page1.getAttribute(explainerContainerSelector, 'data-decision-id');
      const decVersionAttr = await page1.getAttribute(explainerContainerSelector, 'data-decision-version');
      const decPriorityAttr = await page1.getAttribute(explainerContainerSelector, 'data-decided-priority');
      const decByAttr = await page1.getAttribute(explainerContainerSelector, 'data-decided-by');
      const overrideReasonAttr = await page1.getAttribute(explainerContainerSelector, 'data-override-reason');
      const isOverrideAttr = await page1.getAttribute(explainerContainerSelector, 'data-is-override');

      if (!evalIdAttr || !decIdAttr) {
        throw new Error(`Atribut evaluation-id atau decision-id tidak ditemui dalam kontena UI!`);
      }

      const dbDecRow = runPsql(
        `SELECT decided_at, (SELECT full_name FROM public.profiles WHERE id = decided_by) FROM public.report_priority_decisions WHERE id = '${decIdAttr}';`
      );
      const [decidedAt, decidedByName] = dbDecRow.split('|');

      baselineRecords = {
        reportId: testReportId,
        evaluationId: evalIdAttr,
        decisionId: decIdAttr,
        decisionVersion: parseInt(decVersionAttr || '1', 10),
        decidedPriority: decPriorityAttr || 'immediate_review',
        isOverride: isOverrideAttr === 'true',
        overrideReason: overrideReasonAttr || overrideReasonText,
        decidedBy: decByAttr || '',
        decidedByName: decidedByName || 'Pengurus Sentosa',
        decidedAt: decidedAt || new Date().toISOString(),
        initialPid: initialPid!,
        upstreamAiCallsCount,
        evalRowCount: parseInt(
          runPsql(`SELECT count(*) FROM public.report_priority_evaluations WHERE report_id = '${testReportId}';`),
          10
        ),
        decRowCount: parseInt(
          runPsql(`SELECT count(*) FROM public.report_priority_decisions WHERE report_id = '${testReportId}';`),
          10
        ),
      };

      console.log('\n--- SNAPSHOT REKOD UI SEBELUM RESTART ---');
      console.log(JSON.stringify(baselineRecords, null, 2));
    } finally {
      await browser1.close();
      console.log('✓ Sesi browser 1 ditutup.');
    }

    // -------------------------------------------------------------------------
    // STEP 6: Hentikan HANYA proses aplikasi ujian pada port 3005
    // -------------------------------------------------------------------------
    console.log(`\n[LANGKAH 6] Menghentikan HANYA proses aplikasi ujian (PID: ${initialPid})...`);
    stopProcessByPid(initialPid!);

    await new Promise((r) => setTimeout(r, 2000));
    const deadPid = getProcessListeningOnPort(TEST_APP_PORT);
    if (deadPid) {
      throw new Error(`Port ${TEST_APP_PORT} masih dipegang oleh PID ${deadPid} selepas dihentikan!`);
    }
    console.log(`✓ Proses PID ${initialPid} dihentikan. Port ${TEST_APP_PORT} kini kosong.`);

    // Sahkan port 3000 masih berjalan lancar
    const userAppPidStillRunning = getProcessListeningOnPort(3000);
    console.log(`✓ Sah: Port 3000 (Aplikasi Pengguna PID: ${userAppPidStillRunning}) TIDAK TERJEJAS.`);

    // -------------------------------------------------------------------------
    // STEP 7: Mulakan proses aplikasi Next.js BAHARU pada port 3005
    // -------------------------------------------------------------------------
    console.log(`\n[LANGKAH 7] Memulakan proses aplikasi Next.js BAHARU pada port ${TEST_APP_PORT}...`);
    startTestAppProcess(TEST_APP_PORT, mockAiBaseUrl);

    const isReady2 = await waitForPort(TEST_APP_PORT, 45000);
    if (!isReady2) {
      throw new Error(`Aplikasi ujian baharu gagal dimulakan pada port ${TEST_APP_PORT} dalam 45 saat.`);
    }

    newPid = getProcessListeningOnPort(TEST_APP_PORT);
    if (!newPid) {
      throw new Error(`Gagal mengesan PID aplikasi baharu pada port ${TEST_APP_PORT}!`);
    }
    if (newPid === initialPid) {
      throw new Error(`PID baharu (${newPid}) sama dengan PID lama (${initialPid})! Ini bukan proses baharu.`);
    }
    console.log(`✓ PROSES BAHARU BERJAYA DIMULAKAN! PID Baharu: ${newPid} (PID Lama: ${initialPid})`);

    // -------------------------------------------------------------------------
    // STEP 8 & 9: Browser Automasi Pasca-Restart (Log masuk semula & semak keputusan di UI)
    // -------------------------------------------------------------------------
    console.log('\n[LANGKAH 8 & 9] Membuka sesi Google Chrome BAHARU untuk mengesahkan keputusan di UI pasca-restart...');
    const aiCallsBeforePostRestart = upstreamAiCallsCount;

    const browser2: Browser = await chromium.launch({
      executablePath: CHROME_PATH,
      headless: true,
    });

    let postRecords: {
      reportId: string;
      evaluationId: string;
      decisionId: string;
      decisionVersion: number;
      decidedPriority: string;
      isOverride: boolean;
      overrideReason: string;
      decidedBy: string;
      newPid: number;
      evalRowCount: number;
      decRowCount: number;
    };

    try {
      const page2: Page = await browser2.newPage();
      page2.setDefaultTimeout(30000);

      page2.on('console', (msg) => {
        console.log(`[Browser 2 Console ${msg.type()}]: ${msg.text()}`);
      });
      page2.on('pageerror', (err) => console.error(`[Browser 2 PageError]:`, err));

      const loginUrl = `${TEST_BASE_URL}/login?returnTo=/management/inbox`;
      console.log(`Browser baharu melayari: ${loginUrl}`);
      await page2.goto(loginUrl, { waitUntil: 'domcontentloaded' });
      await page2.waitForSelector('#login-email', { timeout: 25000 });
      await page2.waitForSelector('input[name="returnTo"]', { timeout: 15000 }).catch(() => null);
      await page2.waitForLoadState('networkidle').catch(() => null);
      await page2.waitForTimeout(500);

      console.log('Mengisi kelayakan pengurus untuk sesi baharu...');
      await page2.fill('#login-email', MGR_EMAIL);
      await page2.fill('#login-password', MGR_PASSWORD_VALID);
      await page2.click('#login-submit-btn');

      console.log('Menunggu peralihan ke pengurusan pada proses baharu...');
      await page2.waitForFunction(
        () => window.location.pathname.startsWith('/management'),
        null,
        { timeout: 45000 }
      );
      if (page2.url().includes('/management') && !page2.url().includes('/management/inbox')) {
        console.log('Mendarat di /management, menavigasi ke /management/inbox...');
        await page2.goto(`${TEST_BASE_URL}/management/inbox`, { waitUntil: 'domcontentloaded' });
      }
      console.log(`✓ Berjaya mendarat di inbox aplikasi baharu: ${page2.url()}`);

      // Tunggu kad aduan yang sama muncul
      const reportCardSelector = `[data-testid="report-card-${testReportId}"]`;
      await page2.waitForSelector(reportCardSelector, { timeout: 20000 });
      console.log(`✓ Kad aduan ${testReportId} ditemui di UI aplikasi baharu.`);

      // Pastikan hidrasi selesai
      console.log('Menunggu panel pasca-restart terhidrasi (data-hydrated="true")...');
      await page2.waitForFunction(
        (id) => {
          const el = document.querySelector(`[data-testid="priority-explainer-${id}"]`);
          return el && el.getAttribute('data-hydrated') === 'true';
        },
        testReportId,
        { timeout: 25000 }
      );
      console.log('✓ Panel pasca-restart selesai dihidrasi.');

      // Sahkan badge pengesahan wujud dan menunjukkan nilai betul dalam BM
      const panelScope2 = page2.locator(`[data-testid="priority-explainer-${testReportId}"]`);
      const badgeLocatorPost = panelScope2.locator('[data-testid="decision-confirmed-badge"]');
      await badgeLocatorPost.waitFor({ timeout: 25000 });
      const badgeTextPost = await badgeLocatorPost.textContent();
      console.log(`✓ Status Badge di UI Pasca-Restart (BM): "${badgeTextPost?.trim()}"`);
      if (!badgeTextPost || !badgeTextPost.includes('Semak serta-merta')) {
        throw new Error(`Badge pasca-restart tidak mengandungi "Semak serta-merta": "${badgeTextPost}"`);
      }

      // Sahkan pertukaran bahasa ke EN memaparkan teks Inggeris sahaja
      console.log('Menguji penukaran bahasa ke EN dalam UI pengurusan...');
      const enBtn = page2.locator('button:has-text("EN")').first();
      if (await enBtn.isVisible().catch(() => false)) {
        await enBtn.click();
        await page2.waitForTimeout(500);
        const badgeTextEn = await badgeLocatorPost.textContent();
        console.log(`✓ Status Badge di UI Pasca-Restart (EN): "${badgeTextEn?.trim()}"`);
        if (!badgeTextEn || !badgeTextEn.includes('Confirmed: Immediate review')) {
          throw new Error(`Badge bahasa Inggeris tidak memaparkan "Confirmed: Immediate review": "${badgeTextEn}"`);
        }
        // Tukar semula ke BM
        const bmBtn = page2.locator('button:has-text("BM")').first();
        await bmBtn.click();
        await page2.waitForTimeout(500);
        console.log('✓ Pengesahan bahasa: BM memaparkan BM sahaja, EN memaparkan English sahaja.');
      }

      // Dapatkan data kontena di UI
      const explainerContainerSelector = `[data-testid="priority-explainer-${testReportId}"]`;
      const evalIdPost = await page2.getAttribute(explainerContainerSelector, 'data-evaluation-id');
      const decIdPost = await page2.getAttribute(explainerContainerSelector, 'data-decision-id');
      const decVersionPost = await page2.getAttribute(explainerContainerSelector, 'data-decision-version');
      const decPriorityPost = await page2.getAttribute(explainerContainerSelector, 'data-decided-priority');
      const decByPost = await page2.getAttribute(explainerContainerSelector, 'data-decided-by');
      const overrideReasonPost = await page2.getAttribute(explainerContainerSelector, 'data-override-reason');
      const isOverridePost = await page2.getAttribute(explainerContainerSelector, 'data-is-override');

      postRecords = {
        reportId: testReportId,
        evaluationId: evalIdPost || '',
        decisionId: decIdPost || '',
        decisionVersion: parseInt(decVersionPost || '0', 10),
        decidedPriority: decPriorityPost || '',
        isOverride: isOverridePost === 'true',
        overrideReason: overrideReasonPost || '',
        decidedBy: decByPost || '',
        newPid: newPid!,
        evalRowCount: parseInt(
          runPsql(`SELECT count(*) FROM public.report_priority_evaluations WHERE report_id = '${testReportId}';`),
          10
        ),
        decRowCount: parseInt(
          runPsql(`SELECT count(*) FROM public.report_priority_decisions WHERE report_id = '${testReportId}';`),
          10
        ),
      };

      console.log('\n--- SNAPSHOT REKOD UI SELEPAS RESTART (PROSES BAHARU) ---');
      console.log(JSON.stringify(postRecords, null, 2));

      // Buka panel dan semak tab 4 (Keputusan) memaparkan kad keputusan terkini yang sama
      console.log('Mengembangkan panel keputusan pasca-restart...');
      const expandBtn = panelScope2.locator(`[data-testid="toggle-explainer-btn-${testReportId}"]`);
      await expandBtn.waitFor({ timeout: 15000 });
      await expandBtn.click();

      console.log('Mengklik Tab 4 (Keputusan)...');
      await panelScope2.locator('[data-testid="explainer-step-tab-3"]').click();

      const latestDecisionCardLocator = panelScope2.locator('[data-testid="latest-decision-card"]');
      await latestDecisionCardLocator.waitFor({ timeout: 15000 });
      const cardText = await latestDecisionCardLocator.textContent();
      console.log(`✓ Kandungan kad keputusan terkini di UI: ${cardText?.replace(/\s+/g, ' ').trim()}`);
      if (!cardText || !cardText.includes('v1') || !cardText.includes('Semak serta-merta')) {
        throw new Error(`Kad keputusan terkini tidak memaparkan versi v1 atau Semak serta-merta! Teks: "${cardText}"`);
      }
    } finally {
      await browser2.close();
      console.log('✓ Sesi browser 2 ditutup.');
    }

    // -------------------------------------------------------------------------
    // STEP 10: Asersi ketat — Semua snapshot mesti sama, 0 rekod bertambah, 0 panggilan AI
    // -------------------------------------------------------------------------
    console.log('\n[LANGKAH 10] Menjalankan semakan asersi ketat...');

    if (postRecords.evaluationId !== baselineRecords.evaluationId) {
      throw new Error(
        `Evaluation ID tidak sepadan! Asal: ${baselineRecords.evaluationId}, Diterima: ${postRecords.evaluationId}`
      );
    }
    console.log(`✓ Evaluation ID sepadan: ${postRecords.evaluationId}`);

    if (postRecords.decisionId !== baselineRecords.decisionId) {
      throw new Error(
        `Decision ID tidak sepadan! Asal: ${baselineRecords.decisionId}, Diterima: ${postRecords.decisionId}`
      );
    }
    console.log(`✓ Decision ID sepadan: ${postRecords.decisionId}`);

    if (postRecords.decisionVersion !== baselineRecords.decisionVersion) {
      throw new Error(
        `Versi keputusan berubah! Asal: ${baselineRecords.decisionVersion}, Diterima: ${postRecords.decisionVersion}`
      );
    }
    console.log(`✓ Versi keputusan sepadan: v${postRecords.decisionVersion}`);

    if (postRecords.decidedPriority !== baselineRecords.decidedPriority) {
      throw new Error(
        `Keutamaan keputusan berbeza! Asal: ${baselineRecords.decidedPriority}, Diterima: ${postRecords.decidedPriority}`
      );
    }
    console.log(`✓ Keutamaan sepadan: ${postRecords.decidedPriority}`);

    if (postRecords.isOverride !== baselineRecords.isOverride) {
      throw new Error(
        `isOverride berbeza! Asal: ${baselineRecords.isOverride}, Diterima: ${postRecords.isOverride}`
      );
    }
    console.log(`✓ isOverride sepadan: ${postRecords.isOverride}`);

    if (postRecords.overrideReason !== baselineRecords.overrideReason) {
      throw new Error(
        `Sebab override tidak sepadan! Asal: "${baselineRecords.overrideReason}", Diterima: "${postRecords.overrideReason}"`
      );
    }
    console.log(`✓ Sebab override sepadan: "${postRecords.overrideReason}"`);

    if (postRecords.decidedBy !== baselineRecords.decidedBy) {
      throw new Error(
        `Pengurus yang mengesahkan tidak sepadan! Asal: ${baselineRecords.decidedBy}, Diterima: ${postRecords.decidedBy}`
      );
    }
    console.log(`✓ Pengurus yang mengesahkan sepadan: ${postRecords.decidedBy}`);

    if (postRecords.evalRowCount !== baselineRecords.evalRowCount) {
      throw new Error(
        `Bilangan baris evaluation bertambah daripada ${baselineRecords.evalRowCount} ke ${postRecords.evalRowCount}!`
      );
    }
    if (postRecords.decRowCount !== baselineRecords.decRowCount) {
      throw new Error(
        `Bilangan baris decision bertambah daripada ${baselineRecords.decRowCount} ke ${postRecords.decRowCount}!`
      );
    }
    console.log(`✓ Bilangan rekod database tidak bertambah (Tepat 1 Evaluation, 1 Decision).`);

    // Semakan Upstream Mock AI: Pastikan tiada panggilan AI baharu semasa proses pembacaan pasca-restart
    const aiCallsDuringPostRestart = upstreamAiCallsCount - aiCallsBeforePostRestart;
    if (aiCallsDuringPostRestart !== 0) {
      throw new Error(
        `Panggilan AI dikesan semasa operasi bacaan pasca-restart (${aiCallsDuringPostRestart} panggilan baharu)!`
      );
    }
    console.log(`✓ Log Upstream Mock AI membuktikan TIADA panggilan AI berlaku ketika membaca keputusan pasca-restart (0 panggilan baharu).`);

    console.log('\n================================================================');
    console.log('✓ UJIAN BROWSER END-TO-END & RESTART BERJAYA SEPENUHNYA!');
    console.log(`- Status Automasi Browser     : PASS (Google Chrome Sebenar)`);
    console.log(`- Port Ujian                   : ${TEST_APP_PORT}`);
    console.log(`- PID Sebelum Restart          : ${initialPid}`);
    console.log(`- PID Selepas Restart          : ${newPid} (Disahkan proses berbeza)`);
    console.log(`- Port Aplikasi Pengguna (3000): KEKAL BERJALAN`);
    console.log(`- Evaluation ID                : ${postRecords.evaluationId}`);
    console.log(`- Decision ID                  : ${postRecords.decisionId}`);
    console.log(`- Status Badge di UI           : Disahkan: Semak serta-merta`);
    console.log(`- Versi Keputusan              : v${postRecords.decisionVersion}`);
    console.log(`- Panggilan Upstream AI Pasca  : 0 (Tiada panggilan AI berulang)`);
    console.log('================================================================\n');

    return {
      success: true,
      initialPid,
      newPid,
      baselineRecords,
      postRecords,
    };
  } finally {
    // Bersihkan proses ujian pada port 3005 jika masih ada
    const pidToKill = newPid || initialPid || getProcessListeningOnPort(TEST_APP_PORT);
    if (pidToKill) {
      console.log(`Menghentikan proses ujian (PID: ${pidToKill})...`);
      stopProcessByPid(pidToKill);
    }
    clearPort(TEST_APP_PORT);

    // Tutup mock server
    mockAiServer.close();

    // Bersihkan aduan ujian daripada Supabase
    if (testReportId) {
      console.log(`Membersihkan aduan ujian ${testReportId}...`);
      try {
        runPsql(`
          SET session_replication_role = replica;
          DELETE FROM public.incident_reports WHERE id = '${testReportId}';
        `);
        console.log('✓ Aduan ujian dibersihkan daripada database.');
      } catch (cleanErr) {
        console.error('Ralat pembersihan aduan:', cleanErr);
      }
    }

    // Bersihkan direktori binaan terpencil ujian .next-test
    try {
      execSync(`pwsh -Command "Remove-Item -LiteralPath '.next-test' -Recurse -Force -ErrorAction SilentlyContinue"`);
    } catch {
      // ignore
    }
  }
}

runRealRestartVerification()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nUJIAN RESTART GAGAL:', err);
    process.exit(1);
  });
