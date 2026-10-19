import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

/**
 * PPR NADI — Staging Cloud Database Migration Runner
 * Strictly verifies project identity against mhtlcvvqwxkhkeqhzbrk.
 * Errors never print credentials or the raw connection URI.
 */

// Load .env.staging.local if present
if (fs.existsSync('.env.staging.local')) {
  try {
    process.loadEnvFile('.env.staging.local');
  } catch {}
}

export const REQUIRED_PROJECT_REF = 'mhtlcvvqwxkhkeqhzbrk';

export function validateStagingProjectRef(projectRef) {
  if (!projectRef || typeof projectRef !== 'string' || projectRef.trim() === '') {
    throw new Error('STAGING_PROJECT_REF is required and cannot be empty.');
  }
  if (projectRef.trim() !== REQUIRED_PROJECT_REF) {
    throw new Error(`Refusing execution: STAGING_PROJECT_REF [${projectRef}] does not match allowed staging reference [${REQUIRED_PROJECT_REF}].`);
  }
  return REQUIRED_PROJECT_REF;
}

export function validateStagingDatabaseUrl(dbUrl, projectRef) {
  // projectRef must be explicitly provided and strictly verified
  validateStagingProjectRef(projectRef);

  if (!dbUrl || typeof dbUrl !== 'string' || dbUrl.trim() === '') {
    throw new Error('STAGING_DATABASE_URL is required in environment.');
  }

  let parsed;
  try {
    parsed = new URL(dbUrl);
  } catch {
    throw new Error('STAGING_DATABASE_URL is not a valid URI format.');
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error(`Invalid database protocol. Expected postgres: or postgresql:`);
  }

  const hostname = parsed.hostname.toLowerCase();
  const username = decodeURIComponent(parsed.username || '');

  // 1. Strictly reject all loopback and private LAN addresses
  const forbiddenHosts = ['localhost', '127.0.0.1', '::1', '0.0.0.0'];
  if (
    forbiddenHosts.includes(hostname) ||
    hostname.startsWith('192.168.') ||
    hostname.startsWith('10.') ||
    hostname.startsWith('172.16.')
  ) {
    throw new Error(`Safety Violation: STAGING_DATABASE_URL host is a local or loopback address. Aborting.`);
  }

  // 2. Validate Supabase connection identity:
  // Direct: db.<ref>.supabase.co
  // Pooler: *.pooler.supabase.co with EXACT username postgres.<ref>
  const expectedDirectHost = `db.${REQUIRED_PROJECT_REF}.supabase.co`;
  const expectedPoolerUsername = `postgres.${REQUIRED_PROJECT_REF}`;

  const isDirect = hostname === expectedDirectHost;
  const isPooler = hostname.endsWith('.pooler.supabase.co') && username === expectedPoolerUsername;

  if (!isDirect && !isPooler) {
    throw new Error(
      `Safety Violation: Database connection target does not match staging project [${REQUIRED_PROJECT_REF}]. ` +
      `Host must be exactly "${expectedDirectHost}" or pooler username must be exactly "${expectedPoolerUsername}".`
    );
  }

  return { isDirect, isPooler, hostname };
}

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

export async function runStagingMigrations(dbUrl, projectRef) {
  // Validate project ref and URL without printing credentials
  const targetInfo = validateStagingDatabaseUrl(dbUrl, projectRef);
  console.log(`[Staging Migration] Verified target: ${targetInfo.hostname} (Direct: ${targetInfo.isDirect}, Pooler: ${targetInfo.isPooler})`);

  console.log('[Staging Migration] Connecting to remote PostgreSQL...');
  const sql = postgres(dbUrl, {
    ssl: 'require',
    max: 1,
    connect_timeout: 15,
    idle_timeout: 10,
    // Disable prepared statements for compatibility with transaction pooler
    prepare: !targetInfo.isPooler
  });

  try {
    const [dbInfo] = await sql`SELECT current_database() as db, current_user as usr`;
    console.log(`[Staging Migration] Connected successfully to database "${dbInfo.db}".`);

    // Ensure standard Supabase migration tracking schema and table exist
    await sql`CREATE SCHEMA IF NOT EXISTS supabase_migrations`;
    await sql`
      CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
        version TEXT PRIMARY KEY,
        statements TEXT[],
        name TEXT
      )
    `;

    // Also maintain a backup log in public._staging_applied_migrations
    await sql`
      CREATE TABLE IF NOT EXISTS public._staging_applied_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;

    const appliedRows = await sql`SELECT version FROM supabase_migrations.schema_migrations`;
    const appliedSet = new Set(appliedRows.map(r => r.version));

    const migrationsDir = path.resolve('supabase', 'migrations');

    for (const mig of MIGRATIONS) {
      const version = mig.split('_')[0];

      if (appliedSet.has(version)) {
        console.log(`[Staging Migration] Already applied: ${mig} (version ${version})`);
        continue;
      }

      console.log(`[Staging Migration] Applying: ${mig}...`);
      const filePath = path.join(migrationsDir, mig);
      if (!fs.existsSync(filePath)) {
        throw new Error(`Migration file not found: ${mig}`);
      }

      const sqlContent = fs.readFileSync(filePath, 'utf8');

      // Execute migration in a single transaction
      await sql.begin(async tx => {
        await tx.unsafe(sqlContent);
        await tx`
          INSERT INTO supabase_migrations.schema_migrations (version, name)
          VALUES (${version}, ${mig})
          ON CONFLICT (version) DO NOTHING
        `;
        await tx`
          INSERT INTO public._staging_applied_migrations (name)
          VALUES (${mig})
          ON CONFLICT (name) DO NOTHING
        `;
      });

      console.log(`[Staging Migration] Successfully applied: ${mig}`);
    }

    console.log('[Staging Migration] All 9 migrations successfully verified on cloud staging!');
  } catch (err) {
    // Sanitize any potential leakage of password or full connection URI
    const sanitizedMsg = err.message ? err.message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[SANITIZED_DB_URL]') : 'Unknown database error';
    throw new Error(sanitizedMsg);
  } finally {
    await sql.end();
  }
}

if (process.argv[1]?.endsWith('migrate-staging.mjs')) {
  const dbUrl = process.env.STAGING_DATABASE_URL;
  const projectRef = process.env.STAGING_PROJECT_REF;

  try {
    validateStagingProjectRef(projectRef);
  } catch (err) {
    console.error('[Staging Migration Fatal Error]:', err.message);
    process.exit(1);
  }

  runStagingMigrations(dbUrl, projectRef).catch(err => {
    console.error('[Staging Migration Fatal Error]:', err.message);
    process.exit(1);
  });
}
