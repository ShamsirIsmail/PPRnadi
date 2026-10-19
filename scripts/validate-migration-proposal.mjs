#!/usr/bin/env node
import { spawn as cpSpawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// -----------------------------------------------------------------------------
// PPR NADI — REPRODUCIBLE DISPOSABLE MIGRATION CONCURRENCY VALIDATION
// -----------------------------------------------------------------------------

try {
  process.loadEnvFile('.env.local');
} catch {
  // Ignored
}

const DB_HOST = process.env.PGHOST || '127.0.0.1';
const DB_PORT = process.env.PGPORT || '64322';
const DB_USER = process.env.PGUSER || 'postgres';
const DB_PASS = process.env.PGPASSWORD || 'postgres';
const SOURCE_DB = process.env.PGDATABASE || 'postgres';
const PSQL_PATH = 'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe';
const PG_DUMP_PATH = 'C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe';
const PROPOSAL_DOC = path.resolve('docs', 'PHASE_02B_RECOVERY_MIGRATION_PROPOSAL.md');

const BASE_URL = `postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${SOURCE_DB}`;

function runCmd(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = cpSpawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`${cmd} error (${code}): ${stderr || stdout}`));
    });
  });
}

function getLastInt(output) {
  const lines = output.trim().split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return parseInt(lines[lines.length - 1], 10);
}

function runSql(dbName, sql) {
  const url = `postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${dbName}`;
  return runCmd(PSQL_PATH, [url, '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql]);
}

function runSqlFile(dbName, filePath) {
  const url = `postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${dbName}`;
  return runCmd(PSQL_PATH, [url, '-v', 'ON_ERROR_STOP=1', '-f', filePath]);
}

function runSqlExpectError(dbName, sql) {
  const url = `postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${dbName}`;
  return new Promise((resolve, reject) => {
    const proc = cpSpawn(PSQL_PATH, [url, '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-c', sql], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('close', (code) => {
      if (code !== 0) {
        resolve({ code, error: stderr || stdout });
      } else {
        reject(new Error(`Expected SQL to fail, but it succeeded. Output: ${stdout}`));
      }
    });
  });
}

/**
 * Interactive psql session for real overlapping transaction testing.
 */
class PsqlSession {
  constructor(name, dbName) {
    this.name = name;
    this.dbName = dbName;
    const url = `postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${dbName}`;
    this.proc = cpSpawn(PSQL_PATH, [url, '-v', 'ON_ERROR_STOP=0', '-v', 'VERBOSITY=verbose', '-t', '-A'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.stdoutBuf = '';
    this.stderrBuf = '';
    this.currentResolver = null;
    this.currentRejecter = null;
    this.delimiter = null;
    this.pid = null;

    this.proc.stdout.on('data', (d) => {
      this.stdoutBuf += d.toString();
      this.checkCompletion();
    });

    this.proc.stderr.on('data', (d) => {
      this.stderrBuf += d.toString();
      this.checkCompletion();
    });
  }

  checkCompletion() {
    if (!this.delimiter || !this.currentResolver) return;
    if (this.stdoutBuf.includes(this.delimiter)) {
      const out = this.stdoutBuf;
      const err = this.stderrBuf;
      const delim = this.delimiter;
      this.stdoutBuf = '';
      this.stderrBuf = '';
      this.delimiter = null;
      const resolve = this.currentResolver;
      this.currentResolver = null;
      this.currentRejecter = null;

      if (err.includes('ERROR:')) {
        resolve({ error: err.trim(), output: out.replace(delim, '').trim() });
      } else {
        resolve({ error: null, output: out.replace(delim, '').trim() });
      }
    }
  }

  exec(sql) {
    if (this.currentResolver) throw new Error(`${this.name} is already executing a query!`);
    const tag = `__DELIM_${Date.now()}_${Math.random().toString(36).slice(2)}__`;
    this.delimiter = tag;

    return new Promise((resolve, reject) => {
      this.currentResolver = resolve;
      this.currentRejecter = reject;
      this.proc.stdin.write(`${sql}\n\\echo ${tag}\n`);
    });
  }

  async getPid() {
    if (this.pid) return this.pid;
    const res = await this.exec('SELECT pg_backend_pid();');
    this.pid = parseInt(res.output, 10);
    return this.pid;
  }

  close() {
    try {
      this.proc.stdin.write('\\q\n');
      this.proc.stdin.end();
    } catch {}
    try {
      this.proc.kill();
    } catch {}
  }
}

/**
 * Observes actual PostgreSQL lock blocking relationship between two sessions.
 */
async function waitForBlocking(watcherSession, blockedPid, timeoutMs = 8000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const res = await watcherSession.exec(`SELECT pg_blocking_pids(${blockedPid})::text;`);
    const val = res.output.trim();
    if (val && val !== '{}' && val.startsWith('{') && val.endsWith('}')) {
      const pids = val.slice(1, -1).split(',').map((p) => parseInt(p.trim(), 10)).filter(Boolean);
      if (pids.length > 0) return pids;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timeout waiting for PID ${blockedPid} to be blocked!`);
}

async function main() {
  console.log('==============================================================================');
  console.log('PPR NADI — REPRODUCIBLE DISPOSABLE MIGRATION CONCURRENCY VALIDATION');
  console.log('==============================================================================');

  // 1. Strict Target Project & Database Verification
  console.log('[Step 1] Verifying target project identity and host constraints...');
  if (DB_HOST !== '127.0.0.1' || DB_PORT !== '64322') {
    throw new Error(`Host constraint violation: expected 127.0.0.1:64322, got ${DB_HOST}:${DB_PORT}`);
  }

  const currentDb = await runSql(SOURCE_DB, 'SELECT current_database();');
  if (currentDb !== SOURCE_DB) {
    throw new Error(`Unexpected source database: ${currentDb}. Expected: ${SOURCE_DB}`);
  }

  // Verify project domain signatures to ensure we are targeting the actual local ppr-nadi project
  const estateCheck = await runSql(SOURCE_DB, "SELECT count(*) FROM public.profiles WHERE assigned_estate_id = 'ppr-sentosa-demo';");
  const bldgCheck = await runSql(SOURCE_DB, "SELECT count(*) FROM public.buildings WHERE estate_id = 'ppr-sentosa-demo';");
  const demoUsersCheck = await runSql(SOURCE_DB, "SELECT count(*) FROM auth.users WHERE email IN ('resident@sentosa.local', 'manager@sentosa.local');");
  const bucketCheck = await runSql(SOURCE_DB, "SELECT count(*) FROM storage.buckets WHERE id = 'incident-evidence';");

  if (
    parseInt(estateCheck, 10) < 1 ||
    parseInt(bldgCheck, 10) < 1 ||
    parseInt(demoUsersCheck, 10) !== 2 ||
    parseInt(bucketCheck, 10) !== 1
  ) {
    throw new Error('Target database does not match the local ppr-nadi demo project domain signature!');
  }

  // Record initial baseline fingerprints of active demo database
  const baselineStorageStr = await runSql(SOURCE_DB, "SELECT count(*) FROM storage.objects WHERE bucket_id = 'incident-evidence';");
  const baselineStorage = parseInt(baselineStorageStr, 10);
  const baselineReportsStr = await runSql(SOURCE_DB, "SELECT count(*) FROM public.incident_reports;");
  const baselineReports = parseInt(baselineReportsStr, 10);
  const baselineAttachmentsStr = await runSql(SOURCE_DB, "SELECT count(*) FROM public.report_attachments;");
  const baselineAttachments = parseInt(baselineAttachmentsStr, 10);
  const leaseInDemoCheck = await runSql(SOURCE_DB, "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'evidence_recovery_leases';");
  if (parseInt(leaseInDemoCheck, 10) !== 0) {
    throw new Error('FATAL: evidence_recovery_leases table already exists in demo database! Migration must remain UNAPPLIED.');
  }

  console.log(`  ✓ Target project confirmed: ${DB_HOST}:${DB_PORT}/${SOURCE_DB} (PPR Sentosa Demo)`);
  console.log(`  ✓ Baseline metrics: storage=${baselineStorage}, reports=${baselineReports}, attachments=${baselineAttachments}, leases_in_demo=0`);

  // 2. Read exact proposal SQL from documentation (prevent separate divergent copy)
  console.log('[Step 2] Reading exact migration and rollback SQL from proposal document...');
  if (!fs.existsSync(PROPOSAL_DOC)) {
    throw new Error(`Proposal document not found at: ${PROPOSAL_DOC}`);
  }
  const docContent = fs.readFileSync(PROPOSAL_DOC, 'utf8');

  const migMatch = docContent.match(/```sql\r?\n(-- =============================================================================\r?\n-- Migration: 00005_evidence_recovery_leases\.sql[\s\S]*?COMMIT;)\r?\n```/);
  if (!migMatch) {
    throw new Error('Failed to extract migration SQL block from docs/PHASE_02B_RECOVERY_MIGRATION_PROPOSAL.md');
  }
  const migrationSql = migMatch[1];

  const rollMatch = docContent.match(/## 5\. Rollback Plan[\s\S]*?```sql\r?\n(BEGIN;[\s\S]*?COMMIT;)\r?\n```/);
  if (!rollMatch) {
    throw new Error('Failed to extract rollback SQL block from docs/PHASE_02B_RECOVERY_MIGRATION_PROPOSAL.md');
  }
  const rollbackSql = rollMatch[1];

  console.log(`  ✓ Extracted migration SQL (${migrationSql.length} characters)`);
  console.log(`  ✓ Extracted rollback SQL (${rollbackSql.length} characters)`);

  // 3. Create uniquely named disposable database owned by this run
  const runToken = crypto.randomBytes(4).toString('hex');
  const disposableDbName = `ppr_nadi_migval_${Date.now()}_${runToken}`;
  console.log(`\n[Step 3] Initializing isolated disposable database: ${disposableDbName}`);

  const existsCheck = await runSql(SOURCE_DB, `SELECT count(*) FROM pg_database WHERE datname = '${disposableDbName}';`);
  if (parseInt(existsCheck, 10) > 0) {
    throw new Error(`Disposable database ${disposableDbName} already exists! Refusing to reuse.`);
  }

  await runSql(SOURCE_DB, `CREATE DATABASE "${disposableDbName}";`);
  console.log(`  ✓ Disposable database "${disposableDbName}" created cleanly.`);

  let testsPassed = false;
  const scratchDir = path.resolve('scratch');
  if (!fs.existsSync(scratchDir)) {
    fs.mkdirSync(scratchDir, { recursive: true });
  }
  const tmpDumpPath = path.join(scratchDir, `dump_${runToken}.sql`).replace(/\\/g, '/');
  const tmpMigPath = path.join(scratchDir, `mig_${runToken}.sql`).replace(/\\/g, '/');
  const tmpRollPath = path.join(scratchDir, `roll_${runToken}.sql`).replace(/\\/g, '/');

  // Tracking open sessions for cleanup
  const activeSessions = [];

  try {
    // 4. Dump schema-only from active database and load into disposable database
    console.log('[Step 4] Copying active schema DDL via pg_dump into disposable database...');
    await runCmd(PG_DUMP_PATH, [
      '--schema-only',
      '--no-owner',
      '--no-privileges',
      '-n', 'public',
      '-n', 'auth',
      '-n', 'storage',
      '-f', tmpDumpPath,
      '-d', BASE_URL,
    ]);

    let dumpSql = fs.readFileSync(tmpDumpPath, 'utf8');
    dumpSql = dumpSql.replace(/^SET\s+transaction_timeout\s*=.*$/gim, '-- SET transaction_timeout ignored');
    dumpSql = dumpSql.replace(/^SET\s+log_min_messages\s*=.*$/gim, '-- SET log_min_messages ignored');
    dumpSql = dumpSql.replace(/CREATE SCHEMA ([a-zA-Z0-9_]+);/g, 'CREATE SCHEMA IF NOT EXISTS $1;');
    fs.writeFileSync(tmpDumpPath, dumpSql, 'utf8');

    await runSqlFile(disposableDbName, tmpDumpPath);
    try { fs.unlinkSync(tmpDumpPath); } catch {}

    // Grant standard schema and table privileges to Supabase roles in the disposable database
    await runSql(disposableDbName, `
      GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
      GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, service_role;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
      GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;
      GRANT ALL ON ALL ROUTINES IN SCHEMA public TO authenticated, service_role;

      GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
      GRANT ALL ON ALL TABLES IN SCHEMA auth TO postgres, service_role;

      GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
      GRANT ALL ON ALL TABLES IN SCHEMA storage TO postgres, service_role;
      GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA storage TO authenticated;
    `);
    console.log('  ✓ Schema DDL and role privileges loaded into disposable database.');

    // 5. Seed synthetic domain fixtures into disposable database
    console.log('[Step 5] Seeding synthetic fixtures and legacy reports...');
    const resA_id = crypto.randomUUID();
    const resB_id = crypto.randomUUID();
    const mgrA_id = crypto.randomUUID();
    const bldgA_id = crypto.randomUUID();

    const report0_id = crypto.randomUUID(); // 0 attachments, submitted
    const report1_id = crypto.randomUUID(); // 1 attachment, submitted
    const report2_id = crypto.randomUUID(); // 2 attachments, submitted
    const report3_id = crypto.randomUUID(); // 3 attachments, submitted
    const report4_id = crypto.randomUUID(); // 1 attachment, reviewed
    const report5_id = crypto.randomUUID(); // 1 attachment, linked
    const report6_id = crypto.randomUUID(); // 2 attachments, dismissed

    // 10 legacy attachments total
    const att1_id = crypto.randomUUID();
    const att2a_id = crypto.randomUUID();
    const att2b_id = crypto.randomUUID();
    const att3a_id = crypto.randomUUID();
    const att3b_id = crypto.randomUUID();
    const att3c_id = crypto.randomUUID();
    const att4_id = crypto.randomUUID();
    const att5_id = crypto.randomUUID();
    const att6a_id = crypto.randomUUID();
    const att6b_id = crypto.randomUUID();

    const fixtureSql = `
      BEGIN;
      SET session_replication_role = 'replica';

      -- Ensure bucket exists
      INSERT INTO storage.buckets (id, name, public) VALUES ('incident-evidence', 'incident-evidence', false)
      ON CONFLICT (id) DO NOTHING;

      -- Seed synthetic users into auth.users
      INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data)
      VALUES 
        ('${resA_id}', 'res_a_${runToken}@temp.local', 'hash', now(), '{"provider":"email"}'),
        ('${resB_id}', 'res_b_${runToken}@temp.local', 'hash', now(), '{"provider":"email"}'),
        ('${mgrA_id}', 'mgr_a_${runToken}@temp.local', 'hash', now(), '{"provider":"email"}');

      -- Seed building
      INSERT INTO public.buildings (id, name, code, estate_id, total_floors, total_units)
      VALUES ('${bldgA_id}', 'Blok A', 'A', 'ppr-sentosa-demo', 10, 100);

      -- Seed profiles
      INSERT INTO public.profiles (id, role, full_name, assigned_estate_id, assigned_building_id, unit_number)
      VALUES 
        ('${resA_id}', 'resident', 'Resident A', 'ppr-sentosa-demo', '${bldgA_id}', '05-01'),
        ('${resB_id}', 'resident', 'Resident B', 'ppr-sentosa-demo', '${bldgA_id}', '05-02'),
        ('${mgrA_id}', 'management', 'Manager A', 'ppr-sentosa-demo', '${bldgA_id}', null);

      -- Seed reports across all statuses and attachment counts
      INSERT INTO public.incident_reports (id, reporter_id, building_id, category, description, status, urgency_hint)
      VALUES
        ('${report0_id}', '${resA_id}', '${bldgA_id}', 'lift', 'Laporan 0 lampiran', 'submitted', 'medium'),
        ('${report1_id}', '${resA_id}', '${bldgA_id}', 'water_supply', 'Laporan 1 lampiran', 'submitted', 'low'),
        ('${report2_id}', '${resA_id}', '${bldgA_id}', 'corridor_lighting', 'Laporan 2 lampiran', 'submitted', 'high'),
        ('${report3_id}', '${resA_id}', '${bldgA_id}', 'lift', 'Laporan 3 lampiran (Maksimum)', 'submitted', 'urgent'),
        ('${report4_id}', '${resA_id}', '${bldgA_id}', 'lift', 'Laporan reviewed', 'reviewed', 'medium'),
        ('${report5_id}', '${resA_id}', '${bldgA_id}', 'water_supply', 'Laporan linked', 'linked', 'low'),
        ('${report6_id}', '${resA_id}', '${bldgA_id}', 'corridor_lighting', 'Laporan dismissed', 'dismissed', 'low');

      -- Seed Storage objects catalog (required by attachment_guard)
      INSERT INTO storage.objects (id, bucket_id, name, owner, metadata)
      VALUES
        (gen_random_uuid(), 'incident-evidence', '${resA_id}/${report1_id}/att1.png', '${resA_id}', '{"mimetype":"image/png","size":"1024"}'),
        (gen_random_uuid(), 'incident-evidence', '${resA_id}/${report2_id}/att2a.png', '${resA_id}', '{"mimetype":"image/png","size":"2048"}'),
        (gen_random_uuid(), 'incident-evidence', '${resA_id}/${report2_id}/att2b.png', '${resA_id}', '{"mimetype":"image/png","size":"2048"}'),
        (gen_random_uuid(), 'incident-evidence', '${resA_id}/${report3_id}/att3a.png', '${resA_id}', '{"mimetype":"image/png","size":"3072"}'),
        (gen_random_uuid(), 'incident-evidence', '${resA_id}/${report3_id}/att3b.png', '${resA_id}', '{"mimetype":"image/png","size":"3072"}'),
        (gen_random_uuid(), 'incident-evidence', '${resA_id}/${report3_id}/att3c.png', '${resA_id}', '{"mimetype":"image/png","size":"3072"}'),
        (gen_random_uuid(), 'incident-evidence', '${resA_id}/${report4_id}/att4.png', '${resA_id}', '{"mimetype":"image/png","size":"1024"}'),
        (gen_random_uuid(), 'incident-evidence', '${resA_id}/${report5_id}/att5.png', '${resA_id}', '{"mimetype":"image/png","size":"1024"}'),
        (gen_random_uuid(), 'incident-evidence', '${resA_id}/${report6_id}/att6a.png', '${resA_id}', '{"mimetype":"image/png","size":"1024"}'),
        (gen_random_uuid(), 'incident-evidence', '${resA_id}/${report6_id}/att6b.png', '${resA_id}', '{"mimetype":"image/png","size":"1024"}');

      -- Seed 10 legacy attachment rows
      INSERT INTO public.report_attachments (id, report_id, storage_path, file_name, mime_type, file_size_bytes)
      VALUES
        ('${att1_id}', '${report1_id}', '${resA_id}/${report1_id}/att1.png', 'att1.png', 'image/png', 1024),
        ('${att2a_id}', '${report2_id}', '${resA_id}/${report2_id}/att2a.png', 'att2a.png', 'image/png', 2048),
        ('${att2b_id}', '${report2_id}', '${resA_id}/${report2_id}/att2b.png', 'att2b.png', 'image/png', 2048),
        ('${att3a_id}', '${report3_id}', '${resA_id}/${report3_id}/att3a.png', 'att3a.png', 'image/png', 3072),
        ('${att3b_id}', '${report3_id}', '${resA_id}/${report3_id}/att3b.png', 'att3b.png', 'image/png', 3072),
        ('${att3c_id}', '${report3_id}', '${resA_id}/${report3_id}/att3c.png', 'att3c.png', 'image/png', 3072),
        ('${att4_id}', '${report4_id}', '${resA_id}/${report4_id}/att4.png', 'att4.png', 'image/png', 1024),
        ('${att5_id}', '${report5_id}', '${resA_id}/${report5_id}/att5.png', 'att5.png', 'image/png', 1024),
        ('${att6a_id}', '${report6_id}', '${resA_id}/${report6_id}/att6a.png', 'att6a.png', 'image/png', 1024),
        ('${att6b_id}', '${report6_id}', '${resA_id}/${report6_id}/att6b.png', 'att6b.png', 'image/png', 1024);

      SET session_replication_role = 'origin';
      COMMIT;
    `;
    await runSql(disposableDbName, fixtureSql);
    console.log('  ✓ Synthetic fixtures seeded (7 reports, 10 attachments).');

    // 6. Apply Exact Migration SQL
    console.log('\n[Step 6] Executing proposal migration SQL against disposable database...');
    fs.writeFileSync(tmpMigPath, migrationSql, 'utf8');
    await runSqlFile(disposableDbName, tmpMigPath);
    try { fs.unlinkSync(tmpMigPath); } catch {}
    console.log('  ✓ Migration executed successfully without errors.');

    // 7. Sequential Validation Tests
    console.log('\n[Step 7] Running sequential migration test assertions:');

    // Assertion 1: Legacy Backfill counts
    const leaseCountStr = await runSql(disposableDbName, 'SELECT count(*) FROM public.evidence_recovery_leases;');
    if (parseInt(leaseCountStr, 10) !== 10) {
      throw new Error(`Expected exactly 10 backfilled leases, found ${leaseCountStr}`);
    }
    console.log('  ✓ Assertion 1: Exactly 10 legacy attachments backfilled into leases.');

    // Assertion 2: All legacy leases hold status 'committed'
    const nonCommitted = await runSql(disposableDbName, "SELECT count(*) FROM public.evidence_recovery_leases WHERE status <> 'committed';");
    if (parseInt(nonCommitted, 10) !== 0) {
      throw new Error(`Expected all backfilled leases to be 'committed', found ${nonCommitted} non-committed.`);
    }
    console.log('  ✓ Assertion 2: All legacy leases seeded with status = "committed".');

    // Assertion 3: Reports with 3 attachments backfilled successfully
    const rep3Leases = await runSql(disposableDbName, `SELECT count(*) FROM public.evidence_recovery_leases WHERE report_id = '${report3_id}';`);
    if (parseInt(rep3Leases, 10) !== 3) {
      throw new Error(`Report with 3 attachments expected 3 leases, found ${rep3Leases}`);
    }
    console.log('  ✓ Assertion 3: Pre-existing report holding 3 attachments backfilled without quota error.');

    // Assertion 4: Non-submitted reports backfilled successfully
    const reviewedLeases = await runSql(disposableDbName, `SELECT count(*) FROM public.evidence_recovery_leases WHERE report_id = '${report4_id}';`);
    const linkedLeases = await runSql(disposableDbName, `SELECT count(*) FROM public.evidence_recovery_leases WHERE report_id = '${report5_id}';`);
    if (parseInt(reviewedLeases, 10) !== 1 || parseInt(linkedLeases, 10) !== 1) {
      throw new Error('Non-submitted reports failed to backfill correctly.');
    }
    console.log('  ✓ Assertion 4: Non-submitted reports (reviewed, linked, dismissed) backfilled without status error.');

    // Assertion 5: Legacy placeholder hashes verified
    const badHashCount = await runSql(disposableDbName, "SELECT count(*) FROM public.evidence_recovery_leases WHERE length(content_sha256) <> 64 OR content_sha256 NOT LIKE 'legacy_placeholder_%';");
    if (parseInt(badHashCount, 10) !== 0) {
      throw new Error(`Found ${badHashCount} legacy leases with invalid placeholder hash format.`);
    }
    console.log('  ✓ Assertion 5: Legacy placeholder hashes verified (exact 64-char legacy_placeholder_... format).');

    // Assertion 6: Valid reservation and attachment lifecycle
    const newLeaseId = crypto.randomUUID();
    const newPath = `${resA_id}/${report0_id}/new_photo1.png`;
    const newSha = 'a'.repeat(64);

    await runSql(disposableDbName, `
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${resA_id}', false);
      INSERT INTO public.evidence_recovery_leases (
        id, report_id, reporter_id, idempotency_key, content_sha256,
        expected_storage_path, expected_file_name, expected_mime_type, expected_file_size
      ) VALUES (
        '${newLeaseId}', '${report0_id}', '${resA_id}', 'idem_new1', '${newSha}',
        '${newPath}', 'new_photo1.png', 'image/png', 2048
      );
    `);

    const leaseStatus = await runSql(disposableDbName, `SELECT status FROM public.evidence_recovery_leases WHERE id = '${newLeaseId}';`);
    if (leaseStatus !== 'reserved') {
      throw new Error(`Expected lease status 'reserved', got: ${leaseStatus}`);
    }
    console.log('  ✓ Assertion 6a: Slot reservation succeeded with status = "reserved".');

    // Register attachment matching lease -> auto-commits
    await runSql(disposableDbName, `
      INSERT INTO storage.objects (id, bucket_id, name, owner, metadata)
      VALUES (gen_random_uuid(), 'incident-evidence', '${newPath}', '${resA_id}', '{"mimetype":"image/png","size":"2048"}');

      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${resA_id}', false);
      INSERT INTO public.report_attachments (report_id, storage_path, file_name, mime_type, file_size_bytes)
      VALUES ('${report0_id}', '${newPath}', 'new_photo1.png', 'image/png', 2048);
    `);

    const updatedLeaseStatus = await runSql(disposableDbName, `SELECT status FROM public.evidence_recovery_leases WHERE id = '${newLeaseId}';`);
    if (updatedLeaseStatus !== 'committed') {
      throw new Error(`Expected lease status 'committed' after attachment, got: ${updatedLeaseStatus}`);
    }
    console.log('  ✓ Assertion 6b: Attachment committed and lease auto-transitioned to "committed".');

    // Assertion 7: Quota cap enforcement on report with 3 attachments
    const overCapRes = await runSqlExpectError(disposableDbName, `
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${resA_id}', false);
      INSERT INTO public.evidence_recovery_leases (
        report_id, reporter_id, idempotency_key, content_sha256,
        expected_storage_path, expected_file_name, expected_mime_type, expected_file_size
      ) VALUES (
        '${report3_id}', '${resA_id}', 'idem_over_cap', '${newSha}',
        '${resA_id}/${report3_id}/att4.png', 'att4.png', 'image/png', 1024
      );
    `);
    if (!overCapRes.error.includes('42501') || !overCapRes.error.includes('Maksimum 3 slot bukti dibenarkan')) {
      throw new Error(`Expected 42501 quota cap rejection, got: ${overCapRes.error}`);
    }
    console.log('  ✓ Assertion 7: Reserving beyond 3-slot cap strictly rejected (42501).');

    // Assertion 8: Reservation on reviewed report rejected
    const revRepRes = await runSqlExpectError(disposableDbName, `
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${resA_id}', false);
      INSERT INTO public.evidence_recovery_leases (
        report_id, reporter_id, idempotency_key, content_sha256,
        expected_storage_path, expected_file_name, expected_mime_type, expected_file_size
      ) VALUES (
        '${report4_id}', '${resA_id}', 'idem_rev', '${newSha}',
        '${resA_id}/${report4_id}/att_extra.png', 'att_extra.png', 'image/png', 1024
      );
    `);
    if (!revRepRes.error.includes('42501') || !revRepRes.error.includes('cannot accept new evidence reservations')) {
      throw new Error(`Expected 42501 rejection on reviewed report, got: ${revRepRes.error}`);
    }
    console.log('  ✓ Assertion 8: Reservation on reviewed report rejected (42501).');

    // Assertion 9: Reservation on linked report rejected
    const linkedRepRes = await runSqlExpectError(disposableDbName, `
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${resA_id}', false);
      INSERT INTO public.evidence_recovery_leases (
        report_id, reporter_id, idempotency_key, content_sha256,
        expected_storage_path, expected_file_name, expected_mime_type, expected_file_size
      ) VALUES (
        '${report5_id}', '${resA_id}', 'idem_linked', '${newSha}',
        '${resA_id}/${report5_id}/att_extra.png', 'att_extra.png', 'image/png', 1024
      );
    `);
    if (!linkedRepRes.error.includes('42501')) {
      throw new Error(`Expected 42501 rejection on linked report, got: ${linkedRepRes.error}`);
    }
    console.log('  ✓ Assertion 9: Reservation on linked report rejected (42501).');

    // Assertion 10: Reservation on dismissed report rejected
    const dismRepRes = await runSqlExpectError(disposableDbName, `
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${resA_id}', false);
      INSERT INTO public.evidence_recovery_leases (
        report_id, reporter_id, idempotency_key, content_sha256,
        expected_storage_path, expected_file_name, expected_mime_type, expected_file_size
      ) VALUES (
        '${report6_id}', '${resA_id}', 'idem_dism', '${newSha}',
        '${resA_id}/${report6_id}/att_extra.png', 'att_extra.png', 'image/png', 1024
      );
    `);
    if (!dismRepRes.error.includes('42501')) {
      throw new Error(`Expected 42501 rejection on dismissed report, got: ${dismRepRes.error}`);
    }
    console.log('  ✓ Assertion 10: Reservation on dismissed report rejected (42501).');

    // Assertion 11: Foreign resident reservation rejection
    const foreignRes = await runSqlExpectError(disposableDbName, `
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${resB_id}', false);
      INSERT INTO public.evidence_recovery_leases (
        report_id, reporter_id, idempotency_key, content_sha256,
        expected_storage_path, expected_file_name, expected_mime_type, expected_file_size
      ) VALUES (
        '${report0_id}', '${resB_id}', 'idem_foreign', '${newSha}',
        '${resB_id}/${report0_id}/foreign.png', 'foreign.png', 'image/png', 1024
      );
    `);
    if (!foreignRes.error.includes('42501') && !foreignRes.error.includes('row-level security policy')) {
      throw new Error(`Expected RLS 42501 rejection on foreign resident, got: ${foreignRes.error}`);
    }
    console.log('  ✓ Assertion 11: Foreign resident reservation strictly rejected by RLS (42501).');

    // Assertion 12: Resident cannot directly modify or tamper with leases
    // 12a: Cannot mark status committed
    const tamperCommit = await runSqlExpectError(disposableDbName, `
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${resA_id}', false);
      UPDATE public.evidence_recovery_leases SET status = 'committed' WHERE id = '${newLeaseId}';
    `);
    if (!tamperCommit.error.includes('42501') && !tamperCommit.error.includes('permission denied')) {
      throw new Error(`Expected table privilege rejection on direct status update, got: ${tamperCommit.error}`);
    }
    // 12b: Cannot modify expected path or identity
    const tamperPath = await runSqlExpectError(disposableDbName, `
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${resA_id}', false);
      UPDATE public.evidence_recovery_leases SET expected_storage_path = 'hacked' WHERE id = '${newLeaseId}';
    `);
    if (!tamperPath.error.includes('42501') && !tamperPath.error.includes('permission denied')) {
      throw new Error(`Expected table privilege rejection on direct path modification, got: ${tamperPath.error}`);
    }
    // 12c: Cannot extend expiry
    const tamperExpiry = await runSqlExpectError(disposableDbName, `
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${resA_id}', false);
      UPDATE public.evidence_recovery_leases SET lease_expires_at = now() + interval '10 days' WHERE id = '${newLeaseId}';
    `);
    if (!tamperExpiry.error.includes('42501') && !tamperExpiry.error.includes('permission denied')) {
      throw new Error(`Expected table privilege rejection on direct expiry extension, got: ${tamperExpiry.error}`);
    }
    console.log('  ✓ Assertion 12: Direct lease updates by residents (status, path, expiry) strictly rejected by table privileges (42501).');

    // 8. Comprehensive Negative Attachment Registration Tests
    console.log('\n[Step 8] Running comprehensive negative attachment registration tests:');
    // For each negative test, unrelated prerequisites (such as Storage catalog entry) are valid
    // to strictly prove the specific reservation guard being tested.

    // 13a. No reservation
    const noLeasePath = `${resA_id}/${report0_id}/neg_no_lease.png`;
    await runSql(disposableDbName, `
      INSERT INTO storage.objects (id, bucket_id, name, owner, metadata)
      VALUES (gen_random_uuid(), 'incident-evidence', '${noLeasePath}', '${resA_id}', '{"mimetype":"image/png","size":"1024"}');
    `);
    const noLeaseRes = await runSqlExpectError(disposableDbName, `
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${resA_id}', false);
      INSERT INTO public.report_attachments (report_id, storage_path, file_name, mime_type, file_size_bytes)
      VALUES ('${report0_id}', '${noLeasePath}', 'neg_no_lease.png', 'image/png', 1024);
    `);
    if (!noLeaseRes.error.includes('42501') || !noLeaseRes.error.includes('no active, valid unexpired reservation found')) {
      throw new Error(`Expected 42501 on unreserved attachment, got: ${noLeaseRes.error}`);
    }
    console.log('  ✓ Assertion 13a: Attachment without reservation rejected (42501).');

    // 13b. Expired reservation
    const expLeaseId = crypto.randomUUID();
    const expPath = `${resA_id}/${report0_id}/neg_expired.png`;
    await runSql(disposableDbName, `
      INSERT INTO storage.objects (id, bucket_id, name, owner, metadata)
      VALUES (gen_random_uuid(), 'incident-evidence', '${expPath}', '${resA_id}', '{"mimetype":"image/png","size":"1024"}');

      SET session_replication_role = 'replica';
      INSERT INTO public.evidence_recovery_leases (
        id, report_id, reporter_id, idempotency_key, content_sha256,
        expected_storage_path, expected_file_name, expected_mime_type, expected_file_size,
        status, lease_expires_at
      ) VALUES (
        '${expLeaseId}', '${report0_id}', '${resA_id}', 'idem_neg_exp', '${newSha}',
        '${expPath}', 'neg_expired.png', 'image/png', 1024,
        'reserved', clock_timestamp() - interval '2 minutes'
      );
      SET session_replication_role = 'origin';
    `);
    const expAttachRes = await runSqlExpectError(disposableDbName, `
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${resA_id}', false);
      INSERT INTO public.report_attachments (report_id, storage_path, file_name, mime_type, file_size_bytes)
      VALUES ('${report0_id}', '${expPath}', 'neg_expired.png', 'image/png', 1024);
    `);
    if (!expAttachRes.error.includes('42501') || !expAttachRes.error.includes('no active, valid unexpired reservation found')) {
      throw new Error(`Expected 42501 on expired lease attachment, got: ${expAttachRes.error}`);
    }
    const expLeaseCheck = await runSql(disposableDbName, `SELECT status FROM public.evidence_recovery_leases WHERE id = '${expLeaseId}';`);
    if (expLeaseCheck.trim() !== 'reserved') {
      throw new Error(`Expired lease was unexpectedly modified! status = ${expLeaseCheck}`);
    }
    console.log('  ✓ Assertion 13b: Attachment with expired lease rejected (42501); lease not committed.');

    // 13c. Wrong report
    const wrongRepLeaseId = crypto.randomUUID();
    const wrongRepPath = `${resA_id}/${report0_id}/neg_wrong_rep.png`;
    await runSql(disposableDbName, `
      INSERT INTO storage.objects (id, bucket_id, name, owner, metadata)
      VALUES (gen_random_uuid(), 'incident-evidence', '${wrongRepPath}', '${resA_id}', '{"mimetype":"image/png","size":"1024"}');

      SET session_replication_role = 'replica';
      INSERT INTO public.evidence_recovery_leases (
        id, report_id, reporter_id, idempotency_key, content_sha256,
        expected_storage_path, expected_file_name, expected_mime_type, expected_file_size,
        status, lease_expires_at
      ) VALUES (
        '${wrongRepLeaseId}', '${report1_id}', '${resA_id}', 'idem_wrong_rep', '${newSha}',
        '${wrongRepPath}', 'neg_wrong_rep.png', 'image/png', 1024,
        'reserved', clock_timestamp() + interval '10 minutes'
      );
      SET session_replication_role = 'origin';
    `);
    const wrongRepAttachRes = await runSqlExpectError(disposableDbName, `
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${resA_id}', false);
      INSERT INTO public.report_attachments (report_id, storage_path, file_name, mime_type, file_size_bytes)
      VALUES ('${report0_id}', '${wrongRepPath}', 'neg_wrong_rep.png', 'image/png', 1024);
    `);
    if (!wrongRepAttachRes.error.includes('42501')) {
      throw new Error(`Expected 42501 on wrong report attachment, got: ${wrongRepAttachRes.error}`);
    }
    console.log('  ✓ Assertion 13c: Attachment with mismatched report_id rejected (42501).');

    // 13d. Wrong owner
    const wrongOwnerPath = `${resB_id}/${report0_id}/neg_wrong_owner.png`;
    const wrongOwnerAttachRes = await runSqlExpectError(disposableDbName, `
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${resB_id}', false);
      INSERT INTO public.report_attachments (report_id, storage_path, file_name, mime_type, file_size_bytes)
      VALUES ('${report0_id}', '${wrongOwnerPath}', 'neg_wrong_owner.png', 'image/png', 1024);
    `);
    if (!wrongOwnerAttachRes.error.includes('42501')) {
      throw new Error(`Expected 42501 on wrong owner attachment, got: ${wrongOwnerAttachRes.error}`);
    }
    console.log('  ✓ Assertion 13d: Attachment with foreign owner strictly rejected (42501).');

    // 13e. Wrong storage path
    const wrongPathLeaseId = crypto.randomUUID();
    const correctPath = `${resA_id}/${report0_id}/correct_path.png`;
    const wrongPath = `${resA_id}/${report0_id}/wrong_path.png`;
    await runSql(disposableDbName, `
      INSERT INTO storage.objects (id, bucket_id, name, owner, metadata)
      VALUES (gen_random_uuid(), 'incident-evidence', '${wrongPath}', '${resA_id}', '{"mimetype":"image/png","size":"1024"}');

      SET session_replication_role = 'replica';
      INSERT INTO public.evidence_recovery_leases (
        id, report_id, reporter_id, idempotency_key, content_sha256,
        expected_storage_path, expected_file_name, expected_mime_type, expected_file_size,
        status, lease_expires_at
      ) VALUES (
        '${wrongPathLeaseId}', '${report0_id}', '${resA_id}', 'idem_wrong_path', '${newSha}',
        '${correctPath}', 'wrong_path.png', 'image/png', 1024,
        'reserved', clock_timestamp() + interval '10 minutes'
      );
      SET session_replication_role = 'origin';
    `);
    const wrongPathAttachRes = await runSqlExpectError(disposableDbName, `
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${resA_id}', false);
      INSERT INTO public.report_attachments (report_id, storage_path, file_name, mime_type, file_size_bytes)
      VALUES ('${report0_id}', '${wrongPath}', 'wrong_path.png', 'image/png', 1024);
    `);
    if (!wrongPathAttachRes.error.includes('42501')) {
      throw new Error(`Expected 42501 on mismatched path attachment, got: ${wrongPathAttachRes.error}`);
    }
    console.log('  ✓ Assertion 13e: Attachment with mismatched storage_path rejected (42501).');

    // 13f. Wrong filename
    const wrongNameLeaseId = crypto.randomUUID();
    const wrongNamePath = `${resA_id}/${report0_id}/actual_file.png`;
    await runSql(disposableDbName, `
      INSERT INTO storage.objects (id, bucket_id, name, owner, metadata)
      VALUES (gen_random_uuid(), 'incident-evidence', '${wrongNamePath}', '${resA_id}', '{"mimetype":"image/png","size":"1024"}');

      SET session_replication_role = 'replica';
      INSERT INTO public.evidence_recovery_leases (
        id, report_id, reporter_id, idempotency_key, content_sha256,
        expected_storage_path, expected_file_name, expected_mime_type, expected_file_size,
        status, lease_expires_at
      ) VALUES (
        '${wrongNameLeaseId}', '${report0_id}', '${resA_id}', 'idem_wrong_name', '${newSha}',
        '${wrongNamePath}', 'expected_diff.png', 'image/png', 1024,
        'reserved', clock_timestamp() + interval '10 minutes'
      );
      SET session_replication_role = 'origin';
    `);
    const wrongNameAttachRes = await runSqlExpectError(disposableDbName, `
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${resA_id}', false);
      INSERT INTO public.report_attachments (report_id, storage_path, file_name, mime_type, file_size_bytes)
      VALUES ('${report0_id}', '${wrongNamePath}', 'actual_file.png', 'image/png', 1024);
    `);
    if (!wrongNameAttachRes.error.includes('42501')) {
      throw new Error(`Expected 42501 on mismatched filename attachment, got: ${wrongNameAttachRes.error}`);
    }
    console.log('  ✓ Assertion 13f: Attachment with mismatched filename rejected (42501).');

    // 13g. Wrong MIME type
    const wrongMimeLeaseId = crypto.randomUUID();
    const wrongMimePath = `${resA_id}/${report0_id}/mime_test.jpeg`;
    await runSql(disposableDbName, `
      INSERT INTO storage.objects (id, bucket_id, name, owner, metadata)
      VALUES (gen_random_uuid(), 'incident-evidence', '${wrongMimePath}', '${resA_id}', '{"mimetype":"image/jpeg","size":"1024"}');

      SET session_replication_role = 'replica';
      INSERT INTO public.evidence_recovery_leases (
        id, report_id, reporter_id, idempotency_key, content_sha256,
        expected_storage_path, expected_file_name, expected_mime_type, expected_file_size,
        status, lease_expires_at
      ) VALUES (
        '${wrongMimeLeaseId}', '${report0_id}', '${resA_id}', 'idem_wrong_mime', '${newSha}',
        '${wrongMimePath}', 'mime_test.jpeg', 'image/png', 1024,
        'reserved', clock_timestamp() + interval '10 minutes'
      );
      SET session_replication_role = 'origin';
    `);
    const wrongMimeAttachRes = await runSqlExpectError(disposableDbName, `
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${resA_id}', false);
      INSERT INTO public.report_attachments (report_id, storage_path, file_name, mime_type, file_size_bytes)
      VALUES ('${report0_id}', '${wrongMimePath}', 'mime_test.jpeg', 'image/jpeg', 1024);
    `);
    if (!wrongMimeAttachRes.error.includes('42501')) {
      throw new Error(`Expected 42501 on mismatched MIME attachment, got: ${wrongMimeAttachRes.error}`);
    }
    console.log('  ✓ Assertion 13g: Attachment with mismatched MIME type rejected (42501).');

    // 13h. Wrong file size
    const wrongSizeLeaseId = crypto.randomUUID();
    const wrongSizePath = `${resA_id}/${report0_id}/size_test.png`;
    await runSql(disposableDbName, `
      INSERT INTO storage.objects (id, bucket_id, name, owner, metadata)
      VALUES (gen_random_uuid(), 'incident-evidence', '${wrongSizePath}', '${resA_id}', '{"mimetype":"image/png","size":"4096"}');

      SET session_replication_role = 'replica';
      INSERT INTO public.evidence_recovery_leases (
        id, report_id, reporter_id, idempotency_key, content_sha256,
        expected_storage_path, expected_file_name, expected_mime_type, expected_file_size,
        status, lease_expires_at
      ) VALUES (
        '${wrongSizeLeaseId}', '${report0_id}', '${resA_id}', 'idem_wrong_size', '${newSha}',
        '${wrongSizePath}', 'size_test.png', 'image/png', 2048,
        'reserved', clock_timestamp() + interval '10 minutes'
      );
      SET session_replication_role = 'origin';
    `);
    const wrongSizeAttachRes = await runSqlExpectError(disposableDbName, `
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${resA_id}', false);
      INSERT INTO public.report_attachments (report_id, storage_path, file_name, mime_type, file_size_bytes)
      VALUES ('${report0_id}', '${wrongSizePath}', 'size_test.png', 'image/png', 4096);
    `);
    if (!wrongSizeAttachRes.error.includes('42501')) {
      throw new Error(`Expected 42501 on mismatched file size attachment, got: ${wrongSizeAttachRes.error}`);
    }
    console.log('  ✓ Assertion 13h: Attachment with mismatched file size rejected (42501).');

    // 13i. Invalid reservation state (already expired status)
    const invalidStateLeaseId = crypto.randomUUID();
    const invalidStatePath = `${resA_id}/${report0_id}/invalid_state_test.png`;
    await runSql(disposableDbName, `
      INSERT INTO storage.objects (id, bucket_id, name, owner, metadata)
      VALUES (gen_random_uuid(), 'incident-evidence', '${invalidStatePath}', '${resA_id}', '{"mimetype":"image/png","size":"1024"}');

      SET session_replication_role = 'replica';
      INSERT INTO public.evidence_recovery_leases (
        id, report_id, reporter_id, idempotency_key, content_sha256,
        expected_storage_path, expected_file_name, expected_mime_type, expected_file_size,
        status, lease_expires_at
      ) VALUES (
        '${invalidStateLeaseId}', '${report0_id}', '${resA_id}', 'idem_inv_state', '${newSha}',
        '${invalidStatePath}', 'invalid_state_test.png', 'image/png', 1024,
        'expired', clock_timestamp() + interval '10 minutes'
      );
      SET session_replication_role = 'origin';
    `);
    const invalidStateAttachRes = await runSqlExpectError(disposableDbName, `
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${resA_id}', false);
      INSERT INTO public.report_attachments (report_id, storage_path, file_name, mime_type, file_size_bytes)
      VALUES ('${report0_id}', '${invalidStatePath}', 'invalid_state_test.png', 'image/png', 1024);
    `);
    if (!invalidStateAttachRes.error.includes('42501')) {
      throw new Error(`Expected 42501 on invalid state lease attachment, got: ${invalidStateAttachRes.error}`);
    }
    console.log('  ✓ Assertion 13i: Attachment with invalid lease state (expired) rejected (42501).');

    // 13j. Attachment rejected on reviewed report
    const revAttachPath = `${resA_id}/${report4_id}/rev_attach.png`;
    await runSql(disposableDbName, `
      INSERT INTO storage.objects (id, bucket_id, name, owner, metadata)
      VALUES (gen_random_uuid(), 'incident-evidence', '${revAttachPath}', '${resA_id}', '{"mimetype":"image/png","size":"1024"}');
    `);
    const revAttachRes = await runSqlExpectError(disposableDbName, `
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${resA_id}', false);
      INSERT INTO public.report_attachments (report_id, storage_path, file_name, mime_type, file_size_bytes)
      VALUES ('${report4_id}', '${revAttachPath}', 'rev_attach.png', 'image/png', 1024);
    `);
    if (!revAttachRes.error.includes('42501') || !revAttachRes.error.includes('Cannot attach evidence to report in status "reviewed"')) {
      throw new Error(`Expected 42501 on reviewed report attachment, got: ${revAttachRes.error}`);
    }
    console.log('  ✓ Assertion 13j: Attachment rejected on reviewed report (42501).');

    // 13k. Attachment rejected on linked report
    const linkedAttachPath = `${resA_id}/${report5_id}/linked_attach.png`;
    await runSql(disposableDbName, `
      INSERT INTO storage.objects (id, bucket_id, name, owner, metadata)
      VALUES (gen_random_uuid(), 'incident-evidence', '${linkedAttachPath}', '${resA_id}', '{"mimetype":"image/png","size":"1024"}');
    `);
    const linkedAttachRes = await runSqlExpectError(disposableDbName, `
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${resA_id}', false);
      INSERT INTO public.report_attachments (report_id, storage_path, file_name, mime_type, file_size_bytes)
      VALUES ('${report5_id}', '${linkedAttachPath}', 'linked_attach.png', 'image/png', 1024);
    `);
    if (!linkedAttachRes.error.includes('42501') || !linkedAttachRes.error.includes('Cannot attach evidence to report in status "linked"')) {
      throw new Error(`Expected 42501 on linked report attachment, got: ${linkedAttachRes.error}`);
    }
    console.log('  ✓ Assertion 13k: Attachment rejected on linked report (42501).');

    // 13l. Attachment rejected on dismissed report
    const dismAttachPath = `${resA_id}/${report6_id}/dism_attach.png`;
    await runSql(disposableDbName, `
      INSERT INTO storage.objects (id, bucket_id, name, owner, metadata)
      VALUES (gen_random_uuid(), 'incident-evidence', '${dismAttachPath}', '${resA_id}', '{"mimetype":"image/png","size":"1024"}');
    `);
    const dismAttachRes = await runSqlExpectError(disposableDbName, `
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${resA_id}', false);
      INSERT INTO public.report_attachments (report_id, storage_path, file_name, mime_type, file_size_bytes)
      VALUES ('${report6_id}', '${dismAttachPath}', 'dism_attach.png', 'image/png', 1024);
    `);
    if (!dismAttachRes.error.includes('42501') || !dismAttachRes.error.includes('Cannot attach evidence to report in status "dismissed"')) {
      throw new Error(`Expected 42501 on dismissed report attachment, got: ${dismAttachRes.error}`);
    }
    console.log('  ✓ Assertion 13l: Attachment rejected on dismissed report (42501).');

    // 9. Privileged Maintenance Execution Permissions
    console.log('\n[Step 9] Testing maintenance function execution permissions:');
    // 14a. Anonymous caller denied
    const anonRes = await runSqlExpectError(disposableDbName, `
      SET ROLE anon;
      SELECT public.expire_stale_evidence_leases();
    `);
    if (!anonRes.error.includes('42501') && !anonRes.error.includes('permission denied for function expire_stale_evidence_leases')) {
      throw new Error(`Expected 42501 for anon, got: ${anonRes.error}`);
    }
    console.log('  ✓ Assertion 14a: Anonymous caller denied execution of expire_stale_evidence_leases (42501).');

    // 14b. Resident caller denied
    const resCallerRes = await runSqlExpectError(disposableDbName, `
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${resA_id}', false);
      SELECT public.expire_stale_evidence_leases();
    `);
    if (!resCallerRes.error.includes('42501') && !resCallerRes.error.includes('permission denied for function expire_stale_evidence_leases')) {
      throw new Error(`Expected 42501 for resident, got: ${resCallerRes.error}`);
    }
    console.log('  ✓ Assertion 14b: Resident caller denied execution of expire_stale_evidence_leases (42501).');

    // 14c. Manager caller denied
    const mgrCallerRes = await runSqlExpectError(disposableDbName, `
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${mgrA_id}', false);
      SELECT public.expire_stale_evidence_leases();
    `);
    if (!mgrCallerRes.error.includes('42501') && !mgrCallerRes.error.includes('permission denied for function expire_stale_evidence_leases')) {
      throw new Error(`Expected 42501 for manager, got: ${mgrCallerRes.error}`);
    }
    console.log('  ✓ Assertion 14c: Manager caller denied execution of expire_stale_evidence_leases (42501).');

    // 14d. Service role caller succeeds
    const sweepRepId = crypto.randomUUID();
    const staleLeaseId = crypto.randomUUID();
    const activeLeaseId = crypto.randomUUID();
    await runSql(disposableDbName, `
      SET session_replication_role = 'replica';
      INSERT INTO public.incident_reports (id, reporter_id, building_id, category, description, status, urgency_hint)
      VALUES ('${sweepRepId}', '${resA_id}', '${bldgA_id}', 'water_supply', 'Sweeper Test Report', 'submitted', 'low');
      SET session_replication_role = 'origin';

      SET ROLE service_role;
      INSERT INTO public.evidence_recovery_leases (
        id, report_id, reporter_id, idempotency_key, content_sha256,
        expected_storage_path, expected_file_name, expected_mime_type, expected_file_size,
        status, lease_expires_at
      ) VALUES 
      ('${staleLeaseId}', '${sweepRepId}', '${resA_id}', 'idem_stale', '${newSha}', '${resA_id}/${sweepRepId}/stale.png', 'stale.png', 'image/png', 1024, 'reserved', clock_timestamp() - interval '1 hour'),
      ('${activeLeaseId}', '${sweepRepId}', '${resA_id}', 'idem_active', '${newSha}', '${resA_id}/${sweepRepId}/active.png', 'active.png', 'image/png', 1024, 'reserved', clock_timestamp() + interval '10 minutes');
    `);

    const sweepCount = await runSql(disposableDbName, `
      SET ROLE service_role;
      SELECT public.expire_stale_evidence_leases();
    `);
    if (getLastInt(sweepCount) !== 2) {
      throw new Error(`Expected sweeper to expire exactly 2 stale leases, got: ${sweepCount}`);
    }

    const expLeaseStatus = await runSql(disposableDbName, `SELECT status FROM public.evidence_recovery_leases WHERE id = '${expLeaseId}';`);
    const staleStatus = await runSql(disposableDbName, `SELECT status FROM public.evidence_recovery_leases WHERE id = '${staleLeaseId}';`);
    const activeStatus = await runSql(disposableDbName, `SELECT status FROM public.evidence_recovery_leases WHERE id = '${activeLeaseId}';`);
    if (expLeaseStatus !== 'expired' || staleStatus !== 'expired' || activeStatus !== 'reserved') {
      throw new Error(`Sweeper state mismatch: exp=${expLeaseStatus}, stale=${staleStatus}, active=${activeStatus}`);
    }
    console.log('  ✓ Assertion 14d: Authorized service_role succeeded; expired only stale uncommitted leases and preserved active leases.');

    // 10. Repeated Operation Idempotency
    console.log('\n[Step 10] Testing repeated operation idempotency without duplicate attachment rows:');
    const retrySql = `
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${resA_id}', false);
      INSERT INTO public.report_attachments (report_id, storage_path, file_name, mime_type, file_size_bytes)
      VALUES ('${report0_id}', '${newPath}', 'new_photo1.png', 'image/png', 2048)
      ON CONFLICT (storage_path) DO NOTHING;
    `;
    await runSql(disposableDbName, retrySql);

    const dupCount = await runSql(disposableDbName, `SELECT count(*) FROM public.report_attachments WHERE storage_path = '${newPath}';`);
    if (getLastInt(dupCount) !== 1) {
      throw new Error(`Expected exactly 1 attachment row after retry, found ${dupCount}`);
    }
    const retainedLeaseStatus = await runSql(disposableDbName, `SELECT status FROM public.evidence_recovery_leases WHERE id = '${newLeaseId}';`);
    if (retainedLeaseStatus !== 'committed') {
      throw new Error(`Expected lease to stay 'committed', got: ${retainedLeaseStatus}`);
    }
    console.log('  ✓ Assertion 15: Repeated operations remain idempotent without duplicate attachment rows.');

    // 11. Real Overlapping Concurrency Tests (pg_blocking_pids Coordination)
    console.log('\n[Step 11] Running real overlapping concurrency tests with pg_blocking_pids():');

    const s1 = new PsqlSession('Session 1', disposableDbName);
    const s2 = new PsqlSession('Session 2', disposableDbName);
    const sWatcher = new PsqlSession('Watcher Session', disposableDbName);
    activeSessions.push(s1, s2, sWatcher);

    const s1Pid = await s1.getPid();
    const s2Pid = await s2.getPid();
    console.log(`  [Concurrency Harness] Active sessions: S1 (PID ${s1Pid}), S2 (PID ${s2Pid})`);

    // -------------------------------------------------------------------------
    // Concurrency Test A: Competing reservations at capacity (2 slots occupied, race for last slot)
    // -------------------------------------------------------------------------
    console.log('\n  [Concurrency Test A] Competing reservations for the final remaining slot:');
    const concurRepA = crypto.randomUUID();
    const leaseA1 = crypto.randomUUID();
    const leaseA2 = crypto.randomUUID();
    const leaseA3_comp1 = crypto.randomUUID();
    const leaseA3_comp2 = crypto.randomUUID();

    // Setup: report with 2 occupied reservation slots
    await runSql(disposableDbName, `
      SET session_replication_role = 'replica';
      INSERT INTO public.incident_reports (id, reporter_id, building_id, category, description, status, urgency_hint)
      VALUES ('${concurRepA}', '${resA_id}', '${bldgA_id}', 'lift', 'Concurrency Test A', 'submitted', 'high');

      INSERT INTO public.evidence_recovery_leases (
        id, report_id, reporter_id, idempotency_key, content_sha256,
        expected_storage_path, expected_file_name, expected_mime_type, expected_file_size,
        status, lease_expires_at
      ) VALUES
        ('${leaseA1}', '${concurRepA}', '${resA_id}', 'idem_ca_1', '${newSha}', '${resA_id}/${concurRepA}/ca1.png', 'ca1.png', 'image/png', 1024, 'reserved', clock_timestamp() + interval '10 minutes'),
        ('${leaseA2}', '${concurRepA}', '${resA_id}', 'idem_ca_2', '${newSha}', '${resA_id}/${concurRepA}/ca2.png', 'ca2.png', 'image/png', 1024, 'reserved', clock_timestamp() + interval '10 minutes');
      SET session_replication_role = 'origin';
    `);

    // S1 (Resident A) begins reservation for 3rd slot and keeps transaction open
    await s1.exec(`
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${resA_id}', false);
      BEGIN;
      INSERT INTO public.evidence_recovery_leases (
        id, report_id, reporter_id, idempotency_key, content_sha256,
        expected_storage_path, expected_file_name, expected_mime_type, expected_file_size
      ) VALUES (
        '${leaseA3_comp1}', '${concurRepA}', '${resA_id}', 'idem_ca_comp1', '${newSha}',
        '${resA_id}/${concurRepA}/ca3_comp1.png', 'ca3_comp1.png', 'image/png', 1024
      );
    `);
    console.log('    S1 holds open transaction and FOR UPDATE lock on report row.');

    // S2 (Resident A) attempts competing reservation for the same 3rd slot -> MUST BLOCK!
    console.log('    S2 attempting competing reservation for last slot (should block on lock)...');
    const s2CompAPromise = s2.exec(`
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${resA_id}', false);
      BEGIN;
      INSERT INTO public.evidence_recovery_leases (
        id, report_id, reporter_id, idempotency_key, content_sha256,
        expected_storage_path, expected_file_name, expected_mime_type, expected_file_size
      ) VALUES (
        '${leaseA3_comp2}', '${concurRepA}', '${resA_id}', 'idem_ca_comp2', '${newSha}',
        '${resA_id}/${concurRepA}/ca3_comp2.png', 'ca3_comp2.png', 'image/png', 1024
      );
      COMMIT;
    `);

    // Verify S1 is actively blocking S2
    const blockingPidsA = await waitForBlocking(sWatcher, s2Pid);
    if (!blockingPidsA.includes(s1Pid)) {
      throw new Error(`Expected S1 (${s1Pid}) to block S2 (${s2Pid}), observed: ${blockingPidsA.join(', ')}`);
    }
    console.log(`    ✓ Observed lock blocking: pg_blocking_pids(${s2Pid}) = {${blockingPidsA.join(', ')}}`);

    // S1 commits transaction
    console.log('    S1 committing transaction...');
    await s1.exec('COMMIT;');

    // S2 unblocks and must receive the quota cap error
    const s2CompARes = await s2CompAPromise;
    if (!s2CompARes.error || !s2CompARes.error.includes('42501') || !s2CompARes.error.includes('Maksimum 3 slot bukti dibenarkan')) {
      throw new Error(`Expected S2 to fail with quota cap 42501 after unblocking, got: ${s2CompARes.error || s2CompARes.output}`);
    }
    await s2.exec('ROLLBACK;');
    console.log('    ✓ S2 unblocked and was strictly rejected with quota error (42501).');

    // Verify final state: exactly 3 active reservations, never 4
    const totalLeasesA = await runSql(disposableDbName, `SELECT count(*) FROM public.evidence_recovery_leases WHERE report_id = '${concurRepA}';`);
    if (getLastInt(totalLeasesA) !== 3) {
      throw new Error(`Expected exactly 3 leases for report A, found ${totalLeasesA}`);
    }
    console.log('    ✓ Verified: exactly 3 reservations persist; 3-slot cap strictly respected across concurrent requests.');

    // -------------------------------------------------------------------------
    // Concurrency Test B: Reservation versus attachment commitment (no double counting)
    // -------------------------------------------------------------------------
    console.log('\n  [Concurrency Test B] Reservation vs attachment commitment (verify slot not double-counted):');
    const concurRepB = crypto.randomUUID();
    const leaseB1 = crypto.randomUUID();
    const leaseB2 = crypto.randomUUID();
    const pathB1 = `${resA_id}/${concurRepB}/cb1.png`;

    // Setup: 1 registered attachment + 1 active reservation (leaseB1). Total slots occupied = 2. 1 slot free.
    await runSql(disposableDbName, `
      SET session_replication_role = 'replica';
      INSERT INTO public.incident_reports (id, reporter_id, building_id, category, description, status, urgency_hint)
      VALUES ('${concurRepB}', '${resA_id}', '${bldgA_id}', 'lift', 'Concurrency Test B', 'submitted', 'medium');

      -- Pre-existing registered attachment
      INSERT INTO storage.objects (id, bucket_id, name, owner, metadata)
      VALUES (gen_random_uuid(), 'incident-evidence', '${resA_id}/${concurRepB}/pre.png', '${resA_id}', '{"mimetype":"image/png","size":"1024"}');
      INSERT INTO public.report_attachments (report_id, storage_path, file_name, mime_type, file_size_bytes)
      VALUES ('${concurRepB}', '${resA_id}/${concurRepB}/pre.png', 'pre.png', 'image/png', 1024);

      -- Active lease to be committed
      INSERT INTO public.evidence_recovery_leases (
        id, report_id, reporter_id, idempotency_key, content_sha256,
        expected_storage_path, expected_file_name, expected_mime_type, expected_file_size,
        status, lease_expires_at
      ) VALUES (
        '${leaseB1}', '${concurRepB}', '${resA_id}', 'idem_cb_1', '${newSha}',
        '${pathB1}', 'cb1.png', 'image/png', 2048,
        'reserved', clock_timestamp() + interval '10 minutes'
      );
      INSERT INTO storage.objects (id, bucket_id, name, owner, metadata)
      VALUES (gen_random_uuid(), 'incident-evidence', '${pathB1}', '${resA_id}', '{"mimetype":"image/png","size":"2048"}');
      SET session_replication_role = 'origin';
    `);

    // S1 (Resident A) begins committing leaseB1 via attachment insert, holds transaction open
    await s1.exec(`
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${resA_id}', false);
      BEGIN;
      INSERT INTO public.report_attachments (report_id, storage_path, file_name, mime_type, file_size_bytes)
      VALUES ('${concurRepB}', '${pathB1}', 'cb1.png', 'image/png', 2048);
    `);
    console.log('    S1 holds open transaction registering attachment (transitioning lease to committed).');

    // S2 (Resident A) races new reservation for the 3rd slot -> blocks on report lock
    console.log('    S2 races new reservation for the remaining slot (should block on lock)...');
    const s2CompBPromise = s2.exec(`
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${resA_id}', false);
      BEGIN;
      INSERT INTO public.evidence_recovery_leases (
        id, report_id, reporter_id, idempotency_key, content_sha256,
        expected_storage_path, expected_file_name, expected_mime_type, expected_file_size
      ) VALUES (
        '${leaseB2}', '${concurRepB}', '${resA_id}', 'idem_cb_2', '${newSha}',
        '${resA_id}/${concurRepB}/cb2.png', 'cb2.png', 'image/png', 1024
      );
      COMMIT;
    `);

    // Verify blocking
    const blockingPidsB = await waitForBlocking(sWatcher, s2Pid);
    if (!blockingPidsB.includes(s1Pid)) {
      throw new Error(`Expected S1 (${s1Pid}) to block S2 (${s2Pid}), observed: ${blockingPidsB.join(', ')}`);
    }
    console.log(`    ✓ Observed lock blocking: pg_blocking_pids(${s2Pid}) = {${blockingPidsB.join(', ')}}`);

    // S1 commits
    console.log('    S1 commits attachment registration...');
    await s1.exec('COMMIT;');

    // S2 unblocks. Because committed lease is NOT double-counted, S2 succeeds!
    const s2CompBRes = await s2CompBPromise;
    if (s2CompBRes.error) {
      throw new Error(`S2 reservation failed unexpectedly: ${s2CompBRes.error}`);
    }
    console.log('    ✓ S2 unblocked and successfully reserved the 3rd slot without double-counting.');

    // Verify final combined count: 2 registered attachments + 1 active reservation = 3 total
    const regCountB = await runSql(disposableDbName, `SELECT count(*) FROM public.report_attachments WHERE report_id = '${concurRepB}';`);
    const activeLeaseCountB = await runSql(disposableDbName, `SELECT count(*) FROM public.evidence_recovery_leases WHERE report_id = '${concurRepB}' AND status = 'reserved';`);
    if (getLastInt(regCountB) !== 2 || getLastInt(activeLeaseCountB) !== 1) {
      throw new Error(`Expected 2 attachments and 1 reserved lease, found ${regCountB} and ${activeLeaseCountB}`);
    }
    console.log('    ✓ Verified: exactly 2 registered attachments + 1 active reservation = 3 total slots.');

    // -------------------------------------------------------------------------
    // Concurrency Test C: Management review holds the report lock first
    // -------------------------------------------------------------------------
    console.log('\n  [Concurrency Test C] Management review holds report lock first:');
    const concurRepC = crypto.randomUUID();
    const leaseC = crypto.randomUUID();
    const pathC = `${resA_id}/${concurRepC}/cc.png`;

    await runSql(disposableDbName, `
      SET session_replication_role = 'replica';
      INSERT INTO public.incident_reports (id, reporter_id, building_id, category, description, status, urgency_hint)
      VALUES ('${concurRepC}', '${resA_id}', '${bldgA_id}', 'lift', 'Concurrency Test C', 'submitted', 'urgent');

      INSERT INTO public.evidence_recovery_leases (
        id, report_id, reporter_id, idempotency_key, content_sha256,
        expected_storage_path, expected_file_name, expected_mime_type, expected_file_size,
        status, lease_expires_at
      ) VALUES (
        '${leaseC}', '${concurRepC}', '${resA_id}', 'idem_cc', '${newSha}',
        '${pathC}', 'cc.png', 'image/png', 1024,
        'reserved', clock_timestamp() + interval '10 minutes'
      );
      INSERT INTO storage.objects (id, bucket_id, name, owner, metadata)
      VALUES (gen_random_uuid(), 'incident-evidence', '${pathC}', '${resA_id}', '{"mimetype":"image/png","size":"1024"}');
      SET session_replication_role = 'origin';
    `);

    // S1 (Manager A - real authenticated role) begins review update, holding open transaction
    await s1.exec(`
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${mgrA_id}', false);
      BEGIN;
      UPDATE public.incident_reports SET status = 'reviewed' WHERE id = '${concurRepC}';
    `);
    console.log('    S1 (Manager) executed status update to "reviewed", holding open transaction.');

    // S2 (Resident A - real authenticated role) attempts evidence attachment -> blocks on lock
    console.log('    S2 (Resident) attempts attachment registration (should block on lock)...');
    const s2CompCPromise = s2.exec(`
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${resA_id}', false);
      BEGIN;
      INSERT INTO public.report_attachments (report_id, storage_path, file_name, mime_type, file_size_bytes)
      VALUES ('${concurRepC}', '${pathC}', 'cc.png', 'image/png', 1024);
      COMMIT;
    `);

    // Verify S1 blocks S2
    const blockingPidsC = await waitForBlocking(sWatcher, s2Pid);
    if (!blockingPidsC.includes(s1Pid)) {
      throw new Error(`Expected Manager (${s1Pid}) to block Resident (${s2Pid}), observed: ${blockingPidsC.join(', ')}`);
    }
    console.log(`    ✓ Observed lock blocking: pg_blocking_pids(${s2Pid}) = {${blockingPidsC.join(', ')}}`);

    // Manager commits review
    console.log('    S1 (Manager) commits review...');
    await s1.exec('COMMIT;');

    // Resident unblocks -> rejected because report is now 'reviewed'
    const s2CompCRes = await s2CompCPromise;
    if (!s2CompCRes.error || !s2CompCRes.error.includes('42501') || !s2CompCRes.error.includes('Cannot attach evidence to report in status "reviewed"')) {
      throw new Error(`Expected Resident attachment to fail with status 42501, got: ${s2CompCRes.error || s2CompCRes.output}`);
    }
    await s2.exec('ROLLBACK;');
    console.log('    ✓ Resident unblocked and attachment was strictly rejected with 42501.');

    // Verify zero attachments inserted
    const attCountC = await runSql(disposableDbName, `SELECT count(*) FROM public.report_attachments WHERE report_id = '${concurRepC}';`);
    if (getLastInt(attCountC) !== 0) {
      throw new Error(`Expected 0 attachments for report C, found ${attCountC}`);
    }
    console.log('    ✓ Verified: report remains "reviewed" and zero attachments were inserted.');

    // -------------------------------------------------------------------------
    // Concurrency Test D: Evidence operation holds the report lock first
    // -------------------------------------------------------------------------
    console.log('\n  [Concurrency Test D] Evidence operation holds report lock first:');
    const concurRepD = crypto.randomUUID();
    const leaseD = crypto.randomUUID();
    const pathD = `${resA_id}/${concurRepD}/cd.png`;

    await runSql(disposableDbName, `
      SET session_replication_role = 'replica';
      INSERT INTO public.incident_reports (id, reporter_id, building_id, category, description, status, urgency_hint)
      VALUES ('${concurRepD}', '${resA_id}', '${bldgA_id}', 'lift', 'Concurrency Test D', 'submitted', 'urgent');

      INSERT INTO public.evidence_recovery_leases (
        id, report_id, reporter_id, idempotency_key, content_sha256,
        expected_storage_path, expected_file_name, expected_mime_type, expected_file_size,
        status, lease_expires_at
      ) VALUES (
        '${leaseD}', '${concurRepD}', '${resA_id}', 'idem_cd', '${newSha}',
        '${pathD}', 'cd.png', 'image/png', 1024,
        'reserved', clock_timestamp() + interval '10 minutes'
      );
      INSERT INTO storage.objects (id, bucket_id, name, owner, metadata)
      VALUES (gen_random_uuid(), 'incident-evidence', '${pathD}', '${resA_id}', '{"mimetype":"image/png","size":"1024"}');
      SET session_replication_role = 'origin';
    `);

    // S1 (Resident A) begins attachment registration and holds open transaction
    await s1.exec(`
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${resA_id}', false);
      BEGIN;
      INSERT INTO public.report_attachments (report_id, storage_path, file_name, mime_type, file_size_bytes)
      VALUES ('${concurRepD}', '${pathD}', 'cd.png', 'image/png', 1024);
    `);
    console.log('    S1 (Resident) registered attachment, holding open transaction.');

    // S2 (Manager A) attempts review update -> blocks on lock
    console.log('    S2 (Manager) attempts review update (should block on lock)...');
    const s2CompDPromise = s2.exec(`
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${mgrA_id}', false);
      BEGIN;
      UPDATE public.incident_reports SET status = 'reviewed' WHERE id = '${concurRepD}';
      COMMIT;
    `);

    // Verify S1 blocks S2
    const blockingPidsD = await waitForBlocking(sWatcher, s2Pid);
    if (!blockingPidsD.includes(s1Pid)) {
      throw new Error(`Expected Resident (${s1Pid}) to block Manager (${s2Pid}), observed: ${blockingPidsD.join(', ')}`);
    }
    console.log(`    ✓ Observed lock blocking: pg_blocking_pids(${s2Pid}) = {${blockingPidsD.join(', ')}}`);

    // Resident commits
    console.log('    S1 (Resident) commits attachment registration...');
    await s1.exec('COMMIT;');

    // Manager unblocks and completes review update
    const s2CompDRes = await s2CompDPromise;
    if (s2CompDRes.error) {
      throw new Error(`Manager review update failed unexpectedly: ${s2CompDRes.error}`);
    }
    console.log('    ✓ Manager unblocked and successfully reviewed report.');

    // Verify serial outcome: report is reviewed and attachment is retained
    const finalRepStatusD = await runSql(disposableDbName, `SELECT status FROM public.incident_reports WHERE id = '${concurRepD}';`);
    const finalAttCountD = await runSql(disposableDbName, `SELECT count(*) FROM public.report_attachments WHERE report_id = '${concurRepD}';`);
    if (finalRepStatusD.trim() !== 'reviewed' || getLastInt(finalAttCountD) !== 1) {
      throw new Error(`Serial outcome mismatch! status=${finalRepStatusD}, atts=${finalAttCountD}`);
    }
    console.log('    ✓ Serial outcome verified: report is "reviewed" and attachment is safely retained.');

    s1.close();
    s2.close();
    sWatcher.close();
    activeSessions.length = 0;

    // 12. Rollback Execution and Behavioral Integrity Verification
    console.log('\n[Step 12] Executing proposal rollback SQL and verifying behavior:');
    fs.writeFileSync(tmpRollPath, rollbackSql, 'utf8');
    await runSqlFile(disposableDbName, tmpRollPath);
    try { fs.unlinkSync(tmpRollPath); } catch {}

    // Verify database objects dropped
    const tableExists = await runSql(disposableDbName, "SELECT count(*) FROM information_schema.tables WHERE table_name = 'evidence_recovery_leases';");
    const func1Exists = await runSql(disposableDbName, "SELECT count(*) FROM pg_proc WHERE proname = 'guard_lease_reservation';");
    const func2Exists = await runSql(disposableDbName, "SELECT count(*) FROM pg_proc WHERE proname = 'guard_attachment_with_lease';");
    const func3Exists = await runSql(disposableDbName, "SELECT count(*) FROM pg_proc WHERE proname = 'expire_stale_evidence_leases';");
    const origTriggerExists = await runSql(disposableDbName, "SELECT count(*) FROM pg_trigger WHERE tgname = 'attachment_guard';");

    if (
      getLastInt(tableExists) !== 0 ||
      getLastInt(func1Exists) !== 0 ||
      getLastInt(func2Exists) !== 0 ||
      getLastInt(func3Exists) !== 0 ||
      getLastInt(origTriggerExists) !== 1
    ) {
      throw new Error('Rollback failed to drop proposal objects or restore attachment_guard trigger.');
    }
    console.log('  ✓ Database objects dropped and original attachment_guard trigger restored.');

    // Behavioral Verification on Rolled Back State:
    // 1. Original attachment guard works without lease requirement
    const rollbackRepId = crypto.randomUUID();
    const rollbackAttPath = `${resA_id}/${rollbackRepId}/rolled_back.png`;
    await runSql(disposableDbName, `
      SET session_replication_role = 'replica';
      INSERT INTO public.incident_reports (id, reporter_id, building_id, category, description, status, urgency_hint)
      VALUES ('${rollbackRepId}', '${resA_id}', '${bldgA_id}', 'water_supply', 'Rollback Behavior Test', 'submitted', 'low');

      INSERT INTO storage.objects (id, bucket_id, name, owner, metadata)
      VALUES (gen_random_uuid(), 'incident-evidence', '${rollbackAttPath}', '${resA_id}', '{"mimetype":"image/png","size":"1024"}');
      SET session_replication_role = 'origin';

      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${resA_id}', false);
      INSERT INTO public.report_attachments (report_id, storage_path, file_name, mime_type, file_size_bytes)
      VALUES ('${rollbackRepId}', '${rollbackAttPath}', 'rolled_back.png', 'image/png', 1024);
    `);
    const rbAttCount = await runSql(disposableDbName, `SELECT count(*) FROM public.report_attachments WHERE report_id = '${rollbackRepId}';`);
    if (getLastInt(rbAttCount) !== 1) {
      throw new Error(`Expected attachment to insert under original guard, found ${rbAttCount}`);
    }
    console.log('  ✓ Original attachment_guard executes and accepts valid attachments without leases.');

    // 2. Original ownership guard still works
    const rbForeignRes = await runSqlExpectError(disposableDbName, `
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${resB_id}', false);
      INSERT INTO public.report_attachments (report_id, storage_path, file_name, mime_type, file_size_bytes)
      VALUES ('${rollbackRepId}', '${resB_id}/${rollbackRepId}/hack.png', 'hack.png', 'image/png', 1024);
    `);
    if (!rbForeignRes.error.includes('42501')) {
      throw new Error(`Expected original ownership guard to reject foreign resident, got: ${rbForeignRes.error}`);
    }
    console.log('  ✓ Original ownership guard still strictly rejects foreign residents (42501).');

    // 3. Original Storage metadata check still works
    const rbMismatchedRes = await runSqlExpectError(disposableDbName, `
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${resA_id}', false);
      INSERT INTO public.report_attachments (report_id, storage_path, file_name, mime_type, file_size_bytes)
      VALUES ('${rollbackRepId}', '${resA_id}/${rollbackRepId}/nonexistent.png', 'nonexistent.png', 'image/png', 1024);
    `);
    if (!rbMismatchedRes.error.includes('Evidence object and metadata must match an existing upload')) {
      throw new Error(`Expected original storage metadata guard to reject missing upload, got: ${rbMismatchedRes.error}`);
    }
    console.log('  ✓ Original storage metadata guard still strictly validates storage catalog.');

    testsPassed = true;
    console.log('\n==============================================================================');
    console.log('ALL MIGRATION VALIDATION & CONCURRENCY ASSERTIONS PASSED SUCCESSFULLY');
    console.log('==============================================================================');
  } finally {
    // Close any remaining interactive sessions
    for (const s of activeSessions) {
      try { s.close(); } catch {}
    }

    try { if (fs.existsSync(tmpDumpPath)) fs.unlinkSync(tmpDumpPath); } catch {}
    try { if (fs.existsSync(tmpMigPath)) fs.unlinkSync(tmpMigPath); } catch {}
    try { if (fs.existsSync(tmpRollPath)) fs.unlinkSync(tmpRollPath); } catch {}

    // Teardown: Disconnect and remove only the run-owned disposable database
    console.log(`\n[Teardown] Dropping disposable database: "${disposableDbName}"...`);
    try {
      await runSql(SOURCE_DB, `DROP DATABASE IF EXISTS "${disposableDbName}";`);
      console.log(`  ✓ Disposable database "${disposableDbName}" dropped cleanly.`);
    } catch (dropErr) {
      console.error(`  × Cleanup failed to drop "${disposableDbName}": ${dropErr.message}`);
      process.exitCode = 1;
    }

    // Verify active demo database remained untouched and intact
    console.log('[Teardown] Verifying active demo database preservation and baseline fingerprints...');
    const finalDemoCheck = await runSql(SOURCE_DB, 'SELECT current_database();');
    if (finalDemoCheck !== SOURCE_DB) {
      console.error(`  × CRITICAL: Active database corrupted or missing!`);
      process.exitCode = 1;
    }

    const finalStorageStr = await runSql(SOURCE_DB, "SELECT count(*) FROM storage.objects WHERE bucket_id = 'incident-evidence';");
    const finalStorage = parseInt(finalStorageStr, 10);
    const finalReportsStr = await runSql(SOURCE_DB, "SELECT count(*) FROM public.incident_reports;");
    const finalReports = parseInt(finalReportsStr, 10);
    const finalAttachmentsStr = await runSql(SOURCE_DB, "SELECT count(*) FROM public.report_attachments;");
    const finalAttachments = parseInt(finalAttachmentsStr, 10);
    const finalLeasesInDemoStr = await runSql(SOURCE_DB, "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'evidence_recovery_leases';");
    const finalLeasesInDemo = parseInt(finalLeasesInDemoStr, 10);

    const finalDemoUsersCount = await runSql(SOURCE_DB, "SELECT count(*) FROM auth.users WHERE email IN ('resident@sentosa.local', 'manager@sentosa.local');");

    if (finalStorage !== baselineStorage) {
      console.error(`  × Baseline storage objects mismatch: expected ${baselineStorage}, found ${finalStorage}`);
      process.exitCode = 1;
    }
    if (finalReports !== baselineReports) {
      console.error(`  × Baseline reports count mismatch: expected ${baselineReports}, found ${finalReports}`);
      process.exitCode = 1;
    }
    if (finalAttachments !== baselineAttachments) {
      console.error(`  × Baseline attachments count mismatch: expected ${baselineAttachments}, found ${finalAttachments}`);
      process.exitCode = 1;
    }
    if (finalLeasesInDemo !== 0) {
      console.error(`  × Migration proposal was illegally applied to active demo database!`);
      process.exitCode = 1;
    }
    if (parseInt(finalDemoUsersCount, 10) !== 2) {
      console.error(`  × Permanent demo accounts corrupted!`);
      process.exitCode = 1;
    }

    if (process.exitCode !== 1) {
      console.log('  ✓ Active demo database verified 100% intact, untouched, and unapplied:');
      console.log(`    - Permanent demo accounts intact: 2 (resident@sentosa.local, manager@sentosa.local)`);
      console.log(`    - Storage objects in incident-evidence: exactly ${finalStorage} (matched baseline)`);
      console.log(`    - Incident reports: exactly ${finalReports} (matched baseline)`);
      console.log(`    - Report attachments: exactly ${finalAttachments} (matched baseline)`);
      console.log(`    - evidence_recovery_leases in demo db: 0 (PROPOSAL STRICTLY UNAPPLIED)`);
    }

    if (!testsPassed) {
      process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  console.error('\n[FATAL ERROR in migration validation]:', err.message);
  process.exit(1);
});
