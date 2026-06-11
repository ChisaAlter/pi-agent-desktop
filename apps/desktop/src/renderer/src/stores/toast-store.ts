import { create } from "zustand";

export type ToastTone = "success" | "error" | "warning" | "info";

export interface Toast {
  id: string;
  message: string;
  tone: ToastTone;
  duration?: number; // ms, default 6000 for error, 3000 for others
  retryAction?: () => Promise<void> | void;
  createdAt: number;
}

interface ToastState {
  toasts: Toast[];
  addToast: (input: Omit<Toast, "id" | "createdAt">) => string;
  removeToast: (id: string) => void;
  clearAll: () => void;
}

let nextId = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  addToast: (input) => {
    const id = `toast_${++nextId}_${Date.now()}`;
    const toast: Toast = {
      ...input,
      id,
      createdAt: Date.now(),
      duration: input.duration ?? (input.tone === "error" ? 6000 : 3000),
    };
    set((state) => ({
      toasts: [...state.toasts.slice(-4), toast], // keep max 5 toasts
    }));
    return id;
  },

  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),

  clearAll: () => set({ toasts: [] }),
}));

/** Convenience helper — can be called from stores/hooks without importing the full store */
export function addToast(
  message: string,
  tone: ToastTone = "error",
  retryAction?: () => Promise<void> | void,
): string {
  return useToastStore.getState().addToast({ message, tone, retryAction });
}
