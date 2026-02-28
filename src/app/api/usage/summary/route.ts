import { NextResponse } from 'next/server';
import { getOpenClawClient } from '@/lib/openclaw/client';
import { queryAll } from '@/lib/db';
import fs from 'fs';

interface SessionRow {
  openclaw_session_id: string;
  agent_id: string;
}

interface AgentRow {
  id: string;
  name: string;
  workspace_id: string;
}

interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
}

type UsageTotals = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  sessions: number;
  estCostUsd: number;
};

type LedgerState = {
  lastBySession: Record<string, { input: number; output: number; total: number }>;
  cumulative: UsageTotals;
  byModel: Record<string, UsageTotals>;
  byWorkspace: Record<string, UsageTotals & { workspaceId: string; workspaceName: string; workspaceSlug: string }>;
  byAgent: Record<string, UsageTotals & { agentId: string; agentName: string; workspaceId: string; model: string }>;
};

export const dynamic = 'force-dynamic';

const LEDGER_PATH = '/root/.openclaw/workspace/projects/personal/mission-control/data/usage-ledger-state.json';

function emptyTotals(): UsageTotals {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, sessions: 0, estCostUsd: 0 };
}

function loadLedger(): LedgerState {
  try {
    if (!fs.existsSync(LEDGER_PATH)) {
      return { lastBySession: {}, cumulative: emptyTotals(), byModel: {}, byWorkspace: {}, byAgent: {} };
    }
    const raw = JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8'));
    return {
      lastBySession: raw.lastBySession || {},
      cumulative: raw.cumulative || emptyTotals(),
      byModel: raw.byModel || {},
      byWorkspace: raw.byWorkspace || {},
      byAgent: raw.byAgent || {},
    };
  } catch {
    return { lastBySession: {}, cumulative: emptyTotals(), byModel: {}, byWorkspace: {}, byAgent: {} };
  }
}

function saveLedger(state: LedgerState) {
  fs.mkdirSync('/root/.openclaw/workspace/projects/personal/mission-control/data', { recursive: true });
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(state, null, 2));
}

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
    const workspaceRows = queryAll<WorkspaceRow>('SELECT id, name, slug FROM workspaces');

    const mapBySession = new Map(mapRows.map((r) => [r.openclaw_session_id, r.agent_id]));
    const mapAgent = new Map(agentRows.map((a) => [a.id, a]));
    const mapWorkspace = new Map(workspaceRows.map((w) => [w.id, w]));

    // Pricing (USD per 1M tokens)
    let pricing: Record<string, { inputPer1M: number; outputPer1M: number }> = {
      'anthropic/claude-sonnet-4-6': { inputPer1M: 3, outputPer1M: 15 },
      'openai-codex/gpt-5.3-codex': { inputPer1M: 2, outputPer1M: 8 },
    };
    try {
      const p = '/root/.openclaw/workspace/projects/personal/mission-control/data/model-pricing.json';
      if (fs.existsSync(p)) {
        const loaded = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (loaded?.pricing) pricing = loaded.pricing;
      }
    } catch {}

    // Live snapshot
    const live = emptyTotals();

    // Cumulative ledger update
    const ledger = loadLedger();

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
      const estLive = (input / 1_000_000) * price.inputPer1M + (output / 1_000_000) * price.outputPer1M;

      live.inputTokens += input;
      live.outputTokens += output;
      live.totalTokens += t;
      live.sessions += 1;
      live.estCostUsd += estLive;

      const prev = ledger.lastBySession[key];
      const deltaInput = prev ? Math.max(0, input - prev.input) : input;
      const deltaOutput = prev ? Math.max(0, output - prev.output) : output;
      const deltaTotal = prev ? Math.max(0, t - prev.total) : t;

      // If session reset (lower numbers), update baseline without subtracting
      if (prev && (input < prev.input || output < prev.output || t < prev.total)) {
        ledger.lastBySession[key] = { input, output, total: t };
        continue;
      }

      if (deltaTotal > 0 || deltaInput > 0 || deltaOutput > 0) {
        const estDelta = (deltaInput / 1_000_000) * price.inputPer1M + (deltaOutput / 1_000_000) * price.outputPer1M;

        ledger.cumulative.inputTokens += deltaInput;
        ledger.cumulative.outputTokens += deltaOutput;
        ledger.cumulative.totalTokens += deltaTotal;
        ledger.cumulative.estCostUsd += estDelta;
        ledger.cumulative.sessions = live.sessions;

        if (!ledger.byModel[model]) ledger.byModel[model] = emptyTotals();
        ledger.byModel[model].inputTokens += deltaInput;
        ledger.byModel[model].outputTokens += deltaOutput;
        ledger.byModel[model].totalTokens += deltaTotal;
        ledger.byModel[model].estCostUsd += estDelta;

        const maybeSessionId = key.startsWith('agent:main:') ? key.slice('agent:main:'.length) : '';
        const agentId = mapBySession.get(maybeSessionId);
        if (agentId) {
          const agent = mapAgent.get(agentId);
          const workspaceId = agent?.workspace_id || 'unknown';
          const ws = mapWorkspace.get(workspaceId);

          if (!ledger.byWorkspace[workspaceId]) {
            ledger.byWorkspace[workspaceId] = {
              workspaceId,
              workspaceName: ws?.name || workspaceId,
              workspaceSlug: ws?.slug || workspaceId,
              ...emptyTotals(),
            };
          }
          ledger.byWorkspace[workspaceId].inputTokens += deltaInput;
          ledger.byWorkspace[workspaceId].outputTokens += deltaOutput;
          ledger.byWorkspace[workspaceId].totalTokens += deltaTotal;
          ledger.byWorkspace[workspaceId].estCostUsd += estDelta;

          const label = agent?.name || agentId;
          const ak = `${agentId}::${model}`;
          if (!ledger.byAgent[ak]) {
            ledger.byAgent[ak] = {
              agentId,
              agentName: label,
              workspaceId,
              model,
              ...emptyTotals(),
            };
          }
          ledger.byAgent[ak].inputTokens += deltaInput;
          ledger.byAgent[ak].outputTokens += deltaOutput;
          ledger.byAgent[ak].totalTokens += deltaTotal;
          ledger.byAgent[ak].estCostUsd += estDelta;
        }
      }

      ledger.lastBySession[key] = { input, output, total: t };
    }

    saveLedger(ledger);

    return NextResponse.json({
      // Backward-compatible fields (now cumulative, so they won't decrease)
      total: ledger.cumulative,
      byModel: ledger.byModel,
      byWorkspace: Object.values(ledger.byWorkspace).sort((a, b) => b.totalTokens - a.totalTokens),
      byAgent: Object.values(ledger.byAgent).sort((a, b) => b.totalTokens - a.totalTokens).slice(0, 20),
      // Explicit live snapshot
      live,
      pricing,
      sessionsCount: sessions.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('usage summary error', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
