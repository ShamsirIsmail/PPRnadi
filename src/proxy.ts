import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return supabaseResponse;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // Server-side identity validation (DO NOT use getSession which is unverified)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // Protect private data responses from caching
  if (pathname.startsWith('/resident') || pathname.startsWith('/management')) {
    supabaseResponse.headers.set('Cache-Control', 'no-store, private');
  }

  // Helper to attach no-store header to redirects
  function makeRedirect(url: URL) {
    const res = NextResponse.redirect(url);
    res.headers.set('Cache-Control', 'no-store, private');
    return res;
  }

  // 1. Unauthenticated users trying to access protected paths
  if (!user && (pathname.startsWith('/resident') || pathname.startsWith('/management'))) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('returnTo', pathname);
    return makeRedirect(url);
  }

  // 2. Authenticated user routing & role boundary enforcement
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, assigned_estate_id, assigned_building_id')
      .eq('id', user.id)
      .single();

    const role = profile?.role;

    // Logged-in user visiting login page -> redirect to appropriate portal
    if (pathname === '/login') {
      const url = request.nextUrl.clone();
      url.pathname = role === 'management' ? '/management' : '/resident';
      return makeRedirect(url);
    }

    // Residents cannot enter management routes
    if (pathname.startsWith('/management') && role !== 'management') {
      const url = request.nextUrl.clone();
      url.pathname = '/resident';
      return makeRedirect(url);
    }

    // Management users directed to management portal
    if (pathname.startsWith('/resident') && role === 'management') {
      const url = request.nextUrl.clone();
      url.pathname = '/management';
      return makeRedirect(url);
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: ['/resident/:path*', '/management/:path*', '/login'],
};
