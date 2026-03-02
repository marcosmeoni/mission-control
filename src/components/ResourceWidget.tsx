'use client';

import { useState, useEffect, useCallback } from 'react';
import { Cpu, MemoryStick, Activity, RefreshCw } from 'lucide-react';

interface ResourceData {
  cpu: { percentUsed: number };
  memory: {
    percentUsed: number;
    usedFormatted: string;
    totalFormatted: string;
    swapPercentUsed: number;
    swapUsedFormatted: string;
    swapTotalFormatted: string;
  };
  load: { load1: number; load5: number; load15: number };
  processes: Array<{
    pid: number;
    name: string;
    state: string;
    memPercent: number;
    rssBytes: number;
  }>;
  collectedAt: string;
  disabled?: boolean;
}

function GaugeBar({ percent, color }: { percent: number; color: string }) {
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <div className="w-full bg-mc-border rounded-full h-2 overflow-hidden">
      <div
        className={`h-2 rounded-full transition-all duration-700 ${color}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

function colorFor(pct: number) {
  if (pct >= 90) return 'bg-red-500';
  if (pct >= 70) return 'bg-yellow-500';
  return 'bg-emerald-500';
}

const REFRESH_INTERVAL_MS = 12000;

export function ResourceWidget() {
  const [data, setData] = useState<ResourceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/system/resources?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: ResourceData = await res.json();
      setData(json);
      setLastUpdated(new Date());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (data?.disabled) return null;

  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-mc-bg-secondary border border-mc-border rounded-lg p-3 animate-pulse h-20" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="mb-6 bg-mc-bg-secondary border border-mc-border rounded-lg p-3 text-xs text-mc-text-secondary flex items-center gap-2">
        <span>⚠️ Resources unavailable: {error}</span>
      </div>
    );
  }

  if (!data) return null;

  const { cpu, memory, load, processes } = data;

  return (
    <div className="mb-6">
      {/* Main metric cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* CPU */}
        <div className="bg-mc-bg-secondary border border-mc-border rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-xs text-mc-text-secondary">
            <Cpu className="w-3.5 h-3.5" />
            <span>CPU</span>
          </div>
          <div className={`text-2xl font-bold ${cpu.percentUsed >= 90 ? 'text-red-500' : cpu.percentUsed >= 70 ? 'text-yellow-500' : 'text-mc-text'}`}>
            {cpu.percentUsed}%
          </div>
          <GaugeBar percent={cpu.percentUsed} color={colorFor(cpu.percentUsed)} />
        </div>

        {/* Memory */}
        <div className="bg-mc-bg-secondary border border-mc-border rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-xs text-mc-text-secondary">
            <MemoryStick className="w-3.5 h-3.5" />
            <span>Memory</span>
          </div>
          <div className={`text-2xl font-bold ${memory.percentUsed >= 90 ? 'text-red-500' : memory.percentUsed >= 70 ? 'text-yellow-500' : 'text-mc-text'}`}>
            {memory.percentUsed}%
          </div>
          <GaugeBar percent={memory.percentUsed} color={colorFor(memory.percentUsed)} />
          <div className="text-xs text-mc-text-secondary">{memory.usedFormatted} / {memory.totalFormatted}</div>
        </div>

        {/* Swap */}
        <div className="bg-mc-bg-secondary border border-mc-border rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-xs text-mc-text-secondary">
            <Activity className="w-3.5 h-3.5" />
            <span>Swap</span>
          </div>
          {memory.swapTotalFormatted === '0 KB' || memory.swapTotalFormatted === '0 B' ? (
            <div className="text-sm text-mc-text-secondary">No swap</div>
          ) : (
            <>
              <div className={`text-2xl font-bold ${memory.swapPercentUsed >= 50 ? 'text-yellow-500' : 'text-mc-text'}`}>
                {memory.swapPercentUsed}%
              </div>
              <GaugeBar percent={memory.swapPercentUsed} color={memory.swapPercentUsed >= 50 ? 'bg-yellow-500' : 'bg-emerald-500'} />
              <div className="text-xs text-mc-text-secondary">{memory.swapUsedFormatted} / {memory.swapTotalFormatted}</div>
            </>
          )}
        </div>

        {/* Load Average */}
        <div className="bg-mc-bg-secondary border border-mc-border rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs text-mc-text-secondary">
              <Activity className="w-3.5 h-3.5" />
              <span>Load Avg</span>
            </div>
            {lastUpdated && (
              <button
                onClick={fetchData}
                title="Refresh"
                className="text-mc-text-secondary hover:text-mc-text transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
            )}
          </div>
          <div className="text-xl font-bold">{load.load1.toFixed(2)}</div>
          <div className="text-xs text-mc-text-secondary space-y-0.5">
            <div>5m: {load.load5.toFixed(2)} · 15m: {load.load15.toFixed(2)}</div>
          </div>
        </div>
      </div>

      {/* Top processes (compact) */}
      {processes.length > 0 && (
        <div className="mt-3 bg-mc-bg-secondary border border-mc-border rounded-lg p-3">
          <div className="text-xs text-mc-text-secondary mb-2 flex items-center justify-between">
            <span>Top Processes by Memory</span>
            {lastUpdated && (
              <span className="text-mc-text-secondary/50">
                updated {lastUpdated.toLocaleTimeString()}
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-1.5">
            {processes.map(proc => (
              <div key={proc.pid} className="flex items-center justify-between text-xs bg-mc-bg rounded px-2 py-1.5 gap-2">
                <span className="truncate font-medium max-w-[80px]" title={proc.name}>{proc.name}</span>
                <span className={`flex-shrink-0 font-mono ${proc.memPercent > 10 ? 'text-yellow-500' : 'text-mc-text-secondary'}`}>
                  {proc.memPercent.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
