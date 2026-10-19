import fs from 'node:fs';
import { validateStagingDatabaseUrl } from './migrate-staging.mjs';

/**
 * Validates presence and format of .env.staging.local without printing any secrets.
 */

const EXPECTED_REF = 'mhtlcvvqwxkhkeqhzbrk';

export function checkStagingEnv() {
  if (!fs.existsSync('.env.staging.local')) {
    return {
      fileFound: false,
      summary: {}
    };
  }

  process.loadEnvFile('.env.staging.local');

  const ref = process.env.STAGING_PROJECT_REF;
  const url = process.env.STAGING_SUPABASE_URL;
  const anon = process.env.STAGING_SUPABASE_ANON_KEY;
  const service = process.env.STAGING_SERVICE_ROLE_KEY;
  const dbUrl = process.env.STAGING_DATABASE_URL;
  const resPass = process.env.STAGING_RESIDENT_PASSWORD;
  const mgrPass = process.env.STAGING_MANAGER_PASSWORD;

  let dbValid = false;
  let dbError = null;
  if (dbUrl) {
    try {
      validateStagingDatabaseUrl(dbUrl, EXPECTED_REF);
      dbValid = true;
    } catch (e) {
      dbError = e.message;
    }
  }

  return {
    fileFound: true,
    summary: {
      STAGING_PROJECT_REF: ref === EXPECTED_REF ? 'OK (Padan)' : (ref ? 'RALAT (Bukan mhtlcvvqwxkhkeqhzbrk)' : 'BELUM DIISI'),
      STAGING_SUPABASE_URL: url?.startsWith(`https://${EXPECTED_REF}.supabase.co`) ? 'OK (Padan)' : (url ? 'RALAT' : 'BELUM DIISI'),
      STAGING_SUPABASE_ANON_KEY: anon && anon.length > 20 ? 'OK (Wujud)' : 'BELUM DIISI',
      STAGING_SERVICE_ROLE_KEY: service && service.length > 20 ? 'OK (Wujud)' : 'BELUM DIISI',
      STAGING_DATABASE_URL: dbValid ? 'OK (Format Sah & Padan Projek)' : (dbUrl ? `RALAT: ${dbError}` : 'BELUM DIISI'),
      STAGING_RESIDENT_PASSWORD: resPass && resPass.length >= 6 ? 'OK (Wujud)' : 'BELUM DIISI',
      STAGING_MANAGER_PASSWORD: mgrPass && mgrPass.length >= 6 ? 'OK (Wujud)' : 'BELUM DIISI'
    },
    allReady: ref === EXPECTED_REF &&
              url?.startsWith(`https://${EXPECTED_REF}.supabase.co`) &&
              Boolean(anon && anon.length > 20) &&
              Boolean(service && service.length > 20) &&
              dbValid &&
              Boolean(resPass && resPass.length >= 6) &&
              Boolean(mgrPass && mgrPass.length >= 6)
  };
}

if (process.argv[1]?.endsWith('check-staging-env.mjs')) {
  const result = checkStagingEnv();
  console.log(JSON.stringify(result, null, 2));
}
