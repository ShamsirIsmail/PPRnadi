import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

/**
 * PPR NADI — Staging Cloud Migration Runner
 * Applies migrations in order to the verified staging Supabase database.
 * 
 * Safety guards:
 * - Refuses to run if target DB is not confirmed staging.
 * - Never touches local DB.
 * - Idempotent execution.
 */

const MIGRATIONS = [
  '20261016160000_core_schema.sql',
  '20261016160100_synthetic_demo_seed.sql',
  '20261016160200_rls_and_security_closure.sql',
  '20261016160300_storage_evidence_bucket.sql',
  '20261019120000_priority_explainer.sql',
  '20261019130000_priority_security_hardening.sql',
  '20261019140000_priority_evaluation_protection_and_locking.sql',
  '20261019150000_incident_link_immutability.sql',
  '20261019160000_desa_rejang_demo_estate.sql'
];

export async function runStagingMigrations(dbUrl, expectedRef) {
  if (!dbUrl) {
    throw new Error('STAGING_DATABASE_URL is required.');
  }

  // Safety check: Ensure URL contains the expected staging project ref or host
  if (expectedRef && !dbUrl.includes(expectedRef)) {
    throw new Error(`Safety Violation: STAGING_DATABASE_URL does not match expected project ref [${expectedRef}]. Aborting.`);
  }

  // Prevent running against local DB by accident
  if (dbUrl.includes('127.0.0.1:64322') || dbUrl.includes('localhost:64322')) {
    throw new Error('Safety Violation: STAGING_DATABASE_URL is pointing to local database port 64322! Aborting.');
  }

  console.log('[Staging Migration] Connecting to cloud database...');
  const sql = postgres(dbUrl, {
    ssl: 'require',
    max: 1,
    connect_timeout: 10
  });

  try {
    // 1. Create migrations tracking table if not exists
    await sql`
      CREATE TABLE IF NOT EXISTS public._staging_applied_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `;

    const applied = await sql`SELECT name FROM public._staging_applied_migrations`;
    const appliedSet = new Set(applied.map(r => r.name));

    const migrationsDir = path.resolve('supabase', 'migrations');

    for (const mig of MIGRATIONS) {
      if (appliedSet.has(mig)) {
        console.log(`[Staging Migration] Already applied: ${mig}`);
        continue;
      }

      console.log(`[Staging Migration] Applying: ${mig}...`);
      const filePath = path.join(migrationsDir, mig);
      const sqlContent = fs.readFileSync(filePath, 'utf8');

      // Execute in transaction
      await sql.begin(async tx => {
        await tx.unsafe(sqlContent);
        await tx`INSERT INTO public._staging_applied_migrations (name) VALUES (${mig})`;
      });

      console.log(`[Staging Migration] Successfully applied: ${mig}`);
    }

    console.log('[Staging Migration] All staging migrations up to date.');
  } finally {
    await sql.end();
  }
}

if (process.argv[1]?.endsWith('migrate-staging.mjs')) {
  const dbUrl = process.env.STAGING_DATABASE_URL;
  const expectedRef = process.env.STAGING_PROJECT_REF;
  runStagingMigrations(dbUrl, expectedRef).catch(err => {
    console.error('[Staging Migration Error]:', err.message);
    process.exit(1);
  });
}
