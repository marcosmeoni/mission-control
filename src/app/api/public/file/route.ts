import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

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

function getMime(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html' || ext === '.htm') return 'text/html; charset=utf-8';
  if (ext === '.md') return 'text/markdown; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.txt') return 'text/plain; charset=utf-8';
  if (ext === '.pdf') return 'application/pdf';
  return 'application/octet-stream';
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  const download = request.nextUrl.searchParams.get('download') === '1';
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 });

  const store = loadStore();
  const rec = store[token];
  if (!rec) return NextResponse.json({ error: 'invalid token' }, { status: 404 });

  const filePath = rec.path.replace(/^~/, process.env.HOME || '');
  const normalized = path.normalize(filePath);
  if (!fs.existsSync(normalized)) return NextResponse.json({ error: 'file not found' }, { status: 404 });

  const content = fs.readFileSync(normalized);
  const headers: Record<string, string> = { 'Content-Type': getMime(normalized) };
  if (download) {
    headers['Content-Disposition'] = `attachment; filename="${path.basename(normalized)}"`;
  }
  return new NextResponse(content, { headers });
}
