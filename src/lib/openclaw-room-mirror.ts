/**
 * OpenClaw Room Mirror
 *
 * Polls active OpenClaw sessions that are linked to tasks and mirrors
 * new assistant/tool messages into the task room conversation so users
 * can see live agent progress before callback delivery.
 *
 * Env vars:
 *   MC_ROOM_OPENCLAW_MIRROR=true          – enable (default false)
 *   MC_ROOM_OPENCLAW_MIRROR_POLL_MS=5000  – poll interval in ms (default 5000)
 */

import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { queryAll, queryOne, run } from '@/lib/db';
import { getOpenClawClient } from '@/lib/openclaw/client';
import { broadcast } from '@/lib/events';
import type { Task } from '@/lib/types';

let mirrorStarted = false;

// -----------------------------------------------------------------------
// Config helpers
// -----------------------------------------------------------------------

function isMirrorEnabled(): boolean {
  return process.env.MC_ROOM_OPENCLAW_MIRROR === 'true';
}

function getPollIntervalMs(): number {
  const v = parseInt(process.env.MC_ROOM_OPENCLAW_MIRROR_POLL_MS || '', 10);
  return isNaN(v) ? 5_000 : Math.max(1_000, v);
}

// -----------------------------------------------------------------------
// Public entry-point (lazy singleton, same pattern as dispatch-timeout-guard)
// -----------------------------------------------------------------------

export function startOpenClawRoomMirror(): void {
  if (mirrorStarted) return;
  if (!isMirrorEnabled()) {
    console.log('[room-mirror] disabled – set MC_ROOM_OPENCLAW_MIRROR=true to enable');
    return;
  }

  mirrorStarted = true;
  const intervalMs = getPollIntervalMs();
  console.log(`[room-mirror] started – polling every ${intervalMs}ms`);

  // Run once immediately, then on interval
  void pollAllActiveSessions();
  setInterval(() => { void pollAllActiveSessions(); }, intervalMs);
}

// -----------------------------------------------------------------------
// Core polling logic
// -----------------------------------------------------------------------

interface ActiveSession {
  session_key: string;   // full key e.g. agent:main:subagent:xxx
  task_id: string;
  agent_id: string;
  agent_name: string;
  agent_avatar: string;
}

async function pollAllActiveSessions(): Promise<void> {
  try {
    const sessions = getActiveSessions();
    if (sessions.length === 0) return;

    const client = getOpenClawClient();
    if (!client.isConnected()) {
      await client.connect();
    }

    for (const session of sessions) {
      try {
        await mirrorSession(client, session);
      } catch (err) {
        console.warn(`[room-mirror] error mirroring session ${session.session_key}:`, err);
      }
    }
  } catch (err) {
    console.warn('[room-mirror] poll error:', err);
  }
}

function getActiveSessions(): ActiveSession[] {
  return queryAll<ActiveSession>(`
    SELECT
      ('agent:main:' || os.openclaw_session_id) AS session_key,
      os.task_id,
      os.agent_id,
      COALESCE(a.name, 'Agent') AS agent_name,
      COALESCE(a.avatar_emoji, '🤖') AS agent_avatar
    FROM openclaw_sessions os
    LEFT JOIN agents a ON a.id = os.agent_id
    WHERE os.status = 'active'
      AND os.task_id IS NOT NULL
  `);
}

// -----------------------------------------------------------------------
// Per-session mirror
// -----------------------------------------------------------------------

interface OcMessage {
  role: string;
  content: Array<{ type: string; text?: string }> | string;
  metadata?: Record<string, unknown>;
}

async function mirrorSession(client: ReturnType<typeof getOpenClawClient>, session: ActiveSession): Promise<void> {
  const result = await client.call<{ messages?: OcMessage[] }>('chat.history', {
    sessionKey: session.session_key,
    limit: 50,
  });

  const messages: OcMessage[] = result?.messages || [];

  // We only care about assistant messages
  const candidates = messages.filter(m => m.role === 'assistant');

  for (const msg of candidates) {
    const text = extractText(msg);
    if (!text || text.trim().length < 10) continue;

    const hash = hashMessage(session.session_key, text);

    // Already mirrored?
    const seen = queryOne<{ msg_hash: string }>(
      'SELECT msg_hash FROM openclaw_mirror_seen WHERE session_key = ? AND msg_hash = ?',
      [session.session_key, hash]
    );
    if (seen) continue;

    // Mark as seen first (prevent echoes if mirror triggers a room message which triggers chat.send)
    run(
      'INSERT OR IGNORE INTO openclaw_mirror_seen (session_key, msg_hash, seen_at) VALUES (?, ?, ?)',
      [session.session_key, hash, new Date().toISOString()]
    );

    // Write to room
    const snippet = summarise(text);
    postToRoom(session.task_id, session.agent_id, snippet);
  }
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function extractText(msg: OcMessage): string {
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    const part = msg.content.find(c => c.type === 'text');
    return part?.text || '';
  }
  return '';
}

function hashMessage(sessionKey: string, text: string): string {
  return createHash('sha256').update(`${sessionKey}::${text}`).digest('hex').slice(0, 40);
}

/**
 * Produce a concise (≤400 char) snippet from the full assistant text.
 * Strips code fences and trims whitespace.
 */
function summarise(text: string): string {
  // Remove markdown code blocks (keep language hint only)
  let s = text.replace(/```[\w]*\n[\s\S]*?```/g, '[code block]');
  // Collapse whitespace
  s = s.replace(/\n{3,}/g, '\n\n').trim();

  const PREFIX = '🔄 ';
  const MAX = 400;

  if (s.length <= MAX) return PREFIX + s;

  // Try to cut at a sentence boundary
  const cutAt = s.lastIndexOf('.', MAX);
  if (cutAt > 80) return PREFIX + s.slice(0, cutAt + 1) + ' …';
  return PREFIX + s.slice(0, MAX) + ' …';
}

function postToRoom(taskId: string, agentId: string, content: string): void {
  try {
    // Ensure the task conversation exists
    let conv = queryOne<{ id: string }>(
      'SELECT id FROM conversations WHERE task_id = ? AND type = ? LIMIT 1',
      [taskId, 'task']
    );
    if (!conv) {
      const id = uuidv4();
      run(
        'INSERT INTO conversations (id, title, type, task_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [id, `Task Room ${taskId.slice(0, 8)}`, 'task', taskId, new Date().toISOString(), new Date().toISOString()]
      );
      conv = { id };
    }

    const msgId = uuidv4();
    const now = new Date().toISOString();
    run(
      `INSERT INTO messages (id, conversation_id, sender_agent_id, content, message_type, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        msgId,
        conv.id,
        agentId,
        content,
        'system',
        JSON.stringify({ source: 'openclaw_mirror' }),
        now,
      ]
    );

    run('UPDATE conversations SET updated_at = ? WHERE id = ?', [now, conv.id]);

    // Notify SSE clients so the room updates without a page reload
    broadcast({ type: 'room_message', payload: { task_id: taskId } as unknown as Task });

    console.log(`[room-mirror] mirrored to task ${taskId.slice(0, 8)}: ${content.slice(0, 60)}…`);
  } catch (err) {
    console.warn('[room-mirror] failed to post to room:', err);
  }
}
