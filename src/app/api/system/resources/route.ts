import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { readFile } from 'fs/promises';

// Lightweight /proc-based resource collection (Linux)

interface CpuSample {
  idle: number;
  total: number;
}

async function readProcStat(): Promise<CpuSample> {
  const stat = await readFile('/proc/stat', 'utf8');
  const line = stat.split('\n').find(l => l.startsWith('cpu '));
  if (!line) throw new Error('No cpu line in /proc/stat');
  const parts = line.trim().split(/\s+/).slice(1).map(Number);
  // user, nice, system, idle, iowait, irq, softirq, steal, ...
  const idle = (parts[3] || 0) + (parts[4] || 0); // idle + iowait
  const total = parts.reduce((a, b) => a + b, 0);
  return { idle, total };
}

async function getCpuPercent(): Promise<number> {
  // Two samples 200ms apart
  const s1 = await readProcStat();
  await new Promise(r => setTimeout(r, 200));
  const s2 = await readProcStat();
  const diffTotal = s2.total - s1.total;
  const diffIdle = s2.idle - s1.idle;
  if (diffTotal === 0) return 0;
  return Math.round(((diffTotal - diffIdle) / diffTotal) * 100);
}

async function getMemoryInfo() {
  const meminfo = await readFile('/proc/meminfo', 'utf8');
  const get = (key: string): number => {
    const m = meminfo.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'));
    return m ? parseInt(m[1]) * 1024 : 0; // kB -> bytes
  };
  const total = get('MemTotal');
  const free = get('MemFree');
  const buffers = get('Buffers');
  const cached = get('Cached') + get('SReclaimable') - get('Shmem');
  const available = get('MemAvailable') || (free + buffers + cached);
  const used = total - available;
  const swapTotal = get('SwapTotal');
  const swapFree = get('SwapFree');
  const swapUsed = swapTotal - swapFree;

  return {
    totalBytes: total,
    usedBytes: used,
    availableBytes: available,
    percentUsed: total > 0 ? Math.round((used / total) * 100) : 0,
    swapTotalBytes: swapTotal,
    swapUsedBytes: swapUsed,
    swapPercentUsed: swapTotal > 0 ? Math.round((swapUsed / swapTotal) * 100) : 0,
  };
}

async function getLoadAvg() {
  const raw = await readFile('/proc/loadavg', 'utf8');
  const parts = raw.trim().split(/\s+/);
  return {
    load1: parseFloat(parts[0]),
    load5: parseFloat(parts[1]),
    load15: parseFloat(parts[2]),
  };
}

interface ProcessEntry {
  pid: number;
  name: string;
  cpuPercent: number;
  memPercent: number;
  rssBytes: number;
  state: string;
}

async function getTopProcesses(limit = 5): Promise<ProcessEntry[]> {
  // Read /proc/[pid]/stat and /proc/[pid]/status for each visible process
  const { readdir } = await import('fs/promises');
  const entries = await readdir('/proc').catch(() => [] as string[]);
  const pids = entries.filter(e => /^\d+$/.test(e)).map(Number);

  const meminfo = await readFile('/proc/meminfo', 'utf8');
  const memTotalKb = parseInt((meminfo.match(/^MemTotal:\s+(\d+)/m) || [, '1'])[1]!);

  const processes: ProcessEntry[] = [];

  for (const pid of pids) {
    try {
      const statRaw = await readFile(`/proc/${pid}/stat`, 'utf8');
      const statusRaw = await readFile(`/proc/${pid}/status`, 'utf8');

      // Parse stat: pid (name) state ... utime stime ...
      const statMatch = statRaw.match(/^\d+ \((.+)\) (\S) \S+ \S+ \S+ \S+ \S+ \S+ \S+ \S+ \S+ \S+ (\d+) (\d+)/);
      if (!statMatch) continue;
      const name = statMatch[1];
      const state = statMatch[2];
      const utime = parseInt(statMatch[3]);
      const stime = parseInt(statMatch[4]);

      const rssMatch = statusRaw.match(/^VmRSS:\s+(\d+)/m);
      const rssKb = rssMatch ? parseInt(rssMatch[1]) : 0;

      processes.push({
        pid,
        name,
        state,
        cpuPercent: 0, // Will be approximated using utime+stime below
        memPercent: Math.round((rssKb / memTotalKb) * 1000) / 10,
        rssBytes: rssKb * 1024,
        // We stash ticks for sorting
        ..._cpuTicks(utime + stime),
      });
    } catch {
      // Process may have exited
    }
  }

  // Sort by CPU ticks desc, take top N
  const sorted = processes
    .sort((a, b) => (b as any)._ticks - (a as any)._ticks)
    .slice(0, limit)
    .map(({ pid, name, state, memPercent, rssBytes }) => ({
      pid,
      name,
      state,
      cpuPercent: 0, // Static snapshot — good enough for dashboard
      memPercent,
      rssBytes,
    }));

  return sorted;
}

function _cpuTicks(ticks: number) {
  return { _ticks: ticks };
}

function formatBytes(bytes: number): string {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

export async function GET() {
  // Env toggle
  if (process.env.MC_RESOURCE_WIDGET === 'false') {
    return NextResponse.json({ disabled: true }, { status: 200 });
  }

  try {
    const [cpu, mem, load, topProcs] = await Promise.all([
      getCpuPercent(),
      getMemoryInfo(),
      getLoadAvg(),
      getTopProcesses(5),
    ]);

    return NextResponse.json(
      {
        cpu: {
          percentUsed: cpu,
        },
        memory: {
          ...mem,
          totalFormatted: formatBytes(mem.totalBytes),
          usedFormatted: formatBytes(mem.usedBytes),
          swapTotalFormatted: formatBytes(mem.swapTotalBytes),
          swapUsedFormatted: formatBytes(mem.swapUsedBytes),
        },
        load,
        processes: topProcs,
        collectedAt: new Date().toISOString(),
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          Pragma: 'no-cache',
          Expires: '0',
        },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
