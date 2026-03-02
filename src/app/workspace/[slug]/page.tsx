'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, Users, LayoutGrid, Activity } from 'lucide-react';
import { Header } from '@/components/Header';
import { AgentsSidebar } from '@/components/AgentsSidebar';
import { MissionQueue } from '@/components/MissionQueue';
import { LiveFeed } from '@/components/LiveFeed';
import { SSEDebugPanel } from '@/components/SSEDebugPanel';
import { useMissionControl } from '@/lib/store';
import { useSSE } from '@/hooks/useSSE';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { debug } from '@/lib/debug';
import type { Task, Workspace } from '@/lib/types';

type MobileView = 'board' | 'agents' | 'feed';

export default function WorkspacePage() {
  const params = useParams();
  const slug = params.slug as string;
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const [mobileView, setMobileView] = useState<MobileView>('board');
  const [leftWidth, setLeftWidth] = useState(256);
  const [rightWidth, setRightWidth] = useState(320);

  const {
    setAgents,
    setTasks,
    setEvents,
    setIsOnline,
    setIsLoading,
    isLoading,
  } = useMissionControl();

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [notFound, setNotFound] = useState(false);

  useSSE();

  useEffect(() => {
    async function loadWorkspace() {
      try {
        const res = await fetch(`/api/workspaces/${slug}`);
        if (res.ok) {
          const data = await res.json();
          setWorkspace(data);
        } else if (res.status === 404) {
          setNotFound(true);
          setIsLoading(false);
          return;
        }
      } catch (error) {
        console.error('Failed to load workspace:', error);
        setNotFound(true);
        setIsLoading(false);
        return;
      }
    }

    loadWorkspace();
  }, [slug, setIsLoading]);

  useEffect(() => {
    if (!workspace) return;

    const workspaceId = workspace.id;

    async function loadData() {
      try {
        debug.api('Loading workspace data...', { workspaceId });

        const [agentsRes, tasksRes, eventsRes] = await Promise.all([
          fetch(`/api/agents?workspace_id=${workspaceId}`),
          fetch(`/api/tasks?workspace_id=${workspaceId}`),
          fetch('/api/events'),
        ]);

        if (agentsRes.ok) setAgents(await agentsRes.json());
        if (tasksRes.ok) {
          const tasksData = await tasksRes.json();
          debug.api('Loaded tasks', { count: tasksData.length });
          setTasks(tasksData);
        }
        if (eventsRes.ok) setEvents(await eventsRes.json());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setIsLoading(false);
      }
    }

    async function checkOpenClaw() {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const openclawRes = await fetch('/api/openclaw/status', { signal: controller.signal });
        clearTimeout(timeoutId);

        if (openclawRes.ok) {
          const status = await openclawRes.json();
          setIsOnline(status.connected);
        }
      } catch {
        setIsOnline(false);
      }
    }

    loadData();
    checkOpenClaw();

    const eventPoll = setInterval(async () => {
      try {
        const res = await fetch('/api/events?limit=20');
        if (res.ok) {
          setEvents(await res.json());
        }
      } catch (error) {
        console.error('Failed to poll events:', error);
      }
    }, 30000);

    const taskPoll = setInterval(async () => {
      try {
        const res = await fetch(`/api/tasks?workspace_id=${workspaceId}`);
        if (res.ok) {
          const newTasks: Task[] = await res.json();
          const currentTasks = useMissionControl.getState().tasks;

          const hasChanges = newTasks.length !== currentTasks.length ||
            newTasks.some((t) => {
              const current = currentTasks.find(ct => ct.id === t.id);
              return !current || current.status !== t.status;
            });

          if (hasChanges) {
            debug.api('[FALLBACK] Task changes detected via polling, updating store');
            setTasks(newTasks);
          }
        }
      } catch (error) {
        console.error('Failed to poll tasks:', error);
      }
    }, 30000);

    const connectionCheck = setInterval(async () => {
      try {
        const res = await fetch('/api/openclaw/status');
        if (res.ok) {
          const status = await res.json();
          setIsOnline(status.connected);
        }
      } catch {
        setIsOnline(false);
      }
    }, 30000);

    return () => {
      clearInterval(eventPoll);
      clearInterval(connectionCheck);
      clearInterval(taskPoll);
    };
  }, [workspace, setAgents, setTasks, setEvents, setIsOnline, setIsLoading]);

  if (notFound) {
    return (
      <div className="min-h-screen bg-mc-bg flex items-center justify-center p-4">
        <div className="text-center">
          <div className="text-6xl mb-4">🔍</div>
          <h1 className="text-2xl font-bold mb-2">Workspace Not Found</h1>
          <p className="text-mc-text-secondary mb-6">
            The workspace &ldquo;{slug}&rdquo; doesn&apos;t exist.
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-6 py-3 bg-mc-accent text-mc-bg rounded-lg font-medium hover:bg-mc-accent/90"
          >
            <ChevronLeft className="w-4 h-4" />
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  if (isLoading || !workspace) {
    return (
      <div className="min-h-screen bg-mc-bg flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4 animate-pulse">🦞</div>
          <p className="text-mc-text-secondary">Loading {slug}...</p>
        </div>
      </div>
    );
  }

  const startResize = (side: 'left' | 'right') => (e: any) => {
    e.preventDefault();
    const startX = e.clientX;
    const startLeft = leftWidth;
    const startRight = rightWidth;

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      if (side === 'left') {
        setLeftWidth(Math.max(180, Math.min(420, startLeft + dx)));
      } else {
        setRightWidth(Math.max(220, Math.min(520, startRight - dx)));
      }
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div className="h-screen flex flex-col bg-mc-bg overflow-hidden">
      <Header workspace={workspace} />

      {isDesktop ? (
        <div className="flex-1 flex overflow-hidden">
          <AgentsSidebar workspaceId={workspace.id} desktopWidth={leftWidth} />
          <div
            className="w-1 cursor-col-resize bg-mc-border/60 hover:bg-mc-accent/60 transition-colors"
            onMouseDown={startResize('left')}
            title="Resize left panel"
          />
          <MissionQueue workspaceId={workspace.id} />
          <div
            className="w-1 cursor-col-resize bg-mc-border/60 hover:bg-mc-accent/60 transition-colors"
            onMouseDown={startResize('right')}
            title="Resize right panel"
          />
          <LiveFeed desktopWidth={rightWidth} />
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-hidden flex flex-col">
            {mobileView === 'board' && <MissionQueue workspaceId={workspace.id} />}
            {mobileView === 'agents' && (
              <AgentsSidebar
                workspaceId={workspace.id}
                mobileMode
                onOpenTaskFromRoom={() => setMobileView('board')}
              />
            )}
            {mobileView === 'feed' && <LiveFeed mobileMode />}
          </div>

          <nav className="flex-shrink-0 flex border-t border-mc-border bg-mc-bg-secondary safe-bottom">
            {([
              { id: 'agents' as MobileView, icon: Users, label: 'Agents' },
              { id: 'board' as MobileView, icon: LayoutGrid, label: 'Board' },
              { id: 'feed' as MobileView, icon: Activity, label: 'Feed' },
            ]).map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                onClick={() => setMobileView(id)}
                className={`flex-1 flex flex-col items-center gap-1 py-3 text-xs transition-colors ${
                  mobileView === id
                    ? 'text-mc-accent'
                    : 'text-mc-text-secondary active:text-mc-text'
                }`}
              >
                <Icon className="w-5 h-5" />
                {label}
              </button>
            ))}
          </nav>
        </>
      )}

      <SSEDebugPanel />
    </div>
  );
}
