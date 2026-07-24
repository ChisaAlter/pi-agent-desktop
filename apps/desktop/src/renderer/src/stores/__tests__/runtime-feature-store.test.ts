import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clampAgentModeByRuntime,
  isRuntimeFeatureEnabled,
  supportedAgentModes,
  useRuntimeFeatureStore,
} from "../runtime-feature-store";
import type { MiMoCodeRuntimeFeatureState } from "@shared";

function featureToggle(supported: boolean, enabled: boolean) {
  return { supported, enabled };
}

function makeFeatureState(
  overrides: Partial<MiMoCodeRuntimeFeatureState["features"]> = {},
): MiMoCodeRuntimeFeatureState {
  const base = {
    planMode: featureToggle(true, true),
    composeMode: featureToggle(true, true),
    memory: featureToggle(true, true),
    history: featureToggle(true, true),
    checkpoint: featureToggle(true, false),
    goal: featureToggle(false, true),
    task: featureToggle(true, true),
    actor: featureToggle(true, true),
    subagents: featureToggle(true, true),
  };
  return {
    features: { ...base, ...overrides },
  } as MiMoCodeRuntimeFeatureState;
}

describe("supportedAgentModes", () => {
  it("falls back to longHorizon settings when featureState is null", () => {
    expect(supportedAgentModes(null, { enabled: false })).toEqual(["build"]);
    expect(
      supportedAgentModes(null, {
        enabled: true,
        planMode: { enabled: true },
        composeMode: { enabled: false },
      }),
    ).toEqual(["build", "plan"]);
    expect(
      supportedAgentModes(null, {
        enabled: true,
        planMode: { enabled: true },
        composeMode: { enabled: true },
      }),
    ).toEqual(["build", "plan", "compose"]);
  });

  it("requires both supported and enabled on runtime feature state", () => {
    expect(
      supportedAgentModes(
        makeFeatureState({
          planMode: featureToggle(true, false),
          composeMode: featureToggle(false, true),
        }),
      ),
    ).toEqual(["build"]);
    expect(supportedAgentModes(makeFeatureState())).toEqual(["build", "plan", "compose"]);
  });
});

describe("clampAgentModeByRuntime", () => {
  it("keeps requested mode when available", () => {
    expect(clampAgentModeByRuntime("plan", makeFeatureState(), null)).toBe("plan");
  });

  it("falls back when requested mode unavailable", () => {
    const state = makeFeatureState({
      planMode: featureToggle(false, false),
      composeMode: featureToggle(false, false),
    });
    expect(clampAgentModeByRuntime("plan", state, null, "compose")).toBe("build");
  });

  it("normalizes unknown values to build then clamps", () => {
    expect(clampAgentModeByRuntime("weird", null, { enabled: false })).toBe("build");
  });

  it("uses fallback when present in available set", () => {
    const state = makeFeatureState({
      planMode: featureToggle(false, false),
      composeMode: featureToggle(true, true),
    });
    expect(clampAgentModeByRuntime("plan", state, null, "compose")).toBe("compose");
  });
});

describe("isRuntimeFeatureEnabled", () => {
  it("uses longHorizon when featureState is null", () => {
    expect(
      isRuntimeFeatureEnabled(null, { enabled: true, memory: { enabled: true } }, "memory"),
    ).toBe(true);
    expect(
      isRuntimeFeatureEnabled(null, { enabled: false, memory: { enabled: true } }, "memory"),
    ).toBe(false);
  });

  it("requires supported+enabled on feature state", () => {
    const state = makeFeatureState({
      checkpoint: featureToggle(true, false),
      goal: featureToggle(false, true),
      task: featureToggle(true, true),
    });
    expect(isRuntimeFeatureEnabled(state, null, "checkpoint")).toBe(false);
    expect(isRuntimeFeatureEnabled(state, null, "goal")).toBe(false);
    expect(isRuntimeFeatureEnabled(state, null, "task")).toBe(true);
  });
});

describe("useRuntimeFeatureStore.refresh", () => {
  beforeEach(() => {
    useRuntimeFeatureStore.setState({
      featureState: null,
      loading: false,
      lastError: null,
      lastLoadedAt: null,
    });
    vi.unstubAllGlobals();
  });

  it("loads feature state from piAPI", async () => {
    const state = makeFeatureState();
    vi.stubGlobal("window", {
      piAPI: {
        runtimeFeatureState: vi.fn(async () => state),
      },
    });
    const result = await useRuntimeFeatureStore.getState().refresh();
    expect(result).toEqual(state);
    expect(useRuntimeFeatureStore.getState().featureState).toEqual(state);
    expect(useRuntimeFeatureStore.getState().lastError).toBeNull();
    expect(useRuntimeFeatureStore.getState().loading).toBe(false);
    expect(useRuntimeFeatureStore.getState().lastLoadedAt).toBeTypeOf("number");
  });

  it("records IPC errors without clearing existing state", async () => {
    const existing = makeFeatureState();
    useRuntimeFeatureStore.setState({ featureState: existing });
    vi.stubGlobal("window", {
      piAPI: {
        runtimeFeatureState: vi.fn(async () => ({
          code: "ERR",
          fallback: "runtime unavailable",
        })),
      },
    });
    const result = await useRuntimeFeatureStore.getState().refresh();
    expect(result).toEqual(existing);
    expect(useRuntimeFeatureStore.getState().lastError).toBe("runtime unavailable");
    expect(useRuntimeFeatureStore.getState().loading).toBe(false);
  });

  it("clearError resets lastError", () => {
    useRuntimeFeatureStore.setState({ lastError: "x" });
    useRuntimeFeatureStore.getState().clearError();
    expect(useRuntimeFeatureStore.getState().lastError).toBeNull();
  });

  // wave-110 residual
  it("returns existing state when runtimeFeatureState API is missing", async () => {
    const existing = makeFeatureState();
    useRuntimeFeatureStore.setState({ featureState: existing, lastError: null });
    vi.stubGlobal("window", { piAPI: {} });
    const result = await useRuntimeFeatureStore.getState().refresh();
    expect(result).toEqual(existing);
    expect(useRuntimeFeatureStore.getState().loading).toBe(false);
    expect(useRuntimeFeatureStore.getState().lastError).toBeNull();
  });

  it("records thrown errors as lastError string", async () => {
    const existing = makeFeatureState();
    useRuntimeFeatureStore.setState({ featureState: existing });
    vi.stubGlobal("window", {
      piAPI: {
        runtimeFeatureState: vi.fn(async () => {
          throw new Error("network down");
        }),
      },
    });
    const result = await useRuntimeFeatureStore.getState().refresh();
    expect(result).toEqual(existing);
    expect(useRuntimeFeatureStore.getState().lastError).toBe("network down");
    expect(useRuntimeFeatureStore.getState().loading).toBe(false);
  });

  it("stringifies non-Error throws", async () => {
    vi.stubGlobal("window", {
      piAPI: {
        runtimeFeatureState: vi.fn(async () => {
          throw "plain-fail";
        }),
      },
    });
    await useRuntimeFeatureStore.getState().refresh();
    expect(useRuntimeFeatureStore.getState().lastError).toBe("plain-fail");
  });

  // wave-120 residual
  it("supportedAgentModes ignores longHorizon when featureState is present", () => {
    const state = makeFeatureState({
      planMode: featureToggle(true, true),
      composeMode: featureToggle(false, false),
    });
    // longHorizon would enable compose, but featureState takes precedence
    expect(
      supportedAgentModes(state, {
        enabled: true,
        planMode: { enabled: true },
        composeMode: { enabled: true },
      }),
    ).toEqual(["build", "plan"]);
  });

  it("isRuntimeFeatureEnabled for actor/history/subagents uses feature flags", () => {
    const state = makeFeatureState({
      actor: featureToggle(true, false),
      history: featureToggle(true, true),
      subagents: featureToggle(false, true),
    });
    expect(isRuntimeFeatureEnabled(state, null, "actor")).toBe(false);
    expect(isRuntimeFeatureEnabled(state, null, "history")).toBe(true);
    expect(isRuntimeFeatureEnabled(state, null, "subagents")).toBe(false);
  });

  it("clampAgentModeByRuntime prefers requested when both requested and fallback available", () => {
    const state = makeFeatureState();
    expect(clampAgentModeByRuntime("compose", state, null, "plan")).toBe("compose");
    expect(clampAgentModeByRuntime("plan", state, null, "compose")).toBe("plan");
  });

  it("refresh sets loading false after success and updates lastLoadedAt", async () => {
    const state = makeFeatureState();
    vi.stubGlobal("window", {
      piAPI: {
        runtimeFeatureState: vi.fn(async () => state),
      },
    });
    useRuntimeFeatureStore.setState({ loading: true, lastLoadedAt: null });
    await useRuntimeFeatureStore.getState().refresh();
    const next = useRuntimeFeatureStore.getState();
    expect(next.loading).toBe(false);
    expect(next.lastLoadedAt).toEqual(expect.any(Number));
    expect(next.featureState).toEqual(state);
  });

  // wave-130 residual
  it("clampAgentModeByRuntime falls back to build when neither requested nor fallback available", () => {
    const state = makeFeatureState({
      planMode: featureToggle(false, false),
      composeMode: featureToggle(false, false),
    });
    expect(clampAgentModeByRuntime("plan", state, null, "compose")).toBe("build");
    expect(clampAgentModeByRuntime("compose", state, null, "plan")).toBe("build");
  });

  it("clamp treats unknown values as build", () => {
    const state = makeFeatureState();
    expect(clampAgentModeByRuntime("weird", state, null, "plan")).toBe("build");
    expect(clampAgentModeByRuntime(null, state, null, "compose")).toBe("build");
  });

  it("clearError clears lastError only", () => {
    const state = makeFeatureState();
    useRuntimeFeatureStore.setState({
      featureState: state,
      lastError: "stale",
      loading: false,
      lastLoadedAt: 123,
    });
    useRuntimeFeatureStore.getState().clearError();
    expect(useRuntimeFeatureStore.getState()).toMatchObject({
      featureState: state,
      lastError: null,
      lastLoadedAt: 123,
    });
  });

  it("refresh IpcError keeps prior featureState and sets lastError", async () => {
    const { ipcError } = await import("@shared");
    const prior = makeFeatureState();
    useRuntimeFeatureStore.setState({
      featureState: prior,
      lastError: null,
      loading: false,
    });
    vi.stubGlobal("window", {
      piAPI: {
        runtimeFeatureState: vi.fn(async () =>
          ipcError("ipcErrors.runtime.featureFailed", "feature failed"),
        ),
      },
    });
    const result = await useRuntimeFeatureStore.getState().refresh();
    expect(result).toEqual(prior);
    expect(useRuntimeFeatureStore.getState().loading).toBe(false);
    expect(useRuntimeFeatureStore.getState().lastError).toBe("feature failed");
    expect(useRuntimeFeatureStore.getState().featureState).toEqual(prior);
  });

  // wave-240 residual
  it("isRuntimeFeatureEnabled null featureState requires longHorizon master + feature toggle", () => {
    const features = ["memory", "history", "checkpoint", "goal", "task", "actor", "subagents"] as const;
    for (const feature of features) {
      expect(isRuntimeFeatureEnabled(null, { enabled: true, [feature]: { enabled: true } }, feature)).toBe(
        true,
      );
      expect(isRuntimeFeatureEnabled(null, { enabled: true, [feature]: { enabled: false } }, feature)).toBe(
        false,
      );
      expect(isRuntimeFeatureEnabled(null, { enabled: false, [feature]: { enabled: true } }, feature)).toBe(
        false,
      );
    }
  });

  it("supportedAgentModes null longHorizon uses defaults (plan+compose on when LH enabled default)", () => {
    // normalizeLongHorizonSettings(null) → DEFAULT with plan/compose enabled
    expect(supportedAgentModes(null, null)).toEqual(["build", "plan", "compose"]);
    expect(supportedAgentModes(null, undefined)).toEqual(["build", "plan", "compose"]);
    expect(supportedAgentModes(null, { enabled: true })).toEqual(["build", "plan", "compose"]);
  });

  it("clampAgentModeByRuntime uses normalized fallback only when requested unavailable", () => {
    const state = makeFeatureState({
      planMode: featureToggle(false, false),
      composeMode: featureToggle(true, true),
    });
    // requested plan unavailable → fallback compose available
    expect(clampAgentModeByRuntime("plan", state, null, "compose")).toBe("compose");
    // both unavailable → build
    const none = makeFeatureState({
      planMode: featureToggle(false, false),
      composeMode: featureToggle(false, false),
    });
    expect(clampAgentModeByRuntime("plan", none, null, "compose")).toBe("build");
    // weird requested + weird fallback both normalize to build
    expect(clampAgentModeByRuntime("weird", state, null, "also-weird" as never)).toBe("build");
  });

  it("refresh without window.piAPI returns current featureState and does not set loading true permanently", async () => {
    const prior = makeFeatureState();
    useRuntimeFeatureStore.setState({
      featureState: prior,
      loading: false,
      lastError: "stale",
    });
    vi.stubGlobal("window", {});
    const result = await useRuntimeFeatureStore.getState().refresh();
    expect(result).toEqual(prior);
    expect(useRuntimeFeatureStore.getState().loading).toBe(false);
    // missing API early-return does not clear lastError
    expect(useRuntimeFeatureStore.getState().lastError).toBe("stale");
  });



  // wave-307 residual
  describe("runtime-feature pure residual (wave-307)", () => {
    it("supportedAgentModes requires supported AND enabled for plan/compose; build always present", () => {
      const both = makeFeatureState({
        planMode: featureToggle(true, true),
        composeMode: featureToggle(true, true),
      });
      expect(supportedAgentModes(both)).toEqual(["build", "plan", "compose"]);
      const planOnly = makeFeatureState({
        planMode: featureToggle(true, true),
        composeMode: featureToggle(true, false),
      });
      expect(supportedAgentModes(planOnly)).toEqual(["build", "plan"]);
      const composeSupportedOff = makeFeatureState({
        planMode: featureToggle(false, true),
        composeMode: featureToggle(true, true),
      });
      // plan supported=false even if enabled → no plan
      expect(supportedAgentModes(composeSupportedOff)).toEqual(["build", "compose"]);
      const none = makeFeatureState({
        planMode: featureToggle(false, false),
        composeMode: featureToggle(false, false),
      });
      expect(supportedAgentModes(none)).toEqual(["build"]);
    });

    it("clampAgentModeByRuntime normalizes requested; falls back then build", () => {
      const state = makeFeatureState({
        planMode: featureToggle(true, true),
        composeMode: featureToggle(false, false),
      });
      expect(clampAgentModeByRuntime("plan", state)).toBe("plan");
      // product normalizeAgentMode is exact enum match — unknown casing falls to build
      expect(clampAgentModeByRuntime("PLAN", state)).toBe("build");
      expect(clampAgentModeByRuntime("compose", state, null, "plan")).toBe("plan");
      expect(clampAgentModeByRuntime("compose", state, null, "compose")).toBe("build");
      expect(clampAgentModeByRuntime("nope", null, { enabled: true, planMode: { enabled: false }, composeMode: { enabled: false } }, "plan")).toBe("build");
    });

    it("isRuntimeFeatureEnabled uses featureState toggle when present; ignores longHorizon when featureState set", () => {
      const state = makeFeatureState({
        memory: featureToggle(true, true),
        goal: featureToggle(true, false),
      });
      // longHorizon would say goal on, but featureState wins
      expect(
        isRuntimeFeatureEnabled(state, { enabled: true, goal: { enabled: true } }, "goal"),
      ).toBe(false);
      expect(
        isRuntimeFeatureEnabled(state, { enabled: false, memory: { enabled: false } }, "memory"),
      ).toBe(true);
      expect(isRuntimeFeatureEnabled(null, { enabled: true, history: { enabled: true } }, "history")).toBe(true);
      expect(isRuntimeFeatureEnabled(null, { enabled: true, history: { enabled: false } }, "history")).toBe(false);
    });
  });

});
