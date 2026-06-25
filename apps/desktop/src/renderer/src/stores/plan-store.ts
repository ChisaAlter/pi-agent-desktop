import { create } from "zustand";
import type { GoalState, PlanCard, PlanDecisionRequest, PlanProgressItem, PlanProgressUpdate } from "@shared";

export type PlanFlowPhase =
  | "idle"
  | "planning"
  | "awaiting_confirmation"
  | "executing"
  | "pausing"
  | "paused"
  | "completed"
  | "failed";

export interface ActivePlanExecution {
  activePlanId: string;
  title: string;
  filename?: string;
  sourceMessageId?: string;
  executionMessageId?: string;
  phase: PlanFlowPhase;
}

interface PlanState {
  enabled: boolean;
  activeCard: PlanCard | null;
  decisionRequest: PlanDecisionRequest | null;
  pendingPlanClarification: { workspaceId: string; originalContent: string } | null;
  renderedPlanCardIds: string[];
  activeExecution: ActivePlanExecution | null;
  goal: GoalState | null;
  steps: PlanProgressItem[];
  status: PlanProgressUpdate["status"];
  lastError: string | null;
  clearError: () => void;
  setEnabled: (workspaceId: string | undefined, enabled: boolean) => void;
  setCard: (card: PlanCard) => void;
  setDecisionRequest: (request: PlanDecisionRequest | null) => void;
  setPendingPlanClarification: (request: { workspaceId: string; originalContent: string } | null) => void;
  markPlanCardRendered: (cardId: string) => void;
  startPlanning: () => void;
  setAwaitingConfirmation: (input: { activePlanId: string; title: string; filename?: string; sourceMessageId?: string }) => void;
  startExecution: (input: { activePlanId: string; title: string; filename?: string; sourceMessageId?: string; executionMessageId?: string }) => void;
  setExecutionMessageId: (messageId: string) => void;
  markPausing: () => void;
  markPaused: () => void;
  markCompleted: () => void;
  markFailed: () => void;
  clearPlanFlow: () => void;
  setProgress: (update: PlanProgressUpdate) => void;
  setGoal: (goal: GoalState | null) => void;
  reset: () => void;
}

function stepsFromMarkdown(content: string): PlanProgressItem[] {
  const matches: Array<PlanProgressItem | null> = content
    .split(/\r?\n/)
    .map((line, index) => {
      const task = line.match(/^\s*(?:(?:[-*]|\d+\.)\s+|(?:步骤|Step)\s*\d+\s*[：:.]\s*)(?:\[[ xX]\]\s*)?(.+)/i);
      if (!task) return null;
      const done = /\[[xX]\]|\[DONE:\d+\]/.test(line);
      return {
        id: `plan_md_${index}`,
        text: task[1].trim(),
        status: done ? "completed" : "pending",
      } satisfies PlanProgressItem;
    });
  return matches.filter((item): item is PlanProgressItem => item !== null).slice(0, 12);
}

function stripInlineThinking(content: string): string {
  return content
    .replace(/<think[\s\S]*?<\/think>/gi, "")
    .replace(/<think[\s\S]*$/gi, "")
    .trim();
}

export const usePlanStore = create<PlanState>((set, get) => ({
  enabled: false,
  activeCard: null,
  decisionRequest: null,
  pendingPlanClarification: null,
  renderedPlanCardIds: [],
  activeExecution: null,
  goal: null,
  steps: [],
  status: "idle",
  lastError: null,
  clearError: () => set({ lastError: null }),

  setEnabled: (workspaceId, enabled) => {
    const previousEnabled = get().enabled;
    set({ enabled, lastError: null, ...(enabled ? {} : { pendingPlanClarification: null }) });
    if (workspaceId && window.piAPI?.planSetEnabled) {
      const result = window.piAPI.planSetEnabled(workspaceId, enabled);
      if (result && typeof result.then === "function") {
        result.then((res) => {
          if (res !== undefined) {
            set({ enabled: previousEnabled, lastError: typeof res === 'string' ? res : '计划模式切换失败' });
          }
        }).catch((err) => {
          set({ enabled: previousEnabled, lastError: err instanceof Error ? err.message : '计划模式切换失败' });
        });
      }
    }
  },

  setCard: (card) => {
    const cleanCard = {
      ...card,
      content: stripInlineThinking(card.content),
    };
    set((state) => ({
      activeCard: cleanCard,
      steps: stepsFromMarkdown(cleanCard.content),
      status: "waiting_decision",
      activeExecution: {
        activePlanId: cleanCard.id,
        title: cleanCard.title,
        filename: cleanCard.filename,
        phase: "awaiting_confirmation",
      },
      decisionRequest: state.decisionRequest && !state.decisionRequest.card
        ? state.decisionRequest
        : {
            requestId: `plan_decision_${cleanCard.id}`,
            card: cleanCard,
            source: "plan",
            createdAt: Date.now(),
          },
    }));
  },

  setDecisionRequest: (request) => set({ decisionRequest: request }),

  setPendingPlanClarification: (request) => set({ pendingPlanClarification: request }),

  markPlanCardRendered: (cardId) => set((state) => ({
    renderedPlanCardIds: state.renderedPlanCardIds.includes(cardId)
      ? state.renderedPlanCardIds
      : [...state.renderedPlanCardIds, cardId],
  })),

  startPlanning: () => set({
    activeExecution: null,
    status: "idle",
  }),

  setAwaitingConfirmation: (input) => set((state) => ({
    activeExecution: {
      ...state.activeExecution,
      activePlanId: input.activePlanId,
      title: input.title,
      filename: input.filename,
      sourceMessageId: input.sourceMessageId,
      phase: "awaiting_confirmation",
    },
    status: "waiting_decision",
  })),

  startExecution: (input) => set({
    activeExecution: {
      activePlanId: input.activePlanId,
      title: input.title,
      filename: input.filename,
      sourceMessageId: input.sourceMessageId,
      executionMessageId: input.executionMessageId,
      phase: "executing",
    },
    status: "executing",
  }),

  setExecutionMessageId: (messageId) => set((state) => ({
    activeExecution: state.activeExecution
      ? { ...state.activeExecution, executionMessageId: messageId }
      : null,
  })),

  markPausing: () => set((state) => ({
    activeExecution: state.activeExecution
      ? { ...state.activeExecution, phase: "pausing" }
      : null,
    status: "executing",
  })),

  markPaused: () => set((state) => ({
    activeExecution: state.activeExecution
      ? { ...state.activeExecution, phase: "paused" }
      : null,
    status: "waiting_decision",
  })),

  markCompleted: () => set((state) => ({
    activeExecution: state.activeExecution
      ? { ...state.activeExecution, phase: "completed" }
      : null,
    status: "completed",
  })),

  markFailed: () => set((state) => ({
    activeExecution: state.activeExecution
      ? { ...state.activeExecution, phase: "failed" }
      : null,
    status: "idle",
  })),

  clearPlanFlow: () => set({
    activeCard: null,
    decisionRequest: null,
    pendingPlanClarification: null,
    activeExecution: null,
    steps: [],
    status: "idle",
  }),

  setProgress: (update) => {
    set({
      steps: update.items.length > 0 ? update.items : get().steps,
      status: update.status ?? get().status,
    });
  },

  setGoal: (goal) => set({ goal: goal?.status === "cleared" ? null : goal }),

  reset: () => set({ activeCard: null, decisionRequest: null, pendingPlanClarification: null, renderedPlanCardIds: [], activeExecution: null, goal: null, steps: [], status: "idle" }),
}));

let subscribed = false;
const unsubscribers: Array<() => void> = [];

export function ensurePlanSubscriptions(): void {
  if (subscribed || !window.piAPI?.onPlanCard) return;
  subscribed = true;
  unsubscribers.push(window.piAPI.onPlanCard((card) => usePlanStore.getState().setCard(card)));
  unsubscribers.push(window.piAPI.onPlanDecisionRequest((request) => usePlanStore.getState().setDecisionRequest(request)));
  unsubscribers.push(window.piAPI.onPlanProgress((update) => usePlanStore.getState().setProgress(update)));
  const offGoal = window.piAPI.onGoalChanged?.((goal) => usePlanStore.getState().setGoal(goal));
  if (typeof offGoal === "function") unsubscribers.push(offGoal);
}

/** 退订所有 plan 订阅, 供测试 / AppShell 重挂时重置. */
export function cleanupPlanSubscriptions(): void {
  for (const off of unsubscribers) {
    try { off(); } catch { /* ignore */ }
  }
  unsubscribers.length = 0;
  subscribed = false;
}
