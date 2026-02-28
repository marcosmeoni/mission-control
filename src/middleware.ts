import { NextRequest, NextResponse } from 'next/server';

const MC_API_TOKEN = process.env.MC_API_TOKEN;
const AUTH_USER = process.env.MC_BASIC_AUTH_USER;
const AUTH_PASS = process.env.MC_BASIC_AUTH_PASS;
const LOGIN_ENABLED = Boolean(AUTH_USER && AUTH_PASS);

const DEMO_MODE = process.env.DEMO_MODE === 'true';

function expectedSessionToken(): string | null {
  if (!AUTH_USER || !AUTH_PASS) return null;
  return btoa(`${AUTH_USER}:${AUTH_PASS}`);
}

function isApiAuthorized(request: NextRequest): boolean {
  // API bearer token support for automation / external callers
  if (!MC_API_TOKEN) return false;
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  return authHeader.substring(7) === MC_API_TOKEN;
}

function isLoggedIn(request: NextRequest): boolean {
  if (!LOGIN_ENABLED) return true;
  const cookie = request.cookies.get('mc_session')?.value;
  const expected = expectedSessionToken();
  return Boolean(cookie && expected && cookie === expected);
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip static assets
  if (
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico' ||
    pathname === '/favicon.svg'
  ) {
    return NextResponse.next();
  }

  // Public routes
  if (
    pathname === '/login' ||
    pathname === '/api/auth/login' ||
    pathname === '/api/auth/logout' ||
    pathname.startsWith('/public/') ||
    pathname.startsWith('/api/public/')
  ) {
    return NextResponse.next();
  }

  const loggedIn = isLoggedIn(request);

  // Non-API routes: redirect to login page if needed
  if (!pathname.startsWith('/api/')) {
    if (!loggedIn) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      url.searchParams.set('next', pathname);
      return NextResponse.redirect(url);
    }

    if (DEMO_MODE) {
      const response = NextResponse.next();
      response.headers.set('X-Demo-Mode', 'true');
      return response;
    }

    return NextResponse.next();
  }

  // API routes: allow if logged-in cookie OR bearer token
  if (!loggedIn && !isApiAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Demo mode write protection
  if (DEMO_MODE) {
    const method = request.method.toUpperCase();
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      return NextResponse.json(
        { error: 'Demo mode — this is a read-only instance. Visit github.com/crshdn/mission-control to run your own!' },
        { status: 403 }
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|favicon.svg).*)'],
};
