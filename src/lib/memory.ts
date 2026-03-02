/**
 * Hybrid Memory System — Recall & Format
 */

import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const OPENCLAW_WORKSPACE = process.env.OPENCLAW_WORKSPACE || '/root/.openclaw/workspace';
const LEGACY_MEMORY_BASE = path.join(process.cwd(), 'data', 'memory');

const WORKSPACE_MEMORY_PATHS = [
  path.join(OPENCLAW_WORKSPACE, 'MEMORY.md'),
  path.join(LEGACY_MEMORY_BASE, 'workspace.md'),
];

const AGENT_MEMORY_DIR = path.join(OPENCLAW_WORKSPACE, 'agents');
const LEGACY_AGENT_MEMORY_DIR = path.join(LEGACY_MEMORY_BASE, 'agents');

const PROJECT_MEMORY_DIR = path.join(OPENCLAW_WORKSPACE, 'memory', 'context', 'projects');
const LEGACY_PROJECT_MEMORY_DIR = path.join(LEGACY_MEMORY_BASE, 'projects');

const execFileAsync = promisify(execFile);
const SEMANTIC_RECALL_ENABLED = process.env.MC_MEMORY_SEMANTIC_RECALL === 'true';

export interface RecalledMemory {
  workspace?: string;
  agent?: string;
  project?: string;
  semantic?: string;
}

function loadMemoryFile(filePath: string): string | null {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8').trim();
      return content.length > 0 ? content : null;
    }
  } catch {}
  return null;
}

function loadFirstExisting(paths: string[]): string | null {
  for (const p of paths) {
    const c = loadMemoryFile(p);
    if (c) return c;
  }
  return null;
}

function getAgentMemoryPath(agentMemoryKey: string): string {
  return path.join(AGENT_MEMORY_DIR, agentMemoryKey, 'MEMORY.md');
}

function getLegacyAgentMemoryPath(agentMemoryKey: string): string {
  return path.join(LEGACY_AGENT_MEMORY_DIR, `${agentMemoryKey}.md`);
}

function matchProjectMemory(taskText: string): string | null {
  const dirs = [PROJECT_MEMORY_DIR, LEGACY_PROJECT_MEMORY_DIR];
  const lowerText = taskText.toLowerCase();

  for (const projectDir of dirs) {
    if (!fs.existsSync(projectDir)) continue;
    try {
      const files = fs.readdirSync(projectDir).filter((f) => f.endsWith('.md'));
      for (const file of files) {
        const slug = path.basename(file, '.md').toLowerCase();
        if (lowerText.includes(slug)) {
          return loadMemoryFile(path.join(projectDir, file));
        }
      }
    } catch {}
  }

  return null;
}

async function recallSemanticMemory(query: string): Promise<string | undefined> {
  if (!SEMANTIC_RECALL_ENABLED) return undefined;

  const scriptPath = path.join(process.cwd(), 'scripts', 'memory', 'recall_memories.js');
  if (!fs.existsSync(scriptPath)) return undefined;

  try {
    const { stdout } = await execFileAsync(
      'node',
      [scriptPath, '--query', query, '--limit', '3', '--threshold', '0.25', '--json'],
      { cwd: process.cwd(), timeout: 12000, maxBuffer: 1024 * 1024 }
    );

    const rows = JSON.parse(stdout || '[]') as Array<{
      category?: string;
      summary?: string;
      content?: string;
      similarity?: number;
    }>;

    if (!Array.isArray(rows) || rows.length === 0) return undefined;

    return rows
      .slice(0, 3)
      .map((r, i) => {
        const score = typeof r.similarity === 'number' ? ` (${(r.similarity * 100).toFixed(0)}%)` : '';
        const title = r.summary || r.category || `memory-${i + 1}`;
        const body = (r.content || '').trim();
        return `- **${title}**${score}: ${body}`;
      })
      .join('\n');
  } catch {
    return undefined;
  }
}

export async function recallMemory(
  agentMemoryKey: string,
  taskTitle: string,
  taskDescription?: string | null
): Promise<RecalledMemory> {
  const taskText = `${taskTitle} ${taskDescription || ''}`;

  return {
    workspace: loadFirstExisting(WORKSPACE_MEMORY_PATHS) ?? undefined,
    agent:
      loadFirstExisting([
        getAgentMemoryPath(agentMemoryKey),
        getLegacyAgentMemoryPath(agentMemoryKey),
      ]) ?? undefined,
    project: matchProjectMemory(taskText) ?? undefined,
    semantic: await recallSemanticMemory(taskText),
  };
}

export function formatMemoryBlock(memory: RecalledMemory): string {
  const sections: string[] = [];

  if (memory.workspace) sections.push(`### 🌐 Workspace Memory\n${memory.workspace}`);
  if (memory.agent) sections.push(`### 🤖 Your Agent Memory\n${memory.agent}`);
  if (memory.project) sections.push(`### 📁 Project Context\n${memory.project}`);
  if (memory.semantic) sections.push(`### 🔎 Semantic Recall (DB)\n${memory.semantic}`);

  if (sections.length === 0) return '';
  return `\n\n---\n## 🧠 Recalled Memory\n\n${sections.join('\n\n---\n\n')}\n\n---`;
}

export function writeAgentMemory(agentMemoryKey: string, category: string, content: string): void {
  const filePath = getAgentMemoryPath(agentMemoryKey);
  const timestamp = new Date().toISOString().split('T')[0];

  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  if (!fs.existsSync(filePath)) {
    const template = `# Memory: Agent ${agentMemoryKey}
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
  fs.appendFileSync(filePath, `\n- [${timestamp}] ${emoji} **[${category}]** ${content}`, 'utf8');

  try {
    let fileContent = fs.readFileSync(filePath, 'utf8');
    fileContent = fileContent.replace(/_Last updated: \d{4}-\d{2}-\d{2}_/, `_Last updated: ${timestamp}_`);
    fs.writeFileSync(filePath, fileContent, 'utf8');
  } catch {}
}

export function getAgentMemoryReadPath(agentMemoryKey: string): string {
  const primary = getAgentMemoryPath(agentMemoryKey);
  if (fs.existsSync(primary)) return primary;
  return getLegacyAgentMemoryPath(agentMemoryKey);
}
