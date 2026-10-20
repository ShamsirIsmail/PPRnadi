'use server';

import { createServerSupabaseClient } from '../../lib/supabase/server';
import { redirect } from 'next/navigation';

export interface LoginActionResult {
  error?: string;
  code?: string;
  success?: boolean;
}

export async function loginAction(
  _prevState: LoginActionResult | null,
  formData: FormData
): Promise<LoginActionResult> {
  const email = (formData.get('email') as string)?.trim();
  const password = formData.get('password') as string;
  const returnTo = (formData.get('returnTo') as string)?.trim();

  if (!email || !password) {
    return { error: 'Sila masukkan e-mel dan kata laluan.' };
  }

  let redirectTo: string | null = null;

  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.user) {
      return { error: 'Log masuk gagal: E-mel atau kata laluan tidak sah.' };
    } else {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, assigned_estate_id, assigned_building_id')
        .eq('id', data.user.id)
        .single();

      if (!profile) {
        return { error: 'Akaun anda belum mempunyai profil aktif dalam sistem pangkalan data.' };
      }

      // Safe role-based returnTo validation
      if (returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') && !returnTo.startsWith('/\\')) {
        if (profile.role === 'management' && returnTo.startsWith('/management')) {
          redirectTo = returnTo;
        } else if (profile.role === 'resident' && returnTo.startsWith('/resident')) {
          redirectTo = returnTo;
        } else {
          redirectTo = profile.role === 'management' ? '/management' : '/resident';
        }
      } else {
        redirectTo = profile.role === 'management' ? '/management' : '/resident';
      }
    }
  } catch (err: unknown) {
    if ((err as Error)?.message?.includes('NEXT_REDIRECT')) {
      throw err;
    }
    return { error: 'Ralat pelayan semasa log masuk. Sila cuba sebentar lagi.' };
  }

  if (redirectTo) {
    redirect(redirectTo);
  }

  return { success: true };
}

export async function logoutAction(): Promise<void> {
  const { cookies } = await import('next/headers');
  const cookieStore = await cookies();
  cookieStore.delete('ppr_demo_role');

  try {
    const supabase = await createServerSupabaseClient();
    await supabase.auth.signOut();
  } catch {
    // Continue
  }
  redirect('/login');
}

export type DemoRole = 'resident' | 'management';

export async function demoLoginAction(role: DemoRole): Promise<LoginActionResult> {
  // 1. Explicit server environment flag check
  if (process.env.ENABLE_DEMO_LOGIN !== 'true') {
    return { error: 'Log masuk demo dimatikan pada persekitaran ini.' };
  }

  // 2. Strict whitelist validation: only 'resident' or 'management' accepted
  if (role !== 'resident' && role !== 'management') {
    return { error: 'Pilihan peranan demo tidak sah.' };
  }

  // 3. Rate limiting check (cookie HMAC + IP tracking)
  const { checkDemoRateLimit } = await import('../../lib/auth/demo-rate-limiter');
  const rateLimitResult = await checkDemoRateLimit();
  if (!rateLimitResult.allowed) {
    return {
      error:
        rateLimitResult.message ||
        'Had percubaan log masuk demo dicapai. Sila tunggu sebentar sebelum mencuba lagi.',
      code: rateLimitResult.code || 'DEMO_RATE_LIMITED',
    };
  }

  // 4. Resolve credentials from SERVER environment only (no hardcoded credentials)
  let email: string;
  let password: string | undefined;
  let targetUrl: string;
  let expectedRole: 'resident' | 'management';

  if (role === 'resident') {
    email = 'resident.rejang@nadi.local';
    password = process.env.STAGING_RESIDENT_PASSWORD || process.env.DEMO_RESIDENT_PASSWORD;
    targetUrl = '/resident';
    expectedRole = 'resident';
  } else {
    email = 'manager.rejang@nadi.local';
    password = process.env.STAGING_MANAGER_PASSWORD || process.env.DEMO_MANAGER_PASSWORD;
    targetUrl = '/management';
    expectedRole = 'management';
  }

  if (!password) {
    return {
      error: 'Konfigurasi kata laluan akaun demo belum ditetapkan pada pelayan.',
    };
  }

  // 5. Standard Supabase Auth signInWithPassword and session cookie management
  let redirectTo: string | null = null;
  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.user) {
      return { error: 'Log masuk gagal: E-mel atau kata laluan akaun demo tidak sah.' };
    }

    // 6. Confirm authoritative role from database profiles table
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', data.user.id)
      .single();

    if (!profile || profile.role !== expectedRole) {
      // Abort and sign out if role doesn't match expected profile
      await supabase.auth.signOut();
      return { error: 'Akaun tidak mempunyai profil atau peranan yang sepadan.' };
    }

    redirectTo = targetUrl;
  } catch (err: unknown) {
    if ((err as Error)?.message?.includes('NEXT_REDIRECT')) {
      throw err;
    }
    return { error: 'Ralat pelayan semasa log masuk demo. Sila cuba sebentar lagi.' };
  }

  if (redirectTo) {
    redirect(redirectTo);
  }

  return { success: true };
}
