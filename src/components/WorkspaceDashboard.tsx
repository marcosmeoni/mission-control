'use client';

import { useState, useEffect } from 'react';
import { Plus, ArrowRight, Folder, Users, CheckSquare, Trash2, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import type { WorkspaceStats } from '@/lib/types';

export function WorkspaceDashboard() {
  const [workspaces, setWorkspaces] = useState<WorkspaceStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [usage, setUsage] = useState<any>(null);

  useEffect(() => {
    loadWorkspaces();
    loadUsage();
  }, []);

  const loadWorkspaces = async () => {
    try {
      const res = await fetch('/api/workspaces?stats=true');
      if (res.ok) {
        const data = await res.json();
        setWorkspaces(data);
      }
    } catch (error) {
      console.error('Failed to load workspaces:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadUsage = async () => {
    try {
      const res = await fetch('/api/usage/summary');
      if (res.ok) setUsage(await res.json());
    } catch (error) {
      console.error('Failed to load usage summary:', error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-mc-bg flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4 animate-pulse">🦞</div>
          <p className="text-mc-text-secondary">Loading workspaces...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-mc-bg">
      {/* Header */}
      <header className="border-b border-mc-border bg-mc-bg-secondary">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-2xl flex-shrink-0">🦞</span>
              <h1 className="text-lg sm:text-xl font-bold truncate">Mission Control</h1>
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-mc-accent text-mc-bg rounded-lg font-medium hover:bg-mc-accent/90 min-h-[44px] flex-shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">New Workspace</span>
              <span className="sm:hidden">New</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-6 sm:mb-8">
          <h2 className="text-xl sm:text-2xl font-bold mb-2">All Workspaces</h2>
          <p className="text-mc-text-secondary text-sm sm:text-base">
            Select a workspace to view its mission queue and agents
          </p>
        </div>

        {usage && (
          <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-mc-bg-secondary border border-mc-border rounded-lg p-3">
              <div className="text-xs text-mc-text-secondary">Total tokens</div>
              <div className="text-lg font-semibold">{Number(usage?.total?.totalTokens || 0).toLocaleString()}</div>
            </div>
            <div className="bg-mc-bg-secondary border border-mc-border rounded-lg p-3">
              <div className="text-xs text-mc-text-secondary">Input / Output</div>
              <div className="text-sm font-medium">{Number(usage?.total?.inputTokens || 0).toLocaleString()} / {Number(usage?.total?.outputTokens || 0).toLocaleString()}</div>
            </div>
            <div className="bg-mc-bg-secondary border border-mc-border rounded-lg p-3">
              <div className="text-xs text-mc-text-secondary">Active sessions</div>
              <div className="text-lg font-semibold">{Number(usage?.sessionsCount || 0)}</div>
            </div>
            <div className="bg-mc-bg-secondary border border-mc-border rounded-lg p-3">
              <div className="text-xs text-mc-text-secondary">Costo estimado (USD)</div>
              <div className="text-lg font-semibold">${Number(usage?.total?.estCostUsd || 0).toFixed(4)}</div>
            </div>
          </div>
        )}

        {usage && (
          <div className="mb-4 bg-mc-bg-secondary border border-mc-border rounded-lg p-3 overflow-auto">
            <div className="text-sm font-semibold mb-2">Costo por workspace</div>
            <table className="w-full text-xs sm:text-sm">
              <thead>
                <tr className="text-mc-text-secondary text-left border-b border-mc-border">
                  <th className="py-2 pr-2">Workspace</th>
                  <th className="py-2 pr-2">Tokens</th>
                  <th className="py-2 pr-2">Costo USD</th>
                </tr>
              </thead>
              <tbody>
                {(usage.byWorkspace || []).map((r: any) => (
                  <tr key={r.workspaceId} className="border-b border-mc-border/40">
                    <td className="py-2 pr-2">{r.workspaceName || r.workspaceId}</td>
                    <td className="py-2 pr-2">{Number(r.totalTokens||0).toLocaleString()}</td>
                    <td className="py-2 pr-2">${Number(r.estCostUsd||0).toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {usage && (
          <div className="mb-8 bg-mc-bg-secondary border border-mc-border rounded-lg p-3 overflow-auto">
            <div className="text-sm font-semibold mb-2">Usage por agente/modelo (top 10)</div>
            <table className="w-full text-xs sm:text-sm">
              <thead>
                <tr className="text-mc-text-secondary text-left border-b border-mc-border">
                  <th className="py-2 pr-2">Agent</th>
                  <th className="py-2 pr-2">Workspace</th>
                  <th className="py-2 pr-2">Model</th>
                  <th className="py-2 pr-2">Tokens</th>
                  <th className="py-2 pr-2">Costo USD</th>
                </tr>
              </thead>
              <tbody>
                {(usage.byAgent || []).slice(0,10).map((r: any) => (
                  <tr key={`${r.agentId}-${r.model}`} className="border-b border-mc-border/40">
                    <td className="py-2 pr-2">{r.agentName}</td>
                    <td className="py-2 pr-2">{r.workspaceId}</td>
                    <td className="py-2 pr-2">{r.model}</td>
                    <td className="py-2 pr-2">{Number(r.totalTokens||0).toLocaleString()}</td>
                    <td className="py-2 pr-2">${Number(r.estCostUsd||0).toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {workspaces.length === 0 ? (
          <div className="text-center py-12 sm:py-16">
            <Folder className="w-12 sm:w-16 h-12 sm:h-16 mx-auto text-mc-text-secondary mb-4" />
            <h3 className="text-lg font-medium mb-2">No workspaces yet</h3>
            <p className="text-mc-text-secondary mb-6">
              Create your first workspace to get started
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-6 py-3 bg-mc-accent text-mc-bg rounded-lg font-medium hover:bg-mc-accent/90 min-h-[44px]"
            >
              Create Workspace
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {workspaces.map((workspace) => (
              <WorkspaceCard 
                key={workspace.id} 
                workspace={workspace} 
                onDelete={(id) => setWorkspaces(workspaces.filter(w => w.id !== id))}
              />
            ))}
            
            {/* Add workspace card */}
            <button
              onClick={() => setShowCreateModal(true)}
              className="border-2 border-dashed border-mc-border rounded-xl p-6 hover:border-mc-accent/50 transition-colors flex flex-col items-center justify-center gap-3 min-h-[160px] sm:min-h-[200px]"
            >
              <div className="w-12 h-12 rounded-full bg-mc-bg-tertiary flex items-center justify-center">
                <Plus className="w-6 h-6 text-mc-text-secondary" />
              </div>
              <span className="text-mc-text-secondary font-medium">Add Workspace</span>
            </button>
          </div>
        )}
      </main>

      {/* Create Modal */}
      {showCreateModal && (
        <CreateWorkspaceModal 
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false);
            loadWorkspaces();
          }}
        />
      )}
    </div>
  );
}

function WorkspaceCard({ workspace, onDelete }: { workspace: WorkspaceStats; onDelete: (id: string) => void }) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDeleting(true);
    try {
      const res = await fetch(`/api/workspaces/${workspace.id}`, { method: 'DELETE' });
      if (res.ok) {
        onDelete(workspace.id);
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to delete workspace');
      }
    } catch {
      alert('Failed to delete workspace');
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };
  
  return (
    <>
    <Link href={`/workspace/${workspace.slug}`}>
      <div className="bg-mc-bg-secondary border border-mc-border rounded-xl p-4 sm:p-6 hover:border-mc-accent/50 transition-all hover:shadow-lg cursor-pointer group relative active:scale-[0.98]">
        <div className="flex items-start justify-between mb-3 sm:mb-4 gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-2xl sm:text-3xl flex-shrink-0">{workspace.icon}</span>
            <div className="min-w-0">
              <h3 className="font-semibold text-base sm:text-lg group-hover:text-mc-accent transition-colors truncate">
                {workspace.name}
              </h3>
              <p className="text-sm text-mc-text-secondary truncate">/{workspace.slug}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {workspace.id !== 'default' && (
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowDeleteConfirm(true);
                }}
                className="p-2 rounded hover:bg-mc-accent-red/20 text-mc-text-secondary hover:text-mc-accent-red transition-colors opacity-0 group-hover:opacity-100 min-w-[36px] min-h-[36px] flex items-center justify-center"
                title="Delete workspace"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <ArrowRight className="w-5 h-5 text-mc-text-secondary group-hover:text-mc-accent transition-colors" />
          </div>
        </div>

        <div className="flex items-center gap-4 text-sm text-mc-text-secondary mt-3 sm:mt-4">
          <div className="flex items-center gap-1">
            <CheckSquare className="w-4 h-4 flex-shrink-0" />
            <span>{workspace.taskCounts.total} tasks</span>
          </div>
          <div className="flex items-center gap-1">
            <Users className="w-4 h-4 flex-shrink-0" />
            <span>{workspace.agentCount} agents</span>
          </div>
        </div>
      </div>
    </Link>

    {/* Delete Confirmation Modal */}
    {showDeleteConfirm && (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowDeleteConfirm(false)}>
        <div className="bg-mc-bg-secondary border border-mc-border rounded-xl w-full max-w-md p-4 sm:p-6" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 bg-mc-accent-red/20 rounded-full flex-shrink-0">
              <AlertTriangle className="w-6 h-6 text-mc-accent-red" />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-lg">Delete Workspace</h3>
              <p className="text-sm text-mc-text-secondary">This action cannot be undone</p>
            </div>
          </div>
          
          <p className="text-mc-text-secondary mb-6">
            Are you sure you want to delete <strong>{workspace.name}</strong>? 
            {workspace.taskCounts.total > 0 && (
              <span className="block mt-2 text-mc-accent-red">
                ⚠️ This workspace has {workspace.taskCounts.total} task(s). Delete them first.
              </span>
            )}
          </p>
          
          <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-3">
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="px-4 py-2.5 text-mc-text-secondary hover:text-mc-text min-h-[44px]"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting || workspace.taskCounts.total > 0 || workspace.agentCount > 0}
              className="px-4 py-2.5 bg-mc-accent-red text-white rounded-lg font-medium hover:bg-mc-accent-red/90 disabled:opacity-50 min-h-[44px]"
            >
              {deleting ? 'Deleting...' : 'Delete Workspace'}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

function CreateWorkspaceModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('📁');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const icons = ['📁', '💼', '🏢', '🚀', '💡', '🎯', '📊', '🔧', '🌟', '🏠'];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), icon }),
      });

      if (res.ok) {
        onCreated();
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to create workspace');
      }
    } catch {
      setError('Failed to create workspace');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-mc-bg-secondary border border-mc-border rounded-t-xl sm:rounded-xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto">
        <div className="p-4 sm:p-6 border-b border-mc-border">
          <h2 className="text-lg font-semibold">Create New Workspace</h2>
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4">
          {/* Icon selector */}
          <div>
            <label className="block text-sm font-medium mb-2">Icon</label>
            <div className="flex flex-wrap gap-2">
              {icons.map((i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setIcon(i)}
                  className={`w-11 h-11 sm:w-10 sm:h-10 rounded-lg text-xl flex items-center justify-center transition-colors ${
                    icon === i 
                      ? 'bg-mc-accent/20 border-2 border-mc-accent' 
                      : 'bg-mc-bg border border-mc-border hover:border-mc-accent/50'
                  }`}
                >
                  {i}
                </button>
              ))}
            </div>
          </div>

          {/* Name input */}
          <div>
            <label className="block text-sm font-medium mb-2">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Acme Corp"
              className="w-full bg-mc-bg border border-mc-border rounded-lg px-4 py-2.5 focus:outline-none focus:border-mc-accent text-base sm:text-sm"
              autoFocus
            />
          </div>

          {error && (
            <div className="text-mc-accent-red text-sm">{error}</div>
          )}

          <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 text-mc-text-secondary hover:text-mc-text min-h-[44px]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || isSubmitting}
              className="px-6 py-2.5 bg-mc-accent text-mc-bg rounded-lg font-medium hover:bg-mc-accent/90 disabled:opacity-50 min-h-[44px]"
            >
              {isSubmitting ? 'Creating...' : 'Create Workspace'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
