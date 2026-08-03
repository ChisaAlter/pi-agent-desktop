import { create } from "zustand";
import type { ExtensionUiRequest, PermissionDecision, PermissionMode } from "@shared";
import { logger } from "../utils/logger";
import { createSubscriptionManager } from "../utils/subscription-manager";

interface PermissionState {
  mode: PermissionMode;
  pending: ExtensionUiRequest[];
  setMode: (mode: PermissionMode, workspaceId?: string) => void;
  enqueue: (request: ExtensionUiRequest) => void;
  respond: (requestId: string, decision: PermissionDecision) => void;
  respondValue: (requestId: string, value: string | boolean) => void;
  dismiss: (requestId: string) => void;
}

export const usePermissionStore = create<PermissionState>((set, get) => ({
  mode: "smart",
  pending: [],

  setMode: (mode, workspaceId) => {
    set({ mode });
    // 生产要求：尽量传 workspaceId，避免全局污染其他工作区权限
    window.piAPI?.permissionSetMode(mode, workspaceId).catch((err) => {
      logger.error("[permission-store] set mode failed:", err);
    });
  },

  enqueue: (request) => {
    set((state) => ({
      pending: state.pending.some((item) => item.requestId === request.requestId)
        ? state.pending
        : [...state.pending, request],
    }));
  },

  respond: (requestId, decision) => {
    const request = get().pending.find((item) => item.requestId === requestId);
    if (!request) return;
    // permissionRespond 内部用 ipcRenderer.send (fire-and-forget), 但 send 可能因
    // webContents 已销毁等同步抛错; 包 try/catch 避免静默丢失 + 记录失败.
    try {
      window.piAPI?.permissionRespond(requestId, { requestId, decision });
    } catch (err) {
      logger.error("[permission-store] respond failed:", err);
    }
    get().dismiss(requestId);
  },

  respondValue: (requestId, value) => {
    const request = get().pending.find((item) => item.requestId === requestId);
    if (!request) return;
    try {
      window.piAPI?.permissionRespond(requestId, { requestId, value });
    } catch (err) {
      logger.error("[permission-store] value response failed:", err);
    }
    get().dismiss(requestId);
  },

  dismiss: (requestId) => {
    set((state) => ({ pending: state.pending.filter((item) => item.requestId !== requestId) }));
  },
}));

const { ensure, cleanup } = createSubscriptionManager();

export function ensurePermissionSubscriptions(): void {
  if (!window.piAPI?.onPermissionRequest) return;
  ensure(() => {
    const off = window.piAPI!.onPermissionRequest((request) => {
      usePermissionStore.getState().enqueue(request);
    });
    // onPermissionRequest 可能返回 unsubscribe 函数; 否则仅记录用于测试期重置
    return typeof off === "function" ? off : undefined;
  });
}

/** 退订 onPermissionRequest, 供测试 / AppShell 重挂时重置 (生产环境通常不需调用). */
export function cleanupPermissionSubscriptions(): void {
  cleanup();
}
