import { create } from "zustand";
import type { ExtensionUiRequest, PermissionDecision, PermissionMode } from "@shared";
import { logger } from "../utils/logger";

interface PermissionState {
  mode: PermissionMode;
  pending: ExtensionUiRequest[];
  setMode: (mode: PermissionMode) => void;
  enqueue: (request: ExtensionUiRequest) => void;
  respond: (requestId: string, decision: PermissionDecision) => void;
  dismiss: (requestId: string) => void;
}

export const usePermissionStore = create<PermissionState>((set, get) => ({
  mode: "smart",
  pending: [],

  setMode: (mode) => {
    set({ mode });
    window.piAPI?.permissionSetMode(mode).catch((err) => {
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
    window.piAPI?.permissionRespond(requestId, { requestId, decision });
    get().dismiss(requestId);
  },

  dismiss: (requestId) => {
    set((state) => ({ pending: state.pending.filter((item) => item.requestId !== requestId) }));
  },
}));

let subscribed = false;

export function ensurePermissionSubscriptions(): void {
  if (subscribed || !window.piAPI?.onPermissionRequest) return;
  subscribed = true;
  window.piAPI.onPermissionRequest((request) => {
    usePermissionStore.getState().enqueue(request);
  });
}
