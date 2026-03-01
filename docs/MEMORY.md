# MEMORY.md — Hybrid Memory System

> Standard template and specification for agent/workspace long-term memory in Mission Control.

---

## Purpose

Agents in Mission Control are stateless by default — each task dispatch starts fresh. **Hybrid Memory** bridges that gap by persisting structured context that can be recalled and injected at dispatch time, giving agents continuity without bloating every session.

---

## Memory File Layout

Each workspace stores memory under `data/memory/`:

```
data/memory/
├── workspace.md          ← global workspace-level memory (shared by all agents)
├── agents/
│   ├── {agent-id}.md     ← per-agent memory (preferences, past decisions)
│   └── ...
└── projects/
    ├── {project-slug}.md ← per-project context (tech stack, constraints, history)
    └── ...
```

---

## MEMORY.md Template (per agent or workspace)

Copy this template when initializing a new memory file:

```markdown
# Memory: {Agent Name or Workspace Name}
_Last updated: YYYY-MM-DD_

## 🔵 Decisiones (Decisions)
<!-- Key architectural, operational, or process decisions made. -->
<!-- Format: [DATE] Decision — Rationale -->

- [YYYY-MM-DD] ...

## 🟡 Preferencias (Preferences)
<!-- How this agent/workspace prefers to work. Style, tooling, output format. -->

- ...

## 🔴 Restricciones (Restrictions)
<!-- Hard limits: things that MUST NOT happen, regulatory constraints, known failures. -->

- ...

## 🟢 Contexto del Proyecto (Project Context)
<!-- Active projects, their current state, links to specs, repos, owners. -->

### {Project Name}
- **Status:** active / paused / done
- **Repo:** ...
- **Stack:** ...
- **Notes:** ...

## 📌 Notas Rápidas (Quick Notes)
<!-- Short-lived context that doesn't fit above. Clear on next review. -->

- ...
```

---

## Memory Lifecycle

```
Task Completed
     │
     ▼
Agent writes to memory file (via API or direct file write)
     │
     ▼
Memory file persisted in data/memory/
     │
     ▼
Next task dispatched → memory injected into task message
```

---

## Recall at Dispatch

When a task is dispatched, Mission Control:

1. Loads `data/memory/workspace.md` (global context)
2. Loads `data/memory/agents/{agent-id}.md` (agent-specific)
3. Loads matching project memory if task title/description matches a project slug
4. Appends a **`## 🧠 Recalled Memory`** section to the task message

See `docs/HYBRID_MEMORY_INTEGRATION.md` for the full integration spec.

---

## Maintenance

- Agents should update their memory file after completing significant tasks.
- Workspace memory is managed by the orchestrator or by humans.
- Files should be reviewed and pruned periodically (stale notes removed).
- No secrets, tokens, or credentials should be stored in memory files.
