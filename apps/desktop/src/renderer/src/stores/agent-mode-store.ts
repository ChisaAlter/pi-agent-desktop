import { create } from "zustand";
import type { AgentMode } from "@shared";

interface AgentModeState {
  byWorkspace: Record<string, AgentMode>;
  getMode: (workspaceId?: string | null, fallback?: AgentMode) => AgentMode;
  setMode: (workspaceId: string, mode: AgentMode) => void;
}

function normalizeAgentMode(value: unknown): AgentMode {
  return value === "plan" || value === "compose" || value === "max" ? value : "build";
}

function loadModes(): Record<string, AgentMode> {
  if (typeof localStorage === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem("pi-agent-modes") ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).map(([workspaceId, mode]) => [workspaceId, normalizeAgentMode(mode)]),
    );
  } catch {
    return {};
  }
}

function persistModes(modes: Record<string, AgentMode>): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem("pi-agent-modes", JSON.stringify(modes));
}

export const useAgentModeStore = create<AgentModeState>((set, get) => ({
  byWorkspace: loadModes(),
  getMode: (workspaceId, fallback = "build") => {
    if (!workspaceId) return normalizeAgentMode(fallback);
    return get().byWorkspace[workspaceId] ?? normalizeAgentMode(fallback);
  },
  setMode: (workspaceId, mode) => {
    const next = {
      ...get().byWorkspace,
      [workspaceId]: normalizeAgentMode(mode),
    };
    set({ byWorkspace: next });
    persistModes(next);
  },
}));
