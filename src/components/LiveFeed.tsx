'use client';

import { useState } from 'react';
import { ChevronRight, ChevronLeft, Clock } from 'lucide-react';
import { useMissionControl } from '@/lib/store';
import type { Event } from '@/lib/types';
import { formatDistanceToNow } from 'date-fns';

type FeedFilter = 'all' | 'tasks' | 'agents';

interface LiveFeedProps {
  mobileMode?: boolean;
}

export function LiveFeed({ mobileMode }: LiveFeedProps) {
  const { events } = useMissionControl();
  const [filter, setFilter] = useState<FeedFilter>('all');
  const [isMinimized, setIsMinimized] = useState(false);

  const toggleMinimize = () => setIsMinimized(!isMinimized);

  const filteredEvents = events.filter((event) => {
    if (filter === 'all') return true;
    if (filter === 'tasks')
      return ['task_created', 'task_assigned', 'task_status_changed', 'task_completed'].includes(
        event.type
      );
    if (filter === 'agents')
      return ['agent_joined', 'agent_status_changed', 'message_sent'].includes(event.type);
    return true;
  });

  const expanded = mobileMode || !isMinimized;

  return (
    <aside
      className={`bg-mc-bg-secondary border-mc-border flex flex-col transition-all duration-300 ease-in-out ${
        mobileMode
          ? 'w-full h-full border-none'
          : `border-l ${isMinimized ? 'w-12' : 'w-80'}`
      }`}
    >
      {/* Header */}
      <div className="p-3 border-b border-mc-border flex-shrink-0">
        <div className="flex items-center">
          {!mobileMode && (
            <button
              onClick={toggleMinimize}
              className="p-1 rounded hover:bg-mc-bg-tertiary text-mc-text-secondary hover:text-mc-text transition-colors"
              aria-label={isMinimized ? 'Expand feed' : 'Minimize feed'}
            >
              {isMinimized ? (
                <ChevronLeft className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </button>
          )}
          {expanded && (
            <span className="text-sm font-medium uppercase tracking-wider">Live Feed</span>
          )}
        </div>

        {/* Filter Tabs */}
        {expanded && (
          <div className="flex gap-1 mt-3">
            {(['all', 'tasks', 'agents'] as FeedFilter[]).map((tab) => (
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
      </div>

      {/* Events List */}
      {expanded && (
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredEvents.length === 0 ? (
            <div className="text-center py-8 text-mc-text-secondary text-sm">
              No events yet
            </div>
          ) : (
            filteredEvents.map((event) => (
              <EventItem key={event.id} event={event} />
            ))
          )}
        </div>
      )}
    </aside>
  );
}

function EventItem({ event }: { event: Event }) {
  const getEventIcon = (type: string) => {
    switch (type) {
      case 'task_created':
        return '📋';
      case 'task_assigned':
        return '👤';
      case 'task_status_changed':
        return '🔄';
      case 'task_completed':
        return '✅';
      case 'message_sent':
        return '💬';
      case 'agent_joined':
        return '🎉';
      case 'agent_status_changed':
        return '🔔';
      case 'system':
        return '⚙️';
      default:
        return '📌';
    }
  };

  const isTaskEvent = ['task_created', 'task_assigned', 'task_completed'].includes(event.type);
  const isHighlight = event.type === 'task_created' || event.type === 'task_completed';

  return (
    <div
      className={`p-2 sm:p-3 rounded border-l-2 animate-slide-in ${
        isHighlight
          ? 'bg-mc-bg-tertiary border-mc-accent-pink'
          : 'bg-transparent border-transparent hover:bg-mc-bg-tertiary'
      }`}
    >
      <div className="flex items-start gap-2">
        <span className="text-sm flex-shrink-0">{getEventIcon(event.type)}</span>
        <div className="flex-1 min-w-0">
          <p className={`text-sm break-words ${isTaskEvent ? 'text-mc-accent-pink' : 'text-mc-text'}`}>
            {event.message}
          </p>
          <div className="flex items-center gap-1 mt-1 text-xs text-mc-text-secondary">
            <Clock className="w-3 h-3 flex-shrink-0" />
            {formatDistanceToNow(new Date(event.created_at), { addSuffix: true })}
          </div>
        </div>
      </div>
    </div>
  );
}
