import React, { useMemo } from "react";
import type { GeneratedUiCard, GeneratedUiListItem } from "@shared";
import { useTaskProgress } from "../../hooks/useTaskProgress";
import { usePlanStore } from "../../stores/plan-store";
import { useRuntimeFeatureStore, isRuntimeFeatureEnabled } from "../../stores/runtime-feature-store";
import { useSettingsStore } from "../../stores/settings-store";
import { useWorkspaceStore } from "../../stores/workspace-store";
import { useSessionStore } from "../../stores/session-store";
import { useAgentStore } from "../../stores/agent-store";
import { useI18n } from "../../i18n";
import type { TaskProgressItem, TaskStatus } from "../MiniMaxCode/TaskProgressPanel";
import { resolveActiveAgent } from "../../utils/active-agent";

interface MessageWithGeneratedUi {
  generatedUi?: GeneratedUiCard;
}

/** Exported for unit tests. */
export function mapPlanStepStatus(status: "pending" | "running" | "completed" | "failed" | "waiting" | "blocked"): TaskStatus {
  switch (status) {
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "failed":
    case "blocked":
      return "failed";
    case "pending":
    case "waiting":
    default:
      return "pending";
  }
}

/** Exported for unit tests. */
export function mapUiStatus(status?: string): TaskStatus {
  if (!status) return "pending";
  const normalized = status.toLowerCase();
  if (normalized === "running" || normalized === "in_progress" || normalized === "progress" || normalized === "进行中") {
    return "running";
  }
  if (
    normalized === "completed"
    || normalized === "done"
    || normalized === "success"
    || normalized === "skipped"
    || normalized === "完成"
  ) {
    return "completed";
  }
  if (normalized === "failed" || normalized === "error" || normalized === "blocked" || normalized === "失败") {
    return "failed";
  }
  return "pending";
}

/** Exported for unit tests. */
export function tasksFromListItems(items: GeneratedUiListItem[]): TaskProgressItem[] {
  return items
    .map((item) => {
      const name = item.label?.trim();
      if (!name) return null;
      return {
        id: item.id || name,
        name,
        status: mapUiStatus(item.status),
      } satisfies TaskProgressItem;
    })
    .filter((item): item is TaskProgressItem => item !== null);
}

/** Exported for unit tests. */
export function tasksFromGeneratedUi(card: GeneratedUiCard | undefined): TaskProgressItem[] {
  if (!card?.sections?.length) return [];
  const collected: TaskProgressItem[] = [];
  for (const section of card.sections) {
    if (section.kind === "steps" || section.kind === "status_list" || section.kind === "file_list") {
      collected.push(...tasksFromListItems(section.items));
    }
  }
  return collected;
}

/** Exported for unit tests. */
export function tasksFromMessages(messages: MessageWithGeneratedUi[]): TaskProgressItem[] {
  // Prefer the newest workflow/progress card so phase sequence reflects the latest run.
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const fromCard = tasksFromGeneratedUi(messages[index]?.generatedUi);
    if (fromCard.length > 0) return fromCard;
  }
  return [];
}

export function TaskOverviewPanel(): React.JSX.Element {
  const currentSessionId = useSessionStore((state) => state.currentSessionId);
  const sessions = useSessionStore((state) => state.sessions);
  const currentAgentId = useAgentStore((state) => state.currentAgentId);
  const agents = useAgentStore((state) => state.agents);
  const messagesByAgent = useAgentStore((state) => state.messagesByAgent);
  const goal = usePlanStore((state) => state.goal);
  const planSteps = usePlanStore((state) => state.steps);
  const featureState = useRuntimeFeatureStore((state) => state.featureState);
  const longHorizon = useSettingsStore((state) => state.settings.longHorizon);
  const currentWorkspace = useWorkspaceStore((state) => state.getCurrentWorkspace());
  const { t } = useI18n();
  const scopedAgentId = useMemo(
    () => resolveActiveAgent(agents, currentWorkspace?.id, { agentId: currentAgentId, sessionId: currentSessionId })?.id,
    [agents, currentAgentId, currentSessionId, currentWorkspace],
  );
  const { tasks: scopedRegistryTasks } = useTaskProgress(scopedAgentId);
  // Workspace-wide fallback: plan/workflow rows are often written with agentId,
  // but after tab switches or agent rebinding the scoped id may not match.
  const { tasks: workspaceRegistryTasks } = useTaskProgress(undefined);
  const sessionMessages = useMemo((): MessageWithGeneratedUi[] => {
    if (!currentSessionId) return [];
    const session = sessions.find((item) => item.id === currentSessionId);
    return session?.messages ?? [];
  }, [currentSessionId, sessions]);
  const agentMessages = useMemo((): MessageWithGeneratedUi[] => {
    if (!scopedAgentId) return [];
    return messagesByAgent?.[scopedAgentId] ?? [];
  }, [messagesByAgent, scopedAgentId]);
  // Prefer registry tasks; fall back to live plan/workflow steps and the
  // latest generated-ui phase card so Compose stages remain visible on the
  // Run tab even when chat is hidden or agent-scoped registry rows lag.
  const tasks = useMemo(() => {
    if (scopedRegistryTasks.length > 0) return scopedRegistryTasks;
    if (workspaceRegistryTasks.length > 0) return workspaceRegistryTasks;
    if (planSteps.length > 0) {
      return planSteps.map((step) => ({
        id: step.id,
        name: step.text,
        status: mapPlanStepStatus(step.status),
      }));
    }
    const fromAgent = tasksFromMessages(agentMessages);
    if (fromAgent.length > 0) return fromAgent;
    return tasksFromMessages(sessionMessages);
  }, [agentMessages, planSteps, scopedRegistryTasks, sessionMessages, workspaceRegistryTasks]);
  const taskEnabled = isRuntimeFeatureEnabled(featureState, longHorizon, "task");

  const statusLabel = (status: "pending" | "running" | "completed" | "failed"): string => {
    switch (status) {
      case "running":
        return t("taskOverview.status.running");
      case "completed":
        return t("taskOverview.status.completed");
      case "failed":
        return t("taskOverview.status.failed");
      case "pending":
      default:
        return t("taskOverview.status.pending");
    }
  };

  return (
    <section className="flex h-full flex-col overflow-hidden bg-[var(--mm-bg-body)] px-6 py-6">
      <div className="mb-5">
        <h1 className="m-0 text-xl font-semibold text-[var(--mm-text-primary)]">{t("taskOverview.title")}</h1>
        <p className="mt-1 text-sm text-[var(--mm-text-secondary)]">
          {currentWorkspace
            ? t("taskOverview.subtitle.currentWorkspace", { name: currentWorkspace.name })
            : t("taskOverview.subtitle.selectWorkspace")}
        </p>
      </div>

      {!taskEnabled ? (
        <div className="rounded-2xl border border-dashed border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-4 py-5 text-sm text-[var(--mm-text-secondary)]">
          {t("taskOverview.disabled")}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_320px]">
          <section className="rounded-2xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="m-0 text-sm font-medium text-[var(--mm-text-primary)]">{t("taskOverview.taskList.heading")}</h2>
              <span className="rounded-full bg-[var(--mm-bg-sidebar)] px-2 py-0.5 text-[11px] text-[var(--mm-text-tertiary)]">
                {t("taskOverview.taskList.countSuffix", { count: tasks.length })}
              </span>
            </div>
            {tasks.length === 0 ? (
              <p className="m-0 text-sm text-[var(--mm-text-secondary)]">{t("taskOverview.taskList.empty")}</p>
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
            <h2 className="m-0 text-sm font-medium text-[var(--mm-text-primary)]">{t("taskOverview.goal.heading")}</h2>
            {goal ? (
              <div className="mt-3 space-y-2">
                <p className="m-0 text-sm text-[var(--mm-text-primary)]">{goal.condition}</p>
                <p className="m-0 text-xs text-[var(--mm-text-tertiary)]">{t("taskOverview.goal.status", { status: goal.status })}</p>
                {goal.reason && <p className="m-0 text-xs text-[var(--mm-text-secondary)]">{goal.reason}</p>}
              </div>
            ) : (
              <p className="mt-3 text-sm text-[var(--mm-text-secondary)]">{t("taskOverview.goal.empty")}</p>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}
