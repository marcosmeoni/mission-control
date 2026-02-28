import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { queryOne, queryAll, run } from '@/lib/db';
import { getOpenClawClient } from '@/lib/openclaw/client';

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

    const task = queryOne<{ id: string; title: string; status: string; assigned_agent_id: string | null }>(
      'SELECT id, title, status, assigned_agent_id FROM tasks WHERE id = ?',
      [taskId]
    );
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

    // Natural inter-agent ping: if message mentions @agentName, auto-ack from that agent
    // Otherwise fallback to assigned agent so user always gets a conversational response.
    let responder: { id: string; name: string } | null = null;

    const mention = content.match(/@([a-zA-Z0-9_-]+)/);
    if (mention) {
      const mentionedName = mention[1];
      responder = queryOne<{ id: string; name: string }>(
        `SELECT a.id, a.name
         FROM agents a
         INNER JOIN tasks t ON t.workspace_id = a.workspace_id
         WHERE t.id = ? AND (LOWER(a.name) = LOWER(?) OR LOWER(a.gateway_agent_id) = LOWER(?))
         LIMIT 1`,
        [taskId, mentionedName, mentionedName]
      ) || null;
    }

    if (!responder) {
      responder = queryOne<{ id: string; name: string }>(
        `SELECT a.id, a.name
         FROM tasks t
         LEFT JOIN agents a ON a.id = t.assigned_agent_id
         WHERE t.id = ?
         LIMIT 1`,
        [taskId]
      ) || null;
    }

    if (responder && responder.id !== senderAgentId) {
      const ackId = uuidv4();
      run(
        `INSERT INTO messages (id, conversation_id, sender_agent_id, content, message_type, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [ackId, conversationId, responder.id, `✅ Recibido. Estoy procesando este punto y vuelvo con update en breve.`, 'task_update', new Date().toISOString()]
      );

      // If task is already done, provide instant summary from stored result context
      if (task.status === 'done') {
        const latestActivity = queryOne<{ message: string }>(
          `SELECT message FROM task_activities WHERE task_id = ? ORDER BY created_at DESC LIMIT 1`,
          [taskId]
        );
        const deliverables = queryAll<{ title: string }>(
          `SELECT title FROM task_deliverables WHERE task_id = ? ORDER BY created_at DESC LIMIT 5`,
          [taskId]
        );
        const summary = [
          `📌 Esta tarea ya está en *done*.`,
          latestActivity?.message ? `Último resultado: ${latestActivity.message}` : null,
          deliverables.length ? `Deliverables: ${deliverables.map((d) => d.title).join(', ')}` : null,
        ].filter(Boolean).join('\n');

        run(
          `INSERT INTO messages (id, conversation_id, sender_agent_id, content, message_type, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [uuidv4(), conversationId, responder.id, summary, 'task_update', new Date().toISOString()]
        );
      } else if (task.assigned_agent_id) {
        // Forward user message to assigned agent session for real processing
        try {
          const session = queryOne<{ openclaw_session_id: string }>(
            `SELECT openclaw_session_id FROM openclaw_sessions WHERE agent_id = ? AND status = 'active' ORDER BY updated_at DESC LIMIT 1`,
            [task.assigned_agent_id]
          );
          if (session?.openclaw_session_id) {
            const client = getOpenClawClient();
            if (!client.isConnected()) {
              await client.connect();
            }
            await client.call('chat.send', {
              sessionKey: `agent:main:${session.openclaw_session_id}`,
              message: `Room message on task ${task.title} (${task.id}): ${content}`,
              idempotencyKey: `room-${task.id}-${Date.now()}`,
            });
          }
        } catch (err) {
          console.warn('Failed to forward room message to agent session:', err);
        }
      }
    }

    return NextResponse.json(msg, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Failed to post message' }, { status: 500 });
  }
}
