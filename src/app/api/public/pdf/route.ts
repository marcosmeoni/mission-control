import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

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

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 });

  const store = loadStore();
  const rec = store[token];
  if (!rec) return NextResponse.json({ error: 'invalid token' }, { status: 404 });

  const filePath = path.normalize(rec.path.replace(/^~/, process.env.HOME || ''));
  if (!fs.existsSync(filePath)) return NextResponse.json({ error: 'file not found' }, { status: 404 });

  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.html' && ext !== '.htm') {
    return NextResponse.json({ error: 'PDF export supports HTML deliverables only' }, { status: 400 });
  }

  const html = fs.readFileSync(filePath, 'utf8');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true });
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${path.basename(filePath).replace(/\.(html|htm)$/i, '')}.pdf"`,
      },
    });
  } finally {
    await browser.close();
  }
}
