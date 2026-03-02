/**
 * Real-time WhatsApp notifier for Mission Control task state transitions.
 *
 * Controlled by:
 *   MC_REALTIME_NOTIFICATIONS=true   (enables the feature)
 *   MC_NOTIFY_TARGET=+5492364545076  (WhatsApp recipient, E.164)
 *
 * De-duplicates: skips notification if same taskId+status was already sent
 * within the last hour. Uses an in-process Map on globalThis to survive
 * Next.js hot-reload without duplicate sends.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const KEY_STATES = new Set(['in_progress', 'review', 'done', 'blocked']);

// Dedup cache: "taskId:status" → timestamp of last notification sent
const CACHE_KEY = '__mc_notify_sent__';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

if (!(CACHE_KEY in globalThis)) {
  (globalThis as Record<string, unknown>)[CACHE_KEY] = new Map<string, number>();
}

const sentCache = (globalThis as unknown as Record<string, Map<string, number>>)[CACHE_KEY];

function isEnabled(): boolean {
  return process.env.MC_REALTIME_NOTIFICATIONS === 'true';
}

function getTarget(): string {
  return process.env.MC_NOTIFY_TARGET || '+5492364545076';
}

/**
 * Notify if the new status is a key state and hasn't been notified recently.
 *
 * @param taskId   Task UUID
 * @param title    Task title for the notification message
 * @param newStatus  The status the task just moved to
 * @param workspace  Optional workspace name for context
 */
export async function notifyTaskStatusChange(
  taskId: string,
  title: string,
  newStatus: string,
  workspace?: string | null
): Promise<void> {
  if (!isEnabled()) return;
  if (!KEY_STATES.has(newStatus)) return;

  const cacheKey = `${taskId}:${newStatus}`;
  const now = Date.now();
  const lastSent = sentCache.get(cacheKey);

  if (lastSent && now - lastSent < CACHE_TTL_MS) {
    console.log(`[Notifier] Skipping duplicate notification for ${cacheKey}`);
    return;
  }

  sentCache.set(cacheKey, now);

  const statusEmoji: Record<string, string> = {
    in_progress: '🔄',
    review: '👀',
    done: '✅',
    blocked: '🚫',
  };

  const emoji = statusEmoji[newStatus] || '📋';
  const ws = workspace ? `[${workspace}] ` : '';
  const shortId = taskId.slice(0, 8);
  const msg = `${emoji} *Mission Control*\n${ws}Task *${title}* → *${newStatus}*\nID: ${shortId}`;

  const target = getTarget();

  console.log(`[Notifier] Sending WhatsApp notification to ${target}: ${newStatus} — ${title}`);

  try {
    await execFileAsync('openclaw', [
      'message', 'send',
      '--channel', 'whatsapp',
      '--target', target,
      '--message', msg,
    ], { timeout: 15000 });
    console.log(`[Notifier] Notification sent for task ${shortId} → ${newStatus}`);
  } catch (err) {
    console.error('[Notifier] Failed to send WhatsApp notification:', err);
    // Remove from cache so next attempt can retry
    sentCache.delete(cacheKey);
  }
}
