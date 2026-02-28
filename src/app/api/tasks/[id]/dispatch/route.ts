import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import { queryOne, queryAll, run } from '@/lib/db';
import { getOpenClawClient } from '@/lib/openclaw/client';
import { broadcast } from '@/lib/events';
import { getProjectsPath } from '@/lib/config';
import type { Task, Agent, OpenClawSession } from '@/lib/types';

interface RouteParams {
  params: Promise<{ id: string }>;
}

type RouterRule = { key: string; patterns: string[] };

const DEFAULT_ROUTER_RULES: RouterRule[] = [
  { key: 'spec-iac', patterns: ['iac', 'terraform', 'terragrunt', 'iam', 'vpc', 'policy', 'módulo', 'modulo', 'repo iac', 'infra as code'] },
  { key: 'spec-k8s', patterns: ['k8s', 'kubernetes', 'eks', 'oke', 'aks', 'ingress', 'hpa', 'karpenter', 'helm'] },
  { key: 'spec-ci', patterns: ['pipeline', 'github actions', 'gitlab ci', 'bitbucket', 'cicd', 'ci/'] },
  { key: 'spec-python', patterns: ['python', 'script', 'automation', 'bot', 'parser'] },
  { key: 'spec-ansible', patterns: ['ansible', 'playbook', 'hardening', 'inventory'] },
  { key: 'spec-observability', patterns: ['slo', 'sli', 'grafana', 'prometheus', 'alert', 'observab'] },
  { key: 'spec-finops', patterns: ['cost', 'finops', 'spend', 'billing', 'rightsiz', 'oci'] },
  { key: 'spec-secops-cloud', patterns: ['security', 'secrets', 'least privilege', 'posture', 'compliance'] },
  { key: 'spec-release-manager', patterns: ['release', 'deploy window', 'change management', 'cutover'] },
  { key: 'spec-incident-commander', patterns: ['incident', 'sev1', 'sev2', 'sev3', 'outage', 'rca', 'postmortem'] },
  { key: 'spec-platform-engineering', patterns: ['golden path', 'platform', 'scaffold', 'template'] },
  { key: 'spec-runbook-automation', patterns: ['runbook', 'automation workflow', 'operational procedure'] },
  { key: 'spec-dr-bcp', patterns: ['dr', 'bcp', 'backup', 'restore', 'rto', 'rpo'] },
];

function loadRouterRules(): RouterRule[] {
  const p = '/root/.openclaw/workspace/projects/personal/mission-control/data/router-rules.json';
  try {
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.rules)) return parsed.rules;
    }
  } catch {}
  return DEFAULT_ROUTER_RULES;
}

function pickSpecialist(taskTitle: string, taskDescription?: string | null): string | null {
  const text = `${taskTitle} ${taskDescription || ''}`.toLowerCase();
  const rules = loadRouterRules();

  for (const r of rules) {
    if (r.patterns.some((p) => text.includes(String(p).toLowerCase()))) return r.key;
  }
  return null;
}

/**
 * POST /api/tasks/[id]/dispatch
 * 
 * Dispatches a task to its assigned agent's OpenClaw session.
 * Creates session if needed, sends task details to agent.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    // Get task with agent info
    const task = queryOne<Task & { assigned_agent_name?: string; workspace_id: string }>(
      `SELECT t.*, a.name as assigned_agent_name, a.is_master
       FROM tasks t
       LEFT JOIN agents a ON t.assigned_agent_id = a.id
       WHERE t.id = ?`,
      [id]
    );

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    if (!task.assigned_agent_id) {
      return NextResponse.json(
        { error: 'Task has no assigned agent' },
        { status: 400 }
      );
    }

    // Get agent details
    let agent = queryOne<Agent>(
      'SELECT * FROM agents WHERE id = ?',
      [task.assigned_agent_id]
    );

    if (!agent) {
      return NextResponse.json({ error: 'Assigned agent not found' }, { status: 404 });
    }

    // Coordinator auto-planning + specialist auto-routing
    const isCoordinator = (agent.gateway_agent_id || agent.name || '').startsWith('coord-');
    if (isCoordinator) {
      const specialistKey = pickSpecialist(task.title, task.description);
      if (specialistKey) {
        const specialist = queryOne<Agent>(
          `SELECT * FROM agents
           WHERE workspace_id = ?
             AND gateway_agent_id = ?
           LIMIT 1`,
          [task.workspace_id, specialistKey]
        );

        if (specialist) {
          // Reassign task to specialist inside the same workspace
          run(
            'UPDATE tasks SET assigned_agent_id = ?, status = ?, updated_at = ? WHERE id = ?',
            [specialist.id, 'assigned', new Date().toISOString(), task.id]
          );

          run(
            `INSERT INTO events (id, type, agent_id, task_id, message, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
              uuidv4(),
              'task_assigned',
              specialist.id,
              task.id,
              `Auto-routing: ${agent.name} delegated to ${specialist.name}`,
              new Date().toISOString(),
            ]
          );

          // Refresh selected agent for the dispatch flow below
          agent = specialist;
        }
      }
    }

    // Check if dispatching to the master agent while there are other orchestrators available
    if (agent.is_master) {
      // Check for other master agents in the same workspace (excluding this one)
      const otherOrchestrators = queryAll<{
        id: string;
        name: string;
        role: string;
      }>(
        `SELECT id, name, role
         FROM agents
         WHERE is_master = 1
         AND id != ?
         AND workspace_id = ?
         AND status != 'offline'`,
        [agent.id, task.workspace_id]
      );

      if (otherOrchestrators.length > 0) {
        return NextResponse.json({
          success: false,
          warning: 'Other orchestrators available',
          message: `There ${otherOrchestrators.length === 1 ? 'is' : 'are'} ${otherOrchestrators.length} other orchestrator${otherOrchestrators.length === 1 ? '' : 's'} available in this workspace: ${otherOrchestrators.map(o => o.name).join(', ')}. Consider assigning this task to them instead.`,
          otherOrchestrators,
        }, { status: 409 }); // 409 Conflict - indicating there's an alternative
      }
    }

    // Connect to OpenClaw Gateway
    const client = getOpenClawClient();
    if (!client.isConnected()) {
      try {
        await client.connect();
      } catch (err) {
        console.error('Failed to connect to OpenClaw Gateway:', err);
        return NextResponse.json(
          { error: 'Failed to connect to OpenClaw Gateway' },
          { status: 503 }
        );
      }
    }

    // Get or create OpenClaw session for this agent
    let session = queryOne<OpenClawSession>(
      'SELECT * FROM openclaw_sessions WHERE agent_id = ? AND status = ?',
      [agent.id, 'active']
    );

    const now = new Date().toISOString();

    const sessionSlug = `${task.workspace_id}-${agent.name}-${agent.id.slice(0, 8)}`
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    if (!session) {
      // Create session record (workspace-scoped, unique per imported agent)
      const sessionId = uuidv4();
      const openclawSessionId = `mission-control-${sessionSlug}`;

      run(
        `INSERT INTO openclaw_sessions (id, agent_id, openclaw_session_id, channel, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [sessionId, agent.id, openclawSessionId, 'mission-control', 'active', now, now]
      );

      session = queryOne<OpenClawSession>(
        'SELECT * FROM openclaw_sessions WHERE id = ?',
        [sessionId]
      );

      // Log session creation
      run(
        `INSERT INTO events (id, type, agent_id, message, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [uuidv4(), 'agent_status_changed', agent.id, `${agent.name} session created`, now]
      );
    }

    if (!session) {
      return NextResponse.json(
        { error: 'Failed to create agent session' },
        { status: 500 }
      );
    }

    // Migrate legacy shared session IDs to workspace-scoped IDs to avoid cross-workspace collisions
    const legacySessionId = `mission-control-${agent.name.toLowerCase().replace(/\s+/g, '-')}`;
    if (session.openclaw_session_id === legacySessionId) {
      const newSessionId = `mission-control-${sessionSlug}`;
      run(
        'UPDATE openclaw_sessions SET openclaw_session_id = ?, updated_at = ? WHERE id = ?',
        [newSessionId, now, session.id]
      );
      session.openclaw_session_id = newSessionId;
    }

    // Build task message for agent
    const priorityEmoji = {
      low: '🔵',
      normal: '⚪',
      high: '🟡',
      urgent: '🔴'
    }[task.priority] || '⚪';

    // Prefer OpenClaw agent workspace for deliverables (isolated per agent)
    const projectDir = task.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const openclawAgentWorkspace = agent.gateway_agent_id
      ? `/root/.openclaw/workspace/agents/${agent.gateway_agent_id}`
      : null;
    const fallbackProjectsPath = getProjectsPath();
    const taskProjectDir = openclawAgentWorkspace
      ? `${openclawAgentWorkspace}/projects/${projectDir}`
      : `${fallbackProjectsPath}/${projectDir}`;
    // Use local loopback URL so agent curl calls work from server host regardless of public domain/proxy
    const localPort = process.env.PORT || '80';
    const missionControlUrl = localPort === '80' ? 'http://127.0.0.1' : `http://127.0.0.1:${localPort}`;

    const missionControlApiToken = process.env.MC_API_TOKEN || '';

    const taskMessage = `${priorityEmoji} **NEW TASK ASSIGNED**

**Title:** ${task.title}
${task.description ? `**Description:** ${task.description}\n` : ''}
**Priority:** ${task.priority.toUpperCase()}
${task.due_date ? `**Due:** ${task.due_date}\n` : ''}
**Task ID:** ${task.id}

**OUTPUT DIRECTORY:** ${taskProjectDir}
Create this directory and save all deliverables there.

**AUTH FOR MISSION CONTROL API:**
Use header: Authorization: Bearer ${missionControlApiToken}

**IMPORTANT:** After completing work, you MUST call these APIs:
1. Log activity: POST ${missionControlUrl}/api/tasks/${task.id}/activities
   Body: {"activity_type": "completed", "message": "Description of what was done"}
2. Register deliverable: POST ${missionControlUrl}/api/tasks/${task.id}/deliverables
   Body: {"deliverable_type": "file", "title": "File name", "path": "${taskProjectDir}/filename.html"}
3. Update status: PATCH ${missionControlUrl}/api/tasks/${task.id}
   Body: {"status": "review"}
4. At end, set done when approved: PATCH ${missionControlUrl}/api/tasks/${task.id}
   Body: {"status": "done"}

When complete, reply with:
\`TASK_COMPLETE: [brief summary of what you did]\`

If you need help or clarification, ask the orchestrator.`;

    // Send message to agent's session using chat.send
    try {
      // Use sessionKey for routing to the agent's session
      // Format: agent:main:{openclaw_session_id}
      const sessionKey = `agent:main:${session.openclaw_session_id}`;
      await client.call('chat.send', {
        sessionKey,
        message: taskMessage,
        idempotencyKey: `dispatch-${task.id}-${Date.now()}`
      });

      // Update task status to in_progress
      run(
        'UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?',
        ['in_progress', now, id]
      );

      // Broadcast task update
      const updatedTask = queryOne<Task>('SELECT * FROM tasks WHERE id = ?', [id]);
      if (updatedTask) {
        broadcast({
          type: 'task_updated',
          payload: updatedTask,
        });
      }

      // Update agent status to working
      run(
        'UPDATE agents SET status = ?, updated_at = ? WHERE id = ?',
        ['working', now, agent.id]
      );

      // Log dispatch event to events table
      const eventId = uuidv4();
      run(
        `INSERT INTO events (id, type, agent_id, task_id, message, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [eventId, 'task_dispatched', agent.id, task.id, `Task "${task.title}" dispatched to ${agent.name}`, now]
      );

      // Log dispatch activity to task_activities table (for Activity tab)
      const activityId = crypto.randomUUID();
      run(
        `INSERT INTO task_activities (id, task_id, agent_id, activity_type, message, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [activityId, task.id, agent.id, 'status_changed', `Task dispatched to ${agent.name} - Agent is now working on this task`, now]
      );

      return NextResponse.json({
        success: true,
        task_id: task.id,
        agent_id: agent.id,
        session_id: session.openclaw_session_id,
        message: 'Task dispatched to agent'
      });
    } catch (err) {
      console.error('Failed to send message to agent:', err);
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Failed to dispatch task:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
