import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

export const dynamic = 'force-dynamic';

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
  return ok ? normalized : null;
}

export async function GET(request: NextRequest) {
  const filePath = request.nextUrl.searchParams.get('path');
  if (!filePath) return NextResponse.json({ error: 'path is required' }, { status: 400 });

  const resolved = resolveAllowedPath(filePath);
  if (!resolved) return NextResponse.json({ error: 'Path not allowed' }, { status: 403 });
  if (!fs.existsSync(resolved)) return NextResponse.json({ error: 'File not found' }, { status: 404 });

  const ext = path.extname(resolved).toLowerCase();
  if (ext !== '.html' && ext !== '.htm') {
    return NextResponse.json({ error: 'PDF export supports HTML deliverables only' }, { status: 400 });
  }

  const html = fs.readFileSync(resolved, 'utf8');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true });

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${path.basename(resolved).replace(/\.(html|htm)$/i, '')}.pdf"`,
      },
    });
  } finally {
    await browser.close();
  }
}
