import { create } from "zustand";
import type { PiEvent, PiQueueUpdate } from "@shared/events";
import { createSubscriptionManager } from "../utils/subscription-manager";

export type QueueTaskStatus = "running" | "waiting" | "pending" | "completed" | "error";

export interface QueueTaskItem {
  id: string;
  label: string;
  meta: string;
  status: QueueTaskStatus;
  updatedAt: number;
}

export interface QueueSnapshot {
  steering: string[];
  followUp: string[];
  items: QueueTaskItem[];
  updatedAt: number | null;
  running: boolean;
  autoRetrying: boolean;
  lastActivity: string | null;
  lastError: string | null;
  lastCompletedAt: number | null;
}

interface QueueState extends QueueSnapshot {
  applyEvent: (event: PiEvent) => void;
  clear: () => void;
}

function upsertQueueItem(items: QueueTaskItem[], next: QueueTaskItem): QueueTaskItem[] {
  const filtered = items.filter((item) => item.id !== next.id);
  return [next, ...filtered].slice(0, 12);
}

export const useQueueStore = create<QueueState>((set) => ({
  steering: [],
  followUp: [],
  items: [],
  updatedAt: null,
  running: false,
  autoRetrying: false,
  lastActivity: null,
  lastError: null,
  lastCompletedAt: null,
  applyEvent: (event) => {
    if (event.type === "agent_start" || event.type === "turn_start") {
      const now = Date.now();
      const label = event.type === "agent_start" ? "Agent 已开始" : "Turn 已开始";
      set((state) => ({
        running: true,
        lastError: null,
        lastActivity: label,
        updatedAt: now,
        items: upsertQueueItem(state.items, {
          id: "queue:running",
          label: "当前任务运行中",
          meta: event.type === "agent_start" ? "Agent" : "Turn",
          status: "running",
          updatedAt: now,
        }),
      }));
      return;
    }
    if (event.type === "agent_end" || event.type === "turn_end") {
      const now = Date.now();
      const label = event.type === "agent_end" ? "Agent 已结束" : "Turn 已结束";
      set((state) => ({
        running: false,
        autoRetrying: false,
        lastActivity: label,
        lastCompletedAt: now,
        updatedAt: now,
        items: upsertQueueItem(state.items, {
          id: "queue:running",
          label: "当前任务已完成",
          meta: event.type === "agent_end" ? "Agent" : "Turn",
          status: "completed",
          updatedAt: now,
        }),
      }));
      return;
    }
    if (event.type === "auto_retry_start") {
      const now = Date.now();
      set((state) => ({
        running: true,
        autoRetrying: true,
        lastActivity: "自动重试中",
        updatedAt: now,
        items: upsertQueueItem(state.items, {
          id: "queue:auto-retry",
          label: "自动重试中",
          meta: "Auto retry",
          status: "running",
          updatedAt: now,
        }),
      }));
      return;
    }
    if (event.type === "auto_retry_end") {
      const now = Date.now();
      set((state) => ({
        autoRetrying: false,
        lastActivity: "自动重试结束",
        updatedAt: now,
        items: upsertQueueItem(state.items, {
          id: "queue:auto-retry",
          label: "自动重试结束",
          meta: "Auto retry",
          status: "completed",
          updatedAt: now,
        }),
      }));
      return;
    }
    if (event.type === "tool_execution_start" || event.type === "tool_execution_update") {
      const name = event.toolName.trim() ? event.toolName : "工具";
      const now = Date.now();
      set((state) => ({
        running: true,
        lastActivity: `${name} 运行中`,
        updatedAt: now,
        items: upsertQueueItem(state.items, {
          id: `tool:${event.toolCallId}`,
          label: `${name} 运行中`,
          meta: "Tool",
          status: "running",
          updatedAt: now,
        }),
      }));
      return;
    }
    if (event.type === "tool_execution_end") {
      const name = event.toolName.trim() ? event.toolName : "工具";
      const isError = event.isError === true;
      const now = Date.now();
      set((state) => ({
        lastActivity: `${name} ${isError ? "失败" : "完成"}`,
        lastError: isError ? `${name} 执行失败` : null,
        updatedAt: now,
        items: upsertQueueItem(state.items, {
          id: `tool:${event.toolCallId}`,
          label: `${name} ${isError ? "失败" : "完成"}`,
          meta: "Tool",
          status: isError ? "error" : "completed",
          updatedAt: now,
        }),
      }));
      return;
    }
    if (event.type === "extension_error") {
      const record = event as Record<string, unknown>;
      const message = record.message ?? record.error ?? record.reason;
      const now = Date.now();
      const text = typeof message === "string" && message.trim() ? message : "任务运行时出现扩展错误";
      set((state) => ({
        running: false,
        autoRetrying: false,
        lastActivity: "扩展错误",
        lastError: text,
        updatedAt: now,
        items: upsertQueueItem(state.items, {
          id: "queue:running",
          label: text,
          meta: "Error",
          status: "error",
          updatedAt: now,
        }),
      }));
      return;
    }
    if (event.type !== "queue_update") return;
    const queue = event as PiQueueUpdate;
    const now = Date.now();
    const queuedItems = [
      ...queue.steering.slice(0, 6).map((item, index): QueueTaskItem => ({
        id: `queue:steer:${index}:${item}`,
        label: item,
        meta: "Steer",
        status: "waiting",
        updatedAt: now,
      })),
      ...queue.followUp.slice(0, 6).map((item, index): QueueTaskItem => ({
        id: `queue:follow:${index}:${item}`,
        label: item,
        meta: "Follow-up",
        status: "pending",
        updatedAt: now,
      })),
    ];
    set((state) => ({
      steering: [...queue.steering],
      followUp: [...queue.followUp],
      lastActivity: queue.steering.length > 0 || queue.followUp.length > 0 ? "队列已更新" : null,
      updatedAt: now,
      items: [
        ...queuedItems,
        ...state.items.filter((item) => !item.id.startsWith("queue:steer:") && !item.id.startsWith("queue:follow:")),
      ].slice(0, 12),
    }));
  },
  clear: () => set({ steering: [], followUp: [], items: [], updatedAt: null, running: false, autoRetrying: false, lastActivity: null, lastError: null, lastCompletedAt: null }),
}));

const { ensure, cleanup } = createSubscriptionManager();

export function ensureQueueSubscription(): void {
  if (typeof window === "undefined" || !window.piAPI?.onEvent) return;
  ensure(() => window.piAPI!.onEvent((event) => {
    useQueueStore.getState().applyEvent(event);
  }));
}

/** 退订 queue 事件, 供测试 / AppShell 重挂时重置. */
export function cleanupQueueSubscription(): void {
  cleanup();
}
