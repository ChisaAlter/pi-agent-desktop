import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../i18n";
import { useAgentStore } from "../../stores/agent-store";
import { usePlanStore } from "../../stores/plan-store";
import { requestRunControlStop } from "../../utils/run-control";

interface ProgressReminderToastProps {
  workspaceId?: string;
  agentId?: string | null;
  enabled?: boolean;
}

type StreamStartDetail = {
  runContext?: "task" | "plan_execution" | null;
};

function isRunningAgent(agent: { status?: string }): boolean {
  return agent.status === "running" || agent.status === "starting";
}

export function ProgressReminderToast({
  workspaceId,
  agentId = null,
  enabled = true,
}: ProgressReminderToastProps): React.JSX.Element | null {
  const { t } = useI18n();
  const agents = useAgentStore((state) => state.agents);
  const activePlanExecution = usePlanStore((state) => state.activeExecution);
  const [visible, setVisible] = useState(false);
  const [streamContext, setStreamContext] = useState<"task" | "plan_execution">("task");

  const activeAgent = useMemo(() => {
    if (agentId) {
      return agents.find((agent) => agent.id === agentId && isRunningAgent(agent)) ?? null;
    }
    if (workspaceId) {
      return agents.find((agent) => agent.workspaceId === workspaceId && isRunningAgent(agent)) ?? null;
    }
    return agents.find((agent) => isRunningAgent(agent)) ?? null;
  }, [agentId, agents, workspaceId]);

  const planActive = activePlanExecution?.phase === "executing" || activePlanExecution?.phase === "pausing";
  const effectiveContext = planActive || streamContext === "plan_execution" ? "plan_execution" : "task";

  useEffect(() => {
    const handleStart = (event: Event): void => {
      const detail = (event as CustomEvent<StreamStartDetail>).detail;
      setStreamContext(detail?.runContext === "plan_execution" ? "plan_execution" : "task");
      setVisible(true);
    };
    const handleEnd = (): void => {
      setVisible(false);
      setStreamContext("task");
    };
    window.addEventListener("pi:stream-start", handleStart);
    window.addEventListener("pi:stream-end", handleEnd);
    return () => {
      window.removeEventListener("pi:stream-start", handleStart);
      window.removeEventListener("pi:stream-end", handleEnd);
    };
  }, []);

  useEffect(() => {
    if (activeAgent || planActive) {
      setVisible(true);
    }
  }, [activeAgent, planActive]);

  const handleAction = async (): Promise<void> => {
    await requestRunControlStop({
      workspaceId: workspaceId ?? activeAgent?.workspaceId,
      agentId: activeAgent?.id ?? agentId,
      runContext: effectiveContext,
      markPlanPausing: effectiveContext === "plan_execution",
    });
  };

  if (!enabled || !visible) return null;

  const bodyLabel = effectiveContext === "plan_execution"
    ? t("chatInput.running.plan")
    : t("chatInput.running.task");
  const actionText = effectiveContext === "plan_execution" ? t("chatInput.pauseExecution") : t("chatInput.stop");
  const actionAria = effectiveContext === "plan_execution" ? t("chatInput.pauseExecution") : t("chatView.stopGeneration");

  const reminder = (
    <div
      role="status"
      aria-label="任务运行中提醒"
      aria-live="polite"
      className="pointer-events-none fixed z-[90]"
      style={{
        left: "var(--pi-global-composer-left, 0px)",
        right: "var(--pi-global-composer-right, 0px)",
        bottom: "calc(var(--pi-global-composer-height, 103px) + 12px)",
      }}
    >
      <div className="mx-auto flex max-w-[768px] justify-end px-4">
        <div className="pointer-events-auto w-full max-w-sm rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg-sidebar)] px-4 py-3 shadow-[0_18px_48px_rgba(15,23,42,0.16)]">
          <div className="flex items-start gap-3">
            <span className="relative mt-1 inline-flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
              <span className="absolute inset-0 rounded-full bg-[var(--mm-bg-active)] opacity-25 animate-ping" />
              <span className="relative h-2.5 w-2.5 rounded-full bg-[var(--mm-bg-active)]" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-[var(--mm-text-primary)]">进度提醒</div>
              <div className="mt-1 text-xs leading-5 text-[var(--mm-text-secondary)]">{bodyLabel}</div>
            </div>
            <button
              type="button"
              onClick={() => void handleAction()}
              className="shrink-0 rounded-md border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-2 py-1 text-xs text-[var(--mm-text-primary)] hover:bg-[var(--mm-bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
              aria-label={actionAria}
            >
              {actionText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") {
    return reminder;
  }

  return createPortal(reminder, document.body);
}
