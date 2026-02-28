import { NextRequest, NextResponse } from 'next/server';
import { queryAll } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/rooms?workspace_id=...&task_id=...
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get('workspace_id');
    const taskId = searchParams.get('task_id');

    if (!workspaceId) {
      return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 });
    }

    let sql = `
      SELECT
        c.id as conversation_id,
        c.task_id,
        t.title as task_title,
        t.status as task_status,
        t.priority as task_priority,
        c.updated_at,
        (
          SELECT m.content
          FROM messages m
          WHERE m.conversation_id = c.id
          ORDER BY m.created_at DESC
          LIMIT 1
        ) as last_message,
        (
          SELECT m.created_at
          FROM messages m
          WHERE m.conversation_id = c.id
          ORDER BY m.created_at DESC
          LIMIT 1
        ) as last_message_at,
        (
          SELECT COUNT(*)
          FROM messages m
          WHERE m.conversation_id = c.id
        ) as message_count
      FROM conversations c
      INNER JOIN tasks t ON t.id = c.task_id
      WHERE c.type = 'task'
        AND t.workspace_id = ?
    `;

    const params: unknown[] = [workspaceId];

    if (taskId) {
      sql += ' AND c.task_id = ?';
      params.push(taskId);
    }

    sql += ' ORDER BY COALESCE(last_message_at, c.updated_at) DESC';

    const rooms = queryAll(sql, params);
    return NextResponse.json({ rooms });
  } catch (error) {
    console.error('Failed to load rooms:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
