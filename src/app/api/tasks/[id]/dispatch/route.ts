import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import { queryOne, queryAll, run } from '@/lib/db';
import { getOpenClawClient } from '@/lib/openclaw/client';
import { broadcast } from '@/lib/events';
import { getProjectsPath } from '@/lib/config';
import { recallMemory, formatMemoryBlock } from '@/lib/memory';
import { enqueueRoomMessage, startQueueWorker } from '@/lib/queue';
import { startDispatchTimeoutGuard } from '@/lib/dispatch-timeout-guard';
import type { Task, Agent, OpenClawSession } from '@/lib/types';

interface RouteParams {
  params: Promise<{ id: string }>;
}

type RouterRule = { key: string; patterns: string[] };

const DEFAULT_ROUTER_RULES: RouterRule[] = [
  { key: 'spec-git', patterns: ['repo', 'repository', 'git', 'github', 'gitlab', 'branch', 'commit', 'mr', 'pr', 'changelog', 'tag release'] },
  { key: 'spec-iac', patterns: ['iac', 'terraform', 'terragrunt', 'iam', 'vpc', 'policy', 'módulo', 'modulo', 'repo iac', 'infra as code'] },
  { key: 'spec-k8s', patterns: ['k8s', 'kubernetes', 'eks', 'oke', 'aks', 'ingress', 'hpa', 'karpenter', 'helm'] },
  { key: 'spec-ci', patterns: ['pipeline', 'github actions', 'gitlab ci', 'bitbucket', 'cicd', 'ci/'] },
  { key: 'spec-python', patterns: ['python', 'script', 'automation', 'bot', 'parser'] },
  { key: 'spec-ansible', patterns: ['ansible', 'playbook', 'hardening', 'inventory'] },
  { key: 'spec-observability', patterns: ['slo', 'sli', 'grafana', 'prometheus', 'alert', 'observab'] },
  { key: 'spec-finops', patterns: ['cost', 'finops', 'spend', 'billing', 'rightsiz', 'oci', 'reporte de costos', 'cost report', 'informe de costos'] },
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

/**
 * Returns up to maxCount matching specialist keys (ordered by first match in rules list).
 * Backwards compatible: callers that only need the first result still work.
 */
function pickSpecialists(
  taskTitle: string,
  taskDescription?: string | null,
  maxCount = 1
): string[] {
  const text = `${taskTitle} ${taskDescription || ''}`.toLowerCase();
  const rules = loadRouterRules();
  const matched: string[] = [];
  const seen = new Set<string>();

  for (const r of rules) {
    if (seen.has(r.key)) continue;
    if (r.patterns.some((p) => text.includes(String(p).toLowerCase()))) {
      matched.push(r.key);
      seen.add(r.key);
      if (matched.length >= maxCount) break;
    }
  }
  return matched;
}

/** Legacy single-pick — keeps existing callers working */
function pickSpecialist(taskTitle: string, taskDescription?: string | null): string | null {
  const hits = pickSpecialists(taskTitle, taskDescription, 1);
  return hits[0] ?? null;
}

/** Read env guardrail: max specialists to fan-out in one coordinator dispatch */
function getMaxSpecialists(): number {
  const v = parseInt(process.env.MC_COORD_MAX_SPECIALISTS || '', 10);
  return isNaN(v) || v < 1 ? 3 : Math.min(v, 10);
}

function isCodingTask(taskTitle: string, taskDescription?: string | null): boolean {
  const text = `${taskTitle} ${taskDescription || ''}`.toLowerCase();
  const codingHints = [
    'code', 'coding', 'refactor', 'bug', 'fix', 'feature', 'implement', 'script',
    '.ts', '.tsx', '.js', '.py', '.tf', '.yaml', '.yml', 'repo', 'pull request', 'pr', 'mr'
  ];
  return codingHints.some((h) => text.includes(h));
}

/**
 * POST /api/tasks/[id]/dispatch
 * 
 * Dispatches a task to its assigned agent's OpenClaw session.
 * Creates session if needed, sends task details to agent.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    startQueueWorker();
    startDispatchTimeoutGuard();
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

    // -----------------------------------------------------------------------
    // Coordinator auto-routing: single OR multi-specialist fan-out
    // -----------------------------------------------------------------------
    const isCoordinator = (agent.gateway_agent_id || agent.name || '').startsWith('coord-');
    if (isCoordinator) {
      const maxSpec = getMaxSpecialists();
      const specialistKeys = pickSpecialists(task.title, task.description, maxSpec);

      if (specialistKeys.length > 0) {
        // Resolve specialist agents from DB
        const specialists: Agent[] = [];
        for (const key of specialistKeys) {
          const sp = queryOne<Agent>(
            `SELECT * FROM agents WHERE workspace_id = ? AND gateway_agent_id = ? LIMIT 1`,
            [task.workspace_id, key]
          );
          if (sp) specialists.push(sp);
        }

        // Anti-loop guard: prevent re-dispatching to same agent already assigned
        const filteredSpecialists = specialists.filter(sp => sp.id !== task.assigned_agent_id);

        if (filteredSpecialists.length === 1) {
          // ---- Backwards-compatible single specialist path ----
          const specialist = filteredSpecialists[0];
          run(
            'UPDATE tasks SET assigned_agent_id = ?, status = ?, updated_at = ? WHERE id = ?',
            [specialist.id, 'assigned', new Date().toISOString(), task.id]
          );
          run(
            `INSERT INTO events (id, type, agent_id, task_id, message, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
            [uuidv4(), 'task_assigned', specialist.id, task.id,
             `Auto-routing: ${agent.name} delegated to ${specialist.name}`, new Date().toISOString()]
          );
          await enqueueRoomMessage(task.id, null, `🤝 Auto-routing: ${agent.name} delegó la tarea a ${specialist.name}`);
          agent = specialist;

        } else if (filteredSpecialists.length > 1) {
          // ---- Multi-specialist fan-out path ----
          const coordAgent = agent; // keep ref to coordinator
          const now = new Date().toISOString();

          // Connect client once
          const client = getOpenClawClient();
          if (!client.isConnected()) {
            try { await client.connect(); } catch (err) {
              console.error('[multispec] Failed to connect to OpenClaw Gateway:', err);
              return NextResponse.json({ error: 'Failed to connect to OpenClaw Gateway' }, { status: 503 });
            }
          }

          // Room announcement
          const specNames = filteredSpecialists.map(s => s.name).join(', ');
          await enqueueRoomMessage(
            task.id, null,
            `🎯 Multi-especialista: ${coordAgent.name} detectó ${filteredSpecialists.length} especialistas relevantes. Fan-out a: ${specNames}`
          );

          // Log coordinator activity
          run(
            `INSERT INTO task_activities (id, task_id, agent_id, activity_type, message, metadata, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [uuidv4(), task.id, coordAgent.id, 'status_changed',
             `Coordinator fan-out to ${filteredSpecialists.length} specialists: ${specNames}`,
             JSON.stringify({ specialists: filteredSpecialists.map(s => ({ id: s.id, name: s.name })), multispec: true }),
             now]
          );

          const localPort = process.env.PORT || '80';
          const missionControlUrl = localPort === '80' ? 'http://127.0.0.1' : `http://127.0.0.1:${localPort}`;
          const missionControlApiToken = process.env.MC_API_TOKEN || '';
          const projectDir = task.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          const TIMEOUT_MS = parseInt(process.env.MC_COORD_SPECIALIST_TIMEOUT_MS || '', 10) || 300_000; // 5 min default

          // Fan-out: dispatch to each specialist in parallel
          const fanOutResults = await Promise.allSettled(
            filteredSpecialists.map(async (specialist) => {
              const sessionSlug = `${task.workspace_id}-${specialist.name}-${specialist.id.slice(0, 8)}`
                .toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
              const openclawSessionId = `mission-control-${sessionSlug}`;

              // Upsert session
              let spSession = queryOne<OpenClawSession>(
                'SELECT * FROM openclaw_sessions WHERE agent_id = ? AND status = ?',
                [specialist.id, 'active']
              );
              if (!spSession) {
                const sessionId = uuidv4();
                run(
                  `INSERT INTO openclaw_sessions (id, agent_id, openclaw_session_id, channel, status, task_id, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                  [sessionId, specialist.id, openclawSessionId, 'mission-control', 'active', task.id, now, now]
                );
                spSession = queryOne<OpenClawSession>('SELECT * FROM openclaw_sessions WHERE id = ?', [sessionId]);
              } else {
                run('UPDATE openclaw_sessions SET task_id = ?, updated_at = ? WHERE id = ?', [task.id, now, spSession.id]);
              }

              if (!spSession) throw new Error(`Failed to upsert session for ${specialist.name}`);

              // Build specialist task message
              const spProjectDir = specialist.gateway_agent_id
                ? `/root/.openclaw/workspace/agents/${specialist.gateway_agent_id}/projects/${projectDir}`
                : `/root/.openclaw/workspace/projects/${projectDir}`;

              const spMsg = `🎯 **MULTI-SPECIALIST TASK — YOUR SLICE**

**Coordinator:** ${coordAgent.name}
**Task:** ${task.title}
${task.description ? `**Description:** ${task.description}\n` : ''}
**Your domain:** ${specialist.name} (${specialist.gateway_agent_id || specialist.role})
**Priority:** ${task.priority.toUpperCase()}
**Task ID:** ${task.id}

You are ONE of ${filteredSpecialists.length} specialists working on this task in parallel.
Focus on your domain expertise. Keep your response scoped to what you do best.
The coordinator will synthesize all specialist outputs.

**OUTPUT DIRECTORY:** ${spProjectDir}

**AUTH FOR MISSION CONTROL API:**
Use header: Authorization: Bearer ${missionControlApiToken}

After completing your slice:
1. POST ${missionControlUrl}/api/tasks/${task.id}/activities
   Body: {"activity_type": "completed", "message": "Specialist ${specialist.name}: [summary]"}
2. POST ${missionControlUrl}/api/tasks/${task.id}/deliverables
   Body: {"deliverable_type": "file", "title": "[your deliverable]", "path": "${spProjectDir}/..."}

Reply with: \`SPECIALIST_COMPLETE: [your domain] - [brief summary]\``;

              const memory = await recallMemory(specialist.gateway_agent_id || specialist.id, task.title, task.description);
              const memBlock = formatMemoryBlock(memory);

              // Dispatch with timeout
              const sendPromise = client.call('chat.send', {
                sessionKey: `agent:main:${spSession.openclaw_session_id}`,
                message: spMsg + memBlock,
                idempotencyKey: `multispec-${task.id}-${specialist.id}-${Date.now()}`,
              });
              const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`Timeout after ${TIMEOUT_MS}ms`)), TIMEOUT_MS)
              );
              await Promise.race([sendPromise, timeoutPromise]);

              // Log handoff activity in room
              await enqueueRoomMessage(
                task.id, specialist.id,
                `📋 Handoff a ${specialist.name}: recibió slice de tarea. Ejecutando en paralelo.`,
                'task_update'
              );

              run(
                `INSERT INTO task_activities (id, task_id, agent_id, activity_type, message, created_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [uuidv4(), task.id, specialist.id, 'spawned',
                 `Specialist ${specialist.name} dispatched for multi-spec fan-out`, now]
              );

              return { specialist, sessionId: spSession.openclaw_session_id };
            })
          );

          // Summary of fan-out results
          const succeeded = fanOutResults.filter(r => r.status === 'fulfilled').length;
          const failed = fanOutResults.filter(r => r.status === 'rejected');
          if (failed.length > 0) {
            console.warn('[multispec] Some specialists failed to receive task:', failed.map(f => (f as PromiseRejectedResult).reason));
          }

          // Update task status to in_progress
          run('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?', ['in_progress', now, task.id]);
          const updatedTask = queryOne<Task>('SELECT * FROM tasks WHERE id = ?', [task.id]);
          if (updatedTask) broadcast({ type: 'task_updated', payload: updatedTask });

          // Post coordinator synthesis placeholder to room
          await enqueueRoomMessage(
            task.id, coordAgent.id,
            `✅ Fan-out completado: ${succeeded}/${filteredSpecialists.length} especialistas notificados. El coordinador sintetizará los resultados cuando completen.`,
            'task_update'
          );

          return NextResponse.json({
            success: true,
            task_id: task.id,
            multispec: true,
            specialists_dispatched: succeeded,
            specialists_total: filteredSpecialists.length,
            message: `Multi-specialist fan-out: ${succeeded}/${filteredSpecialists.length} specialists dispatched`,
          });
        }
        // else: no specialists found in DB → fall through to normal dispatch
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

    // Bind latest dispatched task to this active session so room mirror can map session -> task
    run(
      'UPDATE openclaw_sessions SET task_id = ?, updated_at = ? WHERE id = ?',
      [task.id, now, session.id]
    );

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

    const forceCursorForCode = process.env.MC_FORCE_CURSOR_FOR_CODE !== 'false';
    const useCursorForThisTask = forceCursorForCode && isCodingTask(task.title, task.description);
    const executionModeBlock = useCursorForThisTask
      ? `\n**EXECUTION MODE (REQUIRED):** CURSOR_CLI\nThis is a coding task. Execute implementation using Cursor CLI workflow.\nWhen reporting progress, mention command-style prefix: \`cursor: <task>\`.\n\n**MODEL POLICY (REQUIRED):**\nUse Cursor model mode **\`auto\`** by default (cost-effective automatic routing).\n\n**CURSOR PREFLIGHT (MANDATORY):**\n1) Run \`agent --version\`\n2) Verify auth/session before coding.\n3) If login is required, STOP and report: \`CURSOR_AUTH_REQUIRED\` with next-step instructions (do not continue coding until auth is resolved).`
      : '';

    const taskMessage = `${priorityEmoji} **NEW TASK ASSIGNED**

**Title:** ${task.title}
${task.description ? `**Description:** ${task.description}\n` : ''}
**Priority:** ${task.priority.toUpperCase()}
${task.due_date ? `**Due:** ${task.due_date}\n` : ''}
**Task ID:** ${task.id}${executionModeBlock}

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
      // Recall and inject hybrid memory context into the task message
      const memoryKey = agent.gateway_agent_id || agent.id;
      const memory = await recallMemory(memoryKey, task.title, task.description);
      const memoryBlock = formatMemoryBlock(memory);
      const fullMessage = taskMessage + memoryBlock;

      // Use sessionKey for routing to the agent's session
      // Format: agent:main:{openclaw_session_id}
      const sessionKey = `agent:main:${session.openclaw_session_id}`;
      await client.call('chat.send', {
        sessionKey,
        message: fullMessage,
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

      await enqueueRoomMessage(task.id, agent.id, `🚀 ${agent.name} recibió la tarea y comenzó ejecución.`, 'task_update');

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
