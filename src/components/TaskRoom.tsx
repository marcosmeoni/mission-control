'use client';

/**
 * TaskRoom V3 - Group-chat style UX
 *
 * Features:
 * - Per-agent chat bubbles with avatar, name, timestamps
 * - Filter chips: All / Decisions / Tools / Status
 * - Event badges for tool calls, status changes, handoffs
 * - @mention helper UI
 * - Mobile-first (<=640px)
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useMissionControl } from '@/lib/store';
import type { Agent } from '@/lib/types';

interface TaskRoomProps {
  taskId: string;
  agents: Agent[];
  defaultAgentId?: string | null;
}

interface RoomMessage {
  id: string;
  sender_name?: string;
  sender_avatar?: string;
  sender_agent_id?: string | null;
  content: string;
  created_at: string;
  message_type: string;
  metadata?: string | null;
}

type FilterChip = 'all' | 'decisions' | 'tools' | 'status';

function parseMeta(m: RoomMessage): Record<string, unknown> {
  try { return m.metadata ? JSON.parse(m.metadata) : {}; } catch { return {}; }
}

function getMessageCategory(m: RoomMessage): FilterChip {
  const meta = parseMeta(m);
  const subtype = meta.subtype as string | undefined;
  if (subtype === 'tool_summary') return 'tools';
  if (m.message_type === 'task_update' || subtype === 'task_update') return 'status';
  if (m.content.startsWith('🔧')) return 'tools';
  if (
    m.message_type === 'system' &&
    (m.content.startsWith('🚀') || m.content.startsWith('✅') ||
     m.content.startsWith('🤝') || m.content.startsWith('📋') ||
     m.content.startsWith('⚙️') || m.content.startsWith('🎯'))
  ) return 'status';
  if (m.content.startsWith('🔄')) return 'decisions';
  if (m.message_type === 'text') return 'decisions';
  return 'all';
}

function getBubbleStyle(m: RoomMessage, isHuman: boolean): string {
  const meta = parseMeta(m);
  const subtype = meta.subtype as string | undefined;
  if (subtype === 'tool_summary' || m.content.startsWith('🔧')) {
    return 'border-l-2 border-mc-accent-yellow bg-[#21262d] text-mc-text-secondary';
  }
  if (m.message_type === 'task_update' || m.content.startsWith('🚀') || m.content.startsWith('🤝')) {
    return 'border-l-2 border-mc-accent-green bg-[#1a2b1e] text-mc-text';
  }
  if (m.content.startsWith('🔄')) {
    return 'border-l-2 border-mc-accent bg-[#1a2233] text-mc-text';
  }
  if (isHuman) {
    return 'bg-mc-accent text-mc-bg ml-auto';
  }
  return 'bg-[#21262d] text-mc-text border border-mc-border';
}

function getBadge(m: RoomMessage): { emoji: string; label: string } | null {
  const meta = parseMeta(m);
  const subtype = meta.subtype as string | undefined;
  if (subtype === 'tool_summary') return { emoji: '🔧', label: 'Tool' };
  if (m.content.startsWith('🔄')) return { emoji: '🔄', label: 'Output' };
  if (m.message_type === 'task_update') return { emoji: '📋', label: 'Status' };
  if (m.content.startsWith('🚀')) return { emoji: '🚀', label: 'Dispatch' };
  if (m.content.startsWith('🤝')) return { emoji: '🤝', label: 'Handoff' };
  if (m.content.startsWith('🎯')) return { emoji: '🎯', label: 'Multi-spec' };
  return null;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

// Group consecutive messages from the same sender
interface MessageGroup {
  senderId: string | null;
  senderName: string;
  senderAvatar: string;
  isHuman: boolean;
  messages: RoomMessage[];
}

function groupMessages(messages: RoomMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  for (const m of messages) {
    const isHuman = !m.sender_agent_id;
    const last = groups[groups.length - 1];
    const sameSender = last && last.senderId === (m.sender_agent_id || null) &&
      // Don't group system/status events - always standalone
      m.message_type !== 'task_update' && !m.content.startsWith('🚀') && !m.content.startsWith('🤝') && !m.content.startsWith('🎯');
    if (sameSender) {
      last.messages.push(m);
    } else {
      groups.push({
        senderId: m.sender_agent_id || null,
        senderName: m.sender_name || (isHuman ? 'Tú' : 'Agent'),
        senderAvatar: m.sender_avatar || (isHuman ? '👤' : '🤖'),
        isHuman,
        messages: [m],
      });
    }
  }
  return groups;
}

const FILTER_LABELS: Record<FilterChip, string> = {
  all: 'Todo',
  decisions: '🔄 Decisiones',
  tools: '🔧 Herramientas',
  status: '📋 Estado',
};

export function TaskRoom({ taskId, agents, defaultAgentId }: TaskRoomProps) {
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [content, setContent] = useState('');
  const [senderId, setSenderId] = useState('');
  const [filter, setFilter] = useState<FilterChip>('all');
  const [showMentions, setShowMentions] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { roomTypingStates } = useMissionControl();
  const typingState = roomTypingStates[taskId];

  const load = useCallback(async () => {
    const res = await fetch(`/api/tasks/${taskId}/room`);
    if (res.ok) {
      const data = await res.json();
      setMessages(data.messages || []);
    }
  }, [taskId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = async () => {
    if (!content.trim()) return;
    const res = await fetch(`/api/tasks/${taskId}/room`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content, sender_agent_id: senderId || null }),
    });
    if (res.ok) {
      setContent('');
      setShowMentions(false);
      await load();
    }
  };

  const mentionAgent = (agentName: string) => {
    setContent((c) => {
      const base = c.endsWith(' ') || c === '' ? c : c + ' ';
      return `${base}@${agentName} `;
    });
    setShowMentions(false);
    inputRef.current?.focus();
  };

  const quickMessage = (text: string) => {
    setContent(text);
    inputRef.current?.focus();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setContent(val);
    // Show mention helper if user just typed @
    const lastAt = val.lastIndexOf('@');
    setShowMentions(lastAt !== -1 && lastAt === val.length - 1);
  };

  // Filter messages
  const filtered = filter === 'all'
    ? messages
    : messages.filter(m => {
        const cat = getMessageCategory(m);
        return cat === filter || cat === 'all';
      });

  const groups = groupMessages(filtered);

  // Count per filter
  const counts: Record<FilterChip, number> = { all: messages.length, decisions: 0, tools: 0, status: 0 };
  for (const m of messages) {
    const cat = getMessageCategory(m);
    if (cat !== 'all') counts[cat]++;
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Filter chips */}
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(FILTER_LABELS) as FilterChip[]).map(chip => (
          <button
            key={chip}
            onClick={() => setFilter(chip)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              filter === chip
                ? 'bg-mc-accent border-mc-accent text-mc-bg font-semibold'
                : 'border-mc-border text-mc-text-secondary hover:border-mc-accent hover:text-mc-accent'
            }`}
          >
            {FILTER_LABELS[chip]}
            {counts[chip] > 0 && chip !== 'all' && (
              <span className="ml-1 opacity-70">({counts[chip]})</span>
            )}
          </button>
        ))}
      </div>

      {/* Message timeline */}
      <div
        ref={listRef}
        className="max-h-[55vh] sm:max-h-[60vh] overflow-y-auto flex flex-col gap-3 p-3 rounded-lg border border-mc-border bg-mc-bg"
      >
        {groups.length === 0 && (
          <p className="text-sm text-mc-text-secondary text-center py-4">
            {filter === 'all' ? 'Sin mensajes todavía.' : `Sin eventos de tipo "${FILTER_LABELS[filter]}".`}
          </p>
        )}

        {groups.map((group, gi) => (
          <div key={gi} className={`flex flex-col gap-1 ${group.isHuman ? 'items-end' : 'items-start'}`}>
            {/* Sender header (only once per group) */}
            <div className={`flex items-center gap-1.5 text-xs text-mc-text-secondary ${group.isHuman ? 'flex-row-reverse' : ''}`}>
              <span className="text-base leading-none">{group.senderAvatar}</span>
              <span className="font-medium text-mc-text">{group.senderName}</span>
              <span className="opacity-60">{formatTime(group.messages[0].created_at)}</span>
            </div>

            {/* Bubble(s) */}
            {group.messages.map((m, mi) => {
              const badge = getBadge(m);
              const bubbleStyle = getBubbleStyle(m, group.isHuman);
              return (
                <div
                  key={m.id}
                  className={`relative max-w-[90%] sm:max-w-[75%] rounded-xl px-3 py-2 text-sm break-words ${bubbleStyle}`}
                >
                  {badge && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide opacity-70 mb-1">
                      {badge.emoji} {badge.label}
                    </span>
                  )}
                  <div className="whitespace-pre-wrap leading-relaxed">{m.content}</div>
                  {mi > 0 && (
                    <span className="absolute bottom-1 right-2 text-[10px] opacity-40">
                      {formatTime(m.created_at)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ))}

        {/* Typing indicator */}
        {typingState?.isTyping && (
          <div className="flex items-center gap-2 text-xs text-mc-text-secondary animate-pulse">
            <span className="text-base">⚙️</span>
            <span>{typingState.agentName} está trabajando…</span>
            <span className="flex gap-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-mc-accent-green animate-bounce [animation-delay:0ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-mc-accent-green animate-bounce [animation-delay:150ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-mc-accent-green animate-bounce [animation-delay:300ms]" />
            </span>
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-1.5">
        <span className="text-xs text-mc-text-secondary self-center mr-1">Rápidos:</span>
        <button onClick={() => quickMessage('Estado rápido: ¿cómo venimos con esta tarea?')} className="text-xs px-2 py-1 rounded border border-mc-border hover:border-mc-accent transition-colors">/status</button>
        <button onClick={() => quickMessage('Bloqueo detectado. ¿Qué necesitás para destrabar?')} className="text-xs px-2 py-1 rounded border border-mc-border hover:border-mc-accent transition-colors">/block</button>
        <button onClick={() => quickMessage('Necesito handoff corto: objetivo, avance, riesgo, próximo paso.')} className="text-xs px-2 py-1 rounded border border-mc-border hover:border-mc-accent transition-colors">/handoff</button>
        <button
          onClick={() => setShowMentions(v => !v)}
          className={`text-xs px-2 py-1 rounded border transition-colors ${showMentions ? 'border-mc-accent text-mc-accent' : 'border-mc-border text-mc-text-secondary hover:border-mc-accent'}`}
        >
          @mencionar
        </button>
      </div>

      {/* Mention helper */}
      {showMentions && agents.length > 0 && (
        <div className="flex flex-wrap gap-1.5 p-2 rounded-lg border border-mc-accent bg-[#1a2233]">
          <span className="text-xs text-mc-text-secondary self-center">Agentes:</span>
          {agents.slice(0, 8).map((a) => (
            <button
              key={a.id}
              onClick={() => mentionAgent(a.name)}
              className="text-xs px-2 py-1 rounded border border-mc-accent text-mc-accent hover:bg-mc-accent hover:text-mc-bg transition-colors"
            >
              {a.avatar_emoji || '🤖'} @{a.name}
            </button>
          ))}
        </div>
      )}

      {/* Compose area */}
      <div className="flex flex-col sm:flex-row gap-2">
        <select
          value={senderId}
          onChange={(e) => setSenderId(e.target.value)}
          className="bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm sm:w-48 shrink-0"
        >
          <option value="">👤 Tú</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.avatar_emoji || '🤖'} {a.name}</option>
          ))}
        </select>

        <div className="flex flex-1 gap-2">
          <input
            ref={inputRef}
            value={content}
            onChange={handleInputChange}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
            placeholder="Escribí mensaje… (@ para mencionar)"
            className="flex-1 bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm focus:border-mc-accent outline-none transition-colors"
          />
          <button
            onClick={send}
            disabled={!content.trim()}
            className="px-4 py-2 rounded bg-mc-accent text-mc-bg text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity shrink-0"
          >
            Enviar
          </button>
        </div>
      </div>
    </div>
  );
}
