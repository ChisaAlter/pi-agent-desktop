import { create } from "zustand";
import {
  isIpcError,
  normalizeLongHorizonSettings,
  type AgentMode,
  type LongHorizonSettings,
  type MiMoCodeRuntimeFeatureState,
} from "@shared";

interface RuntimeFeatureState {
  featureState: MiMoCodeRuntimeFeatureState | null;
  loading: boolean;
  lastError: string | null;
  lastLoadedAt: number | null;
  refresh: () => Promise<MiMoCodeRuntimeFeatureState | null>;
  clearError: () => void;
}

function normalizeAgentMode(value: unknown): AgentMode {
  return value === "plan" || value === "compose" ? value : "build";
}

function fallbackAgentModes(longHorizonValue?: Partial<LongHorizonSettings> | null): AgentMode[] {
  const longHorizon = normalizeLongHorizonSettings(longHorizonValue);
  if (!longHorizon.enabled) return ["build"];
  return [
    "build",
    ...(longHorizon.planMode.enabled ? ["plan" as const] : []),
    ...(longHorizon.composeMode.enabled ? ["compose" as const] : []),
  ];
}

export function supportedAgentModes(
  featureState: MiMoCodeRuntimeFeatureState | null,
  longHorizonValue?: Partial<LongHorizonSettings> | null,
): AgentMode[] {
  if (!featureState) return fallbackAgentModes(longHorizonValue);
  return [
    "build",
    ...(featureState.features.planMode.supported && featureState.features.planMode.enabled ? ["plan" as const] : []),
    ...(featureState.features.composeMode.supported && featureState.features.composeMode.enabled ? ["compose" as const] : []),
  ];
}

export function clampAgentModeByRuntime(
  value: unknown,
  featureState: MiMoCodeRuntimeFeatureState | null,
  longHorizonValue?: Partial<LongHorizonSettings> | null,
  fallback: AgentMode = "build",
): AgentMode {
  const requested = normalizeAgentMode(value);
  const normalizedFallback = normalizeAgentMode(fallback);
  const available = new Set(supportedAgentModes(featureState, longHorizonValue));
  if (available.has(requested)) return requested;
  if (available.has(normalizedFallback)) return normalizedFallback;
  return "build";
}

export function isRuntimeFeatureEnabled(
  featureState: MiMoCodeRuntimeFeatureState | null,
  longHorizonValue: Partial<LongHorizonSettings> | null | undefined,
  feature:
    | "memory"
    | "history"
    | "checkpoint"
    | "goal"
    | "task"
    | "actor"
    | "subagents",
): boolean {
  if (!featureState) {
    const longHorizon = normalizeLongHorizonSettings(longHorizonValue);
    return longHorizon.enabled && longHorizon[feature].enabled;
  }
  const toggle = featureState.features[feature];
  return toggle.supported && toggle.enabled;
}

export const useRuntimeFeatureStore = create<RuntimeFeatureState>((set, get) => ({
  featureState: null,
  loading: false,
  lastError: null,
  lastLoadedAt: null,
  refresh: async () => {
    if (!window.piAPI?.runtimeFeatureState) return get().featureState;
    set({ loading: true });
    try {
      const result = await window.piAPI.runtimeFeatureState();
      if (isIpcError(result)) {
        set({ loading: false, lastError: result.fallback });
        return get().featureState;
      }
      set({
        featureState: result,
        loading: false,
        lastError: null,
        lastLoadedAt: Date.now(),
      });
      return result;
    } catch (error) {
      set({
        loading: false,
        lastError: error instanceof Error ? error.message : String(error),
      });
      return get().featureState;
    }
  },
  clearError: () => set({ lastError: null }),
}));
