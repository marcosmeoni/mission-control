import { NextResponse } from 'next/server';
import { getOpenClawClient } from '@/lib/openclaw/client';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/openclaw/sessions/[id]/history - Get conversation history
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const client = getOpenClawClient();

    if (!client.isConnected()) {
      try {
        await client.connect();
      } catch {
        return NextResponse.json(
          { error: 'Failed to connect to OpenClaw Gateway' },
          { status: 503 }
        );
      }
    }

    // id can be sessionKey (agent:...) or sessionId (uuid). chat.history expects sessionKey.
    let sessionKey = id;
    if (!id.includes(':')) {
      try {
        const sessions = await client.listSessions() as Array<{ key?: string; sessionId?: string; id?: string }>;
        const match = sessions.find((s) => s.sessionId === id || s.id === id);
        if (match?.key) sessionKey = match.key;
      } catch {}
    }

    const history = await client.getSessionHistory(sessionKey);
    return NextResponse.json({ history, sessionKey });
  } catch (error) {
    console.error('Failed to get OpenClaw session history:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
