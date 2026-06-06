import { create } from "zustand";
import type { PlanCard, PlanDecisionRequest, PlanProgressItem, PlanProgressUpdate } from "@shared";

interface PlanState {
  enabled: boolean;
  activeCard: PlanCard | null;
  decisionRequest: PlanDecisionRequest | null;
  steps: PlanProgressItem[];
  status: PlanProgressUpdate["status"];
  setEnabled: (workspaceId: string | undefined, enabled: boolean) => void;
  setCard: (card: PlanCard) => void;
  setDecisionRequest: (request: PlanDecisionRequest | null) => void;
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

export const usePlanStore = create<PlanState>((set, get) => ({
  enabled: false,
  activeCard: null,
  decisionRequest: null,
  steps: [],
  status: "idle",

  setEnabled: (workspaceId, enabled) => {
    set({ enabled });
    if (workspaceId) {
      void window.piAPI?.planSetEnabled(workspaceId, enabled);
    }
  },

  setCard: (card) => {
    set((state) => ({
      activeCard: card,
      steps: stepsFromMarkdown(card.content),
      status: "waiting_decision",
      decisionRequest: state.decisionRequest && !state.decisionRequest.card
        ? state.decisionRequest
        : {
            requestId: `plan_decision_${card.id}`,
            card,
            source: "plan",
            createdAt: Date.now(),
          },
    }));
  },

  setDecisionRequest: (request) => set({ decisionRequest: request }),

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

  reset: () => set({ activeCard: null, decisionRequest: null, steps: [], status: "idle" }),
}));

let subscribed = false;

export function ensurePlanSubscriptions(): void {
  if (subscribed || !window.piAPI?.onPlanCard) return;
  subscribed = true;
  window.piAPI.onPlanCard((card) => usePlanStore.getState().setCard(card));
  window.piAPI.onPlanDecisionRequest((request) => usePlanStore.getState().setDecisionRequest(request));
  window.piAPI.onPlanProgress((update) => usePlanStore.getState().setProgress(update));
}
