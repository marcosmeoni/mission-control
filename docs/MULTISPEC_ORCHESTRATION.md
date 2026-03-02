# Multi-Specialist Coordinator Orchestration

## Overview

When a coordinator agent (`coord-*`) dispatches a task, Mission Control now detects **multiple matching specialist domains** and fans out the task to all relevant specialists in parallel (fan-out/fan-in pattern).

## Dispatch Flow

```
Coordinator receives task
        │
        ▼
pickSpecialists(task, maxCount=MC_COORD_MAX_SPECIALISTS)
        │
   ┌────┴────┐
   │ 0 match │  → fall through to normal dispatch
   │ 1 match │  → backwards-compatible single-specialist reassign (existing behavior)
   │ N match │  → multi-specialist fan-out
   └────┬────┘
        │ (N > 1)
        ▼
For each specialist (in parallel):
  1. Upsert OpenClaw session
  2. Build scoped task message (domain-specific slice)
  3. Inject memory context
  4. client.call('chat.send') with timeout guard
  5. Post "📋 Handoff" room message
  6. Log task_activity (spawned)
        │
        ▼
Coordinator posts synthesis placeholder in room:
  "✅ Fan-out completado: N specialists notificados"
        │
        ▼
Task status → in_progress
Each specialist works independently
Specialist posts SPECIALIST_COMPLETE: [domain] - [summary]
via MC API (POST /api/tasks/:id/activities)
```

## Guardrails

### Max Specialists
```
env: MC_COORD_MAX_SPECIALISTS (default: 3, max: 10)
```
Limits how many specialists receive a task slice. Prevents runaway fan-out.

### Anti-Loop Protection
Specialists with the same `agent_id` as the currently assigned coordinator are filtered out before fan-out. This prevents the coordinator from dispatching to itself.

### Timeout Handling
```
env: MC_COORD_SPECIALIST_TIMEOUT_MS (default: 300000 = 5 minutes)
```
Each specialist dispatch uses `Promise.race()` against a timeout. If a specialist session fails to receive the message within the timeout, its slot is counted as "failed" — other specialists still proceed. The room message reports `N/M specialists notified`.

### Backwards Compatibility
- If `MC_COORD_MAX_SPECIALISTS=1` (or only 1 specialist matches): **identical behavior to pre-V2**.
- If no specialists found in DB: falls through to the standard direct dispatch.
- Single-specialist path: task is **reassigned** to that specialist (same as before).
- Multi-specialist path: task remains assigned to the coordinator; all specialists receive a slice via `chat.send`.

## Specialist Message Format

Each specialist receives a scoped prompt:

```
🎯 MULTI-SPECIALIST TASK — YOUR SLICE

Coordinator: coord-sre
Task: [title]
Description: [description]
Your domain: spec-k8s (Kubernetes Specialist)
Priority: HIGH

You are ONE of 3 specialists working on this task in parallel.
Focus on your domain expertise. Keep your response scoped to what you do best.
The coordinator will synthesize all specialist outputs.

OUTPUT DIRECTORY: /root/.openclaw/workspace/agents/spec-k8s/projects/...

After completing your slice:
1. POST .../api/tasks/:id/activities  { "activity_type": "completed", "message": "..." }
2. POST .../api/tasks/:id/deliverables { "deliverable_type": "file", ... }

Reply with: SPECIALIST_COMPLETE: [your domain] - [brief summary]
```

## Room Events

The Task Room displays the following multi-spec events:

| Event | Badge |
|---|---|
| Fan-out announcement | `🎯 Multi-especialista` |
| Per-specialist handoff | `📋 Handoff a [specialist]` |
| Fan-out summary | `✅ Fan-out completado` |

## Configuration

```bash
# In .env or environment
MC_COORD_MAX_SPECIALISTS=3          # Max specialists per coordinator task (default: 3)
MC_COORD_SPECIALIST_TIMEOUT_MS=300000  # Per-specialist dispatch timeout in ms (default: 5 min)
```

## Demo Scenario

**Task:** "Deploy new k8s ingress + update terraform vpc module + set up prometheus alerts"

**Matched specialists:** `spec-k8s`, `spec-iac`, `spec-observability` (3 matches)

1. Coordinator `coord-sre` receives the task
2. Mission Control detects 3 matching specialists
3. Room shows: `🎯 Multi-especialista: coord-sre detectó 3 especialistas relevantes. Fan-out a: spec-k8s, spec-iac, spec-observability`
4. Each specialist gets their scoped task slice simultaneously
5. Room shows 3 × `📋 Handoff a [specialist]: recibió slice de tarea. Ejecutando en paralelo.`
6. Room shows: `✅ Fan-out completado: 3/3 especialistas notificados`
7. Each specialist works independently and calls the MC API on completion
8. Activities tab accumulates completion entries from each specialist

## File Locations

- **Dispatch logic:** `src/app/api/tasks/[id]/dispatch/route.ts`
- **Router rules:** `data/router-rules.json` (or default rules in dispatch route)
- **Orchestration helpers:** `src/lib/orchestration.ts`
