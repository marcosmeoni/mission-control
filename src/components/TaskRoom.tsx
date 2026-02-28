'use client';

import { useEffect, useState } from 'react';
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
  content: string;
  created_at: string;
  message_type: string;
}

export function TaskRoom({ taskId, agents, defaultAgentId }: TaskRoomProps) {
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [content, setContent] = useState('');
  const [senderId, setSenderId] = useState(defaultAgentId || '');

  const load = async () => {
    const res = await fetch(`/api/tasks/${taskId}/room`);
    if (res.ok) {
      const data = await res.json();
      setMessages(data.messages || []);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [taskId]);

  const send = async () => {
    if (!content.trim()) return;
    const res = await fetch(`/api/tasks/${taskId}/room`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content, sender_agent_id: senderId || null }),
    });
    if (res.ok) {
      setContent('');
      await load();
    }
  };

  const quickMessage = (text: string) => setContent(text);

  const mentionAgent = (agentName: string) => {
    setContent((c) => `${c}${c ? ' ' : ''}@${agentName} `);
  };

  return (
    <div className="space-y-3">
      <div className="max-h-[50vh] overflow-y-auto border border-mc-border rounded p-3 space-y-2 bg-mc-bg">
        {messages.length === 0 && <p className="text-sm text-mc-text-secondary">Sin mensajes todavía.</p>}
        {messages.map((m) => (
          <div key={m.id} className="text-sm">
            <div className="text-xs text-mc-text-secondary">
              {(m.sender_avatar || '🤖')} {m.sender_name || 'system'} · {new Date(m.created_at).toLocaleTimeString()}
            </div>
            <div className="whitespace-pre-wrap">{m.content}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => quickMessage('Estado rápido: ¿cómo venimos con esta tarea?')} className="text-xs px-2 py-1 rounded border border-mc-border">/status</button>
        <button onClick={() => quickMessage('Bloqueo detectado. ¿Qué necesitás para destrabar?')} className="text-xs px-2 py-1 rounded border border-mc-border">/block</button>
        <button onClick={() => quickMessage('Necesito handoff corto: objetivo, avance, riesgo, próximo paso.')} className="text-xs px-2 py-1 rounded border border-mc-border">/handoff</button>
        <div className="text-xs text-mc-text-secondary self-center">Mencionar:</div>
        {agents.slice(0, 5).map((a) => (
          <button key={a.id} onClick={() => mentionAgent(a.name)} className="text-xs px-2 py-1 rounded border border-mc-border text-mc-text-secondary">@{a.name}</button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[220px_1fr_auto] gap-2">
        <select
          value={senderId}
          onChange={(e) => setSenderId(e.target.value)}
          className="bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm"
        >
          <option value="">System</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>

        <input
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="Escribí mensaje para la room..."
          className="bg-mc-bg border border-mc-border rounded px-3 py-2 text-sm"
        />

        <button onClick={send} className="px-3 py-2 rounded bg-mc-accent text-mc-bg text-sm">Enviar</button>
      </div>
    </div>
  );
}
