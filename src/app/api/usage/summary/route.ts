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

    // Pricing (USD per 1M tokens)
    let pricing: Record<string, { inputPer1M: number; outputPer1M: number }> = {
      'anthropic/claude-sonnet-4-6': { inputPer1M: 3, outputPer1M: 15 },
      'openai-codex/gpt-5.3-codex': { inputPer1M: 2, outputPer1M: 8 },
    };
    try {
      const fs = await import('fs');
      const p = '/root/.openclaw/workspace/projects/personal/mission-control/data/model-pricing.json';
      if (fs.existsSync(p)) {
        const loaded = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (loaded?.pricing) pricing = loaded.pricing;
      }
    } catch {}

    const total = { inputTokens: 0, outputTokens: 0, totalTokens: 0, sessions: 0, estCostUsd: 0 };
    const byModel: Record<string, { inputTokens: number; outputTokens: number; totalTokens: number; sessions: number; estCostUsd: number }> = {};
    const byWorkspace: Record<string, { workspaceId: string; inputTokens: number; outputTokens: number; totalTokens: number; sessions: number; estCostUsd: number }> = {};
    const byAgent: Record<string, { agentId: string; agentName: string; workspaceId: string; model: string; inputTokens: number; outputTokens: number; totalTokens: number; sessions: number; estCostUsd: number }> = {};

    for (const s of sessions) {
      const key = String(s?.key || '');
      const provider = String(s?.modelProvider || '').trim();
      const rawModel = String(s?.model || 'unknown').trim();
      const model = rawModel.includes('/') ? rawModel : (provider ? `${provider}/${rawModel}` : rawModel);
      const input = Number(s?.inputTokens || 0);
      const output = Number(s?.outputTokens || 0);
      const t = Number(s?.totalTokens || input + output || 0);

      const bareModel = model.includes('/') ? model.split('/').slice(1).join('/') : model;
      const price = pricing[model] || pricing[bareModel] || { inputPer1M: 0, outputPer1M: 0 };
      const est = (input / 1_000_000) * price.inputPer1M + (output / 1_000_000) * price.outputPer1M;

      total.inputTokens += input;
      total.outputTokens += output;
      total.totalTokens += t;
      total.sessions += 1;
      total.estCostUsd += est;

      if (!byModel[model]) byModel[model] = { inputTokens: 0, outputTokens: 0, totalTokens: 0, sessions: 0, estCostUsd: 0 };
      byModel[model].inputTokens += input;
      byModel[model].outputTokens += output;
      byModel[model].totalTokens += t;
      byModel[model].sessions += 1;
      byModel[model].estCostUsd += est;

      // key: agent:main:<openclaw_session_id>
      const maybeSessionId = key.startsWith('agent:main:') ? key.slice('agent:main:'.length) : '';
      const agentId = mapBySession.get(maybeSessionId);
      if (agentId) {
        const agent = mapAgent.get(agentId);
        const workspaceId = agent?.workspace_id || 'unknown';

        if (!byWorkspace[workspaceId]) {
          byWorkspace[workspaceId] = { workspaceId, inputTokens: 0, outputTokens: 0, totalTokens: 0, sessions: 0, estCostUsd: 0 };
        }
        byWorkspace[workspaceId].inputTokens += input;
        byWorkspace[workspaceId].outputTokens += output;
        byWorkspace[workspaceId].totalTokens += t;
        byWorkspace[workspaceId].sessions += 1;
        byWorkspace[workspaceId].estCostUsd += est;

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
            estCostUsd: 0,
          };
        }
        byAgent[k].inputTokens += input;
        byAgent[k].outputTokens += output;
        byAgent[k].totalTokens += t;
        byAgent[k].sessions += 1;
        byAgent[k].estCostUsd += est;
      }
    }

    return NextResponse.json({
      total,
      byModel,
      byWorkspace: Object.values(byWorkspace).sort((a, b) => b.totalTokens - a.totalTokens),
      byAgent: Object.values(byAgent).sort((a, b) => b.totalTokens - a.totalTokens).slice(0, 20),
      pricing,
      sessionsCount: sessions.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('usage summary error', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
