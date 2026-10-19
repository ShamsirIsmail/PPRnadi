import fs from 'node:fs';
import { validateStagingApiUrl, ALLOWED_STAGING_REF } from './staging-validation.mjs';
import { validateStagingDatabaseUrl, validateStagingProjectRef } from './migrate-staging.mjs';
import { createClient } from '@supabase/supabase-js';

/**
 * Validates presence, format, and connectivity of .env.staging.local without printing any secrets.
 */

export async function checkStagingEnv() {
  if (!fs.existsSync('.env.staging.local')) {
    return {
      fileFound: false,
      summary: {},
      allReady: false
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

  // 1. Ref validation
  let refValid = false;
  let refError = null;
  try {
    validateStagingProjectRef(ref);
    refValid = true;
  } catch (e) {
    refError = e.message;
  }

  // 2. API URL validation
  let urlValid = false;
  let urlError = null;
  if (url) {
    try {
      validateStagingApiUrl(url, ALLOWED_STAGING_REF);
      urlValid = true;
    } catch (e) {
      urlError = e.message;
    }
  }

  // 3. Database URL validation
  let dbValid = false;
  let dbError = null;
  if (dbUrl) {
    try {
      validateStagingDatabaseUrl(dbUrl, ALLOWED_STAGING_REF);
      dbValid = true;
    } catch (e) {
      // Never expose raw URI
      dbError = e.message;
    }
  }

  // 4. API connectivity check (authenticated ping without printing keys)
  let pingStatus = 'BELUM DIUJI';
  if (urlValid && service && service.length > 20) {
    try {
      const sb = createClient(url, service, {
        auth: { autoRefreshToken: false, persistSession: false }
      });
      const { error: pingErr } = await sb.from('buildings').select('count', { count: 'exact', head: true });
      if (pingErr && !pingErr.message?.includes('relation "public.buildings" does not exist')) {
        pingStatus = 'GAGAL: ' + pingErr.message;
      } else {
        pingStatus = 'LULUS (API & Service Role Aktif)';
      }
    } catch (e) {
      pingStatus = 'GAGAL KONEKSI: ' + e.message;
    }
  }

  const allReady = refValid &&
                   urlValid &&
                   Boolean(anon && anon.length > 20) &&
                   Boolean(service && service.length > 20) &&
                   dbValid &&
                   Boolean(resPass && resPass.length >= 6) &&
                   Boolean(mgrPass && mgrPass.length >= 6);

  return {
    fileFound: true,
    summary: {
      STAGING_PROJECT_REF: refValid ? 'OK (Padan: ' + ALLOWED_STAGING_REF + ')' : (ref ? `RALAT: ${refError}` : 'BELUM DIISI'),
      STAGING_SUPABASE_URL: urlValid ? 'OK (Format Sah & Padan Projek)' : (url ? `RALAT: ${urlError}` : 'BELUM DIISI'),
      STAGING_SUPABASE_ANON_KEY: anon && anon.length > 20 ? 'OK (Wujud)' : 'BELUM DIISI',
      STAGING_SERVICE_ROLE_KEY: service && service.length > 20 ? 'OK (Wujud)' : 'BELUM DIISI',
      STAGING_DATABASE_URL: dbValid ? 'OK (Format Sah & Padan Projek)' : (dbUrl ? `RALAT: ${dbError}` : 'BELUM DIISI'),
      STAGING_RESIDENT_PASSWORD: resPass && resPass.length >= 6 ? 'OK (Wujud)' : 'BELUM DIISI',
      STAGING_MANAGER_PASSWORD: mgrPass && mgrPass.length >= 6 ? 'OK (Wujud)' : 'BELUM DIISI',
      API_CONNECTIVITY: pingStatus
    },
    allReady
  };
}

if (process.argv[1]?.endsWith('check-staging-env.mjs')) {
  checkStagingEnv().then(res => {
    console.log(JSON.stringify(res, null, 2));
  }).catch(err => {
    console.error('Check error:', err.message);
    process.exit(1);
  });
}
