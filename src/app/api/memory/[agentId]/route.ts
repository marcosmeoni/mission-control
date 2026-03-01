/**
 * Memory Write-back API
 *
 * Allows agents to persist memory entries after completing tasks.
 * Entries are appended to data/memory/agents/{agentId}.md
 *
 * POST /api/memory/{agentId}
 *   Body: { category: "decision"|"preference"|"restriction"|"project"|"note", content: string }
 *
 * GET /api/memory/{agentId}
 *   Returns the full memory file content for the agent.
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { writeAgentMemory } from '@/lib/memory';

const MEMORY_BASE = path.join(process.cwd(), 'data', 'memory');

const VALID_CATEGORIES = new Set(['decision', 'preference', 'restriction', 'project', 'note']);

interface RouteParams {
  params: Promise<{ agentId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { agentId } = await params;

  let body: { category?: string; content?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { category, content } = body;

  if (!category || !content) {
    return NextResponse.json(
      { error: 'Both "category" and "content" are required' },
      { status: 400 }
    );
  }

  if (!VALID_CATEGORIES.has(category)) {
    return NextResponse.json(
      { error: `Invalid category. Must be one of: ${Array.from(VALID_CATEGORIES).join(', ')}` },
      { status: 400 }
    );
  }

  if (content.length > 2000) {
    return NextResponse.json(
      { error: 'Content too long (max 2000 chars per entry)' },
      { status: 400 }
    );
  }

  try {
    writeAgentMemory(agentId, category, content);
    return NextResponse.json({ success: true, agentId, category });
  } catch (err) {
    console.error('[Memory API] Failed to write agent memory:', err);
    return NextResponse.json({ error: 'Failed to write memory' }, { status: 500 });
  }
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { agentId } = await params;
  const filePath = path.join(MEMORY_BASE, 'agents', `${agentId}.md`);

  try {
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ content: null, exists: false });
    }
    const content = fs.readFileSync(filePath, 'utf8');
    return NextResponse.json({ content, exists: true });
  } catch (err) {
    console.error('[Memory API] Failed to read agent memory:', err);
    return NextResponse.json({ error: 'Failed to read memory' }, { status: 500 });
  }
}
