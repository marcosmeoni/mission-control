/**
 * OpenClaw Room Mirror V2
 *
 * Extends V1 with richer real-time signals:
 *   - Typing/running indicators (agent is thinking/executing tools)
 *   - Concise tool execution summaries with anti-spam throttling
 *   - Deduplication and anti-echo guarantees from V1
 *
 * Env vars:
 *   MC_ROOM_OPENCLAW_MIRROR=true               – enable mirror (shared with V1)
 *   MC_ROOM_OPENCLAW_MIRROR_POLL_MS=5000       – poll interval (default 5000)
 *   MC_ROOM_OPENCLAW_V2_SIGNALS=true           – enable V2 typing/tool signals
 *   MC_ROOM_OPENCLAW_V2_MAX_TOOL_MSG_PER_MIN=12 – max tool summaries per minute per session
 */

import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { queryAll, queryOne, run } from '@/lib/db';
import { getOpenClawClient } from '@/lib/openclaw/client';
import { broadcast } from '@/lib/events';
import type { Task } from '@/lib/types';

// -----------------------------------------------------------------------
// State
// -----------------------------------------------------------------------

let v2Started = false;

/** Per-session in-memory state for V2 signals */
interface SessionState {
  /** True if we previously detected the agent as "running" */
  wasRunning: boolean;
  /** Timestamps of tool messages posted (for rate limiting) */
  toolMsgTimestamps: number[];
  /** Hash set of tool_use blocks already summarised this run */
  seenToolHashes: Set<string>;
  /** Timestamp we last set typing=true for this session */
  typingSetAt: number;
}

const sessionStates = new Map<string, SessionState>();

function getSessionState(key: string): SessionState {
  if (!sessionStates.has(key)) {
    sessionStates.set(key, {
      wasRunning: false,
      toolMsgTimestamps: [],
      seenToolHashes: new Set(),
      typingSetAt: 0,
    });
  }
  return sessionStates.get(key)!;
}

// -----------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------

function isMirrorEnabled(): boolean {
  return process.env.MC_ROOM_OPENCLAW_MIRROR === 'true';
}

function isV2SignalsEnabled(): boolean {
  return process.env.MC_ROOM_OPENCLAW_V2_SIGNALS === 'true';
}

function getPollIntervalMs(): number {
  const v = parseInt(process.env.MC_ROOM_OPENCLAW_MIRROR_POLL_MS || '', 10);
  return isNaN(v) ? 5_000 : Math.max(1_000, v);
}

function getMaxToolMsgPerMin(): number {
  const v = parseInt(process.env.MC_ROOM_OPENCLAW_V2_MAX_TOOL_MSG_PER_MIN || '', 10);
  return isNaN(v) ? 12 : Math.max(1, v);
}

// -----------------------------------------------------------------------
// Public entry-point
// -----------------------------------------------------------------------

export function startOpenClawRoomMirrorV2(): void {
  if (v2Started) return;

  if (!isMirrorEnabled()) {
    console.log('[room-mirror-v2] disabled – set MC_ROOM_OPENCLAW_MIRROR=true to enable');
    return;
  }

  v2Started = true;
  const intervalMs = getPollIntervalMs();
  const v2 = isV2SignalsEnabled();
  console.log(`[room-mirror-v2] started – polling every ${intervalMs}ms, V2 signals: ${v2}`);

  void pollAll();
  setInterval(() => { void pollAll(); }, intervalMs);
}

// -----------------------------------------------------------------------
// Core polling
// -----------------------------------------------------------------------

interface ActiveSession {
  session_key: string;
  task_id: string;
  agent_id: string;
  agent_name: string;
  agent_avatar: string;
}

async function pollAll(): Promise<void> {
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
        console.warn(`[room-mirror-v2] error on session ${session.session_key}:`, err);
      }
    }

    // Clear typing indicators for sessions no longer active
    if (isV2SignalsEnabled()) {
      clearStaleTypingIndicators(sessions.map(s => s.session_key));
    }
  } catch (err) {
    console.warn('[room-mirror-v2] poll error:', err);
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
// Per-session mirroring
// -----------------------------------------------------------------------

interface OcContentBlock {
  type: string;
  text?: string;
  name?: string;         // tool_use: tool name
  input?: Record<string, unknown>; // tool_use: input
  content?: unknown;     // tool_result: output
}

interface OcMessage {
  role: string;
  content: OcContentBlock[] | string;
  metadata?: Record<string, unknown>;
}

async function mirrorSession(
  client: ReturnType<typeof getOpenClawClient>,
  session: ActiveSession
): Promise<void> {
  const result = await client.call<{ messages?: OcMessage[] }>('chat.history', {
    sessionKey: session.session_key,
    limit: 50,
  });

  const messages: OcMessage[] = result?.messages || [];
  const state = getSessionState(session.session_key);
  const v2 = isV2SignalsEnabled();

  // --- V1: mirror assistant text messages ---
  const assistantMsgs = messages.filter(m => m.role === 'assistant');

  let mirrored = 0;
  for (const msg of assistantMsgs) {
    const text = extractText(msg);
    if (!text || text.trim().length < 10) continue;

    const hash = hashContent(session.session_key, text);
    const seen = queryOne<{ msg_hash: string }>(
      'SELECT msg_hash FROM openclaw_mirror_seen WHERE session_key = ? AND msg_hash = ?',
      [session.session_key, hash]
    );
    if (seen) continue;

    run(
      'INSERT OR IGNORE INTO openclaw_mirror_seen (session_key, msg_hash, seen_at) VALUES (?, ?, ?)',
      [session.session_key, hash, new Date().toISOString()]
    );

    const snippet = summariseText(text);
    postToRoom(session.task_id, session.agent_id, snippet);
    mirrored++;
  }

  if (!v2) return;

  // --- V2: tool execution summaries ---
  processToolSummaries(session, state, messages);

  // --- V2: typing/running indicator ---
  const lastMsg = messages[messages.length - 1];
  const isRunning = detectRunning(lastMsg);

  if (isRunning && !state.wasRunning) {
    // Agent started running
    broadcastTyping(session.task_id, session.agent_id, session.agent_name, true);
    state.wasRunning = true;
    state.typingSetAt = Date.now();
  } else if (!isRunning && state.wasRunning) {
    // Agent went idle / completed
    broadcastTyping(session.task_id, session.agent_id, session.agent_name, false);
    state.wasRunning = false;
  } else if (isRunning && state.wasRunning && Date.now() - state.typingSetAt > 60_000) {
    // Re-broadcast every 60s to keep clients in sync
    broadcastTyping(session.task_id, session.agent_id, session.agent_name, true);
    state.typingSetAt = Date.now();
  }
}

// -----------------------------------------------------------------------
// Tool summaries
// -----------------------------------------------------------------------

function processToolSummaries(
  session: ActiveSession,
  state: SessionState,
  messages: OcMessage[]
): void {
  const maxPerMin = getMaxToolMsgPerMin();
  const now = Date.now();

  // Clean timestamps older than 1 minute
  state.toolMsgTimestamps = state.toolMsgTimestamps.filter(t => now - t < 60_000);

  for (const msg of messages) {
    if (msg.role !== 'assistant') continue;
    if (!Array.isArray(msg.content)) continue;

    for (const block of msg.content) {
      if (block.type !== 'tool_use') continue;

      const toolHash = hashContent(session.session_key, `tool_use:${block.name}:${JSON.stringify(block.input)}`);
      if (state.seenToolHashes.has(toolHash)) continue;
      state.seenToolHashes.add(toolHash);

      // Rate limit check
      if (state.toolMsgTimestamps.length >= maxPerMin) {
        console.log(`[room-mirror-v2] rate limit hit for session ${session.session_key.slice(-8)}, skipping tool summary`);
        continue;
      }

      // Find matching tool_result
      const resultText = findToolResult(messages, block.name);
      const summary = formatToolSummary(block, resultText);

      postToRoom(session.task_id, session.agent_id, summary, 'tool_summary');
      state.toolMsgTimestamps.push(now);
    }
  }
}

function findToolResult(messages: OcMessage[], toolName?: string): string | null {
  // Look for tool role messages (result blocks) after a tool_use
  for (const msg of messages) {
    if (msg.role !== 'tool') continue;
    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const block of content) {
      if (block.type === 'tool_result') {
        const out = typeof block.content === 'string'
          ? block.content
          : JSON.stringify(block.content);
        return out?.slice(0, 200) || null;
      }
    }
    // Fallback: tool role message with plain string
    if (typeof msg.content === 'string') {
      return (msg.content as string).slice(0, 200);
    }
  }
  return null;
}

function formatToolSummary(block: OcContentBlock, result: string | null): string {
  const name = block.name || 'tool';
  const inputSnippet = block.input
    ? Object.entries(block.input)
        .slice(0, 2)
        .map(([k, v]) => `${k}=${String(v).slice(0, 40)}`)
        .join(' ')
    : '';

  const status = result !== null ? '✅' : '⏳';
  const resultSnippet = result
    ? result.replace(/\n/g, ' ').slice(0, 120)
    : '';

  // Mobile-friendly: keep lines short
  const lines: string[] = [
    `🔧 *${name}* ${status}`,
  ];
  if (inputSnippet) lines.push(`   ↳ ${inputSnippet}`);
  if (resultSnippet) lines.push(`   ${resultSnippet}…`);

  return lines.join('\n');
}

// -----------------------------------------------------------------------
// Typing indicator
// -----------------------------------------------------------------------

function detectRunning(lastMsg: OcMessage | undefined): boolean {
  if (!lastMsg) return false;
  // If last message is from assistant with tool_use blocks → still running
  if (lastMsg.role === 'assistant' && Array.isArray(lastMsg.content)) {
    return lastMsg.content.some(b => b.type === 'tool_use');
  }
  // If last message is a tool result → agent is processing result, still running
  if (lastMsg.role === 'tool') return true;
  return false;
}

function broadcastTyping(
  taskId: string,
  agentId: string,
  agentName: string,
  isTyping: boolean
): void {
  broadcast({
    type: 'room_typing' as unknown as 'room_message', // cast; handled on client
    payload: {
      task_id: taskId,
      agent_id: agentId,
      agent_name: agentName,
      is_typing: isTyping,
    } as unknown as Task,
  });
  console.log(`[room-mirror-v2] typing=${isTyping} for task ${taskId.slice(0, 8)} agent ${agentName}`);
}

function clearStaleTypingIndicators(activeKeys: string[]): void {
  const activeSet = new Set(activeKeys);
  for (const [key, state] of Array.from(sessionStates.entries())) {
    if (!activeSet.has(key) && state.wasRunning) {
      // Session went away – clear typing
      const row = queryOne<{ task_id: string; agent_id: string; agent_name: string }>(
        `SELECT os.task_id, os.agent_id, COALESCE(a.name,'Agent') as agent_name
         FROM openclaw_sessions os
         LEFT JOIN agents a ON a.id = os.agent_id
         WHERE ('agent:main:' || os.openclaw_session_id) = ? LIMIT 1`,
        [key]
      );
      if (row) {
        broadcastTyping(row.task_id, row.agent_id, row.agent_name, false);
      }
      state.wasRunning = false;
    }
  }
}

// -----------------------------------------------------------------------
// Helpers (shared with V1 logic)
// -----------------------------------------------------------------------

function extractText(msg: OcMessage): string {
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    const part = msg.content.find(c => c.type === 'text');
    return part?.text || '';
  }
  return '';
}

function hashContent(sessionKey: string, content: string): string {
  return createHash('sha256').update(`${sessionKey}::${content}`).digest('hex').slice(0, 40);
}

/**
 * Produce a concise (≤400 char) snippet from the full assistant text.
 * Strips code fences. Mobile-friendly (short lines).
 */
function summariseText(text: string): string {
  let s = text.replace(/```[\w]*\n[\s\S]*?```/g, '[code]');
  s = s.replace(/\n{3,}/g, '\n\n').trim();

  const PREFIX = '🔄 ';
  const MAX = 400;

  if (s.length <= MAX) return PREFIX + s;

  const cutAt = s.lastIndexOf('.', MAX);
  if (cutAt > 80) return PREFIX + s.slice(0, cutAt + 1) + ' …';
  return PREFIX + s.slice(0, MAX) + ' …';
}

function postToRoom(
  taskId: string,
  agentId: string,
  content: string,
  subtype: 'mirror' | 'tool_summary' = 'mirror'
): void {
  try {
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
        JSON.stringify({ source: `openclaw_mirror_v2`, subtype }),
        now,
      ]
    );

    run('UPDATE conversations SET updated_at = ? WHERE id = ?', [now, conv.id]);

    broadcast({ type: 'room_message', payload: { task_id: taskId } as unknown as Task });

    console.log(`[room-mirror-v2] [${subtype}] task ${taskId.slice(0, 8)}: ${content.slice(0, 60).replace(/\n/g, ' ')}…`);
  } catch (err) {
    console.warn('[room-mirror-v2] failed to post to room:', err);
  }
}
