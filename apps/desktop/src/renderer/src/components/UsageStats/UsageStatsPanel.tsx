import React, { useMemo } from "react";
import { useSessionStore, type Session } from "../../stores/session-store";
import { useWorkspaceStore } from "../../stores/workspace-store";

interface UsageStatsPanelProps {
  className?: string;
}

function formatNumber(num: number | undefined): string {
  if (num === undefined || num === 0) return "0";
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toLocaleString();
}

function formatCost(cost: number | undefined): string {
  if (cost === undefined || cost === 0) return "$0.00";
  if (cost < 0.01) return "<$0.01";
  return `$${cost.toFixed(2)}`;
}

interface AggregatedUsage {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCost: number;
  sessionCount: number;
  modelBreakdown: Map<string, { input: number; output: number; cost: number }>;
}

function aggregateUsage(sessions: Session[]): AggregatedUsage {
  const result: AggregatedUsage = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    totalCost: 0,
    sessionCount: 0,
    modelBreakdown: new Map(),
  };

  for (const session of sessions) {
    if (!session.usage) continue;

    const usage = session.usage;
    result.totalInputTokens += usage.inputTokens ?? 0;
    result.totalOutputTokens += usage.outputTokens ?? 0;
    result.totalTokens += usage.totalTokens ?? 0;
    result.totalCost += usage.estimatedCostUsd ?? 0;
    result.sessionCount++;

    const modelKey = `${usage.provider ?? "unknown"}/${usage.model ?? "unknown"}`;
    const existing = result.modelBreakdown.get(modelKey) ?? { input: 0, output: 0, cost: 0 };
    existing.input += usage.inputTokens ?? 0;
    existing.output += usage.outputTokens ?? 0;
    existing.cost += usage.estimatedCostUsd ?? 0;
    result.modelBreakdown.set(modelKey, existing);
  }

  return result;
}

function UsageBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }): React.JSX.Element {
  const percentage = total > 0 ? (value / total) * 100 : 0;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-[var(--mm-text-secondary)]">{label}</span>
        <span className="font-mono text-[var(--mm-text-primary)]">{formatNumber(value)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--mm-bg-hover)]">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${Math.min(100, percentage)}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

export function UsageStatsPanel({ className }: UsageStatsPanelProps): React.JSX.Element {
  const { sessions } = useSessionStore();
  const { getCurrentWorkspace } = useWorkspaceStore();
  const currentWorkspace = getCurrentWorkspace();

  const workspaceSessions = useMemo(
    () => sessions.filter((s) => s.workspaceId === currentWorkspace?.id && !s.archived),
    [sessions, currentWorkspace],
  );

  const usage = useMemo(() => aggregateUsage(workspaceSessions), [workspaceSessions]);

  const modelEntries = useMemo(
    () => Array.from(usage.modelBreakdown.entries()).sort((a, b) => b[1].cost - a[1].cost),
    [usage.modelBreakdown],
  );

  return (
    <div className={`rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-4 ${className ?? ""}`}>
      <h3 className="mb-4 text-sm font-semibold text-[var(--mm-text-primary)]">Token 使用统计</h3>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg bg-[var(--mm-bg-sidebar)] p-3">
          <div className="text-[10px] uppercase tracking-wider text-[var(--mm-text-tertiary)]">总 Token</div>
          <div className="mt-1 font-mono text-lg font-semibold text-[var(--mm-text-primary)]">
            {formatNumber(usage.totalTokens)}
          </div>
        </div>
        <div className="rounded-lg bg-[var(--mm-bg-sidebar)] p-3">
          <div className="text-[10px] uppercase tracking-wider text-[var(--mm-text-tertiary)]">预估费用</div>
          <div className="mt-1 font-mono text-lg font-semibold text-[var(--mm-text-primary)]">
            {formatCost(usage.totalCost)}
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <UsageBar label="输入 Token" value={usage.totalInputTokens} total={usage.totalTokens} color="#3b82f6" />
        <UsageBar label="输出 Token" value={usage.totalOutputTokens} total={usage.totalTokens} color="#10b981" />
      </div>

      {modelEntries.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-xs font-medium text-[var(--mm-text-secondary)]">按模型分布</div>
          <div className="space-y-2">
            {modelEntries.slice(0, 5).map(([model, data]) => (
              <div key={model} className="flex items-center justify-between text-xs">
                <span className="truncate text-[var(--mm-text-secondary)]">{model}</span>
                <span className="font-mono text-[var(--mm-text-primary)]">{formatCost(data.cost)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 border-t border-[var(--mm-border)] pt-3 text-[10px] text-[var(--mm-text-tertiary)]">
        {usage.sessionCount} 个会话 · 数据来自当前工作区
      </div>
    </div>
  );
}
