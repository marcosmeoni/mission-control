'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Zap, Settings, ChevronLeft, LayoutGrid, LogOut } from 'lucide-react';
import { useMissionControl } from '@/lib/store';
import { format } from 'date-fns';
import type { Workspace } from '@/lib/types';

interface HeaderProps {
  workspace?: Workspace;
}

export function Header({ workspace }: HeaderProps) {
  const router = useRouter();
  const { agents, tasks, isOnline } = useMissionControl();
  const [currentTime, setCurrentTime] = useState(new Date());
  const [activeSubAgents, setActiveSubAgents] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

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

  const workingAgents = agents.filter((a) => a.status === 'working').length;
  const activeAgents = workingAgents + activeSubAgents;
  const tasksInQueue = tasks.filter((t) => t.status !== 'done' && t.status !== 'review').length;

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      router.push('/login');
      router.refresh();
    }
  };

  return (
    <header className="h-14 bg-mc-bg-secondary border-b border-mc-border flex items-center justify-between px-2 sm:px-4 flex-shrink-0">
      {/* Left: Logo & Title */}
      <div className="flex items-center gap-2 sm:gap-4 min-w-0">
        <div className="flex items-center gap-2 flex-shrink-0">
          <Zap className="w-5 h-5 text-mc-accent-cyan" />
          <span className="font-semibold text-mc-text uppercase tracking-wider text-sm hidden sm:inline">
            Mission Control
          </span>
        </div>

        {workspace ? (
          <div className="flex items-center gap-1 sm:gap-2 min-w-0">
            <Link
              href="/"
              className="flex items-center gap-1 text-mc-text-secondary hover:text-mc-accent transition-colors flex-shrink-0 p-1"
            >
              <ChevronLeft className="w-4 h-4" />
              <LayoutGrid className="w-4 h-4 hidden sm:block" />
            </Link>
            <span className="text-mc-text-secondary hidden sm:inline">/</span>
            <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1 bg-mc-bg-tertiary rounded min-w-0">
              <span className="text-base sm:text-lg flex-shrink-0">{workspace.icon}</span>
              <span className="font-medium text-sm sm:text-base truncate max-w-[120px] sm:max-w-none">
                {workspace.name}
              </span>
            </div>
          </div>
        ) : (
          <Link
            href="/"
            className="flex items-center gap-2 px-3 py-1.5 bg-mc-bg-tertiary rounded hover:bg-mc-bg transition-colors"
          >
            <LayoutGrid className="w-4 h-4" />
            <span className="text-sm">All Workspaces</span>
          </Link>
        )}
      </div>

      {/* Center: Stats - hidden on mobile/tablet */}
      {workspace && (
        <div className="hidden lg:flex items-center gap-8">
          <div className="text-center">
            <div className="text-2xl font-bold text-mc-accent-cyan">{activeAgents}</div>
            <div className="text-xs text-mc-text-secondary uppercase">Agents Active</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-mc-accent-purple">{tasksInQueue}</div>
            <div className="text-xs text-mc-text-secondary uppercase">Tasks in Queue</div>
          </div>
        </div>
      )}

      {/* Right: Time & Status */}
      <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
        <span className="text-mc-text-secondary text-sm font-mono hidden sm:block">
          {format(currentTime, 'HH:mm:ss')}
        </span>
        <div
          className={`flex items-center gap-1.5 px-2 sm:px-3 py-1 rounded border text-xs sm:text-sm font-medium ${
            isOnline
              ? 'bg-mc-accent-green/20 border-mc-accent-green text-mc-accent-green'
              : 'bg-mc-accent-red/20 border-mc-accent-red text-mc-accent-red'
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${
              isOnline ? 'bg-mc-accent-green animate-pulse' : 'bg-mc-accent-red'
            }`}
          />
          <span className="hidden sm:inline">{isOnline ? 'ONLINE' : 'OFFLINE'}</span>
        </div>
        <button
          onClick={handleLogout}
          className="p-2 hover:bg-mc-bg-tertiary rounded text-mc-text-secondary min-w-[44px] min-h-[44px] flex items-center justify-center"
          title="Logout"
        >
          <LogOut className="w-5 h-5" />
        </button>
        <button
          onClick={() => router.push('/settings')}
          className="p-2 hover:bg-mc-bg-tertiary rounded text-mc-text-secondary min-w-[44px] min-h-[44px] flex items-center justify-center"
          title="Settings"
        >
          <Settings className="w-5 h-5" />
        </button>
      </div>
    </header>
  );
}
