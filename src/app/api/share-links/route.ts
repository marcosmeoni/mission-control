import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

const STORE_PATH = '/root/.openclaw/workspace/projects/personal/mission-control/data/share-links.json';

type ShareMap = Record<string, { path: string; createdAt: string }>;

function loadStore(): ShareMap {
  try {
    if (!fs.existsSync(STORE_PATH)) return {};
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')) as ShareMap;
  } catch {
    return {};
  }
}

function saveStore(store: ShareMap) {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

function isAllowedPath(inputPath: string): boolean {
  const normalized = path.normalize(inputPath.replace(/^~/, process.env.HOME || ''));
  const allowed = [
    process.env.WORKSPACE_BASE_PATH?.replace(/^~/, process.env.HOME || ''),
    process.env.PROJECTS_PATH?.replace(/^~/, process.env.HOME || ''),
    '/root/.openclaw/workspace/agents',
    '/root/.openclaw/workspace/projects/personal/mission-control',
  ].filter(Boolean) as string[];
  return allowed.some((base) => normalized.startsWith(path.normalize(base)));
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const filePath = String(body?.path || '').trim();
    if (!filePath) return NextResponse.json({ error: 'path is required' }, { status: 400 });
    if (!isAllowedPath(filePath)) return NextResponse.json({ error: 'Path not allowed' }, { status: 403 });

    const token = randomUUID().replace(/-/g, '');
    const store = loadStore();
    store[token] = { path: filePath, createdAt: new Date().toISOString() };
    saveStore(store);

    return NextResponse.json({ token });
  } catch {
    return NextResponse.json({ error: 'Failed to create share link' }, { status: 500 });
  }
}
