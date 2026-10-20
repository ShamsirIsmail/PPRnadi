import postgres from 'postgres';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// -----------------------------------------------------------------------------
// PPR NADI — ISOLATED POSTGRES RATE LIMITER CONCURRENCY & ATOMICITY TEST
// -----------------------------------------------------------------------------

const TEST_DB_URL = process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';

async function runPostgresRateLimiterTest() {
  console.log('==============================================================================');
  console.log('PPR NADI — POSTGRES ATOMIC RATE LIMITER CONCURRENCY & ISOLATION TEST');
  console.log('==============================================================================');

  const sql = postgres(TEST_DB_URL, {
    max: 15,
    connect_timeout: 5,
  });

  const runId = Math.random().toString(36).substring(2, 8);
  const testSchema = `test_rl_${runId}`;

  try {
    console.log(`[Step 1] Creating isolated test schema: ${testSchema}`);
    await sql.unsafe(`CREATE SCHEMA ${testSchema};`);
    await sql.unsafe(`SET search_path TO ${testSchema}, public;`);

    // Load migration SQL and replace public. with testSchema.
    const migrationFile = path.resolve('supabase', 'migrations', '20261020230000_demo_rate_limiter.sql');
    let migSql = fs.readFileSync(migrationFile, 'utf8');
    migSql = migSql.replace(/public\./g, `${testSchema}.`);

    console.log('[Step 2] Applying rate limiter schema and atomic stored procedure...');
    await sql.unsafe(migSql);
    console.log('  ✓ Table and stored procedure created successfully.');

    // -------------------------------------------------------------------------
    // Test 1: Sequential 5 allowed attempts, 6th rejected
    // -------------------------------------------------------------------------
    console.log('\n[Test 1] Testing sequential threshold: 5 allowed, 6th rejected...');
    const testHash1 = 'hash_seq_' + runId + '_' + 'a'.repeat(32);
    for (let i = 1; i <= 5; i++) {
      const [res] = await sql.unsafe(
        `SELECT ${testSchema}.check_and_increment_demo_rate_limit($1, 5, 60) AS r;`,
        [testHash1]
      );
      assert.equal(res.r.allowed, true, `Attempt ${i} must be allowed`);
      assert.equal(res.r.attempts, i, `Attempt ${i} count must match`);
    }

    const [rejectedRes] = await sql.unsafe(
      `SELECT ${testSchema}.check_and_increment_demo_rate_limit($1, 5, 60) AS r;`,
      [testHash1]
    );
    assert.equal(rejectedRes.r.allowed, false, '6th attempt must be rejected');
    assert.equal(rejectedRes.r.attempts, 6, '6th attempt count must be 6');
    assert.ok(rejectedRes.r.retry_after_seconds > 0, 'retry_after_seconds must be > 0');
    console.log('  ✓ Sequential threshold verified (5 allowed, 6th rejected with retry_after_seconds).');

    // -------------------------------------------------------------------------
    // Test 2: Concurrent requests from 10 parallel connections at exact same ms
    // -------------------------------------------------------------------------
    console.log('\n[Test 2] Testing 10 simultaneous concurrent requests (Atomic Row Locking)...');
    const testHashConcurrent = 'hash_conc_' + runId + '_' + 'b'.repeat(32);

    // Launch 10 simultaneous queries across parallel connections
    const concurrentPromises = Array.from({ length: 10 }).map((_, idx) =>
      sql.unsafe(
        `SELECT ${testSchema}.check_and_increment_demo_rate_limit($1, 5, 60) AS r;`,
        [testHashConcurrent]
      ).then(rows => ({ idx, result: rows[0].r }))
    );

    const results = await Promise.all(concurrentPromises);
    const allowed = results.filter(r => r.result.allowed);
    const denied = results.filter(r => !r.result.allowed);

    console.log(`  Concurrent results: ${allowed.length} allowed, ${denied.length} denied.`);
    assert.equal(allowed.length, 5, 'Exactly 5 concurrent requests must be allowed');
    assert.equal(denied.length, 5, 'Exactly 5 concurrent requests must be denied');

    // Check final row count in database
    const [finalRow] = await sql.unsafe(
      `SELECT attempts FROM ${testSchema}.demo_rate_limits WHERE client_hash = $1;`,
      [testHashConcurrent]
    );
    assert.equal(finalRow.attempts, 10, 'Final database counter must accurately reflect all 10 attempts');
    console.log('  ✓ Concurrency test passed: Exactly 5 allowed, 5 rejected, atomic count = 10 with zero race condition.');

    // -------------------------------------------------------------------------
    // Test 3: Multiple separate instances share the exact same count
    // -------------------------------------------------------------------------
    console.log('\n[Test 3] Testing cross-instance shared state (Instance A vs Instance B)...');
    const testHashCross = 'hash_cross_' + runId + '_' + 'c'.repeat(32);

    // Instance A records 3 attempts
    for (let i = 0; i < 3; i++) {
      await sql.unsafe(`SELECT ${testSchema}.check_and_increment_demo_rate_limit($1, 5, 60);`, [testHashCross]);
    }

    // Instance B checks attempt 4
    const [instBRes1] = await sql.unsafe(
      `SELECT ${testSchema}.check_and_increment_demo_rate_limit($1, 5, 60) AS r;`,
      [testHashCross]
    );
    assert.equal(instBRes1.r.attempts, 4, 'Instance B must see count = 4 from shared server storage');
    assert.equal(instBRes1.r.allowed, true);

    // Instance C checks attempt 5
    const [instCRes1] = await sql.unsafe(
      `SELECT ${testSchema}.check_and_increment_demo_rate_limit($1, 5, 60) AS r;`,
      [testHashCross]
    );
    assert.equal(instCRes1.r.attempts, 5, 'Instance C must see count = 5 from shared server storage');
    assert.equal(instCRes1.r.allowed, true);

    // Instance A checks attempt 6 -> rejected
    const [instARes2] = await sql.unsafe(
      `SELECT ${testSchema}.check_and_increment_demo_rate_limit($1, 5, 60) AS r;`,
      [testHashCross]
    );
    assert.equal(instARes2.r.allowed, false, 'Instance A must see limit reached after Instance B and C attempts');
    console.log('  ✓ Cross-instance shared state passed: Independent connections share consistent atomic state.');

    // -------------------------------------------------------------------------
    // Test 4: Window Expiry Resets Count
    // -------------------------------------------------------------------------
    console.log('\n[Test 4] Testing window expiration resets counter...');
    const testHashExpiry = 'hash_exp_' + runId + '_' + 'd'.repeat(32);

    // Use 1-second window
    for (let i = 0; i < 5; i++) {
      await sql.unsafe(`SELECT ${testSchema}.check_and_increment_demo_rate_limit($1, 5, 1);`, [testHashExpiry]);
    }
    const [blocked] = await sql.unsafe(
      `SELECT ${testSchema}.check_and_increment_demo_rate_limit($1, 5, 1) AS r;`,
      [testHashExpiry]
    );
    assert.equal(blocked.r.allowed, false, 'Should be blocked before window expiry');

    console.log('  Waiting 1.2s for window to expire...');
    await new Promise(r => setTimeout(r, 1200));

    const [afterExpiry] = await sql.unsafe(
      `SELECT ${testSchema}.check_and_increment_demo_rate_limit($1, 5, 1) AS r;`,
      [testHashExpiry]
    );
    assert.equal(afterExpiry.r.allowed, true, 'Should be allowed again after window expiry');
    assert.equal(afterExpiry.r.attempts, 1, 'Attempts should reset to 1');
    console.log('  ✓ Window expiration passed: Counter cleanly reset to 1 and allowed.');

    console.log('\n==============================================================================');
    console.log('ALL POSTGRES ATOMICITY & CONCURRENCY TESTS PASSED PERFECTLY!');
    console.log('==============================================================================');
  } finally {
    console.log(`[Cleanup] Dropping isolated test schema ${testSchema}...`);
    try {
      await sql.unsafe(`DROP SCHEMA IF EXISTS ${testSchema} CASCADE;`);
    } catch {}
    await sql.end();
  }
}

runPostgresRateLimiterTest().catch(err => {
  console.error('[POSTGRES TEST FATAL ERROR]:', err);
  process.exit(1);
});
