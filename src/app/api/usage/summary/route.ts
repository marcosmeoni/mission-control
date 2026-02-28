import { NextResponse } from 'next/server';
import { getOpenClawClient } from '@/lib/openclaw/client';
import { queryAll } from '@/lib/db';

interface SessionRow {
  openclaw_session_id: string;
  agent_id: string;
}

interface AgentRow {
  id: string;
  name: string;
  workspace_id: string;
}

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const client = getOpenClawClient();
    if (!client.isConnected()) {
      try {
        await client.connect();
      } catch {
        return NextResponse.json({ error: 'Failed to connect to OpenClaw Gateway' }, { status: 503 });
      }
    }

    const payload = await client.listSessions() as unknown as { sessions?: any[] } | any[];
    const sessions = Array.isArray(payload) ? payload : (Array.isArray(payload?.sessions) ? payload.sessions : []);

    const mapRows = queryAll<SessionRow>('SELECT openclaw_session_id, agent_id FROM openclaw_sessions');
    const agentRows = queryAll<AgentRow>('SELECT id, name, workspace_id FROM agents');

    const mapBySession = new Map(mapRows.map((r) => [r.openclaw_session_id, r.agent_id]));
    const mapAgent = new Map(agentRows.map((a) => [a.id, a]));

    const total = { inputTokens: 0, outputTokens: 0, totalTokens: 0, sessions: 0 };
    const byModel: Record<string, { inputTokens: number; outputTokens: number; totalTokens: number; sessions: number }> = {};
    const byAgent: Record<string, { agentId: string; agentName: string; workspaceId: string; model: string; inputTokens: number; outputTokens: number; totalTokens: number; sessions: number }> = {};

    for (const s of sessions) {
      const key = String(s?.key || '');
      const model = String(s?.model || s?.modelProvider + '/' + s?.model || 'unknown');
      const input = Number(s?.inputTokens || 0);
      const output = Number(s?.outputTokens || 0);
      const t = Number(s?.totalTokens || input + output || 0);

      total.inputTokens += input;
      total.outputTokens += output;
      total.totalTokens += t;
      total.sessions += 1;

      if (!byModel[model]) byModel[model] = { inputTokens: 0, outputTokens: 0, totalTokens: 0, sessions: 0 };
      byModel[model].inputTokens += input;
      byModel[model].outputTokens += output;
      byModel[model].totalTokens += t;
      byModel[model].sessions += 1;

      // key: agent:main:<openclaw_session_id>
      const maybeSessionId = key.startsWith('agent:main:') ? key.slice('agent:main:'.length) : '';
      const agentId = mapBySession.get(maybeSessionId);
      if (agentId) {
        const agent = mapAgent.get(agentId);
        const label = agent?.name || agentId;
        const k = `${agentId}::${model}`;
        if (!byAgent[k]) {
          byAgent[k] = {
            agentId,
            agentName: label,
            workspaceId: agent?.workspace_id || 'unknown',
            model,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            sessions: 0,
          };
        }
        byAgent[k].inputTokens += input;
        byAgent[k].outputTokens += output;
        byAgent[k].totalTokens += t;
        byAgent[k].sessions += 1;
      }
    }

    return NextResponse.json({
      total,
      byModel,
      byAgent: Object.values(byAgent).sort((a, b) => b.totalTokens - a.totalTokens).slice(0, 20),
      sessionsCount: sessions.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('usage summary error', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
