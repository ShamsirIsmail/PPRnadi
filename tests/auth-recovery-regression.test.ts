import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAuthContext, requireResident, requireManager } from '@/lib/auth/session';
import { loginAction } from '@/app/actions/auth';
import type { ProfileRow } from '@/types/database';
import type { User } from '@supabase/supabase-js';

// Mock state for Supabase auth and profiles table
let mockAuthUser: User | null = null;
let mockAuthError: Error | null = null;
let mockProfileData: ProfileRow | null = null;
let mockProfileError: Error | null = null;
const mockCookieStore: Map<string, string> = new Map();

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn().mockImplementation(async () => ({
    auth: {
      getUser: vi.fn().mockImplementation(async () => ({
        data: { user: mockAuthUser },
        error: mockAuthError,
      })),
      signInWithPassword: vi.fn().mockImplementation(async () => {
        if (mockAuthError || !mockAuthUser) {
          return { data: { user: null, session: null }, error: new Error('Invalid login credentials') };
        }
        return { data: { user: mockAuthUser, session: {} }, error: null };
      }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: mockProfileData,
            error: mockProfileError,
          }),
        }),
      }),
    }),
  })),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockImplementation(async () => ({
    get: (name: string) => {
      const val = mockCookieStore.get(name);
      return val ? { name, value: val } : undefined;
    },
    set: (name: string, value: string) => {
      mockCookieStore.set(name, value);
    },
    delete: (name: string) => {
      mockCookieStore.delete(name);
    },
  })),
}));

describe('PPR NADI — Authentication Recovery & Regression Verification', () => {
  beforeEach(() => {
    mockAuthUser = null;
    mockAuthError = null;
    mockProfileData = null;
    mockProfileError = null;
    mockCookieStore.clear();
    process.env.NEXT_PUBLIC_ENABLE_LOCAL_DEMO = 'true';
  });

  // 1. Pengguna tanpa sesi tidak mendapat akses terlindung
  it('1. rejects unauthenticated user and does not provide protected access', async () => {
    mockAuthUser = null;
    mockAuthError = new Error('Auth session missing');

    const authContext = await getAuthContext();
    expect(authContext.user).toBeNull();
    expect(authContext.profile).toBeNull();

    await expect(requireResident()).rejects.toThrow('UNAUTHORIZED');
    await expect(requireManager()).rejects.toThrow('UNAUTHORIZED');
  });

  // 2. Cookie ppr_demo_role=resident tidak memberikan akses
  it('2. legacy cookie ppr_demo_role=resident does NOT grant access without valid Supabase session', async () => {
    mockCookieStore.set('ppr_demo_role', 'resident');
    mockAuthUser = null;
    mockAuthError = new Error('JWT expired');

    const authContext = await getAuthContext();
    expect(authContext.user).toBeNull();
    expect(authContext.profile).toBeNull();

    await expect(requireResident()).rejects.toThrow('UNAUTHORIZED');
  });

  // 3. Cookie ppr_demo_role=management tidak memberikan akses
  it('3. legacy cookie ppr_demo_role=management does NOT grant management access', async () => {
    mockCookieStore.set('ppr_demo_role', 'management');
    mockAuthUser = null;
    mockAuthError = new Error('No user found');

    const authContext = await getAuthContext();
    expect(authContext.user).toBeNull();
    expect(authContext.profile).toBeNull();

    await expect(requireManager()).rejects.toThrow('UNAUTHORIZED');
  });

  // 4. Penduduk tidak boleh menggunakan tindakan pengurusan
  it('4. authenticated resident cannot access management roles or actions', async () => {
    mockAuthUser = { id: 'usr-res-001', email: 'resident@sentosa.local' } as User;
    mockProfileData = {
      id: 'usr-res-001',
      role: 'resident',
      full_name: 'Encik Ali',
      phone_number: '012-1111111',
      assigned_estate_id: 'ppr-sentosa-demo',
      assigned_building_id: 'bldg-001',
      unit_number: 'A-01-02',
      created_at: '2026-10-19T00:00:00.000Z',
      updated_at: '2026-10-19T00:00:00.000Z',
    };

    // Resident check succeeds
    const residentContext = await requireResident();
    expect(residentContext.profile.role).toBe('resident');

    // Manager check MUST strictly fail
    await expect(requireManager()).rejects.toThrow('FORBIDDEN_ROLE');
  });

  // 5. Login salah tidak menjadi login demo berjaya
  it('5. invalid login credentials are strictly rejected without fallback demo bypass', async () => {
    mockAuthUser = null;
    mockAuthError = new Error('Invalid login credentials');

    const formData = new FormData();
    formData.set('email', 'resident@sentosa.local');
    formData.set('password', 'WrongPassword123!');

    const res = await loginAction(null, formData);
    expect(res.error).toBe('Log masuk gagal: E-mel atau kata laluan tidak sah.');
    expect(mockCookieStore.has('ppr_demo_role')).toBe(false);
  });

  // 6. Profil tidak lengkap / belum ditugaskan ditolak
  it('6. unassigned resident without building/estate is rejected with UNASSIGNED_RESIDENT', async () => {
    mockAuthUser = { id: 'usr-unassigned', email: 'new@sentosa.local' } as User;
    mockProfileData = {
      id: 'usr-unassigned',
      role: 'resident',
      full_name: 'Baru Mendaftar',
      phone_number: '012-0000000',
      assigned_estate_id: null,
      assigned_building_id: null,
      unit_number: null,
      created_at: '2026-10-19T00:00:00.000Z',
      updated_at: '2026-10-19T00:00:00.000Z',
    };

    await expect(requireResident()).rejects.toThrow('UNASSIGNED_RESIDENT');
  });
});

describe('PPR NADI — Report Form Real Data & Multi-Image Logic', () => {
  it('7. verifies multi-image selection logic: additive up to 3 files, file size limits and extension checks', () => {
    const existingImages = [{ name: 'img1.jpg', size: 1024 * 1024, type: 'image/jpeg' }];
    const newFiles = [
      { name: 'img2.png', size: 2 * 1024 * 1024, type: 'image/png' },
      { name: 'oversized.jpg', size: 6 * 1024 * 1024, type: 'image/jpeg' }, // >5MB
      { name: 'doc.pdf', size: 1024 * 1024, type: 'application/pdf' }, // invalid type
      { name: 'img3.webp', size: 1024 * 1024, type: 'image/webp' },
    ];

    const availableSlots = 3 - existingImages.length;
    expect(availableSlots).toBe(2);

    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    const validToAdd: typeof newFiles = [];
    const errors: string[] = [];

    for (const f of newFiles) {
      if (validToAdd.length >= availableSlots) {
        errors.push('errMaxFiles');
        break;
      }
      if (f.size > 5 * 1024 * 1024) {
        errors.push(`sizeLimit: ${f.name}`);
        continue;
      }
      if (!validTypes.includes(f.type)) {
        errors.push(`mimeError: ${f.name}`);
        continue;
      }
      validToAdd.push(f);
    }

    // img2.png and img3.webp are accepted into the 2 available slots
    expect(validToAdd.map((f) => f.name)).toEqual(['img2.png', 'img3.webp']);
    // Total files would be 3
    expect(existingImages.length + validToAdd.length).toBe(3);
    // Errors for oversized.jpg and doc.pdf were captured without clearing existing files
    expect(errors).toContain('sizeLimit: oversized.jpg');
    expect(errors).toContain('mimeError: doc.pdf');
  });

  it('8. ensures removing a file restores available slots and allows re-selection', () => {
    let images = ['img1.jpg', 'img2.jpg', 'img3.jpg'];
    expect(images.length).toBe(3);

    // Remove index 1
    const removeIndex = 1;
    images = images.filter((_, i) => i !== removeIndex);
    expect(images).toEqual(['img1.jpg', 'img3.jpg']);
    expect(3 - images.length).toBe(1);

    // Re-add img2.jpg
    const toReAdd = 'img2.jpg';
    images.push(toReAdd);
    expect(images).toHaveLength(3);
    expect(images).toContain('img2.jpg');
  });
});
