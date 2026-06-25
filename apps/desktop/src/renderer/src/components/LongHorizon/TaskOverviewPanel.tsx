import React from "react";
import { useTaskProgress } from "../../hooks/useTaskProgress";
import { usePlanStore } from "../../stores/plan-store";
import { useRuntimeFeatureStore, isRuntimeFeatureEnabled } from "../../stores/runtime-feature-store";
import { useSettingsStore } from "../../stores/settings-store";
import { useWorkspaceStore } from "../../stores/workspace-store";

function statusLabel(status: "pending" | "running" | "completed" | "failed"): string {
  switch (status) {
    case "running":
      return "运行中";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "pending":
    default:
      return "待处理";
  }
}

export function TaskOverviewPanel(): React.JSX.Element {
  const { tasks } = useTaskProgress();
  const goal = usePlanStore((state) => state.goal);
  const featureState = useRuntimeFeatureStore((state) => state.featureState);
  const longHorizon = useSettingsStore((state) => state.settings.longHorizon);
  const currentWorkspace = useWorkspaceStore((state) => state.getCurrentWorkspace());
  const taskEnabled = isRuntimeFeatureEnabled(featureState, longHorizon, "task");

  return (
    <section className="flex h-full flex-col overflow-hidden bg-[var(--mm-bg-body)] px-6 py-6">
      <div className="mb-5">
        <h1 className="m-0 text-xl font-semibold text-[var(--mm-text-primary)]">任务总览</h1>
        <p className="mt-1 text-sm text-[var(--mm-text-secondary)]">
          {currentWorkspace ? `当前 workspace：${currentWorkspace.name}` : "请选择 workspace 后查看任务 registry。"}
        </p>
      </div>

      {!taskEnabled ? (
        <div className="rounded-2xl border border-dashed border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-4 py-5 text-sm text-[var(--mm-text-secondary)]">
          当前未启用 task registry，打开设置里的长程任务能力后会在这里显示真实任务状态。
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_320px]">
          <section className="rounded-2xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="m-0 text-sm font-medium text-[var(--mm-text-primary)]">任务列表</h2>
              <span className="rounded-full bg-[var(--mm-bg-sidebar)] px-2 py-0.5 text-[11px] text-[var(--mm-text-tertiary)]">
                {tasks.length} 项
              </span>
            </div>
            {tasks.length === 0 ? (
              <p className="m-0 text-sm text-[var(--mm-text-secondary)]">本轮还没有任务写入 registry。</p>
            ) : (
              <ul className="m-0 list-none space-y-2 p-0">
                {tasks.map((task) => (
                  <li
                    key={task.id}
                    className="rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg-sidebar)] px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm text-[var(--mm-text-primary)]">{task.name}</span>
                      <span className="shrink-0 text-xs text-[var(--mm-text-tertiary)]">{statusLabel(task.status)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <aside className="rounded-2xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-4">
            <h2 className="m-0 text-sm font-medium text-[var(--mm-text-primary)]">当前目标</h2>
            {goal ? (
              <div className="mt-3 space-y-2">
                <p className="m-0 text-sm text-[var(--mm-text-primary)]">{goal.condition}</p>
                <p className="m-0 text-xs text-[var(--mm-text-tertiary)]">状态：{goal.status}</p>
                {goal.reason && <p className="m-0 text-xs text-[var(--mm-text-secondary)]">{goal.reason}</p>}
              </div>
            ) : (
              <p className="mt-3 text-sm text-[var(--mm-text-secondary)]">当前没有激活的 goal judge 条件。</p>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}
