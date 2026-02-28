import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { queryOne, queryAll, run } from '@/lib/db';

interface RouteParams { params: Promise<{ id: string }> }

function ensureConversation(taskId: string) {
  let conv = queryOne<{ id: string }>('SELECT id FROM conversations WHERE task_id = ? AND type = ? LIMIT 1', [taskId, 'task']);
  if (!conv) {
    const id = uuidv4();
    run('INSERT INTO conversations (id, title, type, task_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [
      id,
      `Task Room ${taskId.slice(0, 8)}`,
      'task',
      taskId,
      new Date().toISOString(),
      new Date().toISOString(),
    ]);
    conv = { id };
  }
  return conv.id;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id: taskId } = await params;
    const task = queryOne<{ id: string }>('SELECT id FROM tasks WHERE id = ?', [taskId]);
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

    const conversationId = ensureConversation(taskId);
    const messages = queryAll(
      `SELECT m.*, a.name as sender_name, a.avatar_emoji as sender_avatar
       FROM messages m
       LEFT JOIN agents a ON a.id = m.sender_agent_id
       WHERE m.conversation_id = ?
       ORDER BY m.created_at ASC`,
      [conversationId]
    );

    return NextResponse.json({ conversationId, messages });
  } catch {
    return NextResponse.json({ error: 'Failed to load room' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: taskId } = await params;
    const body = await request.json();
    const content = String(body?.content || '').trim();
    const senderAgentId = body?.sender_agent_id ? String(body.sender_agent_id) : null;
    const messageType = String(body?.message_type || 'text');

    if (!content) return NextResponse.json({ error: 'content is required' }, { status: 400 });

    const task = queryOne<{ id: string }>('SELECT id FROM tasks WHERE id = ?', [taskId]);
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

    const conversationId = ensureConversation(taskId);
    const now = new Date().toISOString();
    const id = uuidv4();

    run(
      `INSERT INTO messages (id, conversation_id, sender_agent_id, content, message_type, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, conversationId, senderAgentId, content, messageType, now]
    );

    run('UPDATE conversations SET updated_at = ? WHERE id = ?', [now, conversationId]);

    const msg = queryOne(
      `SELECT m.*, a.name as sender_name, a.avatar_emoji as sender_avatar
       FROM messages m
       LEFT JOIN agents a ON a.id = m.sender_agent_id
       WHERE m.id = ?`,
      [id]
    );

    return NextResponse.json(msg, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Failed to post message' }, { status: 500 });
  }
}
