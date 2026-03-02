import { NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { stat, readFile } from 'fs/promises';
import { resolve } from 'path';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const execFileAsync = promisify(execFile);

type TrafficLight = 'green' | 'yellow' | 'red';

interface Check {
  name: string;
  status: TrafficLight;
  message: string;
}

interface MemoryHealthResponse {
  overall: TrafficLight;
  checks: Check[];
  metrics: {
    memoriesCount: number;
    recentCount: number;
    lastRecallAt?: string;
  };
  collectedAt: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function worstStatus(checks: Check[]): TrafficLight {
  if (checks.some(c => c.status === 'red')) return 'red';
  if (checks.some(c => c.status === 'yellow')) return 'yellow';
  return 'green';
}

async function loadDotEnvMemory(): Promise<Record<string, string>> {
  try {
    const p = resolve(process.cwd(), '.env.memory');
    const raw = await readFile(p, 'utf8');
    const out: Record<string, string> = {};
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      const value = m[2].replace(/^['"]|['"]$/g, '');
      out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

async function checkPgvector(): Promise<{ check: Check; memoriesCount: number; recentCount: number; lastRecallAt?: string }> {
  const dbUrl = process.env.MEMORY_DB_URL || 'postgres://postgres:postgres@localhost:54322/memory';

  try {
    // Use psql CLI to run a quick query — avoids bundling pg driver in Next.js edge or cold-start issues
    const query = `
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') AS recent,
        MAX(accessed_at)::text AS last_recalled
      FROM memories
      WHERE archived = false;
    `;
    const { stdout } = await execFileAsync('psql', [dbUrl, '-t', '-A', '-F', ',', '-c', query], {
      timeout: 5000,
    });

    const line = stdout.trim().split('\n').find(l => l.trim());
    if (!line) throw new Error('Empty result');

    const parts = line.split(',');
    const total = parseInt(parts[0] || '0', 10);
    const recent = parseInt(parts[1] || '0', 10);
    const lastRecalled = parts[2]?.trim() && parts[2].trim() !== '' ? parts[2].trim() : undefined;

    return {
      check: {
        name: 'pgvector DB',
        status: 'green',
        message: `Reachable — ${total} memories (${recent} recent)`,
      },
      memoriesCount: total,
      recentCount: recent,
      lastRecallAt: lastRecalled,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      check: {
        name: 'pgvector DB',
        status: 'red',
        message: `Unreachable: ${msg.slice(0, 120)}`,
      },
      memoriesCount: 0,
      recentCount: 0,
    };
  }
}

async function checkPostgREST(memoryEnv: Record<string, string>): Promise<Check> {
  const url = process.env.MEMORY_POSTGREST_URL || process.env.POSTGREST_URL || memoryEnv.MEMORY_POSTGREST_URL || '';

  if (!url) {
    return {
      name: 'PostgREST',
      status: 'yellow',
      message: 'MEMORY_POSTGREST_URL not configured (optional)',
    };
  }

  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${url}/memories?limit=1`, { signal: ctrl.signal });
    clearTimeout(timeout);

    if (res.ok || res.status === 406) {
      // 406 = empty result with Accept headers mismatch, still means service is up
      return { name: 'PostgREST', status: 'green', message: `Reachable (HTTP ${res.status})` };
    }
    return { name: 'PostgREST', status: 'yellow', message: `HTTP ${res.status}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { name: 'PostgREST', status: 'yellow', message: `Unreachable: ${msg.slice(0, 80)}` };
  }
}

async function checkSemanticRecallScript(): Promise<Check> {
  const scriptPath = resolve(process.cwd(), 'scripts/memory/recall_memories.js');

  try {
    await stat(scriptPath);
  } catch {
    return { name: 'Semantic recall script', status: 'red', message: `Not found: ${scriptPath}` };
  }

  try {
    // Run with --help or a trivial query that exits quickly
    const { stdout, stderr } = await execFileAsync(
      'node',
      [scriptPath, '--limit', '1', '--dry-run', 'health-check-ping'],
      { timeout: 8000, env: { ...process.env } }
    );
    const combined = (stdout + stderr).slice(0, 200);
    // If it errors out on unknown flag, that's fine — it means the script ran
    return { name: 'Semantic recall script', status: 'green', message: 'Executable and runs' };
  } catch (err: unknown) {
    const exitCode = (err as NodeJS.ErrnoException & { code?: number })?.code;
    const stderr = (err as { stderr?: string })?.stderr || '';
    const msg = (err instanceof Error ? err.message : String(err)).slice(0, 120);

    // Exit code 1 with usage/error in stderr is fine (script ran but no results)
    if (stderr.includes('No results') || stderr.includes('recall_memories') || msg.includes('No results')) {
      return { name: 'Semantic recall script', status: 'green', message: 'Executable and runs' };
    }

    // Timeout or import error = real problem
    if (msg.includes('TIMEDOUT') || msg.includes('Cannot find') || msg.includes('MODULE')) {
      return { name: 'Semantic recall script', status: 'red', message: `Failed: ${msg}` };
    }

    // Other non-zero exits (e.g. no DB connection from script) = yellow
    return { name: 'Semantic recall script', status: 'yellow', message: `Exit non-zero: ${msg}` };
  }
}

async function checkEnvFlags(memoryEnv: Record<string, string>): Promise<Check> {
  const flags = {
    MC_MEMORY_SEMANTIC_RECALL: process.env.MC_MEMORY_SEMANTIC_RECALL,
    EMBEDDING_PROVIDER: process.env.EMBEDDING_PROVIDER || memoryEnv.EMBEDDING_PROVIDER,
    EMBEDDING_MODEL: process.env.EMBEDDING_MODEL || memoryEnv.EMBEDDING_MODEL,
  };

  const missing = Object.entries(flags)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  const recallEnabled = flags.MC_MEMORY_SEMANTIC_RECALL === 'true';

  if (missing.length > 0) {
    return {
      name: 'Env flags',
      status: 'yellow',
      message: `Missing: ${missing.join(', ')}`,
    };
  }

  if (!recallEnabled) {
    return {
      name: 'Env flags',
      status: 'yellow',
      message: `MC_MEMORY_SEMANTIC_RECALL=false (semantic recall disabled)`,
    };
  }

  return {
    name: 'Env flags',
    status: 'green',
    message: `OK — provider=${flags.EMBEDDING_PROVIDER}, model=${flags.EMBEDDING_MODEL}`,
  };
}

// ─── Route ──────────────────────────────────────────────────────────────────

export async function GET() {
  if (process.env.MC_MEMORY_HEALTH_WIDGET === 'false') {
    return NextResponse.json({ disabled: true }, { status: 200 });
  }

  try {
    const memoryEnv = await loadDotEnvMemory();

    const [pgResult, postgrestCheck, recallCheck, envCheck] = await Promise.all([
      checkPgvector(),
      checkPostgREST(memoryEnv),
      checkSemanticRecallScript(),
      checkEnvFlags(memoryEnv),
    ]);

    const checks: Check[] = [
      pgResult.check,
      postgrestCheck,
      recallCheck,
      envCheck,
    ];

    const response: MemoryHealthResponse = {
      overall: worstStatus(checks),
      checks,
      metrics: {
        memoriesCount: pgResult.memoriesCount,
        recentCount: pgResult.recentCount,
        lastRecallAt: pgResult.lastRecallAt,
      },
      collectedAt: new Date().toISOString(),
    };

    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
