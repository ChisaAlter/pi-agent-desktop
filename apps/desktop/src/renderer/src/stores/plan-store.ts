import { create } from "zustand";
import type { PlanCard, PlanDecisionRequest, PlanProgressItem, PlanProgressUpdate } from "@shared";

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
  steps: PlanProgressItem[];
  status: PlanProgressUpdate["status"];
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
  applyDoneMarkers: (content: string) => void;
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
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/gi, "")
    .trim();
}

function isGenericPlanGuidance(content: string): boolean {
  const asksForGoal = /目标|范围|约束|验收标准|要解决什么问题|实现什么功能|直接描述项目背景|请告诉我你的目标/.test(content);
  const describesCapabilities = /你可以让我|阅读、编辑|重构|调试代码|分解需求|制定执行计划|调用 pi 技能/i.test(content);
  const hasConcretePlanTitle = /(^|\n)\s*#{1,6}\s*(实施计划|执行计划|实现计划|测试计划|迁移计划|修复计划|计划[：:])/.test(content);
  const hasExecutionSteps = /(^|\n)\s*(?:[-*]|\d+\.)\s+(?:修改|实现|新增|删除|运行|验证|测试|构建|修复|重构|更新|提交|检查)/.test(content);
  return (asksForGoal || describesCapabilities) && !hasConcretePlanTitle && !hasExecutionSteps;
}

export const usePlanStore = create<PlanState>((set, get) => ({
  enabled: false,
  activeCard: null,
  decisionRequest: null,
  pendingPlanClarification: null,
  renderedPlanCardIds: [],
  activeExecution: null,
  steps: [],
  status: "idle",

  setEnabled: (workspaceId, enabled) => {
    set({ enabled });
    if (workspaceId) {
      void window.piAPI?.planSetEnabled?.(workspaceId, enabled);
    }
  },

  setCard: (card) => {
    const cleanCard = {
      ...card,
      content: stripInlineThinking(card.content),
    };
    if (isGenericPlanGuidance(cleanCard.content)) {
      set({ activeCard: null, decisionRequest: null, steps: [], status: "idle" });
      return;
    }
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

  applyDoneMarkers: (content) => {
    const done = [...content.matchAll(/\[DONE:(\d+)\]/g)].map((match) => Number(match[1]));
    if (done.length === 0) return;
    set((state) => ({
      steps: state.steps.map((step, index) =>
        done.includes(index + 1) ? { ...step, status: "completed" } : step,
      ),
    }));
  },

  reset: () => set({ activeCard: null, decisionRequest: null, pendingPlanClarification: null, renderedPlanCardIds: [], activeExecution: null, steps: [], status: "idle" }),
}));

let subscribed = false;

export function ensurePlanSubscriptions(): void {
  if (subscribed || !window.piAPI?.onPlanCard) return;
  subscribed = true;
  window.piAPI.onPlanCard((card) => usePlanStore.getState().setCard(card));
  window.piAPI.onPlanDecisionRequest((request) => usePlanStore.getState().setDecisionRequest(request));
  window.piAPI.onPlanProgress((update) => usePlanStore.getState().setProgress(update));
}
