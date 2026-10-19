'use server';

import { createServerSupabaseClient } from '../../lib/supabase/server';
import { redirect } from 'next/navigation';

export interface LoginActionResult {
  error?: string;
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
