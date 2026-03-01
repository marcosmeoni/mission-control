/**
 * Hybrid Memory System — Recall & Format
 *
 * Loads structured memory files from data/memory/ and formats them
 * for injection into task dispatch messages.
 *
 * Memory categories:
 *   🔵 Decisiones    — key decisions + rationale
 *   🟡 Preferencias  — agent/workspace working style
 *   🔴 Restricciones — hard limits, compliance, known failure modes
 *   🟢 Contexto      — active project state
 *   📌 Notas Rápidas — ephemeral short-term notes
 *
 * See docs/MEMORY.md and docs/MEMORY_CATEGORIES.md for full spec.
 * See docs/HYBRID_MEMORY_INTEGRATION.md for dispatch integration plan.
 */

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
  } catch {
    // Silently ignore — missing memory is not a dispatch blocker
  }
  return null;
}

/**
 * Match task text against project memory files by filename slug.
 * Returns the first matching project memory content.
 */
function matchProjectMemory(taskText: string): string | null {
  const projectDir = path.join(MEMORY_BASE, 'projects');
  if (!fs.existsSync(projectDir)) return null;

  try {
    const files = fs.readdirSync(projectDir).filter((f) => f.endsWith('.md'));
    const lowerText = taskText.toLowerCase();
    for (const file of files) {
      const slug = path.basename(file, '.md').toLowerCase();
      if (lowerText.includes(slug)) {
        return loadMemoryFile(path.join(projectDir, file));
      }
    }
  } catch {}
  return null;
}

/**
 * Recall all relevant memories for a task dispatch.
 *
 * @param agentId   - The agent's DB id (used to find data/memory/agents/{agentId}.md)
 * @param taskTitle - Task title (used for project matching)
 * @param taskDescription - Optional task description (also used for project matching)
 */
export function recallMemory(
  agentId: string,
  taskTitle: string,
  taskDescription?: string | null
): RecalledMemory {
  const taskText = `${taskTitle} ${taskDescription || ''}`;

  return {
    workspace: loadMemoryFile(path.join(MEMORY_BASE, 'workspace.md')) ?? undefined,
    agent: loadMemoryFile(path.join(MEMORY_BASE, 'agents', `${agentId}.md`)) ?? undefined,
    project: matchProjectMemory(taskText) ?? undefined,
  };
}

/**
 * Format recalled memories into a markdown block for injection into task messages.
 * Returns empty string if no memories are found (graceful no-op).
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

/**
 * Write a memory entry to an agent's memory file.
 * Creates the file from template if it doesn't exist.
 *
 * @param agentId  - Agent DB id
 * @param category - One of: decision | preference | restriction | project
 * @param content  - The memory entry text
 */
export function writeAgentMemory(agentId: string, category: string, content: string): void {
  const filePath = path.join(MEMORY_BASE, 'agents', `${agentId}.md`);
  const timestamp = new Date().toISOString().split('T')[0];

  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  if (!fs.existsSync(filePath)) {
    const template = `# Memory: Agent ${agentId}
_Last updated: ${timestamp}_

## 🔵 Decisiones

## 🟡 Preferencias

## 🔴 Restricciones

## 🟢 Contexto del Proyecto

## 📌 Notas Rápidas
`;
    fs.writeFileSync(filePath, template, 'utf8');
  }

  const categoryEmoji: Record<string, string> = {
    decision: '🔵',
    preference: '🟡',
    restriction: '🔴',
    project: '🟢',
    note: '📌',
  };

  const emoji = categoryEmoji[category] || '📌';
  const entry = `\n- [${timestamp}] ${emoji} **[${category}]** ${content}`;
  fs.appendFileSync(filePath, entry, 'utf8');

  // Update last-updated timestamp in first line
  try {
    let fileContent = fs.readFileSync(filePath, 'utf8');
    fileContent = fileContent.replace(
      /_Last updated: \d{4}-\d{2}-\d{2}_/,
      `_Last updated: ${timestamp}_`
    );
    fs.writeFileSync(filePath, fileContent, 'utf8');
  } catch {}
}
