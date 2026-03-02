/**
 * Dispatch Timeout Guard
 *
 * Periodically checks for tasks that have been in `in_progress` (dispatched) state
 * but have received no agent activity within the configured timeout window.
 * Those tasks are moved to `blocked` with an explanatory activity note.
 *
 * Env vars:
 *   MC_DISPATCH_TIMEOUT_MS       – timeout window in ms (default 300 000 / 5 min)
 *   MC_DISPATCH_TIMEOUT_CHECK_MS – check interval in ms (default 60 000 / 1 min)
 *   MC_DISPATCH_TIMEOUT_ENABLED  – set to "false" to disable entirely (default enabled)
 */

import { v4 as uuidv4 } from 'uuid';
import { queryAll, queryOne, run } from '@/lib/db';
import { broadcast } from '@/lib/events';
import { getDispatchTimeoutMs, getDispatchTimeoutCheckMs } from '@/lib/config';
import type { Task } from '@/lib/types';

let guardStarted = false;

export function startDispatchTimeoutGuard(): void {
  if (guardStarted) return;
  if (process.env.MC_DISPATCH_TIMEOUT_ENABLED === 'false') {
    console.log('[timeout-guard] disabled via MC_DISPATCH_TIMEOUT_ENABLED=false');
    return;
  }

  guardStarted = true;
  const checkIntervalMs = getDispatchTimeoutCheckMs();
  console.log(`[timeout-guard] started – checking every ${checkIntervalMs}ms`);

  setInterval(() => {
    checkTimedOutTasks();
  }, checkIntervalMs);
}

function checkTimedOutTasks(): void {
  const timeoutMs = getDispatchTimeoutMs();
  if (timeoutMs === 0) return; // 0 = disabled

  const cutoff = new Date(Date.now() - timeoutMs).toISOString();

  // Find in_progress tasks that have no task_activity more recent than the cutoff
  // and whose last status change (updated_at) is older than cutoff
  const candidates = queryAll<{ id: string; title: string; assigned_agent_id: string | null; updated_at: string }>(
    `SELECT id, title, assigned_agent_id, updated_at
     FROM tasks
     WHERE status = 'in_progress'
       AND updated_at < ?`,
    [cutoff]
  );

  for (const task of candidates) {
    // Check if there is any agent activity after updated_at
    const recentActivity = queryOne<{ id: string }>(
      `SELECT id FROM task_activities
       WHERE task_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [task.id]
    );

    const hasRecentActivity = recentActivity
      ? queryOne<{ n: number }>(
          `SELECT COUNT(*) as n FROM task_activities
           WHERE task_id = ? AND created_at > ?`,
          [task.id, cutoff]
        )?.n ?? 0
      : 0;

    if (hasRecentActivity > 0) continue;

    console.log(`[timeout-guard] task "${task.title}" (${task.id}) timed out – marking blocked`);

    const now = new Date().toISOString();
    run(
      'UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?',
      ['blocked', now, task.id]
    );

    const activityId = uuidv4();
    run(
      `INSERT INTO task_activities (id, task_id, agent_id, activity_type, message, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        activityId,
        task.id,
        task.assigned_agent_id,
        'blocked',
        `⏱ No agent activity received within the ${Math.round(timeoutMs / 60_000)} min timeout window. Task marked as blocked.`,
        now,
      ]
    );

    // Broadcast the updated task
    const updatedTask = queryOne<Task>('SELECT * FROM tasks WHERE id = ?', [task.id]);
    if (updatedTask) {
      broadcast({ type: 'task_updated', payload: updatedTask });
    }
  }
}
