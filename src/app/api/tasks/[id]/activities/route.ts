/**
 * Task Activities API
 * Endpoints for logging and retrieving task activities
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { broadcast } from '@/lib/events';
import { CreateActivitySchema } from '@/lib/validation';
import { startDispatchTimeoutGuard } from '@/lib/dispatch-timeout-guard';
import type { Task, TaskActivity } from '@/lib/types';
import { notifyTaskStatusChange } from '@/lib/notifier';

/**
 * GET /api/tasks/[id]/activities
 * Retrieve all activities for a task
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const taskId = params.id;
    const db = getDb();

    // Get activities with agent info
    const activities = db.prepare(`
      SELECT 
        a.*,
        ag.id as agent_id,
        ag.name as agent_name,
        ag.avatar_emoji as agent_avatar_emoji
      FROM task_activities a
      LEFT JOIN agents ag ON a.agent_id = ag.id
      WHERE a.task_id = ?
      ORDER BY a.created_at DESC
    `).all(taskId) as any[];

    // Transform to include agent object
    const result: TaskActivity[] = activities.map(row => ({
      id: row.id,
      task_id: row.task_id,
      agent_id: row.agent_id,
      activity_type: row.activity_type,
      message: row.message,
      metadata: row.metadata,
      created_at: row.created_at,
      agent: row.agent_id ? {
        id: row.agent_id,
        name: row.agent_name,
        avatar_emoji: row.agent_avatar_emoji,
        role: '',
        status: 'working' as const,
        is_master: false,
        workspace_id: 'default',
        source: 'local' as const,
        description: '',
        created_at: '',
        updated_at: '',
      } : undefined,
    }));

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error fetching activities:', error);
    return NextResponse.json(
      { error: 'Failed to fetch activities' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/tasks/[id]/activities
 * Log a new activity for a task
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  startDispatchTimeoutGuard();
  try {
    const taskId = params.id;
    const body = await request.json();
    
    // Validate input with Zod
    const validation = CreateActivitySchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.issues },
        { status: 400 }
      );
    }

    const { activity_type, message, agent_id, metadata } = validation.data;

    const db = getDb();
    const id = crypto.randomUUID();

    // Insert activity
    db.prepare(`
      INSERT INTO task_activities (id, task_id, agent_id, activity_type, message, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      taskId,
      agent_id || null,
      activity_type,
      message,
      metadata ? JSON.stringify(metadata) : null
    );

    // Get the created activity with agent info
    const activity = db.prepare(`
      SELECT 
        a.*,
        ag.id as agent_id,
        ag.name as agent_name,
        ag.avatar_emoji as agent_avatar_emoji
      FROM task_activities a
      LEFT JOIN agents ag ON a.agent_id = ag.id
      WHERE a.id = ?
    `).get(id) as any;

    const result: TaskActivity = {
      id: activity.id,
      task_id: activity.task_id,
      agent_id: activity.agent_id,
      activity_type: activity.activity_type,
      message: activity.message,
      metadata: activity.metadata,
      created_at: activity.created_at,
      agent: activity.agent_id ? {
        id: activity.agent_id,
        name: activity.agent_name,
        avatar_emoji: activity.agent_avatar_emoji,
        role: '',
        status: 'working' as const,
        is_master: false,
        workspace_id: 'default',
        source: 'local' as const,
        description: '',
        created_at: '',
        updated_at: '',
      } : undefined,
    };

    // Mirror activity to task room conversation (chat visibility)
    try {
      let conv = db.prepare(`SELECT id FROM conversations WHERE task_id = ? AND type = 'task' LIMIT 1`).get(taskId) as { id: string } | undefined;
      if (!conv) {
        const convId = crypto.randomUUID();
        const now = new Date().toISOString();
        db.prepare(`INSERT INTO conversations (id, title, type, task_id, created_at, updated_at) VALUES (?, ?, 'task', ?, ?, ?)`)
          .run(convId, `Task Room ${taskId.slice(0, 8)}`, taskId, now, now);
        conv = { id: convId };
      }

      db.prepare(`
        INSERT INTO messages (id, conversation_id, sender_agent_id, content, message_type, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        conv.id,
        agent_id || null,
        `📝 ${message}`,
        'task_update',
        new Date().toISOString()
      );

      db.prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`).run(new Date().toISOString(), conv.id);
    } catch (e) {
      console.warn('Failed to mirror activity into task room:', e);
    }

    // Immediate in_progress promotion: if an agent logs an activity and the task
    // is still in assigned/dispatched state, escalate to in_progress.
    if (agent_id) {
      const currentTask = db.prepare('SELECT status, title FROM tasks WHERE id = ?').get(taskId) as { status: string; title: string } | undefined;
      if (currentTask && (currentTask.status === 'assigned' || currentTask.status === 'dispatched')) {
        const now = new Date().toISOString();
        db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?').run('in_progress', now, taskId);
        const promoted = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as Task | undefined;
        if (promoted) broadcast({ type: 'task_updated', payload: promoted });
        // Notify on auto-promotion to in_progress
        notifyTaskStatusChange(taskId, currentTask.title, 'in_progress', null)
          .catch(err => console.error('[Notifier] in_progress promotion notify error:', err));
      }
    }

    // Broadcast to SSE clients
    broadcast({
      type: 'activity_logged',
      payload: result,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error('Error creating activity:', error);
    return NextResponse.json(
      { error: 'Failed to create activity' },
      { status: 500 }
    );
  }
}
