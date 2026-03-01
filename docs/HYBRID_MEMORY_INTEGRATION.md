# Hybrid Memory — Integration Plan

This document specifies how recalled memories are injected into task dispatch, and the file-level changes required to implement Fase A (structure + docs) and Fase B (dispatch injection).

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Mission Control                       │
│                                                         │
│  Task Dispatch (/api/tasks/[id]/dispatch/route.ts)      │
│         │                                               │
│         ▼                                               │
│  ┌─────────────────────┐                                │
│  │  recallMemory()     │  ← NEW: lib/memory.ts          │
│  │  - workspace.md     │                                │
│  │  - agent/{id}.md    │                                │
│  │  - project match    │                                │
│  └──────────┬──────────┘                                │
│             │                                           │
│             ▼                                           │
│  taskMessage += memoryBlock                             │
│             │                                           │
│             ▼                                           │
│  client.call('chat.send', { message })                  │
└─────────────────────────────────────────────────────────┘
```

---

## Fase A — Structure & Docs ✅

**Status: DONE** (this commit)

| File | Action | Description |
|------|--------|-------------|
| `docs/MEMORY.md` | Created | Standard template + memory file layout |
| `docs/MEMORY_CATEGORIES.md` | Created | Full spec for all 4 memory categories |
| `docs/HYBRID_MEMORY_INTEGRATION.md` | Created | This file — integration plan |
| `data/memory/workspace.md` | Created | Workspace-level memory (bootstrapped) |
| `data/memory/agents/.gitkeep` | Created | Placeholder for agent memory files |
| `data/memory/projects/.gitkeep` | Created | Placeholder for project memory files |

---

## Fase B — Dispatch Injection

### New File: `src/lib/memory.ts`

```typescript
import fs from 'fs';
import path from 'path';

const MEMORY_BASE = path.join(process.cwd(), 'data', 'memory');

export interface RecalledMemory {
  workspace?: string;
  agent?: string;
  project?: string;
}

/**
 * Load a memory file if it exists. Returns null if not found or empty.
 */
function loadMemoryFile(filePath: string): string | null {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8').trim();
      return content.length > 0 ? content : null;
    }
  } catch {}
  return null;
}

/**
 * Match task text against project memory files by slug.
 * Returns the first matching project memory content.
 */
function matchProjectMemory(taskText: string): string | null {
  const projectDir = path.join(MEMORY_BASE, 'projects');
  if (!fs.existsSync(projectDir)) return null;

  try {
    const files = fs.readdirSync(projectDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      const slug = path.basename(file, '.md');
      if (taskText.toLowerCase().includes(slug.toLowerCase())) {
        return loadMemoryFile(path.join(projectDir, file));
      }
    }
  } catch {}
  return null;
}

/**
 * Recall all relevant memories for a task dispatch.
 * Returns an object with workspace, agent, and project memory strings.
 */
export function recallMemory(agentId: string, taskTitle: string, taskDescription?: string | null): RecalledMemory {
  const taskText = `${taskTitle} ${taskDescription || ''}`;

  return {
    workspace: loadMemoryFile(path.join(MEMORY_BASE, 'workspace.md')),
    agent: loadMemoryFile(path.join(MEMORY_BASE, 'agents', `${agentId}.md`)),
    project: matchProjectMemory(taskText),
  };
}

/**
 * Format recalled memories into a markdown block for injection into task messages.
 * Returns empty string if no memories found.
 */
export function formatMemoryBlock(memory: RecalledMemory): string {
  const sections: string[] = [];

  if (memory.workspace) {
    sections.push(`### 🌐 Workspace Memory\n${memory.workspace}`);
  }
  if (memory.agent) {
    sections.push(`### 🤖 Your Agent Memory\n${memory.agent}`);
  }
  if (memory.project) {
    sections.push(`### 📁 Project Context\n${memory.project}`);
  }

  if (sections.length === 0) return '';

  return `\n\n---\n## 🧠 Recalled Memory\n\n${sections.join('\n\n---\n\n')}\n\n---`;
}
```

---

### Modified File: `src/app/api/tasks/[id]/dispatch/route.ts`

**Change 1 — Import memory utilities** (add near top of file):

```typescript
import { recallMemory, formatMemoryBlock } from '@/lib/memory';
```

**Change 2 — Inject memory block into taskMessage** (after task message is built, before `chat.send`):

```typescript
// Recall and inject memory context
const memory = recallMemory(agent.id, task.title, task.description);
const memoryBlock = formatMemoryBlock(memory);

const fullMessage = taskMessage + memoryBlock;
```

**Change 3 — Pass `fullMessage` instead of `taskMessage` to `chat.send`**:

```typescript
await client.call('chat.send', {
  sessionKey,
  message: fullMessage,   // ← was: taskMessage
  idempotencyKey: `dispatch-${task.id}-${Date.now()}`
});
```

---

### New API Endpoint: `POST /api/memory/[agentId]`

Allows agents to write back to their own memory file after completing a task.

**File:** `src/app/api/memory/[agentId]/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const MEMORY_BASE = path.join(process.cwd(), 'data', 'memory');

export async function POST(request: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  const body = await request.json();
  const { category, content } = body;

  if (!category || !content) {
    return NextResponse.json({ error: 'category and content required' }, { status: 400 });
  }

  const filePath = path.join(MEMORY_BASE, 'agents', `${agentId}.md`);
  const timestamp = new Date().toISOString().split('T')[0];
  const entry = `\n- [${timestamp}] **[${category}]** ${content}`;

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    // Append to existing file or create new one from template
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, `# Memory: Agent ${agentId}\n_Last updated: ${timestamp}_\n\n## 🔵 Decisiones\n\n## 🟡 Preferencias\n\n## 🔴 Restricciones\n\n## 🟢 Contexto del Proyecto\n\n## 📌 Notas Rápidas\n`);
    }

    fs.appendFileSync(filePath, entry);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: 'Failed to write memory' }, { status: 500 });
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  const filePath = path.join(MEMORY_BASE, 'agents', `${agentId}.md`);

  try {
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ content: null });
    }
    const content = fs.readFileSync(filePath, 'utf8');
    return NextResponse.json({ content });
  } catch {
    return NextResponse.json({ error: 'Failed to read memory' }, { status: 500 });
  }
}
```

---

## Agent Protocol Update

After completing a task, agents should update their memory. Add to `docs/AGENT_PROTOCOL.md`:

```markdown
## Memory Updates

After significant tasks, update your memory via:

\`\`\`bash
curl -X POST http://127.0.0.1:{PORT}/api/memory/{AGENT_ID} \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {MC_API_TOKEN}" \
  -d '{"category": "decision", "content": "Used Helm chart v3.2 for deployment — stable and tested"}'
\`\`\`

Categories: `decision` | `preference` | `restriction` | `project`
```

---

## Implementation Order

1. **[x] Fase A** — Create docs and `data/memory/` structure (this commit)
2. **[ ] Fase B-1** — Create `src/lib/memory.ts`
3. **[ ] Fase B-2** — Modify dispatch route to inject memory
4. **[ ] Fase B-3** — Create `POST /api/memory/[agentId]` write-back endpoint
5. **[ ] Fase B-4** — Update `docs/AGENT_PROTOCOL.md` with memory update instructions
6. **[ ] Fase C** — UI panel to view/edit memory files per agent (future)

---

## Notes

- Memory files are plain markdown — human-readable and editable
- No vector DB required for Fase B (keyword-based project matching is sufficient)
- Fase C can add semantic search if memory grows large
- Memory files are NOT backed by the SQLite database — they're filesystem artifacts
- Add `data/memory/agents/` and `data/memory/projects/` to `.gitignore` if memory is considered private
