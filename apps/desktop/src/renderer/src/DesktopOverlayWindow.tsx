import React, { useEffect, useMemo, useRef, useState } from "react";
import { type AgentTab, type PlanProgressUpdate } from "@shared";
import { I18nProvider, useI18n } from "./i18n";
import { requestRunControlStop } from "./utils/run-control";

type OverlayProgressState = {
  visible: boolean;
  runContext: "task" | "plan_execution";
  agentId?: string | null;
  workspaceId?: string | null;
};

function isRunningAgent(agent: AgentTab): boolean {
  return agent.status === "running" || agent.status === "starting";
}

function useDesktopOverlayProgress(): OverlayProgressState {
  const [runningAgent, setRunningAgent] = useState<{ agentId: string; workspaceId: string } | null>(null);
  const [planExecution, setPlanExecution] = useState<{ agentId?: string; workspaceId?: string } | null>(null);

  useEffect(() => {
    let disposed = false;

    const syncAgents = (agents: AgentTab[]): void => {
      const next = agents.find(isRunningAgent);
      setRunningAgent(next ? { agentId: next.id, workspaceId: next.workspaceId } : null);
    };

    void window.piAPI?.agentsList?.().then((agents) => {
      if (!disposed) syncAgents(agents);
    }).catch(() => undefined);

    const offAgents = window.piAPI?.onAgentsState?.((agents) => {
      syncAgents(agents);
    });

    const offPlan = window.piAPI?.onPlanProgress?.((update: PlanProgressUpdate) => {
      if (update.status === "executing") {
        setPlanExecution({
          agentId: update.agentId,
          workspaceId: update.workspaceId,
        });
        return;
      }
      if (!update.workspaceId) return;
      setPlanExecution((current) => {
        if (!current || current.workspaceId !== update.workspaceId) return current;
        return null;
      });
    });

    return () => {
      disposed = true;
      offAgents?.();
      offPlan?.();
    };
  }, []);

  return useMemo(() => {
    if (planExecution) {
      return {
        visible: true,
        runContext: "plan_execution",
        agentId: planExecution.agentId ?? runningAgent?.agentId ?? null,
        workspaceId: planExecution.workspaceId ?? runningAgent?.workspaceId ?? null,
      } satisfies OverlayProgressState;
    }
    if (runningAgent) {
      return {
        visible: true,
        runContext: "task",
        agentId: runningAgent.agentId,
        workspaceId: runningAgent.workspaceId,
      } satisfies OverlayProgressState;
    }
    return {
      visible: false,
      runContext: "task",
      agentId: null,
      workspaceId: null,
    } satisfies OverlayProgressState;
  }, [planExecution, runningAgent]);
}

function DesktopProgressCard({
  progress,
}: {
  progress: OverlayProgressState;
}): React.JSX.Element | null {
  const { t } = useI18n();

  if (!progress.visible) return null;

  const handleAction = async (): Promise<void> => {
    await requestRunControlStop({
      workspaceId: progress.workspaceId,
      agentId: progress.agentId,
      runContext: progress.runContext,
      markPlanPausing: progress.runContext === "plan_execution",
    });
  };

  const bodyLabel = progress.runContext === "plan_execution"
    ? t("chatInput.running.plan")
    : t("chatInput.running.task");
  const actionText = progress.runContext === "plan_execution" ? t("chatInput.pauseExecution") : t("chatInput.stop");
  const actionAria = progress.runContext === "plan_execution" ? t("chatInput.pauseExecution") : t("chatView.stopGeneration");

  return (
    <div
      role="status"
      aria-label="任务运行中提醒"
      aria-live="polite"
      className="w-full max-w-sm rounded-xl border border-[var(--mm-border)] bg-[var(--mm-bg-sidebar)] px-4 py-3 shadow-[0_18px_48px_rgba(15,23,42,0.16)]"
    >
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
  );
}

function DesktopOverlayShell(): React.JSX.Element {
  const contentRef = useRef<HTMLDivElement>(null);
  const progress = useDesktopOverlayProgress();

  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    document.body.style.margin = "0";
    document.body.dataset.mmWindowKind = "overlay";
  }, []);

  useEffect(() => {
    const reportState = (): void => {
      const rect = contentRef.current?.getBoundingClientRect();
      const visible = progress.visible && Boolean(rect && rect.width > 0 && rect.height > 0);
      window.piAPI?.send?.("desktop-overlay:set-window-state", {
        visible,
        width: visible ? Math.ceil(rect!.width) : 1,
        height: visible ? Math.ceil(rect!.height) : 1,
      });
    };

    reportState();
    const content = contentRef.current;
    const observer = content && typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => {
        reportState();
      })
      : null;
    observer?.observe(content!);
    return () => {
      observer?.disconnect();
      window.piAPI?.send?.("desktop-overlay:set-window-state", { visible: false });
    };
  }, [progress.visible, progress.runContext]);

  return (
    <div className="min-h-screen w-screen bg-transparent">
      <div className="flex min-h-screen items-end justify-end">
        <div ref={contentRef} className="flex w-full max-w-sm flex-col items-end gap-2">
          <DesktopProgressCard progress={progress} />
        </div>
      </div>
    </div>
  );
}

export function DesktopOverlayWindow(): React.JSX.Element {
  return (
    <I18nProvider>
      <DesktopOverlayShell />
    </I18nProvider>
  );
}
