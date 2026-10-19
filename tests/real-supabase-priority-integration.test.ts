import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { spawn as cpSpawn } from 'node:child_process';
import crypto from 'node:crypto';
import { createServerClient } from '@supabase/ssr';
import { testSessionStorage, type CookieAdapter } from '@/lib/supabase/server';
import {
  evaluateReportPriorityAction,
  confirmPriorityDecisionAction,
  getPriorityDataAction,
} from '@/app/actions/priority';

try {
  process.loadEnvFile('.env.local');
} catch {
  // env loaded
}

const API_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:64321';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:64322/postgres';
const PSQL_PATH = 'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe';

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

class PsqlSession {
  private proc: ReturnType<typeof cpSpawn>;
  private buffer: string = '';
  private waitingResolve: ((val: string) => void) | null = null;
  private waitingReject: ((err: Error) => void) | null = null;

  constructor() {
    this.proc = cpSpawn(PSQL_PATH, [DB_URL, '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A']);
    this.proc.stdout?.on('data', (d) => {
      this.buffer += d.toString();
      if (this.waitingResolve && this.buffer.includes('__SENTINEL__')) {
        const parts = this.buffer.split('__SENTINEL__');
        const out = parts[0].trim();
        this.buffer = parts.slice(1).join('__SENTINEL__');
        const resolve = this.waitingResolve;
        this.waitingResolve = null;
        this.waitingReject = null;
        resolve(out);
      }
    });
    this.proc.stderr?.on('data', (d) => {
      const errStr = d.toString();
      if (this.waitingReject) {
        const reject = this.waitingReject;
        this.waitingResolve = null;
        this.waitingReject = null;
        reject(new Error(errStr));
      }
    });
  }

  query(sql: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.waitingResolve = resolve;
      this.waitingReject = reject;
      this.proc.stdin?.write(sql.trim() + "\nSELECT '__SENTINEL__';\n");
    });
  }

  async close() {
    try {
      this.proc.stdin?.write('\\q\n');
      this.proc.kill();
    } catch {
      // closed
    }
  }
}

// Spy / mock only extractReportFacts to simulate AI provider without paid Gemini calls or production fallbacks
const extractSpy = vi.fn().mockImplementation(async (description: string, category: string, count: number) => {
  const isLiftEmergency = category === 'lift' && description.toLowerCase().includes('terperangkap');
  return {
    success: true,
    aiModel: 'synthetic-test-gemini-mock',
    aiProvider: 'test-harness-synthetic',
    facts: {
      issueType: isLiftEmergency ? 'Lif rosak dengan penumpang terperangkap' : 'Kerosakan fasiliti',
      safety: {
        hasHazard: isLiftEmergency,
        isNegated: false,
        isPastResolved: false,
        isUncertain: false,
        hazardQuote: isLiftEmergency ? 'terperangkap' : null,
      },
      location: {
        mentionedBlock: 'Blok A',
        mentionedFloor: 'Tingkat 3',
        specificLocation: 'Lif Blok A',
      },
      urgencyClues: isLiftEmergency ? ['Kecemasan', 'Terperangkap'] : ['Pemeriksaan'],
      affectedCountAssessment: count > 1 ? `Disahkan berkait dengan ${count} aduan` : 'Aduan tunggal',
      unknowns: ['Status ketibaan juruteknik'],
    },
  };
});

vi.mock('@/lib/priority/extractor', async () => {
  const actual = await vi.importActual<typeof import('@/lib/priority/extractor')>('@/lib/priority/extractor');
  return {
    ...actual,
    extractReportFacts: (...args: unknown[]) => extractSpy(...args),
  };
});

interface UserSession {
  id: string;
  email: string;
  cookieJar: Map<string, string>;
  cookieAdapter: CookieAdapter;
  client: ReturnType<typeof createServerClient>;
}

async function loginUser(email: string, password: string): Promise<UserSession> {
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
    password,
  });

  if (authError || !authData.user) {
    throw new Error(`Login failed for ${email}: ${authError?.message}`);
  }

  return {
    id: authData.user.id,
    email,
    cookieJar,
    cookieAdapter,
    client,
  };
}

describe('PPR NADI — Real Supabase Priority Security & Durability Integration', () => {
  let mgrSentosa: UserSession;
  let resSentosa: UserSession;
  let mgrOtherEstate: UserSession;
  let sentosaBldgA: string;
  let sentosaZoneLow: string;

  const testReportIds: string[] = [];
  const testIncidentIds: string[] = [];

  beforeAll(async () => {
    // 1. Verify DB is real local Postgres on 64322
    const dbName = await runPsql('SELECT current_database();');
    expect(dbName).toContain('postgres');

    // 2. Resolve Blok A and Zone in PPR Sentosa
    const bldgRes = await runPsql("SELECT id FROM public.buildings WHERE estate_id = 'ppr-sentosa-demo' AND code = 'BLK_A' LIMIT 1;");
    expect(bldgRes).toBeTruthy();
    sentosaBldgA = bldgRes;

    const zoneRes = await runPsql(`SELECT id FROM public.service_zones WHERE building_id = '${sentosaBldgA}' LIMIT 1;`);
    sentosaZoneLow = zoneRes;

    // 3. Authenticate real users via Supabase Auth using environment variables
    const mgrPassword = process.env.DEMO_MANAGER_PASSWORD;
    if (!mgrPassword) {
      throw new Error('DEMO_MANAGER_PASSWORD environment variable is required.');
    }
    const resPassword = process.env.DEMO_RESIDENT_PASSWORD;
    if (!resPassword) {
      throw new Error('DEMO_RESIDENT_PASSWORD environment variable is required.');
    }

    mgrSentosa = await loginUser('manager@sentosa.local', mgrPassword);
    resSentosa = await loginUser('resident@sentosa.local', resPassword);
    mgrOtherEstate = await loginUser('manager.other@lestari.local', mgrPassword);
  });

  afterAll(async () => {
    // Clean up created test reports and cascade decisions / evaluations
    await runPsql(`
      SET session_replication_role = replica;
      ${testReportIds.map((id) => `DELETE FROM public.incident_reports WHERE id = '${id}';`).join('\n')}
      ${testIncidentIds.map((id) => `DELETE FROM public.incidents WHERE id = '${id}';`).join('\n')}
    `);
  });

  // Helper to create real report in Supabase
  async function createRealReport(desc: string, category = 'lift'): Promise<string> {
    const repId = crypto.randomUUID();
    await runPsql(`
      SET session_replication_role = replica;
      INSERT INTO public.incident_reports (id, reporter_id, building_id, service_zone_id, category, description, status, urgency_hint)
      VALUES ('${repId}', '${resSentosa.id}', '${sentosaBldgA}', '${sentosaZoneLow}', '${category}', '${desc}', 'submitted', 'high');
    `);
    testReportIds.push(repId);
    return repId;
  }

  // Helper to create real incident in Supabase
  async function createRealIncident(title: string, category = 'lift'): Promise<string> {
    const incId = crypto.randomUUID();
    await runPsql(`
      SET session_replication_role = replica;
      INSERT INTO public.incidents (id, incident_number, building_id, title, category, status, severity, verified_at)
      VALUES ('${incId}', 'INC-TEST-${Date.now()}-${Math.floor(Math.random() * 1000)}', '${sentosaBldgA}', '${title}', '${category}', 'confirmed', 'major', now());
    `);
    testIncidentIds.push(incId);
    return incId;
  }

  // =========================================================================
  // 1. DIRECT WRITE PROTECTION (Audit Grants & RLS)
  // =========================================================================
  describe('1. Direct Write Protection: Hentikan INSERT terus yang memintas RPC', () => {
    it('strictly denies direct INSERT from manager session into report_priority_decisions', async () => {
      const repId = await createRealReport('[TEST-DIRECT-INSERT-DENIED] Percubaan insert terus');

      // Attempt direct client table insert
      const { data, error } = await mgrSentosa.client
        .from('report_priority_decisions')
        .insert({
          id: crypto.randomUUID(),
          report_id: repId,
          decided_priority: 'immediate_review',
          decided_by: mgrSentosa.id,
          decision_version: 1,
          idempotency_key: crypto.randomUUID(),
        })
        .select('*');

      expect(data).toBeNull();
      expect(error).toBeDefined();
      expect(error?.message).toMatch(/permission denied for table report_priority_decisions/i);
    });

    it('strictly denies direct INSERT from manager session into report_priority_evaluations', async () => {
      const repId = await createRealReport('[TEST-DIRECT-INSERT-EVAL-DENIED] Percubaan insert terus evaluation');

      const { data, error } = await mgrSentosa.client
        .from('report_priority_evaluations')
        .insert({
          id: crypto.randomUUID(),
          report_id: repId,
          input_fingerprint: 'fake-fingerprint',
          policy_version: '2026.1',
          ai_model: 'fake-model',
          ai_provider: 'fake-provider',
          extracted_facts: {},
          rule_result: {},
          recommended_priority: 'immediate_review',
        })
        .select('*');

      expect(data).toBeNull();
      expect(error).toBeDefined();
      expect(error?.message).toMatch(/permission denied for table report_priority_evaluations/i);
    });

    it('strictly denies resident and unauthenticated direct INSERT into report_priority_evaluations', async () => {
      const repId = await createRealReport('[TEST-RESIDENT-INSERT-EVAL-DENIED] Percubaan insert penduduk');

      const { data: resData, error: resError } = await resSentosa.client
        .from('report_priority_evaluations')
        .insert({
          id: crypto.randomUUID(),
          report_id: repId,
          input_fingerprint: 'fake-fingerprint',
          policy_version: '2026.1',
          ai_model: 'fake-model',
          ai_provider: 'fake-provider',
          extracted_facts: {},
          rule_result: {},
          recommended_priority: 'immediate_review',
        });
      expect(resData).toBeNull();
      expect(resError?.message).toMatch(/permission denied for table report_priority_evaluations/i);

      // Anon client
      const anonClient = createServerClient(API_URL, ANON_KEY, { cookies: { getAll: () => [], setAll: () => {} } });
      const { data: anonData, error: anonError } = await anonClient
        .from('report_priority_evaluations')
        .insert({
          id: crypto.randomUUID(),
          report_id: repId,
          input_fingerprint: 'fake-fingerprint',
          policy_version: '2026.1',
          ai_model: 'fake-model',
          ai_provider: 'fake-provider',
          extracted_facts: {},
          rule_result: {},
          recommended_priority: 'immediate_review',
        });
      expect(anonData).toBeNull();
      expect(anonError?.message).toMatch(/permission denied for table report_priority_evaluations/i);
    });

    it('allows valid priority evaluation generation via evaluateReportPriorityAction using trusted server client', async () => {
      const repId = await createRealReport('[TEST-TRUSTED-EVAL] Penilaian sah melalui server action');

      const evalRes = await testSessionStorage.run(mgrSentosa.cookieAdapter, async () => {
        return evaluateReportPriorityAction(repId);
      });
      expect(evalRes.success).toBe(true);
      expect(evalRes.evaluation).toBeDefined();
      expect(evalRes.evaluation?.id).toBeTruthy();

      // Verify row exists in DB
      const dbRow = await runPsql(`SELECT count(*) FROM public.report_priority_evaluations WHERE id = '${evalRes.evaluation!.id}';`);
      expect(parseInt(dbRow, 10)).toBe(1);
    });

    it('allows valid priority decision confirmation exclusively via the controlled RPC and enforces override rationale', async () => {
      const repId = await createRealReport('[TEST-RPC-SUCCESS] Pengesahan melalui RPC');

      const evalRes = await testSessionStorage.run(mgrSentosa.cookieAdapter, async () => {
        return evaluateReportPriorityAction(repId);
      });
      expect(evalRes.success).toBe(true);
      const recommended = evalRes.evaluation!.ruleResult.recommendedPriority;

      // 1. Attempt override to immediate_review WITHOUT reason -> rejected by DB RPC
      const badOverrideRes = await testSessionStorage.run(mgrSentosa.cookieAdapter, async () => {
        return confirmPriorityDecisionAction(
          repId,
          'immediate_review',
          undefined, // Missing reason for override
          evalRes.evaluation!.id,
          crypto.randomUUID(),
          0
        );
      });
      expect(badOverrideRes.success).toBe(false);
      expect(badOverrideRes.error).toContain('Sila nyatakan sebab / catatan');

      // 2. Confirm matching recommended priority WITHOUT reason -> succeeds
      const confirmRes = await testSessionStorage.run(mgrSentosa.cookieAdapter, async () => {
        return confirmPriorityDecisionAction(
          repId,
          recommended,
          undefined,
          evalRes.evaluation!.id,
          crypto.randomUUID(),
          0
        );
      });

      expect(confirmRes.success).toBe(true);
      expect(confirmRes.decision?.decidedPriority).toBe(recommended);
      expect(confirmRes.decision?.isOverride).toBe(false);
    });
  });

  // =========================================================================
  // 2. IDEMPOTENCY KEY SECURITY & PAYLOAD BINDING
  // =========================================================================
  describe('2. Idempotency Key Security & Strict Binding', () => {
    it('returns the existing decision when same key is submitted with identical payload', async () => {
      const repId = await createRealReport('[TEST-IDEM-SAME] Kunci sama payload sama');

      const evalRes = await testSessionStorage.run(mgrSentosa.cookieAdapter, async () => {
        return evaluateReportPriorityAction(repId);
      });
      expect(evalRes.success).toBe(true);

      const sharedKey = crypto.randomUUID();

      const res1 = await testSessionStorage.run(mgrSentosa.cookieAdapter, async () => {
        return confirmPriorityDecisionAction(
          repId,
          'standard_review',
          'Pemeriksaan rutin dijadualkan.',
          evalRes.evaluation!.id,
          sharedKey,
          0
        );
      });
      expect(res1.success).toBe(true);

      // Resubmission with same key and same payload
      const res2 = await testSessionStorage.run(mgrSentosa.cookieAdapter, async () => {
        return confirmPriorityDecisionAction(
          repId,
          'standard_review',
          'Pemeriksaan rutin dijadualkan.',
          evalRes.evaluation!.id,
          sharedKey,
          0
        );
      });
      expect(res2.success).toBe(true);
      expect(res2.isIdempotent).toBe(true);
      expect(res2.decision?.id).toBe(res1.decision?.id);

      // Exactly 1 DB row
      const count = await runPsql(`SELECT count(*) FROM public.report_priority_decisions WHERE report_id = '${repId}';`);
      expect(parseInt(count, 10)).toBe(1);
    });

    it('strictly rejects when same idempotency key is reused with a DIFFERENT payload', async () => {
      const repId = await createRealReport('[TEST-IDEM-MISMATCH] Kunci sama payload berlainan');

      const evalRes = await testSessionStorage.run(mgrSentosa.cookieAdapter, async () => {
        return evaluateReportPriorityAction(repId);
      });
      expect(evalRes.success).toBe(true);

      const sharedKey = crypto.randomUUID();

      const res1 = await testSessionStorage.run(mgrSentosa.cookieAdapter, async () => {
        return confirmPriorityDecisionAction(
          repId,
          'standard_review',
          'Sebab semakan awal.',
          evalRes.evaluation!.id,
          sharedKey,
          0
        );
      });
      expect(res1.success).toBe(true);

      // Reuse key with different priority
      const res2 = await testSessionStorage.run(mgrSentosa.cookieAdapter, async () => {
        return confirmPriorityDecisionAction(
          repId,
          'high_priority', // Different from standard_review!
          'Sebab berlainan.',
          evalRes.evaluation!.id,
          sharedKey,
          0
        );
      });

      expect(res2.success).toBe(false);
      expect(res2.error).toContain('Idempotency key ini telah digunakan untuk keputusan atau aduan yang berbeza.');
    });

    it('strictly rejects when an idempotency key from another report is presented', async () => {
      const rep1 = await createRealReport('[TEST-IDEM-FOREIGN-1] Aduan 1');
      const rep2 = await createRealReport('[TEST-IDEM-FOREIGN-2] Aduan 2');

      const eval1 = await testSessionStorage.run(mgrSentosa.cookieAdapter, async () => {
        return evaluateReportPriorityAction(rep1);
      });
      const eval2 = await testSessionStorage.run(mgrSentosa.cookieAdapter, async () => {
        return evaluateReportPriorityAction(rep2);
      });

      const keyA = crypto.randomUUID();

      // Submit on rep1
      const res1 = await testSessionStorage.run(mgrSentosa.cookieAdapter, async () => {
        return confirmPriorityDecisionAction(
          rep1,
          'standard_review',
          'Semakan aduan 1.',
          eval1.evaluation!.id,
          keyA,
          0
        );
      });
      expect(res1.success).toBe(true);

      // Present keyA on rep2
      const res2 = await testSessionStorage.run(mgrSentosa.cookieAdapter, async () => {
        return confirmPriorityDecisionAction(
          rep2,
          'standard_review',
          'Semakan aduan 2.',
          eval2.evaluation!.id,
          keyA, // Reusing key from rep1
          0
        );
      });

      expect(res2.success).toBe(false);
      expect(res2.error).toContain('Idempotency key ini telah digunakan untuk keputusan atau aduan yang berbeza.');
    });

    it('strictly rejects when a cross-estate manager tries to use a known idempotency key', async () => {
      const repId = await createRealReport('[TEST-IDEM-CROSS-ESTATE] Lif Sentosa Blok A');

      const evalRes = await testSessionStorage.run(mgrSentosa.cookieAdapter, async () => {
        return evaluateReportPriorityAction(repId);
      });
      expect(evalRes.success).toBe(true);

      const knownKey = crypto.randomUUID();

      // Sentosa manager creates decision with knownKey
      const res1 = await testSessionStorage.run(mgrSentosa.cookieAdapter, async () => {
        return confirmPriorityDecisionAction(
          repId,
          'standard_review',
          'Semakan sah Sentosa.',
          evalRes.evaluation!.id,
          knownKey,
          0
        );
      });
      expect(res1.success).toBe(true);

      // Lestari manager tries direct RPC with the known key
      const { data, error } = await mgrOtherEstate.client.rpc('confirm_priority_decision_rpc', {
        p_report_id: repId,
        p_evaluation_id: evalRes.evaluation!.id,
        p_decided_priority: 'standard_review',
        p_override_reason: 'Semakan sah Sentosa.',
        p_idempotency_key: knownKey,
        p_expected_version: 0,
      });

      expect(data).toBeNull();
      expect(error).toBeDefined();
      expect(error?.message).toContain('FORBIDDEN: Aduan ini bukan di bawah kawasan perumahan tugas anda.');
    });

    it('strictly validates that idempotencyKey and expectedVersion are not missing or null', async () => {
      const repId = await createRealReport('[TEST-PARAMS-MANDATORY] Parameter wajib');

      // Missing idempotency key
      const resNoKey = await testSessionStorage.run(mgrSentosa.cookieAdapter, async () => {
        return confirmPriorityDecisionAction(
          repId,
          'standard_review',
          'Sebab semakan.',
          undefined,
          '', // Empty key
          0
        );
      });
      expect(resNoKey.success).toBe(false);
      expect(resNoKey.error).toContain('Idempotency key wajib dibekalkan');

      // Missing expected version
      const resNoVer = await testSessionStorage.run(mgrSentosa.cookieAdapter, async () => {
        return confirmPriorityDecisionAction(
          repId,
          'standard_review',
          'Sebab semakan.',
          undefined,
          crypto.randomUUID(),
          undefined // Missing expectedVersion
        );
      });
      expect(resNoVer.success).toBe(false);
      expect(resNoVer.error).toContain('Versi dijangka (expected_version) wajib dibekalkan');
    });

    it('handles two simultaneous requests with identical idempotency key concurrently without duplicates', async () => {
      const repId = await createRealReport('[TEST-CONCURRENT-IDEM] Permintaan serentak');

      const evalRes = await testSessionStorage.run(mgrSentosa.cookieAdapter, async () => {
        return evaluateReportPriorityAction(repId);
      });
      expect(evalRes.success).toBe(true);

      const sharedKey = crypto.randomUUID();

      const [res1, res2] = await Promise.all([
        testSessionStorage.run(mgrSentosa.cookieAdapter, async () => {
          return confirmPriorityDecisionAction(
            repId,
            'standard_review',
            'Pemeriksaan tapak selesai.',
            evalRes.evaluation!.id,
            sharedKey,
            0
          );
        }),
        testSessionStorage.run(mgrSentosa.cookieAdapter, async () => {
          return confirmPriorityDecisionAction(
            repId,
            'standard_review',
            'Pemeriksaan tapak selesai.',
            evalRes.evaluation!.id,
            sharedKey,
            0
          );
        }),
      ]);

      expect(res1.success).toBe(true);
      expect(res2.success).toBe(true);
      expect(res1.decision?.id).toBe(res2.decision?.id);

      const count = await runPsql(`SELECT count(*) FROM public.report_priority_decisions WHERE report_id = '${repId}';`);
      expect(parseInt(count, 10)).toBe(1);
    });
  });

  // =========================================================================
  // 3. ATOMIC STALE EVALUATION CHECK IN SAME DATABASE TRANSACTION
  // =========================================================================
  describe('3. Atomic Stale Check: Semak kesegaran dalam transaksi yang sama', () => {
    it('atomically rejects confirmation inside RPC if report description was changed after evaluation', async () => {
      const repId = await createRealReport('[TEST-RACE-DESC] Lif bergegar perlahan');

      const evalRes = await testSessionStorage.run(mgrSentosa.cookieAdapter, async () => {
        return evaluateReportPriorityAction(repId);
      });
      expect(evalRes.success).toBe(true);
      const evalId = evalRes.evaluation!.id;

      // Concurrent race: description updated directly in DB
      await runPsql(`
        SET session_replication_role = replica;
        UPDATE public.incident_reports
        SET description = '[TEST-RACE-DESC] Lif terputus tali dan terhempas ke bawah'
        WHERE id = '${repId}';
      `);

      // Attempt confirmation
      const confirmRes = await testSessionStorage.run(mgrSentosa.cookieAdapter, async () => {
        return confirmPriorityDecisionAction(
          repId,
          'standard_review',
          'Selesai semakan.',
          evalId,
          crypto.randomUUID(),
          0
        );
      });

      expect(confirmRes.success).toBe(false);
      expect(confirmRes.error).toContain('telah berubah sejak penilaian dijana');

      // Verify NO decision was recorded
      const decCount = await runPsql(`SELECT count(*) FROM public.report_priority_decisions WHERE report_id = '${repId}';`);
      expect(parseInt(decCount, 10)).toBe(0);

      // Verify old evaluation is preserved as historical record
      const evalCount = await runPsql(`SELECT count(*) FROM public.report_priority_evaluations WHERE id = '${evalId}';`);
      expect(parseInt(evalCount, 10)).toBe(1);
    });

    it('atomically blocks concurrent incident link mutations while priority confirmation holds incident lock', async () => {
      const repA = await createRealReport('[TEST-LOCK-A] Aduan A Paip', 'water_supply');
      const repB = await createRealReport('[TEST-LOCK-B] Aduan B Paip', 'water_supply');
      const incidentId = crypto.randomUUID();

      await runPsql(`
        SET session_replication_role = replica;
        UPDATE public.incident_reports SET status = 'reviewed' WHERE id IN ('${repA}', '${repB}');
        INSERT INTO public.incidents (id, incident_number, building_id, title, category, status, severity, verified_at)
        VALUES ('${incidentId}', 'INC-LOCK-${Date.now()}', '${sentosaBldgA}', 'Krisis Paip Kunci', 'water_supply', 'confirmed', 'major', now());
        INSERT INTO public.incident_report_links (incident_id, report_id)
        VALUES ('${incidentId}', '${repA}');
      `);

      const session1 = new PsqlSession();
      const session2 = new PsqlSession();

      try {
        // Session 1: Acquire FOR SHARE on incident (same lock taken by confirm_priority_decision_rpc)
        await session1.query(`
          BEGIN;
          SELECT id FROM public.incidents WHERE id = '${incidentId}' FOR SHARE;
        `);

        // Session 2: Attempt to insert a link for repB (trigger attempts FOR UPDATE on public.incidents)
        let session2Resolved = false;
        const linkPromise = session2.query(`
          SET session_replication_role = replica;
          INSERT INTO public.incident_report_links (incident_id, report_id)
          VALUES ('${incidentId}', '${repB}');
        `).then((res) => {
          session2Resolved = true;
          return res;
        });

        // Verify Session 2 is actively BLOCKED by the lock held in Session 1
        await new Promise((r) => setTimeout(r, 200));
        expect(session2Resolved).toBe(false);

        // Session 1 commits, releasing the lock
        await session1.query('COMMIT;');

        // Now Session 2 unblocks and completes
        await linkPromise;
        expect(session2Resolved).toBe(true);

        const count = await runPsql(`SELECT count(*) FROM public.incident_report_links WHERE incident_id = '${incidentId}';`);
        expect(parseInt(count, 10)).toBe(2);
      } finally {
        await session1.close();
        await session2.close();
        await runPsql(`DELETE FROM public.incidents WHERE id = '${incidentId}';`);
      }
    });

    it('atomically blocks confirmation RPC on concurrent link transaction and rejects confirmation as stale after link commits', async () => {
      const repA = await createRealReport('[TEST-RACE-A] Aduan A Paip', 'water_supply');
      const repB = await createRealReport('[TEST-RACE-B] Aduan B Paip', 'water_supply');
      const incidentId = crypto.randomUUID();

      await runPsql(`
        SET session_replication_role = replica;
        UPDATE public.incident_reports SET status = 'reviewed' WHERE id IN ('${repA}', '${repB}');
        INSERT INTO public.incidents (id, incident_number, building_id, title, category, status, severity, verified_at)
        VALUES ('${incidentId}', 'INC-RACE-${Date.now()}', '${sentosaBldgA}', 'Krisis Paip Serentak', 'water_supply', 'confirmed', 'major', now());
        INSERT INTO public.incident_report_links (incident_id, report_id)
        VALUES ('${incidentId}', '${repA}');
      `);

      // 1. Generate evaluation for repA when incident only has 1 report
      const evalRes = await testSessionStorage.run(mgrSentosa.cookieAdapter, async () => {
        return evaluateReportPriorityAction(repA);
      });
      expect(evalRes.success).toBe(true);
      const evalId = evalRes.evaluation!.id;

      const linkSession = new PsqlSession();

      try {
        // 2. Link transaction starts and inserts repB link (taking FOR UPDATE lock on incidents)
        await linkSession.query(`
          SET session_replication_role = replica;
          BEGIN;
          INSERT INTO public.incident_report_links (incident_id, report_id)
          VALUES ('${incidentId}', '${repB}');
        `);

        // 3. Concurrently, Confirmation Action runs on repA.
        // Inside confirm_priority_decision_rpc, it queries SELECT ... FOR SHARE on incidents.
        // This MUST block until linkSession commits!
        let confirmFinished = false;
        const confirmPromise = testSessionStorage.run(mgrSentosa.cookieAdapter, async () => {
          return confirmPriorityDecisionAction(
            repA,
            'standard_review',
            'Semakan selesai.',
            evalId,
            crypto.randomUUID(),
            0
          );
        }).then((res) => {
          confirmFinished = true;
          return res;
        });

        // Verify confirm action is BLOCKED waiting on the link transaction lock
        await new Promise((r) => setTimeout(r, 200));
        expect(confirmFinished).toBe(false);

        // 4. Link transaction commits (now incident has 2 reports)
        await linkSession.query('COMMIT;');

        // 5. Confirm action unblocks, acquires lock, re-checks freshness, and detects STALE_EVALUATION!
        const confirmRes = await confirmPromise;
        expect(confirmFinished).toBe(true);
        expect(confirmRes.success).toBe(false);
        expect(confirmRes.error).toContain('telah berubah sejak penilaian dijana');

        // 6. Assert NO decisions were recorded for repA
        const decCount = await runPsql(`SELECT count(*) FROM public.report_priority_decisions WHERE report_id = '${repA}';`);
        expect(parseInt(decCount, 10)).toBe(0);
      } finally {
        await linkSession.close();
        await runPsql(`DELETE FROM public.incidents WHERE id = '${incidentId}';`);
      }
    });
  });

  // =========================================================================
  // 4. CONTROLLED DATABASE FAULT INJECTION (Kegagalan Database Sebenar)
  // =========================================================================
  describe('4. Database Failure Handling: Fault injection terkawal', () => {
    it('handles database read failure gracefully: returns error and NEVER calls AI provider', async () => {
      const repId = await createRealReport('[TEST-FAULT-READ] Ujian kegagalan bacaan');
      extractSpy.mockClear();

      const faultAdapter: CookieAdapter = {
        ...mgrSentosa.cookieAdapter,
        testHooks: {
          simulateIncidentReportReadError: true,
        },
      };

      const evalRes = await testSessionStorage.run(faultAdapter, async () => {
        return evaluateReportPriorityAction(repId);
      });

      expect(evalRes.success).toBe(false);
      expect(evalRes.error).toContain('Gagal memuatkan rekod aduan');
      expect(extractSpy).not.toHaveBeenCalled(); // Fast fail: no AI provider call!
    });

    it('handles database decision history read failure: returns error and does NOT return fake empty success', async () => {
      const repId = await createRealReport('[TEST-FAULT-HISTORY] Ujian kegagalan baca sejarah');

      const faultAdapter: CookieAdapter = {
        ...mgrSentosa.cookieAdapter,
        testHooks: {
          simulateDecisionsReadError: true,
        },
      };

      const readRes = await testSessionStorage.run(faultAdapter, async () => {
        return getPriorityDataAction(repId);
      });

      expect(readRes.success).toBe(false);
      expect(readRes.error).toContain('Gagal memuatkan sejarah keputusan');
    });

    it('handles database RPC write failure: does not claim false success, retrying with same key succeeds after recovery', async () => {
      const repId = await createRealReport('[TEST-FAULT-RPC] Ujian kegagalan RPC');

      const evalRes = await testSessionStorage.run(mgrSentosa.cookieAdapter, async () => {
        return evaluateReportPriorityAction(repId);
      });
      expect(evalRes.success).toBe(true);

      const retryKey = crypto.randomUUID();

      // First attempt with simulated RPC failure
      const faultAdapter: CookieAdapter = {
        ...mgrSentosa.cookieAdapter,
        testHooks: {
          simulateRpcWriteError: true,
        },
      };

      const failRes = await testSessionStorage.run(faultAdapter, async () => {
        return confirmPriorityDecisionAction(
          repId,
          'standard_review',
          'Catatan semakan tapak.',
          evalRes.evaluation!.id,
          retryKey,
          0
        );
      });

      expect(failRes.success).toBe(false);
      expect(failRes.decision).toBeUndefined();

      // Verify nothing was recorded during the failure
      const countDuringFail = await runPsql(`SELECT count(*) FROM public.report_priority_decisions WHERE report_id = '${repId}';`);
      expect(parseInt(countDuringFail, 10)).toBe(0);

      // Second attempt after recovery using the EXACT SAME idempotency key (simulating user retry after network drop)
      const recoverRes = await testSessionStorage.run(mgrSentosa.cookieAdapter, async () => {
        return confirmPriorityDecisionAction(
          repId,
          'standard_review',
          'Catatan semakan tapak.',
          evalRes.evaluation!.id,
          retryKey,
          0
        );
      });

      expect(recoverRes.success).toBe(true);
      expect(recoverRes.decision).toBeDefined();

      // Exactly 1 row in DB
      const countAfterRecover = await runPsql(`SELECT count(*) FROM public.report_priority_decisions WHERE report_id = '${repId}';`);
      expect(parseInt(countAfterRecover, 10)).toBe(1);
    });
  });

  // =========================================================================
  // 5. ACCESS CONTROL & ROLE ENFORCEMENT
  // =========================================================================
  describe('5. Access Control: Kawalan akses dan pengasingan kawasan', () => {
    it('strictly rejects unauthenticated callers', async () => {
      const repId = await createRealReport('[TEST-AUTH-NONE] Tanpa sesi');

      const evalRes = await evaluateReportPriorityAction(repId);
      expect(evalRes.success).toBe(false);
      expect(evalRes.error).toContain('UNAUTHORIZED');

      const confirmRes = await confirmPriorityDecisionAction(
        repId,
        'standard_review',
        undefined,
        undefined,
        crypto.randomUUID(),
        0
      );
      expect(confirmRes.success).toBe(false);
      expect(confirmRes.error).toContain('UNAUTHORIZED');
    });

    it('strictly rejects resident users from triage actions', async () => {
      const repId = await createRealReport('[TEST-AUTH-RESIDENT] Sesi resident');

      const evalRes = await testSessionStorage.run(resSentosa.cookieAdapter, async () => {
        return evaluateReportPriorityAction(repId);
      });
      expect(evalRes.success).toBe(false);
      expect(evalRes.error).toContain('FORBIDDEN_ROLE');

      const confirmRes = await testSessionStorage.run(resSentosa.cookieAdapter, async () => {
        return confirmPriorityDecisionAction(
          repId,
          'standard_review',
          undefined,
          undefined,
          crypto.randomUUID(),
          0
        );
      });
      expect(confirmRes.success).toBe(false);
      expect(confirmRes.error).toContain('FORBIDDEN_ROLE');
    });

    it('strictly isolates cross-estate managers', async () => {
      const repId = await createRealReport('[TEST-AUTH-CROSS] Kawasan lain');

      const evalRes = await testSessionStorage.run(mgrOtherEstate.cookieAdapter, async () => {
        return evaluateReportPriorityAction(repId);
      });
      expect(evalRes.success).toBe(false);

      const confirmRes = await testSessionStorage.run(mgrOtherEstate.cookieAdapter, async () => {
        return confirmPriorityDecisionAction(
          repId,
          'standard_review',
          undefined,
          undefined,
          crypto.randomUUID(),
          0
        );
      });
      expect(confirmRes.success).toBe(false);
    });

    it('strictly rejects confirmation when evaluation belongs to another report', async () => {
      const rep1 = await createRealReport('[TEST-EVAL-A] Aduan A');
      const rep2 = await createRealReport('[TEST-EVAL-B] Aduan B');

      const eval1 = await testSessionStorage.run(mgrSentosa.cookieAdapter, async () => {
        return evaluateReportPriorityAction(rep1);
      });
      expect(eval1.success).toBe(true);

      const confirmRes = await testSessionStorage.run(mgrSentosa.cookieAdapter, async () => {
        return confirmPriorityDecisionAction(
          rep2,
          'standard_review',
          undefined,
          eval1.evaluation!.id, // Belongs to rep1!
          crypto.randomUUID(),
          0
        );
      });

      expect(confirmRes.success).toBe(false);
      expect(confirmRes.error).toContain('FORBIDDEN: Penilaian yang dirujuk bukan milik aduan ini.');
    });

    it('strictly rejects confirmation when evaluation_id is null or empty string', async () => {
      const repId = await createRealReport('[TEST-MANDATORY-EVAL-NULL] evaluation_id kosong');

      const confirmEmptyRes = await testSessionStorage.run(mgrSentosa.cookieAdapter, async () => {
        return confirmPriorityDecisionAction(
          repId,
          'standard_review',
          'Semakan selesai.',
          '',
          crypto.randomUUID(),
          0
        );
      });
      expect(confirmEmptyRes.success).toBe(false);
      expect(confirmEmptyRes.error).toContain('evaluation_id wajib dibekalkan');

      const confirmUndefRes = await testSessionStorage.run(mgrSentosa.cookieAdapter, async () => {
        return confirmPriorityDecisionAction(
          repId,
          'standard_review',
          'Semakan selesai.',
          undefined,
          crypto.randomUUID(),
          0
        );
      });
      expect(confirmUndefRes.success).toBe(false);
      expect(confirmUndefRes.error).toContain('evaluation_id wajib dibekalkan');
    });

    it('strictly rejects confirmation when evaluation_id does not exist in database', async () => {
      const repId = await createRealReport('[TEST-NONEXISTENT-EVAL] evaluation_id tidak wujud');
      const nonExistentEvalId = crypto.randomUUID();

      const confirmRes = await testSessionStorage.run(mgrSentosa.cookieAdapter, async () => {
        return confirmPriorityDecisionAction(
          repId,
          'standard_review',
          'Semakan selesai.',
          nonExistentEvalId,
          crypto.randomUUID(),
          0
        );
      });
      expect(confirmRes.success).toBe(false);
      expect(confirmRes.error).toContain('Penilaian yang dirujuk tidak dijumpai');
    });
  });

  // ===========================================================================
  // 6. Link Move Protection & Strict Immutability (Migration 20261019150000)
  // ===========================================================================
  describe('6. Link Move Protection: Sekat pemindahan pautan (LINK_MUTATION_NOT_SUPPORTED)', () => {
    it('strictly rejects direct UPDATE attempting to change incident_id of an existing link', async () => {
      const repId = await createRealReport('[TEST-LINK-MOVE-INC] Aduan pautan');
      const incA = await createRealIncident('Insiden A');
      const incB = await createRealIncident('Insiden B');

      // Create valid initial link
      const linkId = crypto.randomUUID();
      await runPsql(`
        SET session_replication_role = replica;
        INSERT INTO public.incident_report_links (id, incident_id, report_id)
        VALUES ('${linkId}', '${incA}', '${repId}');
      `);

      // Attempt to move link from incA to incB via UPDATE
      await expect(
        runPsql(`UPDATE public.incident_report_links SET incident_id = '${incB}' WHERE id = '${linkId}';`)
      ).rejects.toThrow(/LINK_MUTATION_NOT_SUPPORTED/);

      // Verify link remains associated with original incident A
      const currentInc = await runPsql(`SELECT incident_id FROM public.incident_report_links WHERE id = '${linkId}';`);
      expect(currentInc).toBe(incA);
    });

    it('strictly rejects direct UPDATE attempting to change report_id of an existing link', async () => {
      const repA = await createRealReport('[TEST-LINK-MOVE-REP-A] Aduan A');
      const repB = await createRealReport('[TEST-LINK-MOVE-REP-B] Aduan B');
      const incId = await createRealIncident('Insiden Tunggal');

      const linkId = crypto.randomUUID();
      await runPsql(`
        SET session_replication_role = replica;
        INSERT INTO public.incident_report_links (id, incident_id, report_id)
        VALUES ('${linkId}', '${incId}', '${repA}');
      `);

      // Attempt to reassign link from repA to repB via UPDATE
      await expect(
        runPsql(`UPDATE public.incident_report_links SET report_id = '${repB}' WHERE id = '${linkId}';`)
      ).rejects.toThrow(/LINK_MUTATION_NOT_SUPPORTED/);

      const currentRep = await runPsql(`SELECT report_id FROM public.incident_report_links WHERE id = '${linkId}';`);
      expect(currentRep).toBe(repA);
    });

    it('allows standard link INSERT and DELETE while serializing concurrency', async () => {
      const repId = await createRealReport('[TEST-LINK-STD] Aduan standard link');
      const incId = await createRealIncident('Insiden Standard');

      const linkId = crypto.randomUUID();

      // Standard insert succeeds (with session_replication_role = replica so guard_incident allows touch)
      await runPsql(`
        SET session_replication_role = replica;
        INSERT INTO public.incident_report_links (id, incident_id, report_id)
        VALUES ('${linkId}', '${incId}', '${repId}');
      `);

      const count = await runPsql(`SELECT count(*) FROM public.incident_report_links WHERE id = '${linkId}';`);
      expect(parseInt(count, 10)).toBe(1);

      // Standard delete succeeds
      await runPsql(`
        SET session_replication_role = replica;
        DELETE FROM public.incident_report_links WHERE id = '${linkId}';
      `);
      const countAfter = await runPsql(`SELECT count(*) FROM public.incident_report_links WHERE id = '${linkId}';`);
      expect(parseInt(countAfter, 10)).toBe(0);
    });
  });

  // ===========================================================================
  // 7. Inbox Error Handling: Differentiate success, empty, and failure
  // ===========================================================================
  describe('7. Inbox Error Handling: Jangan sembunyikan ralat atau palsukan ketiadaan keputusan', () => {
    it('returns error and does NOT claim "belum dinilai" when evaluations query fails', async () => {
      const repId = await createRealReport('[TEST-INBOX-EVAL-FAIL] Ralat bacaan evaluation');

      // Create a real evaluation in DB
      const evalRes = await testSessionStorage.run(mgrSentosa.cookieAdapter, async () => {
        return evaluateReportPriorityAction(repId);
      });
      expect(evalRes.success).toBe(true);

      // Read priority data with simulated evaluation read failure
      const errorAdapter: CookieAdapter = {
        ...mgrSentosa.cookieAdapter,
        testHooks: {
          simulateEvaluationsReadError: true,
        },
      };

      const readRes = await testSessionStorage.run(errorAdapter, async () => {
        return getPriorityDataAction(repId);
      });

      // Must be an error, NOT a silent empty evaluation
      expect(readRes.success).toBe(false);
      expect(readRes.error).toContain('Gagal memuatkan penilaian keutamaan');
      expect(readRes.evaluation).toBeNull();
    });

    it('returns error and does NOT claim "belum disahkan" when decisions query fails on confirmed report', async () => {
      const repId = await createRealReport('[TEST-INBOX-DEC-FAIL] Ralat bacaan decision');

      // 1. Evaluate & confirm a real decision in DB
      const evalRes = await testSessionStorage.run(mgrSentosa.cookieAdapter, async () => {
        return evaluateReportPriorityAction(repId);
      });
      expect(evalRes.success).toBe(true);

      const confirmRes = await testSessionStorage.run(mgrSentosa.cookieAdapter, async () => {
        return confirmPriorityDecisionAction(
          repId,
          'standard_review',
          'Telah disahkan oleh pengurus.',
          evalRes.evaluation!.id,
          crypto.randomUUID(),
          0
        );
      });
      expect(confirmRes.success).toBe(true);

      // 2. Read priority data with simulated decisions read failure
      const errorAdapter: CookieAdapter = {
        ...mgrSentosa.cookieAdapter,
        testHooks: {
          simulateDecisionsReadError: true,
        },
      };

      const readRes = await testSessionStorage.run(errorAdapter, async () => {
        return getPriorityDataAction(repId);
      });

      // Must return an explicit error and NOT claim "belum disahkan" or return currentVersion 0
      expect(readRes.success).toBe(false);
      expect(readRes.error).toContain('Gagal memuatkan sejarah keputusan');
      expect(readRes.latestDecision).toBeNull();
      // currentVersion must not be returned as valid 0
      expect(readRes.currentVersion).toBeUndefined();
    });

    it('returns clean error when incident reports query fails and never invents synthetic complaints', async () => {
      const repId = await createRealReport('[TEST-INBOX-REP-FAIL] Ralat bacaan report');

      const errorAdapter: CookieAdapter = {
        ...mgrSentosa.cookieAdapter,
        testHooks: {
          simulateIncidentReportReadError: true,
        },
      };

      const readRes = await testSessionStorage.run(errorAdapter, async () => {
        return getPriorityDataAction(repId);
      });

      expect(readRes.success).toBe(false);
      expect(readRes.error).toContain('Gagal memuatkan rekod aduan');
      expect(readRes.isDemoCase).toBeFalsy();
    });

    it('returns clean error and does NOT return false success when incident link query fails', async () => {
      const repId = await createRealReport('[TEST-INBOX-LINK-FAIL] Ralat bacaan links');

      const errorAdapter: CookieAdapter = {
        ...mgrSentosa.cookieAdapter,
        testHooks: {
          simulateLinksReadError: true,
        },
      };

      const readRes = await testSessionStorage.run(errorAdapter, async () => {
        return getPriorityDataAction(repId);
      });

      expect(readRes.success).toBe(false);
      expect(readRes.error).toContain('pautan');
      expect(readRes.currentVersion).toBeUndefined();
    });
  });
});
