import { create } from "zustand";
import { normalizeLongHorizonSettings, type AgentMode } from "@shared";
import { useRuntimeFeatureStore, clampAgentModeByRuntime } from "./runtime-feature-store";
import { useSettingsStore } from "./settings-store";

interface AgentModeState {
  byWorkspace: Record<string, AgentMode>;
  getMode: (workspaceId?: string | null, fallback?: AgentMode) => AgentMode;
  setMode: (workspaceId: string, mode: AgentMode) => void;
}

function normalizeAgentMode(value: unknown): AgentMode {
  return value === "plan" || value === "compose" ? value : "build";
}

function clampMode(mode: unknown, fallback: AgentMode = "build"): AgentMode {
  const longHorizon = normalizeLongHorizonSettings(useSettingsStore.getState().settings.longHorizon);
  const featureState = useRuntimeFeatureStore.getState().featureState;
  return clampAgentModeByRuntime(mode, featureState, longHorizon, fallback);
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
    const clampedFallback = clampMode(fallback);
    if (!workspaceId) return clampedFallback;
    return clampMode(get().byWorkspace[workspaceId] ?? clampedFallback, clampedFallback);
  },
  setMode: (workspaceId, mode) => {
    const nextMode = clampMode(mode);
    const next = {
      ...get().byWorkspace,
      [workspaceId]: nextMode,
    };
    set({ byWorkspace: next });
    persistModes(next);
  },
}));
