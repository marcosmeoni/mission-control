'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, ChevronRight, ChevronLeft, Zap, ZapOff, Loader2, Search, MessagesSquare, Users } from 'lucide-react';
import { useMissionControl } from '@/lib/store';
import type { Agent, AgentStatus, OpenClawSession, Task } from '@/lib/types';
import { AgentModal } from './AgentModal';
import { DiscoverAgentsModal } from './DiscoverAgentsModal';

type FilterTab = 'all' | 'working' | 'standby';
type SidebarView = 'people' | 'rooms';

interface RoomItem {
  conversation_id: string;
  task_id: string;
  task_title: string;
  task_status: string;
  task_priority: string;
  last_message?: string;
  last_message_at?: string;
  message_count: number;
}

interface AgentsSidebarProps {
  workspaceId?: string;
  mobileMode?: boolean;
}

export function AgentsSidebar({ workspaceId, mobileMode }: AgentsSidebarProps) {
  const { agents, tasks, selectedAgent, setSelectedAgent, setSelectedTask, agentOpenClawSessions, setAgentOpenClawSession } = useMissionControl();
  const [filter, setFilter] = useState<FilterTab>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [showDiscoverModal, setShowDiscoverModal] = useState(false);
  const [connectingAgentId, setConnectingAgentId] = useState<string | null>(null);
  const [activeSubAgents, setActiveSubAgents] = useState(0);
  const [isMinimized, setIsMinimized] = useState(false);
  const [sidebarView, setSidebarView] = useState<SidebarView>('people');
  const [rooms, setRooms] = useState<RoomItem[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(false);

  const toggleMinimize = () => setIsMinimized(!isMinimized);

  const loadOpenClawSessions = useCallback(async () => {
    for (const agent of agents) {
      try {
        const res = await fetch(`/api/agents/${agent.id}/openclaw`);
        if (res.ok) {
          const data = await res.json();
          if (data.linked && data.session) {
            setAgentOpenClawSession(agent.id, data.session as OpenClawSession);
          }
        }
      } catch (error) {
        console.error(`Failed to load OpenClaw session for ${agent.name}:`, error);
      }
    }
  }, [agents, setAgentOpenClawSession]);

  useEffect(() => {
    if (agents.length > 0) {
      loadOpenClawSessions();
    }
  }, [loadOpenClawSessions, agents.length]);

  useEffect(() => {
    const loadSubAgentCount = async () => {
      try {
        const res = await fetch('/api/openclaw/sessions?session_type=subagent&status=active');
        if (res.ok) {
          const sessions = await res.json();
          setActiveSubAgents(sessions.length);
        }
      } catch (error) {
        console.error('Failed to load sub-agent count:', error);
      }
    };

    loadSubAgentCount();

    const interval = setInterval(loadSubAgentCount, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!workspaceId) return;

    const loadRooms = async () => {
      setLoadingRooms(true);
      try {
        const res = await fetch(`/api/rooms?workspace_id=${workspaceId}`);
        if (res.ok) {
          const data = await res.json();
          setRooms(data.rooms || []);
        }
      } catch (error) {
        console.error('Failed to load rooms:', error);
      } finally {
        setLoadingRooms(false);
      }
    };

    loadRooms();
    const timer = setInterval(loadRooms, 10000);
    return () => clearInterval(timer);
  }, [workspaceId]);

  const handleConnectToOpenClaw = async (agent: Agent, e: React.MouseEvent) => {
    e.stopPropagation();
    setConnectingAgentId(agent.id);

    try {
      const existingSession = agentOpenClawSessions[agent.id];

      if (existingSession) {
        const res = await fetch(`/api/agents/${agent.id}/openclaw`, { method: 'DELETE' });
        if (res.ok) {
          setAgentOpenClawSession(agent.id, null);
        }
      } else {
        const res = await fetch(`/api/agents/${agent.id}/openclaw`, { method: 'POST' });
        if (res.ok) {
          const data = await res.json();
          setAgentOpenClawSession(agent.id, data.session as OpenClawSession);
        } else {
          const error = await res.json();
          console.error('Failed to connect to OpenClaw:', error);
          alert(`Failed to connect: ${error.error || 'Unknown error'}`);
        }
      }
    } catch (error) {
      console.error('OpenClaw connection error:', error);
    } finally {
      setConnectingAgentId(null);
    }
  };

  const filteredAgents = agents.filter((agent) => {
    if (filter === 'all') return true;
    return agent.status === filter;
  });

  const getStatusBadge = (status: AgentStatus) => {
    const styles = {
      standby: 'status-standby',
      working: 'status-working',
      offline: 'status-offline',
    };
    return styles[status] || styles.standby;
  };

  const expanded = mobileMode || !isMinimized;

  return (
    <aside
      className={`bg-mc-bg-secondary border-mc-border flex flex-col transition-all duration-300 ease-in-out ${
        mobileMode
          ? 'w-full h-full border-none'
          : `border-r ${isMinimized ? 'w-12' : 'w-64'}`
      }`}
    >
      {/* Header */}
      <div className="p-3 border-b border-mc-border flex-shrink-0">
        <div className="flex items-center">
          {!mobileMode && (
            <button
              onClick={toggleMinimize}
              className="p-1 rounded hover:bg-mc-bg-tertiary text-mc-text-secondary hover:text-mc-text transition-colors"
              aria-label={isMinimized ? 'Expand agents' : 'Minimize agents'}
            >
              {isMinimized ? (
                <ChevronRight className="w-4 h-4" />
              ) : (
                <ChevronLeft className="w-4 h-4" />
              )}
            </button>
          )}
          {expanded && (
            <>
              <span className="text-sm font-medium uppercase tracking-wider">Agents</span>
              <span className="bg-mc-bg-tertiary text-mc-text-secondary text-xs px-2 py-0.5 rounded ml-2">
                {agents.length}
              </span>
            </>
          )}
        </div>

        {expanded && (
          <>
            {activeSubAgents > 0 && (
              <div className="mb-3 mt-3 px-3 py-2 bg-green-500/10 border border-green-500/20 rounded-lg">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-green-400">●</span>
                  <span className="text-mc-text">Active Sub-Agents:</span>
                  <span className="font-bold text-green-400">{activeSubAgents}</span>
                </div>
              </div>
            )}

            {/* Top view switch */}
            <div className="flex gap-1 mt-2">
              <button
                onClick={() => setSidebarView('people')}
                className={`px-3 py-1.5 text-xs rounded min-h-[32px] flex items-center gap-1 ${
                  sidebarView === 'people'
                    ? 'bg-mc-accent text-mc-bg font-medium'
                    : 'text-mc-text-secondary hover:bg-mc-bg-tertiary'
                }`}
              >
                <Users className="w-3 h-3" /> People
              </button>
              <button
                onClick={() => setSidebarView('rooms')}
                className={`px-3 py-1.5 text-xs rounded min-h-[32px] flex items-center gap-1 ${
                  sidebarView === 'rooms'
                    ? 'bg-mc-accent text-mc-bg font-medium'
                    : 'text-mc-text-secondary hover:bg-mc-bg-tertiary'
                }`}
              >
                <MessagesSquare className="w-3 h-3" /> Rooms
              </button>
            </div>

            {/* Filter Tabs (people mode) */}
            {sidebarView === 'people' && (
              <div className="flex gap-1 mt-2">
                {(['all', 'working', 'standby'] as FilterTab[]).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setFilter(tab)}
                    className={`px-3 py-1.5 text-xs rounded uppercase min-h-[32px] ${
                      filter === tab
                        ? 'bg-mc-accent text-mc-bg font-medium'
                        : 'text-mc-text-secondary hover:bg-mc-bg-tertiary'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Agent / Rooms List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {sidebarView === 'people' && filteredAgents.map((agent) => {
          const openclawSession = agentOpenClawSessions[agent.id];

          if (!expanded) {
            return (
              <div key={agent.id} className="flex justify-center py-3">
                <button
                  onClick={() => {
                    setSelectedAgent(agent);
                    setEditingAgent(agent);
                  }}
                  className="relative group"
                  title={`${agent.name} - ${agent.role}`}
                >
                  <span className="text-2xl">{agent.avatar_emoji}</span>
                  {openclawSession && (
                    <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-mc-bg-secondary" />
                  )}
                  {!!agent.is_master && (
                    <span className="absolute -top-1 -right-1 text-xs text-mc-accent-yellow">★</span>
                  )}
                </button>
              </div>
            );
          }

          const isConnecting = connectingAgentId === agent.id;
          return (
            <div
              key={agent.id}
              className={`w-full rounded hover:bg-mc-bg-tertiary transition-colors ${
                selectedAgent?.id === agent.id ? 'bg-mc-bg-tertiary' : ''
              }`}
            >
              <button
                onClick={() => {
                  setSelectedAgent(agent);
                  setEditingAgent(agent);
                }}
                className="w-full flex items-center gap-3 p-2 sm:p-3 text-left min-h-[48px]"
              >
                <div className="text-2xl relative flex-shrink-0">{agent.avatar_emoji}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{agent.name}</span>
                    {!!agent.is_master && <span className="text-xs text-mc-accent-yellow flex-shrink-0">★</span>}
                  </div>
                  <div className="text-xs text-mc-text-secondary truncate">{agent.role}</div>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded uppercase flex-shrink-0 ${getStatusBadge(agent.status)}`}>{agent.status}</span>
              </button>

              {!!agent.is_master && (
                <div className="px-2 pb-2">
                  <button
                    onClick={(e) => handleConnectToOpenClaw(agent, e)}
                    disabled={isConnecting}
                    className={`w-full flex items-center justify-center gap-2 px-2 py-1.5 rounded text-xs transition-colors min-h-[36px] ${
                      openclawSession
                        ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                        : 'bg-mc-bg text-mc-text-secondary hover:bg-mc-bg-tertiary hover:text-mc-text'
                    }`}
                  >
                    {isConnecting ? <><Loader2 className="w-3 h-3 animate-spin" /><span>Connecting...</span></> : openclawSession ? <><Zap className="w-3 h-3" /><span>OpenClaw Connected</span></> : <><ZapOff className="w-3 h-3" /><span>Connect to OpenClaw</span></>}
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {sidebarView === 'rooms' && (
          <>
            {loadingRooms && <div className="text-xs text-mc-text-secondary p-2">Loading rooms…</div>}
            {!loadingRooms && rooms.length === 0 && <div className="text-xs text-mc-text-secondary p-2">No rooms yet for this workspace.</div>}
            {rooms.map((room) => (
              <button
                key={room.conversation_id}
                onClick={() => {
                  const task = tasks.find((t) => t.id === room.task_id) as Task | undefined;
                  if (task) setSelectedTask(task);
                }}
                className="w-full text-left p-2 rounded hover:bg-mc-bg-tertiary border border-transparent hover:border-mc-border"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium truncate">{room.task_title}</div>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-mc-bg text-mc-text-secondary uppercase">{room.task_status}</span>
                </div>
                <div className="text-xs text-mc-text-secondary truncate mt-1">{room.last_message || 'Sin mensajes todavía'}</div>
                <div className="text-[10px] text-mc-text-secondary mt-1">{room.message_count} msgs</div>
              </button>
            ))}
          </>
        )}
      </div>

      {/* Add Agent / Discover Buttons */}
      {expanded && (
        <div className="p-3 border-t border-mc-border space-y-2 flex-shrink-0">
          <button
            onClick={() => setShowCreateModal(true)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-mc-bg-tertiary hover:bg-mc-border rounded text-sm text-mc-text-secondary hover:text-mc-text transition-colors min-h-[44px]"
          >
            <Plus className="w-4 h-4" />
            Add Agent
          </button>
          <button
            onClick={() => setShowDiscoverModal(true)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 rounded text-sm text-blue-400 hover:text-blue-300 transition-colors min-h-[44px]"
          >
            <Search className="w-4 h-4" />
            Import from Gateway
          </button>
        </div>
      )}

      {/* Modals */}
      {showCreateModal && (
        <AgentModal onClose={() => setShowCreateModal(false)} workspaceId={workspaceId} />
      )}
      {editingAgent && (
        <AgentModal
          agent={editingAgent}
          onClose={() => setEditingAgent(null)}
          workspaceId={workspaceId}
        />
      )}
      {showDiscoverModal && (
        <DiscoverAgentsModal
          onClose={() => setShowDiscoverModal(false)}
          workspaceId={workspaceId}
        />
      )}
    </aside>
  );
}
