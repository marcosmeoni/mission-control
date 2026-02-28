import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const FILE_PATH = '/root/.openclaw/workspace/projects/personal/mission-control/data/model-pricing.json';

const DEFAULT = {
  pricing: {
    'anthropic/claude-sonnet-4-6': { inputPer1M: 3, outputPer1M: 15 },
    'openai-codex/gpt-5.3-codex': { inputPer1M: 2, outputPer1M: 8 },
  },
};

function readPricing() {
  try {
    if (!fs.existsSync(FILE_PATH)) return DEFAULT;
    return JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
  } catch {
    return DEFAULT;
  }
}

export async function GET() {
  return NextResponse.json(readPricing());
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || typeof body.pricing !== 'object') {
      return NextResponse.json({ error: 'Expected { pricing: { model: { inputPer1M, outputPer1M }}}' }, { status: 400 });
    }

    fs.mkdirSync(path.dirname(FILE_PATH), { recursive: true });
    fs.writeFileSync(FILE_PATH, JSON.stringify(body, null, 2));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Failed to save pricing' }, { status: 500 });
  }
}
