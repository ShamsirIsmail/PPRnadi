import { createServerSupabaseClient } from '../supabase/server';
import type { ProfileRow } from '@/types/database';
import type { User } from '@supabase/supabase-js';

export interface AuthContext {
  user: User | null;
  profile: ProfileRow | null;
}

/**
 * Validates the user identity server-side using supabase.auth.getUser()
 * and resolves their trusted profile and estate/building assignments.
 */
export async function getAuthContext(): Promise<AuthContext> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      return { user: null, profile: null };
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      return { user, profile: null };
    }

    return { user, profile: profile as ProfileRow };
  } catch {
    return { user: null, profile: null };
  }
}

/**
 * Requires an authenticated resident with an assigned estate and building.
 * Throws structured errors for authorization failures.
 */
export async function requireResident(): Promise<{ user: User; profile: ProfileRow }> {
  const { user, profile } = await getAuthContext();
  if (!user) {
    throw new Error('UNAUTHORIZED: Sila log masuk untuk mengakses perkhidmatan penduduk.');
  }
  if (!profile) {
    throw new Error('PROFILE_MISSING: Profil pengguna belum diwujudkan dalam sistem.');
  }
  if (profile.role !== 'resident') {
    throw new Error('FORBIDDEN_ROLE: Akses penduduk terhad kepada akaun penduduk.');
  }
  if (!profile.assigned_estate_id || !profile.assigned_building_id) {
    throw new Error('UNASSIGNED_RESIDENT: Akaun anda belum disahkan ke mana-mana blok atau perumahan.');
  }
  return { user, profile };
}

/**
 * Requires an authenticated manager with an assigned estate.
 * Throws structured errors for authorization failures.
 */
export async function requireManager(): Promise<{ user: User; profile: ProfileRow }> {
  const { user, profile } = await getAuthContext();
  if (!user) {
    throw new Error('UNAUTHORIZED: Sila log masuk untuk mengakses portal pengurusan.');
  }
  if (!profile) {
    throw new Error('PROFILE_MISSING: Profil staf pengurusan belum diwujudkan.');
  }
  if (profile.role !== 'management') {
    throw new Error('FORBIDDEN_ROLE: Kawasan ini dikhaskan untuk kakitangan pengurusan sahaja.');
  }
  if (!profile.assigned_estate_id) {
    throw new Error('UNASSIGNED_MANAGER: Akaun pengurusan anda belum ditugaskan ke kawasan perumahan.');
  }
  return { user, profile };
}
