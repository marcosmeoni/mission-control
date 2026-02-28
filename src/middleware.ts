import { NextRequest, NextResponse } from 'next/server';

// API bearer token (optional)
const MC_API_TOKEN = process.env.MC_API_TOKEN;
if (!MC_API_TOKEN) {
  console.warn('[SECURITY WARNING] MC_API_TOKEN not set - API authentication is DISABLED (local dev mode)');
}

// Basic auth for dashboard + API (optional but recommended for internet-exposed instances)
const MC_BASIC_AUTH_USER = process.env.MC_BASIC_AUTH_USER;
const MC_BASIC_AUTH_PASS = process.env.MC_BASIC_AUTH_PASS;
const BASIC_AUTH_ENABLED = Boolean(MC_BASIC_AUTH_USER && MC_BASIC_AUTH_PASS);
if (!BASIC_AUTH_ENABLED) {
  console.warn('[SECURITY WARNING] Basic auth is DISABLED (set MC_BASIC_AUTH_USER + MC_BASIC_AUTH_PASS)');
}

/**
 * Check if a request originates from the same host (browser UI).
 * Same-origin browser requests include a Referer or Origin header
 * pointing to the MC server itself. Server-side render fetches
 * (Next.js RSC) come from the same process and have no Origin.
 */
function isSameOriginRequest(request: NextRequest): boolean {
  const host = request.headers.get('host');
  if (!host) return false;

  // Server-side fetches from Next.js (no origin/referer) — same process
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');

  // If neither origin nor referer is set, this is likely a server-side
  // fetch or a direct curl. Require auth for these (external API calls).
  if (!origin && !referer) return false;

  // Check if Origin matches the host
  if (origin) {
    try {
      const originUrl = new URL(origin);
      if (originUrl.host === host) return true;
    } catch {
      // Invalid origin header
    }
  }

  // Check if Referer matches the host
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      if (refererUrl.host === host) return true;
    } catch {
      // Invalid referer header
    }
  }

  return false;
}

// Demo mode — read-only, blocks all mutations
const DEMO_MODE = process.env.DEMO_MODE === 'true';
if (DEMO_MODE) {
  console.log('[DEMO] Running in demo mode — all write operations are blocked');
}

function unauthorizedBasicAuth(): NextResponse {
  const response = new NextResponse('Authentication required', { status: 401 });
  response.headers.set('WWW-Authenticate', 'Basic realm="Mission Control"');
  return response;
}

function hasValidBasicAuth(request: NextRequest): boolean {
  if (!BASIC_AUTH_ENABLED) return true;

  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Basic ')) return false;

  try {
    const base64 = authHeader.substring(6);
    const decoded = atob(base64);
    const idx = decoded.indexOf(':');
    if (idx < 0) return false;

    const user = decoded.slice(0, idx);
    const pass = decoded.slice(idx + 1);

    return user === MC_BASIC_AUTH_USER && pass === MC_BASIC_AUTH_PASS;
  } catch {
    return false;
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip auth for static Next assets and favicon
  if (
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico' ||
    pathname === '/favicon.svg'
  ) {
    return NextResponse.next();
  }

  // Basic auth for UI + API when enabled
  if (!hasValidBasicAuth(request)) {
    return unauthorizedBasicAuth();
  }

  // Non-API routes: basic auth already checked
  if (!pathname.startsWith('/api/')) {
    // Add demo mode header for UI detection
    if (DEMO_MODE) {
      const response = NextResponse.next();
      response.headers.set('X-Demo-Mode', 'true');
      return response;
    }
    return NextResponse.next();
  }

  // Demo mode: block all write operations
  if (DEMO_MODE) {
    const method = request.method.toUpperCase();
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      return NextResponse.json(
        { error: 'Demo mode — this is a read-only instance. Visit github.com/crshdn/mission-control to run your own!' },
        { status: 403 }
      );
    }
    return NextResponse.next();
  }

  // If MC_API_TOKEN is not set, auth is disabled (dev mode)
  if (!MC_API_TOKEN) {
    return NextResponse.next();
  }

  // Allow same-origin browser requests (UI fetching its own API)
  if (isSameOriginRequest(request)) {
    return NextResponse.next();
  }

  // Special case: /api/events/stream (SSE) - allow token as query param
  if (pathname === '/api/events/stream') {
    const queryToken = request.nextUrl.searchParams.get('token');
    if (queryToken && queryToken === MC_API_TOKEN) {
      return NextResponse.next();
    }
    // Fall through to header check below
  }

  // Check Authorization header for bearer token
  const authHeader = request.headers.get('authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix
  
  if (token !== MC_API_TOKEN) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|favicon.svg).*)'],
};
