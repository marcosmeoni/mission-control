import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

function resolveAllowedPath(inputPath: string): string | null {
  const expanded = inputPath.replace(/^~/, process.env.HOME || '');
  const normalized = path.normalize(expanded);

  const allowed = [
    process.env.WORKSPACE_BASE_PATH?.replace(/^~/, process.env.HOME || ''),
    process.env.PROJECTS_PATH?.replace(/^~/, process.env.HOME || ''),
    '/root/.openclaw/workspace/agents',
    '/root/.openclaw/workspace/projects/personal/mission-control',
  ].filter(Boolean) as string[];

  const ok = allowed.some((base) => normalized.startsWith(path.normalize(base)));
  if (!ok) return null;
  return normalized;
}

export async function GET(request: NextRequest) {
  const filePath = request.nextUrl.searchParams.get('path');
  if (!filePath) return NextResponse.json({ error: 'path is required' }, { status: 400 });

  const resolved = resolveAllowedPath(filePath);
  if (!resolved) return NextResponse.json({ error: 'Path not allowed' }, { status: 403 });
  if (!fs.existsSync(resolved)) return NextResponse.json({ error: 'File not found' }, { status: 404 });

  try {
    const content = fs.readFileSync(resolved, 'utf8');
    return NextResponse.json({ path: resolved, content });
  } catch {
    return NextResponse.json({ error: 'Failed to read file' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const filePath = String(body?.path || '');
    const content = String(body?.content || '');

    if (!filePath) return NextResponse.json({ error: 'path is required' }, { status: 400 });

    const resolved = resolveAllowedPath(filePath);
    if (!resolved) return NextResponse.json({ error: 'Path not allowed' }, { status: 403 });

    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, content, 'utf8');

    return NextResponse.json({ ok: true, path: resolved });
  } catch {
    return NextResponse.json({ error: 'Failed to save file' }, { status: 500 });
  }
}
