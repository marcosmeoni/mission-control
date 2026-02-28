import { NextResponse } from 'next/server';
import fs from 'fs';

export const dynamic = 'force-dynamic';

const LEDGER_PATH = '/root/.openclaw/workspace/projects/personal/mission-control/data/usage-ledger-state.json';

const EMPTY = {
  lastBySession: {},
  cumulative: { inputTokens: 0, outputTokens: 0, totalTokens: 0, sessions: 0, estCostUsd: 0 },
  byModel: {},
  byWorkspace: {},
  byAgent: {},
};

export async function POST() {
  try {
    fs.mkdirSync('/root/.openclaw/workspace/projects/personal/mission-control/data', { recursive: true });
    fs.writeFileSync(LEDGER_PATH, JSON.stringify(EMPTY, null, 2));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Failed to reset ledger' }, { status: 500 });
  }
}
