import { createServerClient } from '@supabase/ssr';
try { process.loadEnvFile('.env.local'); } catch {}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:64321';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const RESIDENT_PASSWORD = process.env.DEMO_RESIDENT_PASSWORD || 'ResidentPPR2026!';
const MANAGER_PASSWORD = process.env.DEMO_MANAGER_PASSWORD || 'ManagerPPR2026!';

async function verifyLogins() {
  const client = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: { getAll: () => [], setAll: () => {} }
  });

  const { data: resData, error: resError } = await client.auth.signInWithPassword({
    email: 'resident.rejang@nadi.local',
    password: RESIDENT_PASSWORD,
  });
  if (resError) {
    console.error('Resident login failed:', resError.message);
  } else {
    console.log('✅ Resident login SUCCESS:', resData.user.email, 'ID:', resData.user.id);
  }

  const { data: mgrData, error: mgrError } = await client.auth.signInWithPassword({
    email: 'manager.rejang@nadi.local',
    password: MANAGER_PASSWORD,
  });
  if (mgrError) {
    console.error('Manager login failed:', mgrError.message);
  } else {
    console.log('✅ Manager login SUCCESS:', mgrData.user.email, 'ID:', mgrData.user.id);
  }
}

verifyLogins();
