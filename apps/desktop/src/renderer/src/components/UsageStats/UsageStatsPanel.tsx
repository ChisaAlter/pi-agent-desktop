import React, { useMemo } from "react";
import { useSessionStore } from "../../stores/session-store";
import { useWorkspaceStore } from "../../stores/workspace-store";
import { buildUsageOverview, formatUsageCost, formatUsageNumber } from "./usage-aggregation";

interface UsageStatsPanelProps {
  className?: string;
}

function UsageBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }): React.JSX.Element {
  const percentage = total > 0 ? (value / total) * 100 : 0;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-[var(--mm-text-secondary)]">{label}</span>
        <span className="font-mono text-[var(--mm-text-primary)]">{formatUsageNumber(value, "compact")}</span>
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

  const usage = useMemo(
    () => buildUsageOverview(sessions, {
      workspaceId: currentWorkspace?.id,
      includeAllWorkspaces: false,
      includeArchived: false,
      days: "all",
    }),
    [sessions, currentWorkspace?.id],
  );

  return (
    <div className={`rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-4 ${className ?? ""}`}>
      <h3 className="mb-4 text-sm font-semibold text-[var(--mm-text-primary)]">Token 使用统计</h3>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg bg-[var(--mm-bg-sidebar)] p-3">
          <div className="text-[10px] uppercase tracking-wider text-[var(--mm-text-tertiary)]">总 Token</div>
          <div className="mt-1 font-mono text-lg font-semibold text-[var(--mm-text-primary)]">
            {formatUsageNumber(usage.summary.totalTokens, "compact")}
          </div>
        </div>
        <div className="rounded-lg bg-[var(--mm-bg-sidebar)] p-3">
          <div className="text-[10px] uppercase tracking-wider text-[var(--mm-text-tertiary)]">预估费用</div>
          <div className="mt-1 font-mono text-lg font-semibold text-[var(--mm-text-primary)]">
            {formatUsageCost(usage.summary.estimatedCostUsd)}
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <UsageBar label="输入 Token" value={usage.summary.inputTokens} total={usage.summary.totalTokens} color="#3b82f6" />
        <UsageBar label="输出 Token" value={usage.summary.outputTokens} total={usage.summary.totalTokens} color="#10b981" />
      </div>

      {usage.modelBreakdown.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-xs font-medium text-[var(--mm-text-secondary)]">按模型分布</div>
          <div className="space-y-2">
            {usage.modelBreakdown.slice(0, 5).map((model) => (
              <div key={model.key} className="flex items-center justify-between text-xs">
                <span className="truncate text-[var(--mm-text-secondary)]">{model.key}</span>
                <span className="font-mono text-[var(--mm-text-primary)]">{formatUsageCost(model.estimatedCostUsd)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 border-t border-[var(--mm-border)] pt-3 text-[10px] text-[var(--mm-text-tertiary)]">
        {usage.summary.sessionCount} 个会话 · 数据来自当前工作区
      </div>
    </div>
  );
}
