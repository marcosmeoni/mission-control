/**
 * Configuration Management
 * 
 * Handles user-configurable settings for Mission Control.
 * Settings are stored in localStorage for client-side access.
 * 
 * NEVER commit hardcoded IPs, paths, or sensitive data!
 */

export interface MissionControlConfig {
  // Workspace settings
  workspaceBasePath: string; // e.g., ~/Documents/Shared
  projectsPath: string; // e.g., ${workspaceBasePath}/projects
  
  // Mission Control API URL (for orchestration)
  missionControlUrl: string; // Auto-detected or manually set
  
  // OpenClaw Gateway settings (these come from .env on server)
  // Client-side only needs to know if it's configured
  
  // Project defaults
  defaultProjectName: string; // 'mission-control' or custom
}

const DEFAULT_CONFIG: MissionControlConfig = {
  workspaceBasePath: '~/Documents/Shared',
  projectsPath: '~/Documents/Shared/projects',
  missionControlUrl: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4000',
  defaultProjectName: 'mission-control',
};

const CONFIG_KEY = 'mission-control-config';

/**
 * Get current configuration
 * Returns defaults merged with user overrides
 */
export function getConfig(): MissionControlConfig {
  if (typeof window === 'undefined') {
    return DEFAULT_CONFIG;
  }

  try {
    const stored = localStorage.getItem(CONFIG_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...DEFAULT_CONFIG, ...parsed };
    }
  } catch (error) {
    console.error('Failed to load config:', error);
  }

  return DEFAULT_CONFIG;
}

/**
 * Update configuration
 * Validates and saves to localStorage
 */
export function updateConfig(updates: Partial<MissionControlConfig>): void {
  if (typeof window === 'undefined') {
    throw new Error('Cannot update config on server side');
  }

  const current = getConfig();
  const updated = { ...current, ...updates };

  // Validate paths
  if (updates.workspaceBasePath !== undefined) {
    if (!updates.workspaceBasePath.trim()) {
      throw new Error('Workspace base path cannot be empty');
    }
  }

  if (updates.missionControlUrl !== undefined) {
    try {
      new URL(updates.missionControlUrl);
    } catch {
      throw new Error('Invalid Mission Control URL');
    }
  }

  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(updated));
  } catch (error) {
    console.error('Failed to save config:', error);
    throw new Error('Failed to save configuration');
  }
}

/**
 * Reset configuration to defaults
 */
export function resetConfig(): void {
  if (typeof window === 'undefined') {
    throw new Error('Cannot reset config on server side');
  }

  localStorage.removeItem(CONFIG_KEY);
}

/**
 * Expand tilde in paths (for display purposes)
 * Note: Actual path resolution happens server-side
 */
export function expandPath(path: string): string {
  if (typeof window === 'undefined') {
    return path;
  }

  // This is client-side only - server will handle actual expansion
  return path.replace(/^~/, process.env.HOME || '/Users/user');
}

/**
 * Get Mission Control URL for API calls
 * Used by orchestration module and other server-side modules
 */
export function getMissionControlUrl(): string {
  // Server-side: use env var or auto-detect
  if (typeof window === 'undefined') {
    return process.env.MISSION_CONTROL_URL || 'http://localhost:4000';
  }

  // Client-side: use config
  return getConfig().missionControlUrl;
}

/**
 * Get workspace base path
 * Server-side only - returns configured path or default
 */
export function getWorkspaceBasePath(): string {
  if (typeof window !== 'undefined') {
    return getConfig().workspaceBasePath;
  }

  // Server-side: check env var first, then default
  return process.env.WORKSPACE_BASE_PATH || '~/Documents/Shared';
}

/**
 * Get projects path
 * Server-side only - returns configured path or default
 */
export function getProjectsPath(): string {
  if (typeof window !== 'undefined') {
    return getConfig().projectsPath;
  }

  // Server-side: check env var first, then default
  return process.env.PROJECTS_PATH || '~/Documents/Shared/projects';
}

/**
 * Build project-specific path
 * @param projectName - Name of the project
 * @param subpath - Optional subpath within project (e.g., 'deliverables')
 */
export function getProjectPath(projectName: string, subpath?: string): string {
  const projectsPath = getProjectsPath();
  const base = `${projectsPath}/${projectName}`;
  return subpath ? `${base}/${subpath}` : base;
}

// ---------------------------------------------------------------------------
// Polling & responsiveness configuration (server-side env vars)
// ---------------------------------------------------------------------------

/**
 * Fallback task-list poll interval in ms (workspace page).
 * MC_TASK_POLL_MS – default 30 000 ms (30 s). Set lower for snappier fallback.
 */
export function getTaskPollIntervalMs(): number {
  const v = parseInt(process.env.MC_TASK_POLL_MS || '', 10);
  return isNaN(v) ? 30_000 : v;
}

/**
 * Task-room (chat) poll interval in ms.
 * MC_ROOM_POLL_MS – default 3 000 ms (3 s).
 */
export function getRoomPollIntervalMs(): number {
  const v = parseInt(process.env.MC_ROOM_POLL_MS || '', 10);
  return isNaN(v) ? 3_000 : v;
}

/**
 * Activity-log poll interval in ms.
 * MC_ACTIVITY_POLL_MS – default 3 000 ms (3 s).
 */
export function getActivityPollIntervalMs(): number {
  const v = parseInt(process.env.MC_ACTIVITY_POLL_MS || '', 10);
  return isNaN(v) ? 3_000 : v;
}

/**
 * Dispatch-timeout guard window in ms.
 * If a dispatched task has no agent activity within this window it is marked blocked.
 * MC_DISPATCH_TIMEOUT_MS – default 300 000 ms (5 min). Set to 0 to disable.
 */
export function getDispatchTimeoutMs(): number {
  const v = parseInt(process.env.MC_DISPATCH_TIMEOUT_MS || '', 10);
  return isNaN(v) ? 300_000 : v;
}

/**
 * How often the dispatch-timeout watcher runs.
 * MC_DISPATCH_TIMEOUT_CHECK_MS – default 60 000 ms (1 min).
 */
export function getDispatchTimeoutCheckMs(): number {
  const v = parseInt(process.env.MC_DISPATCH_TIMEOUT_CHECK_MS || '', 10);
  return isNaN(v) ? 60_000 : v;
}

/**
 * Whether the OpenClaw-to-room live mirror is enabled.
 * MC_ROOM_OPENCLAW_MIRROR=true to enable (default false).
 */
export function isOpenClawRoomMirrorEnabled(): boolean {
  return process.env.MC_ROOM_OPENCLAW_MIRROR === 'true';
}

/**
 * How often the room mirror polls OpenClaw sessions.
 * MC_ROOM_OPENCLAW_MIRROR_POLL_MS – default 5 000 ms.
 */
export function getOpenClawRoomMirrorPollMs(): number {
  const v = parseInt(process.env.MC_ROOM_OPENCLAW_MIRROR_POLL_MS || '', 10);
  return isNaN(v) ? 5_000 : Math.max(1_000, v);
}
