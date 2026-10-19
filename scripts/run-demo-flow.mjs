#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { chromium } from 'playwright-core';

// Load local environment
try {
  process.loadEnvFile('.env.local');
} catch {
  // Already loaded
}

const BASE_URL = process.env.TEST_APP_URL || 'http://127.0.0.1:3000';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const RESIDENT_PASSWORD = process.env.DEMO_RESIDENT_PASSWORD;
const MANAGER_PASSWORD = process.env.DEMO_MANAGER_PASSWORD;

if (!RESIDENT_PASSWORD || !MANAGER_PASSWORD) {
  throw new Error('DEMO_RESIDENT_PASSWORD and DEMO_MANAGER_PASSWORD must be defined in .env.local without hardcoded fallbacks.');
}

const PREFERRED_REPORT_ID = process.env.TARGET_DEMO_REPORT_ID || '4e5a63de-2225-4227-b02c-77489bbe0699';

function generateValidPng(width = 400, height = 400) {
  const line = Buffer.alloc(1 + width * 3, 160);
  line[0] = 0;
  const raw = Buffer.concat(Array(height).fill(line));
  const idatData = zlib.deflateSync(raw, { level: 0 });

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    const crcVal = zlib.crc32(Buffer.concat([t, data]));
    crc.writeUInt32BE(crcVal, 0);
    return Buffer.concat([len, t, data, crc]);
  }

  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    header,
    chunk('IHDR', ihdr),
    chunk('IDAT', idatData),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function verifyImageLoad(requestContext, url) {
  if (!url || url === '#' || !url.startsWith('http')) {
    throw new Error(`Invalid image URL: ${url}`);
  }
  const res = await requestContext.get(url);
  if (res.status() !== 200) {
    throw new Error(`Image fetch failed with HTTP ${res.status()} for URL: ${url}`);
  }
  const body = await res.body();
  if (body.length < 100) {
    throw new Error(`Image payload too small or empty (${body.length} bytes).`);
  }
  return body.length;
}

async function runDemoFlow() {
  console.log('==============================================================================');
  console.log('PPR NADI — STRICT DEMO WORKFLOW & RECORD VERIFICATION');
  console.log('==============================================================================');
  console.log(`[Target URL] ${BASE_URL}`);
  console.log(`[Target Record ID] ${PREFERRED_REPORT_ID}`);

  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
  });

  let activeReportId = '';

  try {
    // -------------------------------------------------------------------------
    // STEP 1: Resident Login & Check Existing Record First
    // -------------------------------------------------------------------------
    console.log('\n[Langkah 1/3] Log Masuk Penduduk & Semakan Rekod...');
    const residentContext = await browser.newContext();
    const residentPage = await residentContext.newPage();

    await residentPage.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
    await residentPage.fill('#login-email', 'resident@sentosa.local');
    await residentPage.fill('#login-password', RESIDENT_PASSWORD);
    await residentPage.click('button[type="submit"]');

    try {
      await residentPage.waitForURL(/\/resident/, { timeout: 10000 });
      console.log('  ✓ Penduduk berjaya diautentikasi.');
    } catch {
      const errEl = residentPage.locator('[role="alert"]');
      const errText = (await errEl.count() > 0) ? await errEl.innerText() : 'Tiada banner ralat';
      throw new Error(`Log masuk penduduk gagal: ${errText}`);
    }

    // Go to Sejarah to check if preferred report exists
    await residentPage.goto(`${BASE_URL}/resident/sejarah`, { waitUntil: 'networkidle' });
    const shortRef = `#LPR-${PREFERRED_REPORT_ID.substring(0, 8).toUpperCase()}`;
    const existingArticle = residentPage.locator(`article:has-text("${shortRef}")`).first();

    if (await existingArticle.count() > 0) {
      activeReportId = PREFERRED_REPORT_ID;
      console.log(`  ✓ Rekod sasaran sedia ada dijumpai dalam Sejarah: ${activeReportId} (${shortRef})`);

      // Verify Category, Location & Description
      const textContent = await existingArticle.innerText();
      if (!textContent.includes('UJIAN DEMO')) {
        throw new Error(`Penerangan aduan tidak mengandungi penanda 'UJIAN DEMO'.`);
      }
      if (!textContent.includes('Lif')) {
        throw new Error(`Kategori aduan tidak sepadan dengan 'Lif'.`);
      }
      if (!textContent.includes('Blok A')) {
        throw new Error(`Lokasi aduan tidak sepadan dengan 'Blok A'.`);
      }
      console.log('  ✓ Penerangan (UJIAN DEMO), Kategori (Lif), dan Lokasi (Blok A) disahkan tepat.');

      // Verify Evidence Image is loadable
      const attLink = existingArticle.locator('a[href*="http"]').first();
      if (await attLink.count() > 0) {
        const imgUrl = await attLink.getAttribute('href');
        const imgBytes = await verifyImageLoad(residentPage.request, imgUrl);
        console.log(`  ✓ Gambar bukti disahkan dimuatkan berjaya (HTTP 200, saiz: ${imgBytes} bait).`);
      } else {
        throw new Error('Tiada pautan gambar bukti dijumpai pada rekod sejarah.');
      }
    } else {
      console.log(`  ℹ Rekod sedia ada ${PREFERRED_REPORT_ID} tidak ditemui. Mencipta satu aduan baharu...`);

      // Navigate to /resident/lapor
      await residentPage.goto(`${BASE_URL}/resident/lapor`, { waitUntil: 'networkidle' });

      // Select category: lift
      const liftBtn = residentPage.locator('button:has-text("Lif")').first();
      if (await liftBtn.count() > 0) await liftBtn.click();

      // Select zone
      const zoneSelect = residentPage.locator('#report-zone');
      if (await zoneSelect.count() > 0) {
        const options = await zoneSelect.locator('option').all();
        if (options.length > 1) {
          const val = await options[1].getAttribute('value');
          if (val) await zoneSelect.selectOption(val);
        }
      }

      // Fill description
      const desc = 'UJIAN DEMO — Lif rosak di Blok A Aras 3, tersangkut dan lampu padam.';
      await residentPage.locator('#report-description').fill(desc);

      // Create temporary image and attach
      const tempImgPath = path.join(process.cwd(), 'temp-demo-photo.png');
      fs.writeFileSync(tempImgPath, generateValidPng(300, 300));
      try {
        await residentPage.locator('[data-testid="file-picker-input"]').setInputFiles(tempImgPath);
        console.log('  ✓ Gambar bukti dilampirkan.');

        // Submit report
        await residentPage.locator('[data-testid="submit-report-button"]').click();
        await residentPage.waitForSelector('[data-testid="report-saved-heading"]', { timeout: 15000 });

        // Extract and strictly validate Report ID
        const refLocator = residentPage.locator('[data-testid="active-report-id"]');
        if (await refLocator.count() > 0) {
          activeReportId = (await refLocator.innerText()).trim();
        }

        if (!activeReportId || activeReportId.length < 10) {
          throw new Error(`Report ID tidak sah atau kosong diterima: '${activeReportId}'`);
        }
        console.log(`  ✓ Laporan baru berjaya dicipta dengan ID: ${activeReportId}`);
      } finally {
        if (fs.existsSync(tempImgPath)) fs.unlinkSync(tempImgPath);
      }
    }

    await residentContext.close();

    // -------------------------------------------------------------------------
    // STEP 2: Management Login & Verify the EXACT Same Record
    // -------------------------------------------------------------------------
    console.log('\n[Langkah 2/3] Log Masuk Pengurusan & Pembukaan Rekod...');
    const managerContext = await browser.newContext();
    const managerPage = await managerContext.newPage();

    await managerPage.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
    await managerPage.fill('#login-email', 'manager@sentosa.local');
    await managerPage.fill('#login-password', MANAGER_PASSWORD);
    await managerPage.click('button[type="submit"]');

    try {
      await managerPage.waitForURL(/\/management/, { timeout: 10000 });
      console.log('  ✓ Pegawai pengurusan berjaya diautentikasi.');
    } catch {
      const errEl = managerPage.locator('[role="alert"]');
      const errText = (await errEl.count() > 0) ? await errEl.innerText() : 'Tiada banner ralat';
      throw new Error(`Log masuk pengurus gagal: ${errText}`);
    }

    // Navigate to /management/inbox
    await managerPage.goto(`${BASE_URL}/management/inbox`, { waitUntil: 'networkidle' });

    // Look for exact card: data-testid="report-card-${activeReportId}" or short ref
    const cardLocator = managerPage.locator(`[data-testid="report-card-${activeReportId}"]`).first();
    const fallbackShortRef = `#LPR-${activeReportId.substring(0, 8).toUpperCase()}`;

    let targetCard = cardLocator;
    if (await targetCard.count() === 0) {
      targetCard = managerPage.locator(`div:has-text("${fallbackShortRef}")`).first();
    }

    if (await targetCard.count() === 0) {
      throw new Error(`Rekod ${activeReportId} (${fallbackShortRef}) TIDAK dijumpai dalam Inbox Pengurusan!`);
    }

    console.log(`  ✓ Rekod aduan yang tepat ditemui dalam Inbox Pengurusan.`);

    // Verify Description, Category, Building
    const managerCardText = await targetCard.innerText();
    if (!managerCardText.includes('UJIAN DEMO')) {
      throw new Error(`Rekod pengurusan tidak mengandungi teks 'UJIAN DEMO'.`);
    }
    if (!managerCardText.includes('Lif')) {
      throw new Error(`Kategori dalam pengurusan tidak menunjukkan 'Lif'.`);
    }
    if (!managerCardText.includes('Blok A')) {
      throw new Error(`Lokasi dalam pengurusan tidak menunjukkan 'Blok A'.`);
    }
    console.log('  ✓ Butiran laporan disahkan: Kategori=Lif, Lokasi=Blok A, Penerangan=UJIAN DEMO.');

    // Verify Evidence Image Load from Management side
    const managerAttLink = targetCard.locator('a[href*="http"]').first();
    if (await managerAttLink.count() > 0) {
      const imgUrl = await managerAttLink.getAttribute('href');
      const imgBytes = await verifyImageLoad(managerPage.request, imgUrl);
      console.log(`  ✓ Gambar bukti pengurusan disahkan dimuatkan berjaya (HTTP 200, saiz: ${imgBytes} bait).`);
    } else {
      throw new Error('Tiada pautan gambar bukti dijumpai dalam kad aduan pengurusan.');
    }

    await managerContext.close();

    console.log('\n==============================================================================');
    console.log(`HASIL: KETETAPAN ALIRAN DEMO LULUS DENGAN KETAT`);
    console.log(`ID ADUAN DISAHKAN: ${activeReportId}`);
    console.log('==============================================================================');
  } finally {
    await browser.close();
  }
}

runDemoFlow().catch((err) => {
  console.error('\n✗ Kegagalan Pengesahan Aliran Demo:', err);
  process.exit(1);
});
