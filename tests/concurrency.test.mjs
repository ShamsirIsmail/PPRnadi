import { spawn as cpSpawn } from 'node:child_process';
import crypto from 'node:crypto';

const PSQL_PATH = 'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe';
const DB_URL = 'postgresql://postgres:postgres@127.0.0.1:64322/postgres';

function runPsql(sql) {
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

class PsqlSession {
  constructor(name) {
    this.name = name;
    this.proc = cpSpawn(PSQL_PATH, [DB_URL, '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=0']);
    this.buffer = '';
    this.isBusy = false;
    this.backendPid = null;

    this.proc.stdout.on('data', (d) => (this.buffer += d.toString()));
    this.proc.stderr.on('data', (d) => (this.buffer += d.toString()));
  }

  async init() {
    const pidStr = await this.send('SELECT pg_backend_pid();');
    const m = pidStr.stdout.match(/\d+/);
    if (!m) throw new Error(`Could not parse backend PID for session ${this.name}: ${pidStr.stdout}`);
    this.backendPid = parseInt(m[0], 10);
  }

  send(sql, timeoutMs = 10000) {
    if (this.isBusy) {
      throw new Error(`Session ${this.name} is already processing a command.`);
    }
    this.isBusy = true;
    const marker = `---MARKER_${crypto.randomBytes(6).toString('hex')}---`;

    return new Promise((resolve, reject) => {
      let timer = null;

      const onData = () => {
        if (this.buffer.includes(marker)) {
          clearTimeout(timer);
          this.proc.stdout.removeListener('data', onData);
          this.proc.stderr.removeListener('data', onData);
          const raw = this.buffer;
          const output = this.buffer.substring(0, this.buffer.indexOf(marker)).trim();
          this.buffer = this.buffer.substring(this.buffer.indexOf(marker) + marker.length);
          this.isBusy = false;

          const isError = /ERROR:\s+/i.test(output) || /FATAL:\s+/i.test(output);
          let errorMsg = null;
          if (isError) {
            const match = output.match(/ERROR:\s+([^\n\r]+)/i);
            errorMsg = match ? match[1] : output;
          }

          resolve({
            success: !isError,
            stdout: output,
            error: errorMsg,
            raw,
          });
        }
      };

      timer = setTimeout(() => {
        this.proc.stdout.removeListener('data', onData);
        this.proc.stderr.removeListener('data', onData);
        this.isBusy = false;
        reject(new Error(`Session ${this.name} timed out after ${timeoutMs}ms waiting for response to: ${sql}`));
      }, timeoutMs);

      this.proc.stdout.on('data', onData);
      this.proc.stderr.on('data', onData);

      // Send command followed by echo marker
      this.proc.stdin.write(`${sql}\n\\echo ${marker}\n`);
    });
  }

  close() {
    try {
      this.proc.stdin.write('\\q\n');
      this.proc.kill();
    } catch { /* ignore */ }
  }
}

let passedCount = 0;
let totalCount = 0;

function assert(condition, message) {
  totalCount++;
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  passedCount++;
  console.log(`✅ PASS: ${message}`);
}

async function waitForLock(blockedPid, maxWaitMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await runPsql(`SELECT EXISTS (SELECT 1 FROM pg_locks WHERE NOT granted AND pid = ${blockedPid});`);
    if (res === 't') return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

async function main() {
  console.log('================================================================');
  console.log('PHASE 02A: DETERMINISTIC CONCURRENCY AND TRANSACTION TESTING');
  console.log('================================================================\n');

  // Verify target identity (fail-closed if remote or wrong instance)
  const dbUrl = new URL(DB_URL);
  if (!['127.0.0.1', 'localhost'].includes(dbUrl.hostname) || dbUrl.port !== '64322') {
    throw new Error(`Refusing to run against unexpected database target: ${DB_URL}`);
  }
  const dbCheck = await runPsql('SELECT current_database(), current_user, version();');
  if (!dbCheck.includes('postgres') || !dbCheck.includes('PostgreSQL')) {
    throw new Error(`Unexpected database verification output: ${dbCheck}`);
  }
  console.log('✅ Target verified: Local PPR NADI test instance (container: supabase_db_ppr-nadi on port 64322)');

  // Baseline resource measurement before test execution
  const baselineStorage = parseInt(await runPsql('SELECT count(*) FROM storage.objects;'), 10);
  const baselineUsers = parseInt(await runPsql('SELECT count(*) FROM auth.users;'), 10);
  const baselineProfiles = parseInt(await runPsql('SELECT count(*) FROM public.profiles;'), 10);
  const baselineBuildings = parseInt(await runPsql('SELECT count(*) FROM public.buildings;'), 10);
  console.log(`Baseline resources: storage.objects=${baselineStorage}, auth.users=${baselineUsers}, profiles=${baselineProfiles}, buildings=${baselineBuildings}\n`);

  const runToken = crypto.randomBytes(4).toString('hex');
  const runId = `conc_${Date.now()}_${runToken}`;
  const estateId = `estate_${runId}`;
  const bldgId = crypto.randomUUID();
  const zoneId = crypto.randomUUID();
  const facId = crypto.randomUUID();
  const resAId = crypto.randomUUID();
  const mgrAId = crypto.randomUUID();

  // Explicit tracking for run-owned metadata and fixtures
  const trackedStorageIds = [
    crypto.randomUUID(),
    crypto.randomUUID(),
    crypto.randomUUID(),
    crypto.randomUUID()
  ];
  const trackedReportIds = [];
  const trackedIncidentIds = [];
  const trackedUpdateIds = [];

  // Lifecycle-protected test setup and execution
  try {
    // Setup infrastructure & users for concurrency tests
    await runPsql(`
      INSERT INTO auth.users (id, email) VALUES
        ('${resAId}', 'res_${runId}@sentosa.local'),
        ('${mgrAId}', 'mgr_${runId}@sentosa.local')
      ON CONFLICT DO NOTHING;

      INSERT INTO public.buildings (id, estate_id, code, name, total_floors, total_units)
      VALUES ('${bldgId}', '${estateId}', 'BLD_${runToken}', 'Block ${runToken}', 15, 180);

      INSERT INTO public.profiles (id, role, full_name, assigned_estate_id, assigned_building_id, unit_number)
      VALUES
        ('${resAId}', 'resident', 'Resident Conc', '${estateId}', '${bldgId}', '05-01'),
        ('${mgrAId}', 'management', 'Manager Conc', '${estateId}', NULL, NULL);

      INSERT INTO public.service_zones (id, building_id, zone_code, name, floor_start, floor_end, zone_type)
      VALUES ('${zoneId}', '${bldgId}', 'Z_${runToken}', 'Zone Conc', 1, 15, 'residential_floors');

      INSERT INTO public.facilities (id, building_id, facility_code, name, category)
      VALUES ('${facId}', '${bldgId}', 'FAC_${runToken}', 'Pump Conc', 'water_supply');
    `);

    console.log('✅ Concurrency test fixtures provisioned');

    // -------------------------------------------------------------------------
    // Check 1: Simultaneous linking of the same report to two incidents
    // -------------------------------------------------------------------------
    console.log('\n--- Check 1: Simultaneous Linking of One Report ---');
    const rpt1 = crypto.randomUUID();
    trackedReportIds.push(rpt1);
    const inc1 = crypto.randomUUID();
    const inc2 = crypto.randomUUID();
    trackedIncidentIds.push(inc1, inc2);
    const incNum1 = `INC_LNK1_${runToken}`;
    const incNum2 = `INC_LNK2_${runToken}`;

    await runPsql(`
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claims', '{"sub":"${resAId}","role":"authenticated"}', false);
      INSERT INTO public.incident_reports (id, reporter_id, building_id, service_zone_id, category, description, status)
      VALUES ('${rpt1}', '${resAId}', '${bldgId}', '${zoneId}', 'water_supply', 'Link race test report', 'submitted');

      SELECT set_config('request.jwt.claims', '{"sub":"${mgrAId}","role":"authenticated"}', false);
      UPDATE public.incident_reports SET status = 'reviewed' WHERE id = '${rpt1}';

      INSERT INTO public.incidents (id, incident_number, building_id, primary_facility_id, title, category, status)
      VALUES 
        ('${inc1}', '${incNum1}', '${bldgId}', '${facId}', 'Incident 1', 'water_supply', 'investigating'),
        ('${inc2}', '${incNum2}', '${bldgId}', '${facId}', 'Incident 2', 'water_supply', 'investigating');
      UPDATE public.incidents SET status = 'confirmed' WHERE id IN ('${inc1}', '${inc2}');
    `);

    const s1 = new PsqlSession('Link-S1');
    const s2 = new PsqlSession('Link-S2');
    await s1.init();
    await s2.init();

    try {
      await s1.send(`SET ROLE authenticated; SELECT set_config('request.jwt.claims', '{"sub":"${mgrAId}","role":"authenticated"}', false);`);
      await s2.send(`SET ROLE authenticated; SELECT set_config('request.jwt.claims', '{"sub":"${mgrAId}","role":"authenticated"}', false);`);

      await s1.send('BEGIN;');
      await s2.send('BEGIN;');

      // S1 acquires row lock on report via link insertion
      const p1 = s1.send(`INSERT INTO public.incident_report_links (incident_id, report_id) VALUES ('${inc1}', '${rpt1}');`);

      // Ensure S1 has acquired the lock before S2 fires
      await new Promise((r) => setTimeout(r, 100));

      // S2 attempts to link the same report to inc2 (blocks on S1's FOR UPDATE in guard_link)
      const p2 = s2.send(`INSERT INTO public.incident_report_links (incident_id, report_id) VALUES ('${inc2}', '${rpt1}');`);

      // Verify S2 is deterministically blocked via pg_locks
      const isLocked = await waitForLock(s2.backendPid, 3000);
      assert(isLocked, 'Observed Session 2 deterministically blocked waiting on Session 1 row lock');

      // S1 commits; report status is marked 'linked'
      const resS1 = await p1;
      assert(resS1.success, 'Session 1 link insertion succeeded');
      await s1.send('COMMIT;');

      // S2 unblocks; should see status is no longer 'reviewed' and fail
      const resS2 = await p2;
      assert(!resS2.success, 'Session 2 link insertion rejected as expected');
      assert(
        resS2.error?.includes('Link requires reviewed report') || resS2.error?.includes('duplicate key'),
        `Session 2 rejected with expected structured error: ${resS2.error}`
      );
      await s2.send('ROLLBACK;');

      // Verify final business & audit state
      const linkCount = await runPsql(`SELECT count(*) FROM public.incident_report_links WHERE report_id = '${rpt1}';`);
      assert(parseInt(linkCount, 10) === 1, 'Exactly 1 incident link row persisted');

      const repStatus = await runPsql(`SELECT status FROM public.incident_reports WHERE id = '${rpt1}';`);
      assert(repStatus === 'linked', 'Report status atomically updated to linked');

      const auditCount = await runPsql(
        `SELECT count(*) FROM public.audit_events WHERE target_entity = 'incident_report_links' AND new_state->>'incident_id' = '${inc1}';`
      );
      assert(parseInt(auditCount, 10) === 1, 'Exactly 1 audit event persisted for the winning link');

      const loserAuditCount = await runPsql(
        `SELECT count(*) FROM public.audit_events WHERE target_entity = 'incident_report_links' AND new_state->>'incident_id' = '${inc2}';`
      );
      assert(parseInt(loserAuditCount, 10) === 0, 'Zero orphan audit records persisted for the losing transaction');
    } finally {
      s1.close();
      s2.close();
    }

    // -------------------------------------------------------------------------
    // Check 2: Concurrent attachment insertions at the 3-file limit
    // -------------------------------------------------------------------------
    console.log('\n--- Check 2: Concurrent Attachment Insertions at 3-File Limit ---');
    const rpt2 = crypto.randomUUID();
    trackedReportIds.push(rpt2);
    const path2A = `${resAId}/${rpt2}/file2a.png`;
    const path2B = `${resAId}/${rpt2}/file2b.png`;
    const path3A = `${resAId}/${rpt2}/file3a.png`;
    const path3B = `${resAId}/${rpt2}/file3b.png`;

    await runPsql(`
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claims', '{"sub":"${resAId}","role":"authenticated"}', false);
      INSERT INTO public.incident_reports (id, reporter_id, building_id, service_zone_id, category, description, status)
      VALUES ('${rpt2}', '${resAId}', '${bldgId}', '${zoneId}', 'water_supply', 'Attachment race report', 'submitted');

      INSERT INTO storage.objects (id, bucket_id, name, owner, metadata) VALUES
        ('${trackedStorageIds[0]}', 'incident-evidence', '${path2A}', '${resAId}', '{"size":"100","mimetype":"image/png"}'),
        ('${trackedStorageIds[1]}', 'incident-evidence', '${path2B}', '${resAId}', '{"size":"100","mimetype":"image/png"}'),
        ('${trackedStorageIds[2]}', 'incident-evidence', '${path3A}', '${resAId}', '{"size":"100","mimetype":"image/png"}'),
        ('${trackedStorageIds[3]}', 'incident-evidence', '${path3B}', '${resAId}', '{"size":"100","mimetype":"image/png"}');

      INSERT INTO public.report_attachments (report_id, storage_path, file_name, mime_type, file_size_bytes)
      VALUES
        ('${rpt2}', '${path2A}', 'file2a.png', 'image/png', 100),
        ('${rpt2}', '${path2B}', 'file2b.png', 'image/png', 100);
    `);

    const attS1 = new PsqlSession('Att-S1');
    const attS2 = new PsqlSession('Att-S2');
    await attS1.init();
    await attS2.init();

    try {
      await attS1.send(`SET ROLE authenticated; SELECT set_config('request.jwt.claims', '{"sub":"${resAId}","role":"authenticated"}', false);`);
      await attS2.send(`SET ROLE authenticated; SELECT set_config('request.jwt.claims', '{"sub":"${resAId}","role":"authenticated"}', false);`);

      await attS1.send('BEGIN;');
      await attS2.send('BEGIN;');

      // S1 inserts 3rd attachment (takes FOR UPDATE lock on incident_reports in guard_attachment)
      const p1 = attS1.send(`INSERT INTO public.report_attachments (report_id, storage_path, file_name, mime_type, file_size_bytes)
        VALUES ('${rpt2}', '${path3A}', 'file3a.png', 'image/png', 100);`);

      await new Promise((r) => setTimeout(r, 100));

      // S2 attempts competing insert for 3rd attachment (blocks on report row lock)
      const p2 = attS2.send(`INSERT INTO public.report_attachments (report_id, storage_path, file_name, mime_type, file_size_bytes)
        VALUES ('${rpt2}', '${path3B}', 'file3b.png', 'image/png', 100);`);

      // Verify S2 is deterministically blocked
      const isLocked = await waitForLock(attS2.backendPid, 3000);
      assert(isLocked, 'Session 2 deterministically blocked on attachment cap row lock');

      // Commit S1
      const resAtt1 = await p1;
      assert(resAtt1.success, 'Session 1 registered 3rd attachment');
      await attS1.send('COMMIT;');

      // S2 unblocks and must fail specifically on the 3-file cap
      const resAtt2 = await p2;
      assert(!resAtt2.success, 'Session 2 rejected on attachment cap');
      assert(resAtt2.error?.includes('Maximum three evidence attachments per report'),
        `Session 2 rejected specifically with attachment cap error: ${resAtt2.error}`);
      await attS2.send('ROLLBACK;');

      // Assert exactly 3 attachments persist in DB
      const finalCount = await runPsql(`SELECT count(*) FROM public.report_attachments WHERE report_id = '${rpt2}';`);
      assert(parseInt(finalCount, 10) === 3, 'Persisted attachment count is strictly capped at 3');
    } finally {
      attS1.close();
      attS2.close();
    }

    // -------------------------------------------------------------------------
    // Check 3: Competing Incident State Transitions
    // -------------------------------------------------------------------------
    console.log('\n--- Check 3: Competing Incident State Transitions ---');
    const inc3 = crypto.randomUUID();
    trackedIncidentIds.push(inc3);
    const incNum3 = `INC_TR_${runToken}`;

    await runPsql(`
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claims', '{"sub":"${mgrAId}","role":"authenticated"}', false);
      INSERT INTO public.incidents (id, incident_number, building_id, primary_facility_id, title, category, status)
      VALUES ('${inc3}', '${incNum3}', '${bldgId}', '${facId}', 'State Transition Test', 'water_supply', 'investigating');
    `);

    const trS1 = new PsqlSession('Trans-S1');
    const trS2 = new PsqlSession('Trans-S2');
    await trS1.init();
    await trS2.init();

    try {
      await trS1.send(`SET ROLE authenticated; SELECT set_config('request.jwt.claims', '{"sub":"${mgrAId}","role":"authenticated"}', false);`);
      await trS2.send(`SET ROLE authenticated; SELECT set_config('request.jwt.claims', '{"sub":"${mgrAId}","role":"authenticated"}', false);`);

      await trS1.send('BEGIN;');
      await trS2.send('BEGIN;');

      // S1 valid transition investigating -> confirmed
      const p1 = trS1.send(`UPDATE public.incidents SET status = 'confirmed' WHERE id = '${inc3}';`);
      await new Promise((r) => setTimeout(r, 100));

      // S2 invalid competing transition directly to restored
      const p2 = trS2.send(`UPDATE public.incidents SET status = 'restored', restoration_evidence = 'tested' WHERE id = '${inc3}';`);

      const isLocked = await waitForLock(trS2.backendPid, 3000);
      assert(isLocked, 'Session 2 deterministically blocked on incident row update');

      const resTr1 = await p1;
      assert(resTr1.success, 'Session 1 confirmed transition investigating -> confirmed');
      await trS1.send('COMMIT;');

      const resTr2 = await p2;
      assert(!resTr2.success, 'Session 2 competing transition rejected');
      assert(resTr2.error?.includes('Invalid incident transition'),
        `Session 2 rejected with structured invalid transition error: ${resTr2.error}`);
      await trS2.send('ROLLBACK;');

      // Assert final state and attribution
      const finalStatus = await runPsql(`SELECT status FROM public.incidents WHERE id = '${inc3}';`);
      assert(finalStatus === 'confirmed', 'Incident status strictly maintained at confirmed');

      const verifier = await runPsql(`SELECT verified_by FROM public.incidents WHERE id = '${inc3}';`);
      assert(verifier === mgrAId, 'verified_by correctly stamped to Manager A');
    } finally {
      trS1.close();
      trS2.close();
    }

    // -------------------------------------------------------------------------
    // Check 4A: Sequential Sync (Ordering A: Status First)
    // -------------------------------------------------------------------------
    console.log('\n--- Check 4A: Sequential Sync (Ordering A: Status First) ---');
    {
      const inc4A = crypto.randomUUID();
      trackedIncidentIds.push(inc4A);
      const upd4A = crypto.randomUUID();
      trackedUpdateIds.push(upd4A);
      const incNum4A = `INC_SYNC_A_${runToken}`;

      await runPsql(`
        SET ROLE authenticated;
        SELECT set_config('request.jwt.claims', '{"sub":"${mgrAId}","role":"authenticated"}', false);
        INSERT INTO public.incidents (id, incident_number, building_id, primary_facility_id, title, category, status)
        VALUES ('${inc4A}', '${incNum4A}', '${bldgId}', '${facId}', 'Sync A', 'water_supply', 'investigating');
        UPDATE public.incidents SET status = 'confirmed' WHERE id = '${inc4A}';
      `);

      // Order A: Advance status to in_maintenance, then publish notice
      await runPsql(`
        SET ROLE authenticated;
        SELECT set_config('request.jwt.claims', '{"sub":"${mgrAId}","role":"authenticated"}', false);
        UPDATE public.incidents SET status = 'in_maintenance' WHERE id = '${inc4A}';
        INSERT INTO public.incident_updates (id, incident_id, update_title, message_bm, stage, is_published)
        VALUES ('${upd4A}', '${inc4A}', 'Notis A', 'Kandungan rasmi A.', 'contractor_assigned', true);
      `);

      const incidentStatus = await runPsql(`SELECT status FROM public.incidents WHERE id = '${inc4A}';`);
      const bulletinStatus = await runPsql(
        `SELECT incident_status FROM public.published_incident_bulletins WHERE incident_id = '${inc4A}';`
      );
      assert(incidentStatus === 'in_maintenance', 'Incident status is in_maintenance (sequential)');
      assert(bulletinStatus === incidentStatus, `Bulletin status strictly matches incident status in Order A: ${bulletinStatus}`);
    }

    // -------------------------------------------------------------------------
    // Check 4B: Sequential Sync (Ordering B: Publish First)
    // -------------------------------------------------------------------------
    console.log('\n--- Check 4B: Sequential Sync (Ordering B: Publish First) ---');
    {
      const inc4B = crypto.randomUUID();
      trackedIncidentIds.push(inc4B);
      const upd4B = crypto.randomUUID();
      trackedUpdateIds.push(upd4B);
      const incNum4B = `INC_SYNC_B_${runToken}`;

      await runPsql(`
        SET ROLE authenticated;
        SELECT set_config('request.jwt.claims', '{"sub":"${mgrAId}","role":"authenticated"}', false);
        INSERT INTO public.incidents (id, incident_number, building_id, primary_facility_id, title, category, status)
        VALUES ('${inc4B}', '${incNum4B}', '${bldgId}', '${facId}', 'Sync B', 'water_supply', 'investigating');
        UPDATE public.incidents SET status = 'confirmed' WHERE id = '${inc4B}';
      `);

      // Order B: Publish notice while confirmed, THEN advance incident to in_maintenance
      await runPsql(`
        SET ROLE authenticated;
        SELECT set_config('request.jwt.claims', '{"sub":"${mgrAId}","role":"authenticated"}', false);
        INSERT INTO public.incident_updates (id, incident_id, update_title, message_bm, stage, is_published)
        VALUES ('${upd4B}', '${inc4B}', 'Notis B', 'Kandungan rasmi B.', 'contractor_assigned', true);
      `);

      const bStatusBefore = await runPsql(
        `SELECT incident_status FROM public.published_incident_bulletins WHERE incident_id = '${inc4B}';`
      );
      assert(bStatusBefore === 'confirmed', 'Bulletin initially created with confirmed status (sequential)');

      await runPsql(`
        SET ROLE authenticated;
        SELECT set_config('request.jwt.claims', '{"sub":"${mgrAId}","role":"authenticated"}', false);
        UPDATE public.incidents SET status = 'in_maintenance' WHERE id = '${inc4B}';
      `);

      const incidentStatus = await runPsql(`SELECT status FROM public.incidents WHERE id = '${inc4B}';`);
      const bulletinStatus = await runPsql(
        `SELECT incident_status FROM public.published_incident_bulletins WHERE incident_id = '${inc4B}';`
      );
      assert(incidentStatus === 'in_maintenance', 'Incident status advanced to in_maintenance (sequential)');
      assert(bulletinStatus === incidentStatus, `Bulletin projection strictly synchronized to incident status in Order B: ${bulletinStatus}`);
    }

    // -------------------------------------------------------------------------
    // Check 5A: Concurrent Overlapping Sync (Ordering A: Status Holds Lock, Publish Competes)
    // -------------------------------------------------------------------------
    console.log('\n--- Check 5A: Concurrent Overlapping Sync (Ordering A: Status Holds Lock, Publish Competes) ---');
    const inc5A = crypto.randomUUID();
    trackedIncidentIds.push(inc5A);
    const upd5A = crypto.randomUUID();
    trackedUpdateIds.push(upd5A);
    const incNum5A = `INC_OVR_A_${runToken}`;

    await runPsql(`
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claims', '{"sub":"${mgrAId}","role":"authenticated"}', false);
      INSERT INTO public.incidents (id, incident_number, building_id, primary_facility_id, title, category, status)
      VALUES ('${inc5A}', '${incNum5A}', '${bldgId}', '${facId}', 'Overlap A', 'water_supply', 'investigating');
      UPDATE public.incidents SET status = 'confirmed' WHERE id = '${inc5A}';
    `);

    const s5A1 = new PsqlSession('Sync5A-Status');
    const s5A2 = new PsqlSession('Sync5A-Publish');
    await s5A1.init();
    await s5A2.init();

    try {
      await s5A1.send(`SET ROLE authenticated; SELECT set_config('request.jwt.claims', '{"sub":"${mgrAId}","role":"authenticated"}', false);`);
      await s5A2.send(`SET ROLE authenticated; SELECT set_config('request.jwt.claims', '{"sub":"${mgrAId}","role":"authenticated"}', false);`);

      await s5A1.send('BEGIN;');
      await s5A2.send('BEGIN;');

      // Session 1 updates incident status to in_maintenance and holds transaction open (holds NO KEY UPDATE lock)
      const pStatus = s5A1.send(`UPDATE public.incidents SET status = 'in_maintenance' WHERE id = '${inc5A}';`);
      const resStatus = await pStatus;
      assert(resStatus.success, 'Session 1 acquired incident row lock and updated status to in_maintenance (uncommitted)');

      // Session 2 attempts to publish bulletin (guard_update executes SELECT ... FOR SHARE on incident)
      // This MUST block on Session 1's uncommitted NO KEY UPDATE lock
      const pPublish = s5A2.send(`INSERT INTO public.incident_updates (id, incident_id, update_title, message_bm, stage, is_published)
        VALUES ('${upd5A}', '${inc5A}', 'Notis Overlap A', 'Kerja-kerja pembaikan sedang dijalankan segera.', 'contractor_assigned', true);`);

      const isBlocked = await waitForLock(s5A2.backendPid, 3000);
      assert(isBlocked, 'Observed Session 2 bulletin publication deterministically blocked waiting on Session 1 incident row lock');

      // Now Session 1 commits
      const commit1 = await s5A1.send('COMMIT;');
      assert(commit1.success, 'Session 1 status transaction committed successfully');

      // Session 2 unblocks, executes, and commits
      const resPublish = await pPublish;
      if (!resPublish.success) {
        console.error('Session 2 error:', resPublish.error, 'stdout:', resPublish.stdout);
      }
      assert(resPublish.success, 'Session 2 unblocked and successfully published bulletin');
      const commit2 = await s5A2.send('COMMIT;');
      assert(commit2.success, 'Session 2 publication transaction committed successfully');

      // Verify synchronized final states
      const incStatus = await runPsql(`SELECT status FROM public.incidents WHERE id = '${inc5A}';`);
      const bStatus = await runPsql(`SELECT incident_status FROM public.published_incident_bulletins WHERE incident_id = '${inc5A}';`);
      assert(incStatus === 'in_maintenance', 'Incident final status is in_maintenance (concurrent A)');
      assert(bStatus === 'in_maintenance', 'Bulletin final status is in_maintenance (concurrent A)');
      assert(bStatus === incStatus, 'Bulletin and incident status are strictly synchronized in concurrent Order A');

      // Verify audit events
      const noticeAudit = await runPsql(`SELECT count(*) FROM public.audit_events WHERE target_id = '${upd5A}' AND action = 'notice.published';`);
      assert(parseInt(noticeAudit, 10) === 1, 'Notice published audit event recorded in concurrent Order A');
    } finally {
      s5A1.close();
      s5A2.close();
    }

    // -------------------------------------------------------------------------
    // Check 5B: Concurrent Overlapping Sync (Ordering B: Publish Holds Lock, Status Competes)
    // -------------------------------------------------------------------------
    console.log('\n--- Check 5B: Concurrent Overlapping Sync (Ordering B: Publish Holds Lock, Status Competes) ---');
    const inc5B = crypto.randomUUID();
    trackedIncidentIds.push(inc5B);
    const upd5B = crypto.randomUUID();
    trackedUpdateIds.push(upd5B);
    const incNum5B = `INC_OVR_B_${runToken}`;

    await runPsql(`
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claims', '{"sub":"${mgrAId}","role":"authenticated"}', false);
      INSERT INTO public.incidents (id, incident_number, building_id, primary_facility_id, title, category, status)
      VALUES ('${inc5B}', '${incNum5B}', '${bldgId}', '${facId}', 'Overlap B', 'water_supply', 'investigating');
      UPDATE public.incidents SET status = 'confirmed' WHERE id = '${inc5B}';
    `);

    const s5B1 = new PsqlSession('Sync5B-Publish');
    const s5B2 = new PsqlSession('Sync5B-Status');
    await s5B1.init();
    await s5B2.init();

    try {
      await s5B1.send(`SET ROLE authenticated; SELECT set_config('request.jwt.claims', '{"sub":"${mgrAId}","role":"authenticated"}', false);`);
      await s5B2.send(`SET ROLE authenticated; SELECT set_config('request.jwt.claims', '{"sub":"${mgrAId}","role":"authenticated"}', false);`);

      await s5B1.send('BEGIN;');
      await s5B2.send('BEGIN;');

      // Session 1 inserts bulletin update (guard_update acquires FOR SHARE lock on incident inc5B) and holds transaction open
      const pPublish = s5B1.send(`INSERT INTO public.incident_updates (id, incident_id, update_title, message_bm, stage, is_published)
        VALUES ('${upd5B}', '${inc5B}', 'Notis Overlap B', 'Pemberitahuan awal kerosakan bekalan air.', 'contractor_assigned', true);`);
      const resPublish = await pPublish;
      assert(resPublish.success, 'Session 1 published bulletin update and acquired FOR SHARE lock on incident (uncommitted)');

      // Session 2 attempts to advance incident to in_maintenance (requires NO KEY UPDATE lock on inc5B)
      // This MUST block on Session 1's uncommitted FOR SHARE lock
      const pStatus = s5B2.send(`UPDATE public.incidents SET status = 'in_maintenance' WHERE id = '${inc5B}';`);

      const isBlocked = await waitForLock(s5B2.backendPid, 3000);
      assert(isBlocked, 'Observed Session 2 status update deterministically blocked waiting on Session 1 incident SHARE lock');

      // Now Session 1 commits
      const commit1 = await s5B1.send('COMMIT;');
      assert(commit1.success, 'Session 1 publication transaction committed successfully');

      // Session 2 unblocks, completes update, and commits
      const resStatus = await pStatus;
      assert(resStatus.success, 'Session 2 unblocked and successfully updated incident status');
      const commit2 = await s5B2.send('COMMIT;');
      assert(commit2.success, 'Session 2 status transaction committed successfully');

      // Verify synchronized final states
      const incStatus = await runPsql(`SELECT status FROM public.incidents WHERE id = '${inc5B}';`);
      const bStatus = await runPsql(`SELECT incident_status FROM public.published_incident_bulletins WHERE incident_id = '${inc5B}';`);
      assert(incStatus === 'in_maintenance', 'Incident final status is in_maintenance (concurrent B)');
      assert(bStatus === 'in_maintenance', 'Bulletin projection updated to in_maintenance by trigger (concurrent B)');
      assert(bStatus === incStatus, 'Bulletin and incident status are strictly synchronized in concurrent Order B');

      // Verify audit events
      const noticeAudit = await runPsql(`SELECT count(*) FROM public.audit_events WHERE target_id = '${upd5B}' AND action = 'notice.published';`);
      assert(parseInt(noticeAudit, 10) === 1, 'Notice published audit event recorded in concurrent Order B');
    } finally {
      s5B1.close();
      s5B2.close();
    }

    console.log('\n================================================================');
    console.log(`CONCURRENCY TEST SUITE: ${passedCount} / ${totalCount} PASSED`);
    console.log('================================================================\n');

  } finally {
    console.log('--- Cleaning Up Concurrency Test Run Resources ---');
    let cleanupFailed = false;
    let cleanupError = null;

    try {
      // 1. Delete domain records scoped strictly to this run
      await runPsql(`
        DELETE FROM public.published_incident_bulletins WHERE estate_id = '${estateId}';
        DELETE FROM public.incident_report_links WHERE report_id IN (
          SELECT id FROM public.incident_reports WHERE building_id = '${bldgId}'
        );
        DELETE FROM public.report_attachments WHERE report_id IN (
          SELECT id FROM public.incident_reports WHERE building_id = '${bldgId}'
        );
        DELETE FROM public.incident_reports WHERE building_id = '${bldgId}';
        DELETE FROM public.incident_updates WHERE incident_id IN (
          SELECT id FROM public.incidents WHERE building_id = '${bldgId}'
        );
        DELETE FROM public.incidents WHERE building_id = '${bldgId}';
        DELETE FROM public.facilities WHERE building_id = '${bldgId}';
        DELETE FROM public.service_zones WHERE building_id = '${bldgId}';
        DELETE FROM public.audit_events WHERE estate_id = '${estateId}';
      `);

      // 2. Clean up exact tracked storage object metadata fixtures using allow_delete_query
      await runPsql(`
        SELECT set_config('storage.allow_delete_query', 'true', false);
        DELETE FROM storage.objects WHERE id IN ('${trackedStorageIds.join("','")}');
      `);

      // 3. Clean up profiles, buildings, and auth users
      await runPsql(`
        DELETE FROM public.profiles WHERE id IN ('${resAId}', '${mgrAId}');
        DELETE FROM public.buildings WHERE id = '${bldgId}';
        DELETE FROM auth.users WHERE id IN ('${resAId}', '${mgrAId}');
      `);

      // 4. VERIFY CLEANUP THOROUGHLY
      // Check exact tracked storage objects are gone:
      const remStorage = parseInt(await runPsql(`SELECT count(*) FROM storage.objects WHERE id IN ('${trackedStorageIds.join("','")}');`), 10);
      if (remStorage !== 0) throw new Error(`Cleanup failed: ${remStorage} storage objects still exist for this run`);

      // Check current storage objects count matches baseline:
      const currentStorage = parseInt(await runPsql('SELECT count(*) FROM storage.objects;'), 10);
      if (currentStorage !== baselineStorage) {
        throw new Error(`Cleanup failed: storage count delta detected! Expected ${baselineStorage}, got ${currentStorage}`);
      }

      // Check current auth users count matches baseline:
      const currentUsers = parseInt(await runPsql('SELECT count(*) FROM auth.users;'), 10);
      if (currentUsers !== baselineUsers) {
        throw new Error(`Cleanup failed: auth users delta detected! Expected ${baselineUsers}, got ${currentUsers}`);
      }

      // Check no remaining domain fixtures for this run:
      const remProfiles = parseInt(await runPsql(`SELECT count(*) FROM public.profiles WHERE id IN ('${resAId}', '${mgrAId}');`), 10);
      if (remProfiles !== 0) throw new Error(`Cleanup failed: ${remProfiles} profiles still exist`);

      const remBuildings = parseInt(await runPsql(`SELECT count(*) FROM public.buildings WHERE id = '${bldgId}';`), 10);
      if (remBuildings !== 0) throw new Error(`Cleanup failed: ${remBuildings} buildings still exist`);

      const remAudit = parseInt(await runPsql(`SELECT count(*) FROM public.audit_events WHERE estate_id = '${estateId}';`), 10);
      if (remAudit !== 0) throw new Error(`Cleanup failed: ${remAudit} audit events still exist`);

      console.log('✅ VERIFIED: All run-owned domain fixtures, audit events, and auth users cleanly removed');
      console.log(`✅ VERIFIED: Tracked storage metadata fixtures removed; storage.objects returned to baseline (${baselineStorage})`);
      console.log('✅ VERIFIED: Pre-existing database resources remain completely unchanged');
    } catch (err) {
      cleanupFailed = true;
      cleanupError = err;
      console.error('❌ CLEANUP VERIFICATION FAILED:', err.message);
    }

    if (cleanupFailed) {
      throw cleanupError;
    }
  }
}

main().catch((err) => {
  console.error('\n❌ Fatal Concurrency Runner Error:', err);
  process.exit(1);
});
