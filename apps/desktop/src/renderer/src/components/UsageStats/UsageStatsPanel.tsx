import React, { useMemo } from "react";
import { useI18n } from "../../i18n";
import { useSessionStore } from "../../stores/session-store";
import { useWorkspaceStore } from "../../stores/workspace-store";
import { buildUsageOverview, formatUsageNumber } from "./usage-aggregation";

interface UsageStatsPanelProps {
  className?: string;
  workspaceId?: string;
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
          className="h-full rounded-full transition-[width,background-color] duration-[var(--motion-panel)]"
          style={{ width: `${Math.min(100, percentage)}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

export function UsageStatsPanel({ className, workspaceId }: UsageStatsPanelProps): React.JSX.Element {
  const { t } = useI18n();
  const { sessions } = useSessionStore();
  const { getCurrentWorkspace } = useWorkspaceStore();
  const currentWorkspace = getCurrentWorkspace();
  const effectiveWorkspaceId = workspaceId ?? currentWorkspace?.id;

  const usage = useMemo(
    () => buildUsageOverview(sessions, {
      workspaceId: effectiveWorkspaceId,
      includeAllWorkspaces: false,
      includeArchived: false,
      days: "all",
    }),
    [sessions, effectiveWorkspaceId],
  );

  return (
    <div data-testid="usage-stats-panel" className={`rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-4 ${className ?? ""}`}>
      <h3 className="mb-4 text-sm font-semibold text-[var(--mm-text-primary)]">{t("usageStats.title")}</h3>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-[2px] bg-[var(--mm-bg-sidebar)] p-3">
          <div className="text-[10px] uppercase tracking-wider text-[var(--mm-text-tertiary)]">{t("usageStats.totalTokens")}</div>
          <div className="mt-1 font-mono text-lg font-semibold text-[var(--mm-text-primary)]">
            {formatUsageNumber(usage.summary.totalTokens, "compact")}
          </div>
        </div>
        <div className="rounded-[2px] bg-[var(--mm-bg-sidebar)] p-3">
          <div className="text-[10px] uppercase tracking-wider text-[var(--mm-text-tertiary)]">{t("usageStats.sessions")}</div>
          <div className="mt-1 font-mono text-lg font-semibold text-[var(--mm-text-primary)]">
            {usage.summary.sessionCount}
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <UsageBar label={t("usageStats.inputTokens")} value={usage.summary.inputTokens} total={usage.summary.totalTokens} color="#3b82f6" />
        <UsageBar label={t("usageStats.outputTokens")} value={usage.summary.outputTokens} total={usage.summary.totalTokens} color="#10b981" />
      </div>

      {usage.modelBreakdown.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-xs font-medium text-[var(--mm-text-secondary)]">{t("usageStats.modelBreakdown")}</div>
          <div className="space-y-2">
            {usage.modelBreakdown.slice(0, 5).map((model) => (
              <div key={model.key} className="flex items-center justify-between text-xs">
                <span className="truncate text-[var(--mm-text-secondary)]">{model.key}</span>
                <span className="font-mono text-[var(--mm-text-primary)]">{formatUsageNumber(model.totalTokens, "compact")}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 border-t border-[var(--mm-border)] pt-3 text-[10px] text-[var(--mm-text-tertiary)]">
        {t("usageStats.footer", { count: usage.summary.sessionCount })}
      </div>
    </div>
  );
}
