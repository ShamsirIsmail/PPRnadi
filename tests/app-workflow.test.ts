import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn as cpSpawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import zlib from 'node:zlib';
import { createServerClient } from '@supabase/ssr';
import { testSessionStorage, type CookieAdapter } from '@/lib/supabase/server';
import {
  submitResidentReport,
  reconcilePendingEvidenceAction,
  getReportRecoveryStatusAction,
} from '@/app/actions/resident-report';
import {
  reviewReportAction,
  createIncidentAction,
  confirmIncidentAction,
  advanceIncidentStatusAction,
  linkReportToIncidentAction,
  publishNoticeAction,
} from '@/app/actions/management';

try {
  process.loadEnvFile('.env.local');
} catch {
  // env already loaded or missing
}

const API_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:64321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SERVICE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY missing from environment. Populate .env.local before running tests.');
}
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
if (!ANON_KEY) {
  throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY missing from environment. Populate .env.local before running tests.');
}
const DB_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:64322/postgres';
const PSQL_PATH = 'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe';
const APP_PORT = process.env.TEST_APP_PORT ? parseInt(process.env.TEST_APP_PORT, 10) : 3000;
const APP_URL = process.env.TEST_APP_URL || `http://127.0.0.1:${APP_PORT}`;

function runPsql(sql: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = cpSpawn(PSQL_PATH, [DB_URL, '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql]);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`psql error (${code}): ${stderr || stdout}`));
    });
  });
}

/**
 * Generate a genuine, valid PNG image file of exact requested dimensions.
 * Produces valid PNG header, IHDR chunk, uncompressed IDAT scanlines, and IEND chunk.
 */
function generateValidPng(width = 600, height = 600): Buffer {
  const line = Buffer.alloc(1 + width * 3, 128);
  line[0] = 0; // Filter None
  const raw = Buffer.concat(Array(height).fill(line));
  const idatData = zlib.deflateSync(raw, { level: 0 });

  function chunk(type: string, data: Buffer): Buffer {
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
  ihdr[8] = 8; // Bit depth
  ihdr[9] = 2; // Color type RGB
  ihdr[10] = 0; // Compression
  ihdr[11] = 0; // Filter
  ihdr[12] = 0; // Interlace

  return Buffer.concat([
    header,
    chunk('IHDR', ihdr),
    chunk('IDAT', idatData),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Minimal 68-byte 1x1 transparent PNG
const SAMPLE_TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

function toFile(buf: Buffer, name: string, type = 'image/png'): File {
  return new File([new Uint8Array(buf) as unknown as BlobPart], name, { type });
}

interface UserSession {
  id: string;
  email: string;
  cookieJar: Map<string, string>;
  cookieAdapter: CookieAdapter;
  getCookieHeader: () => string;
  client: ReturnType<typeof createServerClient>;
}

describe('PPR NADI — Phase 02B Action Integration Test Suite (Server Action Direct Invocation)', () => {
  const runToken = crypto.randomBytes(4).toString('hex');
  const runId = `app_${Date.now()}_${runToken}`;
  const testPassword = `AppTestPass_${runToken}!`;

  let nextProc: ChildProcess | null = null;
  const cleanupUsers: string[] = [];
  const cleanupReports: string[] = [];
  const cleanupIncidents: string[] = [];
  const cleanupStoragePaths: string[] = [];
  const cleanupBuildings: string[] = [];

  let sentosaBldgA: string;
  let resA: UserSession;
  let mgrA: UserSession;
  let resB: UserSession;
  let mgrB: UserSession;
  let unassignedUser: UserSession;

  let baselineObjects = 0;

  beforeAll(async () => {
    // 1. Verify Target Instance
    expect(API_URL).toMatch(/^http:\/\/127\.0\.0\.1:64321/);
    const dbVer = await runPsql('SELECT current_database();');
    expect(dbVer).toContain('postgres');

    const countObjStr = await runPsql("SELECT count(*) FROM storage.objects WHERE bucket_id = 'incident-evidence';");
    baselineObjects = parseInt(countObjStr, 10) || 0;

    // 2. Start Next.js Server on port 3015 if not already running
    let serverRunning = false;
    try {
      const check = await fetch(`${APP_URL}/login`);
      if (check.status === 200) serverRunning = true;
    } catch {
      serverRunning = false;
    }

    if (!serverRunning) {
      const nextBin = path.join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next');
      nextProc = cpSpawn(process.execPath, [nextBin, 'start', '-p', String(APP_PORT)], {
        cwd: process.cwd(),
        stdio: 'ignore',
        detached: false,
      });

      const start = Date.now();
      while (Date.now() - start < 15000) {
        try {
          const res = await fetch(`${APP_URL}/login`);
          if (res.status === 200) {
            serverRunning = true;
            break;
          }
        } catch {
          // wait
        }
        await new Promise((r) => setTimeout(r, 300));
      }
      expect(serverRunning).toBe(true);
    }

    // 3. Resolve Blok A ID in PPR Sentosa Demo
    const bldgRes = await runPsql("SELECT id FROM public.buildings WHERE estate_id = 'ppr-sentosa-demo' LIMIT 1;");
    expect(bldgRes).toBeTruthy();
    sentosaBldgA = bldgRes;

    // 4. Helper to create synthetic users
    async function createIdentity(
      emailRole: string,
      role: 'resident' | 'management',
      estateId: string | null,
      bldgId: string | null
    ): Promise<UserSession> {
      const email = `${emailRole}_${runId}@temp-test.local`;
      const res = await fetch(`${API_URL}/auth/v1/admin/users`, {
        method: 'POST',
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          password: testPassword,
          email_confirm: true,
          user_metadata: { full_name: `Test ${emailRole}` },
        }),
      });

      expect(res.status).toBe(200);
      const user = await res.json();
      cleanupUsers.push(user.id);

      const bldgVal = bldgId ? `'${bldgId}'` : 'NULL';
      const estateVal = estateId ? `'${estateId}'` : 'NULL';

      await runPsql(`
        INSERT INTO public.profiles (id, role, full_name, assigned_estate_id, assigned_building_id, unit_number)
        VALUES ('${user.id}', '${role}', 'Test ${emailRole}', ${estateVal}, ${bldgVal}, '03-05');
      `);

      const cookieJar = new Map<string, string>();
      const cookieAdapter: CookieAdapter = {
        getAll() {
          return Array.from(cookieJar.entries()).map(([name, value]) => ({ name, value }));
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            if (value === '' || (options as { maxAge?: number })?.maxAge === 0) {
              cookieJar.delete(name);
            } else {
              cookieJar.set(name, value);
            }
          });
        },
      };

      const client = createServerClient(API_URL, ANON_KEY, {
        cookies: cookieAdapter,
      });

      const { data: authData, error: authError } = await client.auth.signInWithPassword({
        email,
        password: testPassword,
      });
      expect(authError).toBeNull();
      expect(authData.session).toBeDefined();

      return {
        id: user.id,
        email,
        cookieJar,
        cookieAdapter,
        getCookieHeader() {
          return Array.from(cookieJar.entries())
            .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
            .join('; ');
        },
        client,
      };
    }

    const otherBldgId = crypto.randomUUID();
    cleanupBuildings.push(otherBldgId);
    await runPsql(`
      INSERT INTO public.buildings (id, estate_id, code, name, total_floors, total_units)
      VALUES ('${otherBldgId}', 'other-estate-xyz', 'BLD_XYZ_${runToken}', 'Block XYZ', 10, 100);
    `);

    resA = await createIdentity('res_a', 'resident', 'ppr-sentosa-demo', sentosaBldgA);
    mgrA = await createIdentity('mgr_a', 'management', 'ppr-sentosa-demo', null);
    resB = await createIdentity('res_b', 'resident', 'other-estate-xyz', otherBldgId);
    mgrB = await createIdentity('mgr_b', 'management', 'other-estate-xyz', null);
    unassignedUser = await createIdentity('unassigned', 'resident', null, null);
  }, 30000);

  // ---------------------------------------------------------------------------
  // FIX 1 & AUTH: Resident Dashboard Server Component Boundary & Route Guards
  // ---------------------------------------------------------------------------
  describe('Fix 1 — Resident Dashboard Runtime & Route Protection', () => {
    it('redirects anonymous user attempting to access /resident/lapor with returnTo parameter', async () => {
      const res = await fetch(`${APP_URL}/resident/lapor`, { redirect: 'manual' });
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('/login?returnTo=%2Fresident%2Flapor');
      expect(res.headers.get('cache-control')).toContain('no-store');
    });

    it('renders the resident dashboard Server Component without runtime crash (Fix 1 verification)', async () => {
      const res = await fetch(`${APP_URL}/resident`, {
        headers: { Cookie: resA.getCookieHeader() },
        redirect: 'manual',
      });

      expect(res.status).toBe(200);
      const html = await res.text();

      // Check greeting, building name, and unit number
      expect(html).toContain('Blok A');
      expect(html).toContain('Unit 03-05');
      expect(html).toContain('Status Fasiliti &amp; Notis Rasmi');
      // Confirm no runtime error or crash message
      expect(html).not.toContain('Functions cannot be passed directly to Client Components');
      expect(html).not.toContain('Application error: a client-side exception has occurred');
    }, 30000);

    it('enforces role boundaries: resident redirected from /management, manager redirected from /resident', async () => {
      const resMgmt = await fetch(`${APP_URL}/management/inbox`, {
        headers: { Cookie: resA.getCookieHeader() },
        redirect: 'manual',
      });
      expect(resMgmt.status).toBe(307);
      expect(resMgmt.headers.get('location')).toBe('/resident');

      const mgrRes = await fetch(`${APP_URL}/resident/lapor`, {
        headers: { Cookie: mgrA.getCookieHeader() },
        redirect: 'manual',
      });
      expect(mgrRes.status).toBe(307);
      expect(mgrRes.headers.get('location')).toBe('/management');
    });

    it('blocks unassigned resident from report submission with clear structured error', async () => {
      const result = await testSessionStorage.run(unassignedUser.cookieAdapter, async () => {
        const formData = new FormData();
        formData.append('building_id', sentosaBldgA);
        formData.append('category', 'water_supply');
        formData.append('urgency', 'medium');
        formData.append('description', 'Percubaan laporan oleh penduduk tidak disahkan.');
        return await submitResidentReport(null, formData);
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('UNASSIGNED_RESIDENT: Akaun anda belum disahkan');
    });
  });

  // ---------------------------------------------------------------------------
  // FIX 2 & FIX 3: Photo Submission, 20MB Transport Limit, Valid >1MB PNG & Limits
  // ---------------------------------------------------------------------------
  describe('Fix 2 & Fix 3 — Photo Submission, Transport Limits & Image Validation', () => {
    it('submits a report with genuine >1 MB valid PNG file through Server Action (Fix 3)', async () => {
      // Create a genuine valid PNG larger than 1 MB (~1.08 MB)
      const bigPng = generateValidPng(600, 600);
      expect(bigPng.length).toBeGreaterThan(1024 * 1024); // > 1 MB
      expect(bigPng.length).toBeLessThan(5 * 1024 * 1024); // < 5 MB

      const fileObj = toFile(bigPng, 'evidence_large.png');

      const result = await testSessionStorage.run(resA.cookieAdapter, async () => {
        const formData = new FormData();
        formData.append('building_id', sentosaBldgA);
        formData.append('category', 'water_supply');
        formData.append('urgency', 'high');
        formData.append('description', 'Kebocoran paip besar dengan bukti foto saiz 1MB+.');
        formData.append('photos', fileObj);
        return await submitResidentReport(null, formData);
      });

      expect(result.success).toBe(true);
      expect(result.reportId).toBeDefined();
      expect(result.attachmentsCount).toBe(1);
      cleanupReports.push(result.reportId!);

      // Verify attachment record in database
      const attRow = await runPsql(`
        SELECT file_name, file_size_bytes, storage_path 
        FROM public.report_attachments 
        WHERE report_id = '${result.reportId}' 
        LIMIT 1;
      `);
      expect(attRow).toContain('.png');
      expect(attRow).toContain(String(bigPng.length));

      const storagePath = attRow.split('|')[2];
      cleanupStoragePaths.push(storagePath);

      // Authorized manager views photo via signed URL
      const { data: signedData, error: signErr } = await mgrA.client.storage
        .from('incident-evidence')
        .createSignedUrl(storagePath, 60);

      expect(signErr).toBeNull();
      expect(signedData?.signedUrl).toBeDefined();

      const dlUrl = signedData!.signedUrl.startsWith('http')
        ? signedData!.signedUrl
        : `${API_URL}/storage/v1${signedData!.signedUrl}`;

      const dlResp = await fetch(dlUrl);
      expect(dlResp.status).toBe(200);
      const dlBuf = Buffer.from(await dlResp.arrayBuffer());
      expect(dlBuf.equals(bigPng)).toBe(true); // Byte-for-byte match
    });

    it('submits a report with exactly 3 photos and verifies all 3 attach correctly (Fix 2)', async () => {
      const file1 = toFile(SAMPLE_TINY_PNG, 'photo1.png');
      const file2 = toFile(SAMPLE_TINY_PNG, 'photo2.png');
      const file3 = toFile(SAMPLE_TINY_PNG, 'photo3.png');

      const result = await testSessionStorage.run(resA.cookieAdapter, async () => {
        const formData = new FormData();
        formData.append('building_id', sentosaBldgA);
        formData.append('category', 'lift');
        formData.append('urgency', 'urgent');
        formData.append('description', 'Lif B rosak di tingkat 7 dengan 3 keping gambar.');
        formData.append('photos', file1);
        formData.append('photos', file2);
        formData.append('photos', file3);
        return await submitResidentReport(null, formData);
      });

      expect(result.success).toBe(true);
      expect(result.attachmentsCount).toBe(3);
      cleanupReports.push(result.reportId!);

      const countStr = await runPsql(`
        SELECT count(*) FROM public.report_attachments WHERE report_id = '${result.reportId}';
      `);
      expect(parseInt(countStr, 10)).toBe(3);

      const paths = await runPsql(`
        SELECT storage_path FROM public.report_attachments WHERE report_id = '${result.reportId}';
      `);
      paths.split('\n').forEach((p) => cleanupStoragePaths.push(p.trim()));
    });

    it('rejects submission attempting to upload 4 photos at once', async () => {
      const files = [1, 2, 3, 4].map(
        (i) => toFile(SAMPLE_TINY_PNG, `p${i}.png`)
      );

      const result = await testSessionStorage.run(resA.cookieAdapter, async () => {
        const formData = new FormData();
        formData.append('building_id', sentosaBldgA);
        formData.append('category', 'corridor_lighting');
        formData.append('urgency', 'low');
        formData.append('description', 'Lampu koridor rosak dengan 4 gambar tidak sah.');
        files.forEach((f) => formData.append('photos', f));
        return await submitResidentReport(null, formData);
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Maksimum 3 keping gambar sahaja dibenarkan.');
    });

    it('handles oversized file (>5 MB) before upload: preserves report and returns actionable uploadErrors', async () => {
      // 5.2 MB dummy buffer
      const oversizeBuf = Buffer.alloc(5.2 * 1024 * 1024, 0);
      oversizeBuf[0] = 0x89;
      oversizeBuf[1] = 0x50;
      oversizeBuf[2] = 0x4e;
      oversizeBuf[3] = 0x47;

      const fileObj = toFile(oversizeBuf, 'huge.png');

      const result = await testSessionStorage.run(resA.cookieAdapter, async () => {
        const formData = new FormData();
        formData.append('building_id', sentosaBldgA);
        formData.append('category', 'water_supply');
        formData.append('urgency', 'medium');
        formData.append('description', 'Fail terlalu besar melebihi 5MB.');
        formData.append('photos', fileObj);
        return await submitResidentReport(null, formData);
      });

      expect(result.success).toBe(true);
      expect(result.attachmentsCount).toBe(0);
      expect(result.uploadErrors).toBeDefined();
      expect(result.uploadErrors![0]).toContain('Melebihi had maksimum 5 MB');
      expect(result.canRetry).toBe(true);
      if (result.reportId) cleanupReports.push(result.reportId);
    });

    it('handles spoofed text file before upload: preserves report and returns actionable uploadErrors', async () => {
      const spoofedBuf = Buffer.from('<html><script>alert("hack")</script></html>', 'utf-8');
      const fileObj = toFile(spoofedBuf, 'spoofed.png');

      const result = await testSessionStorage.run(resA.cookieAdapter, async () => {
        const formData = new FormData();
        formData.append('building_id', sentosaBldgA);
        formData.append('category', 'water_supply');
        formData.append('urgency', 'medium');
        formData.append('description', 'Fail teks menyamar sebagai PNG.');
        formData.append('photos', fileObj);
        return await submitResidentReport(null, formData);
      });

      expect(result.success).toBe(true);
      expect(result.attachmentsCount).toBe(0);
      expect(result.uploadErrors).toBeDefined();
      expect(result.uploadErrors![0]).toContain('Format fail tidak disokong');
      expect(result.canRetry).toBe(true);
      if (result.reportId) cleanupReports.push(result.reportId);
    });
  });

  // ---------------------------------------------------------------------------
  // FIX 4 & FIX 5: Real Partial Failure Recovery & In-Place Retry on Same Report
  // ---------------------------------------------------------------------------
  describe('Fix 4 & Fix 5 — Partial Failure Recovery & Retry on Same Report', () => {
    let partialReportId: string;

    it('handles partial failure: report is created, valid photo attached, invalid photo reported with canRetry: true', async () => {
      const validFile = toFile(SAMPLE_TINY_PNG, 'valid_photo.png');
      const invalidFile = toFile(Buffer.from('not an image', 'utf-8'), 'invalid.png');

      const result = await testSessionStorage.run(resA.cookieAdapter, async () => {
        const formData = new FormData();
        formData.append('building_id', sentosaBldgA);
        formData.append('category', 'water_supply');
        formData.append('urgency', 'high');
        formData.append('description', 'Sebahagian bukti foto gagal ditentusahkan.');
        formData.append('photos', validFile);
        formData.append('photos', invalidFile);
        return await submitResidentReport(null, formData);
      });

      expect(result.success).toBe(true);
      expect(result.reportId).toBeDefined();
      expect(result.attachmentsCount).toBe(1);
      expect(result.uploadErrors).toBeDefined();
      expect(result.uploadErrors![0]).toContain('Format fail tidak disokong');
      expect(result.canRetry).toBe(true);

      partialReportId = result.reportId!;
      cleanupReports.push(partialReportId);

      const paths = await runPsql(`
        SELECT storage_path FROM public.report_attachments WHERE report_id = '${partialReportId}';
      `);
      if (paths) cleanupStoragePaths.push(paths.trim());
    });

    it('retries evidence submission against the existing report without creating a duplicate report', async () => {
      // Resident replaces the failed file with a valid PNG and retries using report_id
      const correctedFile = toFile(SAMPLE_TINY_PNG, 'corrected_photo.png');

      const result = await testSessionStorage.run(resA.cookieAdapter, async () => {
        const formData = new FormData();
        formData.append('report_id', partialReportId);
        formData.append('photos', correctedFile);
        return await submitResidentReport(null, formData);
      });

      expect(result.success).toBe(true);
      expect(result.reportId).toBe(partialReportId); // Attached to SAME report
      expect(result.attachmentsCount).toBe(2); // 1 previous + 1 newly attached
      expect(result.uploadErrors).toBeUndefined();

      // Verify no duplicate report was created in database
      const reportCountStr = await runPsql(`
        SELECT count(*) FROM public.incident_reports WHERE id = '${partialReportId}';
      `);
      expect(parseInt(reportCountStr, 10)).toBe(1);

      // Verify total attachments on this report is now 2
      const attCountStr = await runPsql(`
        SELECT count(*) FROM public.report_attachments WHERE report_id = '${partialReportId}';
      `);
      expect(parseInt(attCountStr, 10)).toBe(2);

      const paths = await runPsql(`
        SELECT storage_path FROM public.report_attachments WHERE report_id = '${partialReportId}';
      `);
      paths.split('\n').forEach((p) => {
        if (!cleanupStoragePaths.includes(p.trim())) cleanupStoragePaths.push(p.trim());
      });
    });

    it('denies another resident from retrying or adding photos to Resident A report', async () => {
      const hostileFile = toFile(SAMPLE_TINY_PNG, 'hostile.png');

      const result = await testSessionStorage.run(resB.cookieAdapter, async () => {
        const formData = new FormData();
        formData.append('report_id', partialReportId);
        formData.append('photos', hostileFile);
        return await submitResidentReport(null, formData);
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/tidak dijumpai|tidak dibenarkan/);
    });

    it('rejects adding evidence when report exceeds 3 attachments via retry', async () => {
      const extra1 = toFile(SAMPLE_TINY_PNG, 'extra1.png');
      const extra2 = toFile(SAMPLE_TINY_PNG, 'extra2.png');

      // Report already has 2 attachments. Trying to add 2 more would exceed cap (2 + 2 = 4 > 3)
      const result = await testSessionStorage.run(resA.cookieAdapter, async () => {
        const formData = new FormData();
        formData.append('report_id', partialReportId);
        formData.append('photos', extra1);
        formData.append('photos', extra2);
        return await submitResidentReport(null, formData);
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('had maksimum 3');
    });

    it('repeating a completed three-photo request returns verified existing result without duplicates', async () => {
      const p1 = toFile(generateValidPng(50, 50), 'repeat_p1.png');
      const p2 = toFile(generateValidPng(60, 60), 'repeat_p2.png');
      const p3 = toFile(generateValidPng(70, 70), 'repeat_p3.png');

      const clientReportId = crypto.randomUUID();

      // First submission with 3 photos
      const firstRes = await testSessionStorage.run(resA.cookieAdapter, async () => {
        const formData = new FormData();
        formData.append('client_report_id', clientReportId);
        formData.append('building_id', sentosaBldgA);
        formData.append('category', 'water_supply');
        formData.append('urgency', 'medium');
        formData.append('description', 'Ujian 3 gambar dengan ulangan permintaan.');
        formData.append('photos', p1);
        formData.append('photos', p2);
        formData.append('photos', p3);
        return await submitResidentReport(null, formData);
      });

      expect(firstRes.success).toBe(true);
      expect(firstRes.reportId).toBeDefined();
      expect(firstRes.attachmentsCount).toBe(3);
      cleanupReports.push(firstRes.reportId!);

      const paths = await runPsql(`
        SELECT storage_path FROM public.report_attachments WHERE report_id = '${firstRes.reportId}';
      `);
      paths.split('\n').forEach((p) => {
        if (p.trim() && !cleanupStoragePaths.includes(p.trim())) cleanupStoragePaths.push(p.trim());
      });

      // Second submission: Repeat exact same 3 photos with same client_report_id
      const repeatRes = await testSessionStorage.run(resA.cookieAdapter, async () => {
        const formData = new FormData();
        formData.append('client_report_id', clientReportId);
        formData.append('photos', p1);
        formData.append('photos', p2);
        formData.append('photos', p3);
        return await submitResidentReport(null, formData);
      });

      expect(repeatRes.success).toBe(true);
      expect(repeatRes.reportId).toBe(firstRes.reportId);
      expect(repeatRes.attachmentsCount).toBe(3);

      // Verify no duplicate attachment rows in database
      const countStr = await runPsql(`
        SELECT count(*) FROM public.report_attachments WHERE report_id = '${firstRes.reportId}';
      `);
      expect(parseInt(countStr, 10)).toBe(3);
    });

    it('two existing attachments plus one repeated photo and one new photo uses only one new slot', async () => {
      const p1 = toFile(generateValidPng(80, 80), 'slot_p1.png');
      const p2 = toFile(generateValidPng(90, 90), 'slot_p2.png');
      const p3 = toFile(generateValidPng(100, 100), 'slot_p3.png');

      const clientReportId = crypto.randomUUID();

      // Submit with 2 photos initially
      const initRes = await testSessionStorage.run(resA.cookieAdapter, async () => {
        const formData = new FormData();
        formData.append('client_report_id', clientReportId);
        formData.append('building_id', sentosaBldgA);
        formData.append('category', 'water_supply');
        formData.append('urgency', 'low');
        formData.append('description', 'Ujian penolakan slot pendua.');
        formData.append('photos', p1);
        formData.append('photos', p2);
        return await submitResidentReport(null, formData);
      });

      expect(initRes.success).toBe(true);
      expect(initRes.attachmentsCount).toBe(2);
      cleanupReports.push(initRes.reportId!);

      const paths = await runPsql(`
        SELECT storage_path FROM public.report_attachments WHERE report_id = '${initRes.reportId}';
      `);
      paths.split('\n').forEach((p) => {
        if (p.trim() && !cleanupStoragePaths.includes(p.trim())) cleanupStoragePaths.push(p.trim());
      });

      // Retry with 2 photos: p2 (already attached) and p3 (new).
      // If deduplication did not run before slot calculation, (2 existing + 2 submitted = 4 > 3) would fail.
      // But because p2 is deduplicated, only 1 new slot is required, and 2 + 1 = 3 <= 3 succeeds.
      const retryRes = await testSessionStorage.run(resA.cookieAdapter, async () => {
        const formData = new FormData();
        formData.append('client_report_id', clientReportId);
        formData.append('photos', p2);
        formData.append('photos', p3);
        return await submitResidentReport(null, formData);
      });

      expect(retryRes.success).toBe(true);
      expect(retryRes.reportId).toBe(initRes.reportId);
      expect(retryRes.attachmentsCount).toBe(3);

      const pathsAfter = await runPsql(`
        SELECT storage_path FROM public.report_attachments WHERE report_id = '${initRes.reportId}';
      `);
      pathsAfter.split('\n').forEach((p) => {
        if (p.trim() && !cleanupStoragePaths.includes(p.trim())) cleanupStoragePaths.push(p.trim());
      });

      const totalCount = await runPsql(`
        SELECT count(*) FROM public.report_attachments WHERE report_id = '${initRes.reportId}';
      `);
      expect(parseInt(totalCount, 10)).toBe(3);
    });

    it('reusing client_report_id cannot bypass a reviewed or linked report restriction', async () => {
      const clientReportId = crypto.randomUUID();

      // 1. Submit report
      const repRes = await testSessionStorage.run(resA.cookieAdapter, async () => {
        const formData = new FormData();
        formData.append('client_report_id', clientReportId);
        formData.append('building_id', sentosaBldgA);
        formData.append('category', 'corridor_lighting');
        formData.append('urgency', 'low');
        formData.append('description', 'Laporan yang akan disemak pengurusan.');
        return await submitResidentReport(null, formData);
      });

      expect(repRes.success).toBe(true);
      cleanupReports.push(repRes.reportId!);

      // 2. Manager reviews report -> status becomes 'reviewed'
      const reviewRes = await testSessionStorage.run(mgrA.cookieAdapter, async () => {
        return await reviewReportAction(repRes.reportId!);
      });
      expect(reviewRes.success).toBe(true);

      // 3. Resident tries to reuse client_report_id with new photo
      const newPhoto = toFile(SAMPLE_TINY_PNG, 'bypass_attempt.png');
      const bypassRes = await testSessionStorage.run(resA.cookieAdapter, async () => {
        const formData = new FormData();
        formData.append('client_report_id', clientReportId);
        formData.append('photos', newPhoto);
        return await submitResidentReport(null, formData);
      });

      expect(bypassRes.success).toBe(false);
      expect(bypassRes.canRetry).toBe(false);
      expect(bypassRes.statusChanged).toBe(true);
      expect(bypassRes.error).toContain("Status laporan telah berubah kepada 'reviewed'");
    });

    it('ignores forged user-controlled failure switches (_test_inject_metadata_failure) without triggering failure', async () => {
      const validPhoto = toFile(SAMPLE_TINY_PNG, 'safe_photo.png');
      const forgedRes = await testSessionStorage.run(resA.cookieAdapter, async () => {
        const formData = new FormData();
        formData.append('building_id', sentosaBldgA);
        formData.append('category', 'water_supply');
        formData.append('urgency', 'low');
        formData.append('description', 'Ujian suis kegagalan palsu.');
        formData.append('_test_inject_metadata_failure', 'true');
        formData.append('photos', validPhoto);
        return await submitResidentReport(null, formData);
      });

      expect(forgedRes.success).toBe(true);
      expect(forgedRes.attachmentsCount).toBe(1);
      expect(forgedRes.uploadErrors).toBeUndefined();
      cleanupReports.push(forgedRes.reportId!);

      const paths = await runPsql(`
        SELECT storage_path FROM public.report_attachments WHERE report_id = '${forgedRes.reportId}';
      `);
      if (paths.trim()) cleanupStoragePaths.push(paths.trim());
    });

    it('validates recovered file content and rejects fake images uploaded directly to Storage (Finding 4)', async () => {
      // 1. Create a base report with 0 photos
      const repRes = await testSessionStorage.run(resA.cookieAdapter, async () => {
        const formData = new FormData();
        formData.append('building_id', sentosaBldgA);
        formData.append('category', 'water_supply');
        formData.append('urgency', 'medium');
        formData.append('description', 'Ujian pengesahan kandungan bukti semasa pemulihan.');
        return await submitResidentReport(null, formData);
      });

      expect(repRes.success).toBe(true);
      const recoveryRepId = repRes.reportId!;
      cleanupReports.push(recoveryRepId);

      // 2. Upload a fake image directly to Storage as resident A
      const fakeStoragePath = `${resA.id}/${recoveryRepId}/fake_image.png`;
      cleanupStoragePaths.push(fakeStoragePath);

      const fakeBuffer = Buffer.from('NOT_AN_IMAGE_VALID_HEADER_TEXT_STREAM');
      const { error: upFakeErr } = await resA.client.storage
        .from('incident-evidence')
        .upload(fakeStoragePath, fakeBuffer, {
          contentType: 'image/png',
          upsert: false,
        });
      expect(upFakeErr).toBeNull();

      // 2b. Test getReportRecoveryStatusAction detection
      const recoveryStatus = await testSessionStorage.run(resA.cookieAdapter, async () => {
        return await getReportRecoveryStatusAction(recoveryRepId);
      });
      expect(recoveryStatus).toBeDefined();
      expect(recoveryStatus?.awaitingRecoveryPaths.length).toBe(1);

      // 3. Run reconcilePendingEvidenceAction - must reject invalid content
      const fakeReconcile = await testSessionStorage.run(resA.cookieAdapter, async () => {
        return await reconcilePendingEvidenceAction(recoveryRepId);
      });

      expect(fakeReconcile.success).toBe(true);
      expect(fakeReconcile.attachmentsCount).toBe(0);
      expect(fakeReconcile.uploadErrors).toBeDefined();
      expect(fakeReconcile.uploadErrors![0]).toContain('Format fail tidak sah atau binari imej rosak');

      // Verify NOT registered in database
      const fakeAttCount = await runPsql(`
        SELECT count(*) FROM public.report_attachments 
        WHERE report_id = '${recoveryRepId}' AND file_name = 'fake_image.png';
      `);
      expect(parseInt(fakeAttCount, 10)).toBe(0);

      // 4. Upload a genuine valid PNG directly to Storage as resident A
      const validStoragePath = `${resA.id}/${recoveryRepId}/valid_image.png`;
      cleanupStoragePaths.push(validStoragePath);

      const validBuffer = generateValidPng(120, 120);
      const { error: upValidErr } = await resA.client.storage
        .from('incident-evidence')
        .upload(validStoragePath, validBuffer, {
          contentType: 'image/png',
          upsert: false,
        });
      expect(upValidErr).toBeNull();

      // 5. Run reconcilePendingEvidenceAction - genuine image must succeed
      const validReconcile = await testSessionStorage.run(resA.cookieAdapter, async () => {
        return await reconcilePendingEvidenceAction(recoveryRepId);
      });

      expect(validReconcile.success).toBe(true);
      expect(validReconcile.attachmentsCount).toBe(1);

      // Verify registered in database
      const validAtt = await runPsql(`
        SELECT file_name, file_size_bytes FROM public.report_attachments 
        WHERE report_id = '${recoveryRepId}' AND file_name = 'valid_image.png';
      `);
      expect(validAtt).toContain('valid_image.png');
      expect(validAtt).toContain(String(validBuffer.length));
    });

    it('deduplicates identical candidates within the same submitted batch (batch-level deduplication)', async () => {
      // User selects the exact same photo twice in the same form submission
      const pngBytes = generateValidPng(65, 65);
      const dupFile1 = toFile(pngBytes, 'dup_photo.png');
      const dupFile2 = toFile(pngBytes, 'dup_photo.png');

      const result = await testSessionStorage.run(resA.cookieAdapter, async () => {
        const formData = new FormData();
        formData.append('building_id', sentosaBldgA);
        formData.append('category', 'water_supply');
        formData.append('urgency', 'low');
        formData.append('description', 'Ujian penolakan pendua dalam kelompok yang sama.');
        formData.append('photos', dupFile1);
        formData.append('photos', dupFile2);
        return await submitResidentReport(null, formData);
      });

      expect(result.success).toBe(true);
      expect(result.reportId).toBeDefined();
      expect(result.attachmentsCount).toBe(1); // Exactly 1 slot consumed
      cleanupReports.push(result.reportId!);

      const attCountStr = await runPsql(`
        SELECT count(*) FROM public.report_attachments WHERE report_id = '${result.reportId}';
      `);
      expect(parseInt(attCountStr, 10)).toBe(1);

      const paths = await runPsql(`
        SELECT storage_path FROM public.report_attachments WHERE report_id = '${result.reportId}';
      `);
      if (paths.trim()) cleanupStoragePaths.push(paths.trim());
    });

    it('deterministically coordinates storage upload collision and verifies byte-check reconciliation branch', async () => {
      // 1. Create a base report with 0 photos
      const repRes = await testSessionStorage.run(resA.cookieAdapter, async () => {
        const formData = new FormData();
        formData.append('building_id', sentosaBldgA);
        formData.append('category', 'water_supply');
        formData.append('urgency', 'low');
        formData.append('description', 'Ujian pertembungan storan deterministik.');
        return await submitResidentReport(null, formData);
      });
      expect(repRes.success).toBe(true);
      const repId = repRes.reportId!;
      cleanupReports.push(repId);

      const photoBuf = generateValidPng(72, 72);
      const photoFile = toFile(photoBuf, 'collision_photo.png');

      let beforeUploadTriggered = false;
      let realStorageConflictReceived = false;
      let capturedConflictError: unknown = null;

      // Coordinate test barrier outside public application flow:
      // The request initially queries storage.list() where the file is absent.
      // Immediately before upload() executes, the barrier uploads the exact file to Storage.
      // The main upload() then encounters a genuine 409/already-exists error,
      // triggering the reconciliation branch (download + byte equality check).
      const coordinatedAdapter: CookieAdapter = {
        ...resA.cookieAdapter,
        testHooks: {
          beforeStorageUpload: async (candidate) => {
            beforeUploadTriggered = true;
            const { error: preUpErr } = await resA.client.storage
              .from('incident-evidence')
              .upload(candidate.storagePath, candidate.buffer, {
                contentType: candidate.mimeType,
                upsert: false,
              });
            expect(preUpErr).toBeNull();
            cleanupStoragePaths.push(candidate.storagePath);
          },
          afterStorageUploadConflict: (storagePath, error) => {
            realStorageConflictReceived = true;
            capturedConflictError = error;
          },
        },
      };

      const result = await testSessionStorage.run(coordinatedAdapter, async () => {
        const formData = new FormData();
        formData.append('report_id', repId);
        formData.append('photos', photoFile);
        return await submitResidentReport(null, formData);
      });

      // Assert observable barrier fired
      expect(beforeUploadTriggered).toBe(true);
      // Assert the request encountered an authentic storage collision error
      expect(realStorageConflictReceived).toBe(true);
      expect(capturedConflictError).toBeDefined();

      // Assert the action cleanly succeeded via the byte-level reconciliation branch
      expect(result.success).toBe(true);
      expect(result.reportId).toBe(repId);
      expect(result.attachmentsCount).toBe(1);
      expect(result.uploadErrors).toBeUndefined();

      // Verify exact bytes, exactly 1 Storage object, and exactly 1 attachment row
      const contentHash = crypto.createHash('sha256').update(photoBuf).digest('hex').slice(0, 16);
      const { data: dlBlob, error: dlErr } = await resA.client.storage
        .from('incident-evidence')
        .download(`${resA.id}/${repId}/collision_photo_${contentHash}.png`);
      expect(dlErr).toBeNull();
      const dlBuf = Buffer.from(await dlBlob!.arrayBuffer());
      expect(dlBuf.equals(photoBuf)).toBe(true);

      const dbRows = await runPsql(`
        SELECT count(*) FROM public.report_attachments WHERE report_id = '${repId}';
      `);
      expect(parseInt(dbRows, 10)).toBe(1);
    });

    it('deterministically coordinates competing metadata insert and verifies 23505 reconciliation', async () => {
      // 1. Create a base report with 0 photos
      const repRes = await testSessionStorage.run(resA.cookieAdapter, async () => {
        const formData = new FormData();
        formData.append('building_id', sentosaBldgA);
        formData.append('category', 'lift');
        formData.append('urgency', 'medium');
        formData.append('description', 'Ujian persaingan metadata 23505.');
        return await submitResidentReport(null, formData);
      });
      expect(repRes.success).toBe(true);
      const repId = repRes.reportId!;
      cleanupReports.push(repId);

      const photoBuf = generateValidPng(88, 88);
      const photoFile = toFile(photoBuf, 'metadata_race.png');

      let beforeInsertTriggered = false;
      let real23505Received = false;
      let capturedInsertError: unknown = null;

      // Coordinate test barrier:
      // Request A observes no attachment initially and completes upload.
      // Right before Request A inserts into report_attachments, competing worker inserts the exact row.
      // Request A's insert fails with unique violation (23505), triggering reconciliation branch.
      const coordinatedAdapter: CookieAdapter = {
        ...resA.cookieAdapter,
        testHooks: {
          beforeMetadataInsert: async (candidate) => {
            beforeInsertTriggered = true;
            // Competing worker commits the row first
            const { error: compErr } = await resA.client
              .from('report_attachments')
              .insert({
                report_id: candidate.reportId,
                storage_path: candidate.storagePath,
                file_name: candidate.fileName,
                mime_type: candidate.mimeType,
                file_size_bytes: candidate.fileSize,
              });
            expect(compErr).toBeNull();
          },
          afterMetadataConflict: (storagePath, error: unknown) => {
            const errObj = error as { code?: string; message?: string } | null;
            if (
              errObj?.code === '23505' ||
              String(errObj?.message).includes('duplicate key') ||
              String(errObj?.message).includes('unique')
            ) {
              real23505Received = true;
            }
            capturedInsertError = error;
          },
        },
      };

      const result = await testSessionStorage.run(coordinatedAdapter, async () => {
        const formData = new FormData();
        formData.append('report_id', repId);
        formData.append('photos', photoFile);
        return await submitResidentReport(null, formData);
      });

      // Assert observable barrier fired
      expect(beforeInsertTriggered).toBe(true);
      // Assert real 23505 conflict was received
      expect(real23505Received).toBe(true);
      expect(capturedInsertError).toBeDefined();

      // Assert reconciliation branch executed and returned success
      expect(result.success).toBe(true);
      expect(result.reportId).toBe(repId);
      expect(result.attachmentsCount).toBe(1);

      // Verify database reflects exactly 1 row (zero duplicate rows)
      const count = await runPsql(`
        SELECT count(*) FROM public.report_attachments WHERE report_id = '${repId}';
      `);
      expect(parseInt(count, 10)).toBe(1);

      const paths = await runPsql(`
        SELECT storage_path FROM public.report_attachments WHERE report_id = '${repId}';
      `);
      if (paths.trim()) cleanupStoragePaths.push(paths.trim());
    });

    it('accurately simulates action recovery from dropped response using stable client_report_id without duplicates (integration simulation)', async () => {
      const stableClientReportId = crypto.randomUUID();
      const photoBuf = generateValidPng(102, 102);
      const photoFile = toFile(photoBuf, 'lost_response_stable.png');

      // Request 1: Client submits report with stable client_report_id and photo.
      // Server commits report and attachment, but test harness simulates dropped response.
      let firstReportId: string | undefined;
      try {
        await testSessionStorage.run(resA.cookieAdapter, async () => {
          const formData = new FormData();
          formData.append('client_report_id', stableClientReportId);
          formData.append('building_id', sentosaBldgA);
          formData.append('category', 'water_supply');
          formData.append('urgency', 'low');
          formData.append('description', 'Ujian pemulihan respons hilang dengan client_report_id stabil.');
          formData.append('photos', photoFile);

          const res = await submitResidentReport(null, formData);
          firstReportId = res.reportId;
          // Simulate network disconnection / client timeout after server commit:
          // The response is dropped and client receives an exception.
          throw new Error('NETWORK_TIMEOUT_SIMULATED: Client connection dropped before response received');
        });
      } catch (err: unknown) {
        expect((err as Error).message).toContain('NETWORK_TIMEOUT_SIMULATED');
      }

      expect(firstReportId).toBe(stableClientReportId);
      cleanupReports.push(stableClientReportId);

      // Verify server did commit the initial report and attachment
      const repExists = await runPsql(`
        SELECT count(*) FROM public.incident_reports WHERE id = '${stableClientReportId}';
      `);
      expect(parseInt(repExists, 10)).toBe(1);

      const attExists = await runPsql(`
        SELECT count(*) FROM public.report_attachments WHERE report_id = '${stableClientReportId}';
      `);
      expect(parseInt(attExists, 10)).toBe(1);

      // Request 2 (Client Retry): Client retries using the exact same stable client_report_id and same photo
      const retryResult = await testSessionStorage.run(resA.cookieAdapter, async () => {
        const formData = new FormData();
        formData.append('client_report_id', stableClientReportId);
        formData.append('building_id', sentosaBldgA);
        formData.append('category', 'water_supply');
        formData.append('urgency', 'low');
        formData.append('description', 'Ujian pemulihan respons hilang dengan client_report_id stabil.');
        formData.append('photos', photoFile);
        return await submitResidentReport(null, formData);
      });

      // Must cleanly recover the existing report and attachments without error or duplication
      expect(retryResult.success).toBe(true);
      expect(retryResult.reportId).toBe(stableClientReportId);
      expect(retryResult.attachmentsCount).toBe(1);
      expect(retryResult.canRetry).toBe(false);

      // Confirm no duplicate report or additional attachment was created
      const totalReports = await runPsql(`
        SELECT count(*) FROM public.incident_reports WHERE id = '${stableClientReportId}';
      `);
      expect(parseInt(totalReports, 10)).toBe(1);

      const totalAttachments = await runPsql(`
        SELECT count(*) FROM public.report_attachments WHERE report_id = '${stableClientReportId}';
      `);
      expect(parseInt(totalAttachments, 10)).toBe(1);

      const paths = await runPsql(`
        SELECT storage_path FROM public.report_attachments WHERE report_id = '${stableClientReportId}';
      `);
      if (paths.trim()) cleanupStoragePaths.push(paths.trim());
    });

    it('honestly returns countUnverified and preserves report when database count query fails', async () => {
      const photoBuf = generateValidPng(60, 60);
      const photoFile = toFile(photoBuf, 'count_fail.png');

      const simulatedAdapter: CookieAdapter = {
        ...resA.cookieAdapter,
        testHooks: {
          simulateCountQueryError: true,
        },
      };

      const result = await testSessionStorage.run(simulatedAdapter, async () => {
        const formData = new FormData();
        formData.append('building_id', sentosaBldgA);
        formData.append('category', 'water_supply');
        formData.append('urgency', 'low');
        formData.append('description', 'Ujian kegagalan membaca bilangan autoritatif lampiran.');
        formData.append('photos', photoFile);
        return await submitResidentReport(null, formData);
      });

      // Must not falsely claim verified count
      expect(result.success).toBe(false);
      expect(result.reportSaved).toBe(true);
      expect(result.reportId).toBeDefined();
      expect(result.countUnverified).toBe(true);
      expect(result.attachmentsCount).toBeUndefined();
      expect(result.error).toContain('Simulated database count verification failure');

      if (result.reportId) {
        cleanupReports.push(result.reportId);
        const paths = await runPsql(`
          SELECT storage_path FROM public.report_attachments WHERE report_id = '${result.reportId}';
        `);
        if (paths.trim()) cleanupStoragePaths.push(paths.trim());
      }
    });
  });

  // ---------------------------------------------------------------------------
  // FIX 6: Honest Management Mutations & Zero-Row Affected Detection
  // ---------------------------------------------------------------------------
  describe('Fix 6 — Honest Management Action Results & Incident Lifecycle', () => {
    let mainReportId: string;
    let mainIncidentId: string;

    it('returns honest error when reviewing a non-existent report (never false success: true)', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      const result = await testSessionStorage.run(mgrA.cookieAdapter, async () => {
        return await reviewReportAction(nonExistentId);
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Laporan tidak dijumpai atau anda tidak mempunyai kebenaran akses');
    });

    it('denies a resident from invoking management actions (role security boundary)', async () => {
      const result = await testSessionStorage.run(resA.cookieAdapter, async () => {
        return await reviewReportAction('00000000-0000-0000-0000-000000000000');
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('FORBIDDEN_ROLE');
    });

    it('executes legitimate management review on a submitted report', async () => {
      // 1. Resident A submits report
      const repRes = await testSessionStorage.run(resA.cookieAdapter, async () => {
        const formData = new FormData();
        formData.append('building_id', sentosaBldgA);
        formData.append('category', 'water_supply');
        formData.append('urgency', 'high');
        formData.append('description', 'Paip utama pecah di aras 4 Blok A.');
        return await submitResidentReport(null, formData);
      });

      expect(repRes.success).toBe(true);
      mainReportId = repRes.reportId!;
      cleanupReports.push(mainReportId);

      // 2. Cross-estate Manager B cannot review Estate A report
      const crossRes = await testSessionStorage.run(mgrB.cookieAdapter, async () => {
        return await reviewReportAction(mainReportId);
      });
      expect(crossRes.success).toBe(false);
      expect(crossRes.error).toContain('Laporan tidak dijumpai atau anda tidak mempunyai kebenaran akses');

      // 3. Assigned Manager A reviews report
      const reviewRes = await testSessionStorage.run(mgrA.cookieAdapter, async () => {
        return await reviewReportAction(mainReportId);
      });
      expect(reviewRes.success).toBe(true);

      const status = await runPsql(`SELECT status FROM public.incident_reports WHERE id = '${mainReportId}';`);
      expect(status).toBe('reviewed');

      // 4. Repeated review returns honest already-completed message
      const dupReview = await testSessionStorage.run(mgrA.cookieAdapter, async () => {
        return await reviewReportAction(mainReportId);
      });
      expect(dupReview.success).toBe(false);
      expect(dupReview.error).toContain('telah pun disemak sebelum ini');
    });

    it('creates incident, confirms it, links reviewed report, and publishes official notice', async () => {
      // 1. Create incident in investigating state
      const incFormData = new FormData();
      incFormData.append('building_id', sentosaBldgA);
      incFormData.append('category', 'water_supply');
      incFormData.append('severity', 'major');
      incFormData.append('title', 'Kebocoran Paip Utama Aras 4 Blok A');
      incFormData.append('internal_notes', 'Pemberitahuan teknikal sulit pengurusan.');

      const createRes = await testSessionStorage.run(mgrA.cookieAdapter, async () => {
        return await createIncidentAction(null, incFormData);
      });

      expect(createRes.success).toBe(true);
      const incData = createRes.data as { id: string };
      expect(incData?.id).toBeDefined();
      mainIncidentId = incData.id;
      cleanupIncidents.push(mainIncidentId);

      // 2. Confirm incident
      const confirmRes = await testSessionStorage.run(mgrA.cookieAdapter, async () => {
        return await confirmIncidentAction(mainIncidentId);
      });
      expect(confirmRes.success).toBe(true);

      const incStatus = await runPsql(`
        SELECT status, verified_by FROM public.incidents WHERE id = '${mainIncidentId}';
      `);
      expect(incStatus).toContain('confirmed');
      expect(incStatus).toContain(mgrA.id); // verified_by stamped to Manager A

      // Duplicate confirmation returns honest error
      const dupConfirm = await testSessionStorage.run(mgrA.cookieAdapter, async () => {
        return await confirmIncidentAction(mainIncidentId);
      });
      expect(dupConfirm.success).toBe(false);
      expect(dupConfirm.error).toContain('telah pun disahkan');

      // 3. Link report to incident
      const linkRes = await testSessionStorage.run(mgrA.cookieAdapter, async () => {
        return await linkReportToIncidentAction(mainIncidentId, mainReportId);
      });
      expect(linkRes.success).toBe(true);

      const repStatus = await runPsql(`SELECT status FROM public.incident_reports WHERE id = '${mainReportId}';`);
      expect(repStatus).toBe('linked');

      // 4. Publish official bulletin notice
      const pubFormData = new FormData();
      pubFormData.append('incident_id', mainIncidentId);
      pubFormData.append('update_title', 'Notis Gangguan Air Blok A');
      pubFormData.append('message_bm', 'Kerja pembaikan paip utama aras 4 sedang dijalankan oleh kontraktor.');
      pubFormData.append('stage', 'contractor_assigned');

      const pubRes = await testSessionStorage.run(mgrA.cookieAdapter, async () => {
        return await publishNoticeAction(null, pubFormData);
      });
      expect(pubRes.success).toBe(true);
    });

    it('renders sanitized official bulletin on resident dashboard and dynamically reflects status change', async () => {
      // 1. Resident fetches dashboard
      const res = await fetch(`${APP_URL}/resident`, {
        headers: { Cookie: resA.getCookieHeader() },
        redirect: 'manual',
      });
      expect(res.status).toBe(200);
      const html = await res.text();

      expect(html).toContain('Notis Gangguan Air Blok A');
      expect(html).toContain('Kerja pembaikan paip utama aras 4 sedang dijalankan');
      expect(html).toContain('Status:');
      expect(html).toContain('confirmed');

      // Must NEVER leak confidential management notes or IDs
      expect(html).not.toContain('Pemberitahuan teknikal sulit pengurusan.');
      expect(html).not.toContain(mgrA.id);
      expect(html).not.toContain(resA.id);

      // 2. Manager advances incident status to 'in_maintenance'
      const advRes = await testSessionStorage.run(mgrA.cookieAdapter, async () => {
        return await advanceIncidentStatusAction(
          mainIncidentId,
          'in_maintenance',
          'Kontraktor telah tiba di tapak.'
        );
      });
      expect(advRes.success).toBe(true);

      // 3. Resident refreshes dashboard -> reflects new status
      const refRes = await fetch(`${APP_URL}/resident`, {
        headers: { Cookie: resA.getCookieHeader() },
        redirect: 'manual',
      });
      expect(refRes.status).toBe(200);
      const refHtml = await refRes.text();
      expect(refHtml).toContain('Status:');
      expect(refHtml).toContain('in_maintenance');
    });
  });

  // ---------------------------------------------------------------------------
  // AUDIT TRAIL: Complete Workflow Audit Records in PostgreSQL
  // ---------------------------------------------------------------------------
  describe('Audit Trail Verification', () => {
    it('verifies database audit events exist for the completed application workflow', async () => {
      const events = await runPsql(`
        SELECT action FROM public.audit_events 
        WHERE actor_id IN ('${resA.id}', '${mgrA.id}')
        ORDER BY created_at ASC;
      `);

      expect(events).toContain('incident_reports.insert');
      expect(events).toContain('incident_reports.update');
      expect(events).toContain('incidents.insert');
      expect(events).toContain('incident.verified');
      expect(events).toContain('incident_report_links.insert');
      expect(events).toContain('notice.published');
      expect(events).toContain('incidents.update');
    });
  });

  afterAll(async () => {
    const teardownErrors: string[] = [];

    try {
      // 1. Discover all run-owned storage objects for synthetic users
      if (cleanupUsers.length > 0) {
        try {
          const userListSql = cleanupUsers.map((u) => `'${u}'`).join(', ');
          const userStorageObjects = await runPsql(`
            SELECT name FROM storage.objects 
            WHERE bucket_id = 'incident-evidence' AND split_part(name, '/', 1) IN (${userListSql});
          `);

          const discoveredPaths = userStorageObjects
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean);

          const allPathsToDelete = Array.from(new Set([...cleanupStoragePaths, ...discoveredPaths]));

          if (allPathsToDelete.length > 0) {
            const delRes = await fetch(`${API_URL}/storage/v1/object/incident-evidence`, {
              method: 'DELETE',
              headers: {
                apikey: SERVICE_KEY,
                Authorization: `Bearer ${SERVICE_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ prefixes: allPathsToDelete }),
            });
            if (!delRes.ok) {
              teardownErrors.push(`Storage cleanup returned non-OK status: ${delRes.status}`);
            }
          }
        } catch (err: unknown) {
          teardownErrors.push(`Failed to clean up storage paths: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // 2. Delete domain records in dependency order
      for (const incId of cleanupIncidents) {
        try {
          await runPsql(`
            DELETE FROM public.published_incident_bulletins WHERE incident_id = '${incId}';
            DELETE FROM public.incident_updates WHERE incident_id = '${incId}';
            DELETE FROM public.incident_report_links WHERE incident_id = '${incId}';
            DELETE FROM public.incidents WHERE id = '${incId}';
          `);
        } catch (err: unknown) {
          teardownErrors.push(`Failed to clean up incident ${incId}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      for (const repId of cleanupReports) {
        try {
          await runPsql(`
            DELETE FROM public.report_attachments WHERE report_id = '${repId}';
            DELETE FROM public.incident_report_links WHERE report_id = '${repId}';
            DELETE FROM public.incident_reports WHERE id = '${repId}';
          `);
        } catch (err: unknown) {
          teardownErrors.push(`Failed to clean up report ${repId}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      for (const bldgId of cleanupBuildings) {
        try {
          await runPsql(`DELETE FROM public.buildings WHERE id = '${bldgId}';`);
        } catch (err: unknown) {
          teardownErrors.push(`Failed to clean up building ${bldgId}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // 3. Delete profiles and auth users
      if (cleanupUsers.length > 0) {
        const userListStr = cleanupUsers.map((u) => `'${u}'`).join(', ');
        try {
          await runPsql(`
            DELETE FROM public.audit_events WHERE actor_id IN (${userListStr});
            DELETE FROM public.profiles WHERE id IN (${userListStr});
          `);
        } catch (err: unknown) {
          teardownErrors.push(`Failed to clean up profiles/audit_events: ${err instanceof Error ? err.message : String(err)}`);
        }

        for (const userId of cleanupUsers) {
          try {
            const authDelRes = await fetch(`${API_URL}/auth/v1/admin/users/${userId}`, {
              method: 'DELETE',
              headers: {
                apikey: SERVICE_KEY,
                Authorization: `Bearer ${SERVICE_KEY}`,
              },
            });
            if (!authDelRes.ok) {
              teardownErrors.push(`Auth user delete returned status ${authDelRes.status} for ${userId}`);
            }
          } catch (err: unknown) {
            teardownErrors.push(`Failed to delete auth user ${userId}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        // Verify no run-owned users remain
        try {
          const remUsers = await runPsql(`SELECT count(*) FROM auth.users WHERE id IN (${userListStr});`);
          if (parseInt(remUsers, 10) !== 0) {
            teardownErrors.push(`Residual synthetic users remain in auth.users: ${remUsers}`);
          }
        } catch (err: unknown) {
          teardownErrors.push(`Failed verifying user cleanup: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // 4. Explicit preservation check for permanent demo accounts
      try {
        const demoUsersCount = await runPsql(`
          SELECT count(*) FROM auth.users WHERE email IN ('resident@sentosa.local', 'manager@sentosa.local');
        `);
        if (parseInt(demoUsersCount, 10) !== 2) {
          teardownErrors.push(`Preservation check failed: Expected 2 demo accounts in auth.users, found ${demoUsersCount}`);
        }
        const demoProfiles = await runPsql(`
          SELECT u.email, p.role, p.assigned_estate_id 
          FROM public.profiles p
          JOIN auth.users u ON u.id = p.id
          WHERE u.email IN ('resident@sentosa.local', 'manager@sentosa.local');
        `);
        if (!demoProfiles.includes('resident') || !demoProfiles.includes('management')) {
          teardownErrors.push(`Preservation check failed: Demo profile roles corrupted: ${demoProfiles}`);
        }
      } catch (err: unknown) {
        teardownErrors.push(`Failed demo accounts preservation check: ${err instanceof Error ? err.message : String(err)}`);
      }

      // 5. Verify no run-owned storage objects remain and baseline is restored
      try {
        const finalObjCountStr = await runPsql("SELECT count(*) FROM storage.objects WHERE bucket_id = 'incident-evidence';");
        const finalObjCount = parseInt(finalObjCountStr, 10) || 0;
        if (finalObjCount !== baselineObjects) {
          teardownErrors.push(`Cleanup failure: Expected ${baselineObjects} storage objects, found ${finalObjCount}`);
        }
      } catch (err: unknown) {
        teardownErrors.push(`Failed verifying storage baseline: ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      // 6. Terminate spawned Next.js process in finally
      if (nextProc) {
        try {
          if (process.platform === 'win32') {
            cpSpawn('taskkill', ['/pid', String(nextProc.pid), '/f', '/t']);
          } else {
            nextProc.kill('SIGTERM');
          }
        } catch {
          // process already terminated
        }
      }
    }

    if (teardownErrors.length > 0) {
      throw new Error(`Teardown errors occurred:\n${teardownErrors.join('\n')}`);
    }
  });
});

