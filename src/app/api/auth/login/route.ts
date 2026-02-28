import { NextRequest, NextResponse } from 'next/server';

const AUTH_USER = process.env.MC_BASIC_AUTH_USER;
const AUTH_PASS = process.env.MC_BASIC_AUTH_PASS;

function expectedToken(): string | null {
  if (!AUTH_USER || !AUTH_PASS) return null;
  return Buffer.from(`${AUTH_USER}:${AUTH_PASS}`).toString('base64');
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const username = String(body?.username || '');
    const password = String(body?.password || '');

    if (!AUTH_USER || !AUTH_PASS) {
      return NextResponse.json({ error: 'Login is not configured' }, { status: 503 });
    }

    if (username !== AUTH_USER || password !== AUTH_PASS) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const token = expectedToken();
    const response = NextResponse.json({ ok: true });
    response.cookies.set('mc_session', token || '', {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/',
      maxAge: 60 * 60 * 12,
    });

    return response;
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
