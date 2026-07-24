/**
 * Agent mode store — workspace-scoped mode + runtime/long-horizon clamp (UX residual).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings, MiMoCodeRuntimeFeatureState } from "@shared";

function createLocalStorageMock(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}

function featureState(opts: {
  plan?: boolean;
  compose?: boolean;
}): MiMoCodeRuntimeFeatureState {
  const plan = opts.plan ?? true;
  const compose = opts.compose ?? true;
  const on = (enabled: boolean) => ({ supported: true, enabled });
  return {
    features: {
      planMode: on(plan),
      composeMode: on(compose),
      memory: on(true),
      history: on(true),
      checkpoint: on(true),
      goal: on(true),
      task: on(true),
      actor: on(true),
      subagents: on(true),
    },
  } as MiMoCodeRuntimeFeatureState;
}

describe("useAgentModeStore", () => {
  beforeEach(() => {
    vi.resetModules();
    const localStorage = createLocalStorageMock();
    (globalThis as { localStorage: Storage }).localStorage = localStorage;
    (globalThis as { window: unknown }).window = {
      localStorage,
      piAPI: {},
    };
  });

  async function loadStores() {
    const { useSettingsStore } = await import("../settings-store");
    const { useRuntimeFeatureStore } = await import("../runtime-feature-store");
    const { useAgentModeStore } = await import("../agent-mode-store");
    return { useSettingsStore, useRuntimeFeatureStore, useAgentModeStore };
  }

  it("defaults to build when workspace has no stored mode", async () => {
    const { useAgentModeStore } = await loadStores();
    useAgentModeStore.setState({ byWorkspace: {} });
    expect(useAgentModeStore.getState().getMode("ws-a")).toBe("build");
  });

  it("persists mode per workspace to localStorage", async () => {
    const { useAgentModeStore, useRuntimeFeatureStore, useSettingsStore } = await loadStores();
    useRuntimeFeatureStore.setState({ featureState: featureState({ plan: true, compose: true }) });
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        longHorizon: {
          ...useSettingsStore.getState().settings.longHorizon,
          enabled: true,
          planMode: { enabled: true },
          composeMode: { enabled: true },
        },
      } as AppSettings,
    });
    useAgentModeStore.setState({ byWorkspace: {} });
    useAgentModeStore.getState().setMode("ws-1", "plan");
    expect(useAgentModeStore.getState().getMode("ws-1")).toBe("plan");
    const raw = localStorage.getItem("pi-agent-modes");
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!)).toMatchObject({ "ws-1": "plan" });
  });

  it("clamps plan → build when plan mode is disabled in runtime features", async () => {
    const { useAgentModeStore, useRuntimeFeatureStore, useSettingsStore } = await loadStores();
    useRuntimeFeatureStore.setState({ featureState: featureState({ plan: false, compose: true }) });
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        longHorizon: {
          ...useSettingsStore.getState().settings.longHorizon,
          enabled: true,
          planMode: { enabled: false },
          composeMode: { enabled: true },
        },
      } as AppSettings,
    });
    useAgentModeStore.setState({ byWorkspace: {} });
    useAgentModeStore.getState().setMode("ws-1", "plan");
    expect(useAgentModeStore.getState().getMode("ws-1")).toBe("build");
  });

  it("clamps compose → build when compose mode is disabled", async () => {
    const { useAgentModeStore, useRuntimeFeatureStore, useSettingsStore } = await loadStores();
    useRuntimeFeatureStore.setState({ featureState: featureState({ plan: true, compose: false }) });
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        longHorizon: {
          ...useSettingsStore.getState().settings.longHorizon,
          enabled: true,
          planMode: { enabled: true },
          composeMode: { enabled: false },
        },
      } as AppSettings,
    });
    useAgentModeStore.setState({ byWorkspace: { "ws-1": "compose" } });
    // getMode re-clamps stored value against current runtime
    expect(useAgentModeStore.getState().getMode("ws-1")).toBe("build");
  });

  it("keeps workspaces independent", async () => {
    const { useAgentModeStore, useRuntimeFeatureStore } = await loadStores();
    useRuntimeFeatureStore.setState({ featureState: featureState({ plan: true, compose: true }) });
    useAgentModeStore.setState({ byWorkspace: {} });
    useAgentModeStore.getState().setMode("ws-a", "plan");
    useAgentModeStore.getState().setMode("ws-b", "compose");
    expect(useAgentModeStore.getState().getMode("ws-a")).toBe("plan");
    expect(useAgentModeStore.getState().getMode("ws-b")).toBe("compose");
  });

  // wave-96 residual
  it("returns build for unknown workspace without creating an entry", async () => {
    const { useAgentModeStore, useRuntimeFeatureStore } = await loadStores();
    useRuntimeFeatureStore.setState({ featureState: featureState({ plan: true, compose: true }) });
    useAgentModeStore.setState({ byWorkspace: {} });
    expect(useAgentModeStore.getState().getMode("ws-missing")).toBe("build");
    expect(useAgentModeStore.getState().byWorkspace["ws-missing"]).toBeUndefined();
  });

  it("allows setting build explicitly after plan", async () => {
    const { useAgentModeStore, useRuntimeFeatureStore } = await loadStores();
    useRuntimeFeatureStore.setState({ featureState: featureState({ plan: true, compose: true }) });
    useAgentModeStore.setState({ byWorkspace: {} });
    useAgentModeStore.getState().setMode("ws-1", "plan");
    useAgentModeStore.getState().setMode("ws-1", "build");
    expect(useAgentModeStore.getState().getMode("ws-1")).toBe("build");
  });

  // wave-104 residual
  it("uses longHorizon master switch only when runtime featureState is null", async () => {
    const { useAgentModeStore, useRuntimeFeatureStore, useSettingsStore } = await loadStores();
    // Product: supportedAgentModes prefers featureState; longHorizon is fallback only.
    useRuntimeFeatureStore.setState({ featureState: null });
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        longHorizon: {
          ...useSettingsStore.getState().settings.longHorizon,
          enabled: false,
          planMode: { enabled: true },
          composeMode: { enabled: true },
        },
      } as AppSettings,
    });
    useAgentModeStore.setState({ byWorkspace: { "ws-1": "plan", "ws-2": "compose" } });
    expect(useAgentModeStore.getState().getMode("ws-1")).toBe("build");
    expect(useAgentModeStore.getState().getMode("ws-2")).toBe("build");

    // With featureState present, plan/compose remain available even if longHorizon.enabled=false.
    useRuntimeFeatureStore.setState({ featureState: featureState({ plan: true, compose: true }) });
    expect(useAgentModeStore.getState().getMode("ws-1")).toBe("plan");
    expect(useAgentModeStore.getState().getMode("ws-2")).toBe("compose");
  });

  it("normalizes invalid stored modes to build when loaded", async () => {
    localStorage.setItem("pi-agent-modes", JSON.stringify({ "ws-1": "max", "ws-2": 123, "ws-3": "plan" }));
    const { useAgentModeStore, useRuntimeFeatureStore } = await loadStores();
    useRuntimeFeatureStore.setState({ featureState: featureState({ plan: true, compose: true }) });
    expect(useAgentModeStore.getState().getMode("ws-1")).toBe("build");
    expect(useAgentModeStore.getState().getMode("ws-2")).toBe("build");
    expect(useAgentModeStore.getState().getMode("ws-3")).toBe("plan");
  });

  it("getMode without workspaceId returns clamped fallback", async () => {
    const { useAgentModeStore, useRuntimeFeatureStore } = await loadStores();
    useRuntimeFeatureStore.setState({ featureState: featureState({ plan: false, compose: false }) });
    expect(useAgentModeStore.getState().getMode(null, "plan")).toBe("build");
    expect(useAgentModeStore.getState().getMode(undefined, "compose")).toBe("build");
  });

  // wave-123 residual
  it("setMode clamps disabled modes before persist and reloads corrupted localStorage as empty", async () => {
    const { useAgentModeStore, useRuntimeFeatureStore } = await loadStores();
    useRuntimeFeatureStore.setState({ featureState: featureState({ plan: false, compose: false }) });
    useAgentModeStore.setState({ byWorkspace: {} });
    useAgentModeStore.getState().setMode("ws-1", "plan");
    useAgentModeStore.getState().setMode("ws-2", "compose");
    const persisted = JSON.parse(localStorage.getItem("pi-agent-modes") ?? "{}") as Record<string, string>;
    expect(persisted["ws-1"]).toBe("build");
    expect(persisted["ws-2"]).toBe("build");
    expect(useAgentModeStore.getState().getMode("ws-1")).toBe("build");
    expect(useAgentModeStore.getState().getMode("ws-2")).toBe("build");

    localStorage.setItem("pi-agent-modes", "{not-json");
    vi.resetModules();
    const reloaded = await loadStores();
    reloaded.useRuntimeFeatureStore.setState({ featureState: featureState({ plan: true, compose: true }) });
    expect(reloaded.useAgentModeStore.getState().byWorkspace).toEqual({});
    expect(reloaded.useAgentModeStore.getState().getMode("ws-1")).toBe("build");
  });

  it("preserves sibling workspace modes when one mode is updated", async () => {
    const { useAgentModeStore, useRuntimeFeatureStore } = await loadStores();
    useRuntimeFeatureStore.setState({ featureState: featureState({ plan: true, compose: true }) });
    useAgentModeStore.setState({ byWorkspace: { "ws-a": "plan", "ws-b": "compose" } });
    useAgentModeStore.getState().setMode("ws-a", "build");
    expect(useAgentModeStore.getState().byWorkspace).toEqual({
      "ws-a": "build",
      "ws-b": "compose",
    });
    expect(JSON.parse(localStorage.getItem("pi-agent-modes") ?? "{}")).toMatchObject({
      "ws-a": "build",
      "ws-b": "compose",
    });
  });

  // wave-133 residual
  it("getMode for unknown workspace uses clamped fallback without mutating map", async () => {
    const { useAgentModeStore, useRuntimeFeatureStore } = await loadStores();
    useRuntimeFeatureStore.setState({ featureState: featureState({ plan: true, compose: true }) });
    useAgentModeStore.setState({ byWorkspace: { "ws-known": "compose" } });
    expect(useAgentModeStore.getState().getMode("ws-missing", "plan")).toBe("plan");
    expect(useAgentModeStore.getState().byWorkspace).toEqual({ "ws-known": "compose" });
    expect(useAgentModeStore.getState().getMode("ws-missing")).toBe("build");
  });

  it("clamps getMode when runtime disables a previously stored plan mode", async () => {
    const { useAgentModeStore, useRuntimeFeatureStore } = await loadStores();
    useRuntimeFeatureStore.setState({ featureState: featureState({ plan: true, compose: true }) });
    useAgentModeStore.setState({ byWorkspace: { "ws-1": "plan" } });
    expect(useAgentModeStore.getState().getMode("ws-1")).toBe("plan");
    useRuntimeFeatureStore.setState({ featureState: featureState({ plan: false, compose: true }) });
    expect(useAgentModeStore.getState().getMode("ws-1")).toBe("build");
    // map still holds raw plan until next setMode
    expect(useAgentModeStore.getState().byWorkspace["ws-1"]).toBe("plan");
  });

  // wave-149 residual
  it("loadModes normalizes unknown stored values to build and ignores non-objects", async () => {
    localStorage.setItem(
      "pi-agent-modes",
      JSON.stringify({ "ws-a": "chat", "ws-b": "plan", "ws-c": 42, "ws-d": "compose" }),
    );
    vi.resetModules();
    const { useAgentModeStore, useRuntimeFeatureStore } = await loadStores();
    useRuntimeFeatureStore.setState({ featureState: featureState({ plan: true, compose: true }) });
    expect(useAgentModeStore.getState().byWorkspace).toEqual({
      "ws-a": "build",
      "ws-b": "plan",
      "ws-c": "build",
      "ws-d": "compose",
    });
    expect(useAgentModeStore.getState().getMode("ws-a")).toBe("build");
    expect(useAgentModeStore.getState().getMode("ws-b")).toBe("plan");
  });

  it("getMode with null/empty workspaceId returns clamped fallback without map lookup", async () => {
    const { useAgentModeStore, useRuntimeFeatureStore } = await loadStores();
    useRuntimeFeatureStore.setState({ featureState: featureState({ plan: true, compose: true }) });
    useAgentModeStore.setState({ byWorkspace: { "ws-1": "compose" } });
    expect(useAgentModeStore.getState().getMode(null, "plan")).toBe("plan");
    expect(useAgentModeStore.getState().getMode(undefined, "compose")).toBe("compose");
    // empty string is falsy → fallback path
    expect(useAgentModeStore.getState().getMode("", "plan")).toBe("plan");
    expect(useAgentModeStore.getState().byWorkspace).toEqual({ "ws-1": "compose" });
  });

  it("with featureState present, longHorizon planMode toggle is ignored for clamp", async () => {
    // product: supportedAgentModes uses featureState only when non-null;
    // longHorizon settings are fallback when featureState is null.
    const { useAgentModeStore, useRuntimeFeatureStore, useSettingsStore } = await loadStores();
    useRuntimeFeatureStore.setState({ featureState: featureState({ plan: true, compose: true }) });
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        longHorizon: {
          ...useSettingsStore.getState().settings.longHorizon,
          enabled: true,
          planMode: { enabled: false },
          composeMode: { enabled: true },
        },
      } as AppSettings,
    });
    useAgentModeStore.setState({ byWorkspace: {} });
    useAgentModeStore.getState().setMode("ws-1", "plan");
    expect(useAgentModeStore.getState().getMode("ws-1")).toBe("plan");
    expect(useAgentModeStore.getState().byWorkspace["ws-1"]).toBe("plan");

    // null featureState → longHorizon gates apply
    useRuntimeFeatureStore.setState({ featureState: null });
    expect(useAgentModeStore.getState().getMode("ws-1")).toBe("build");
    useAgentModeStore.getState().setMode("ws-1", "plan");
    expect(useAgentModeStore.getState().byWorkspace["ws-1"]).toBe("build");
    expect(JSON.parse(localStorage.getItem("pi-agent-modes") ?? "{}")["ws-1"]).toBe("build");
  });

  // wave-241 residual
  it("setMode clamps compose when only plan available; getMode re-clamps stored compose", async () => {
    const { useAgentModeStore, useRuntimeFeatureStore } = await loadStores();
    useRuntimeFeatureStore.setState({ featureState: featureState({ plan: true, compose: false }) });
    useAgentModeStore.setState({ byWorkspace: {} });
    useAgentModeStore.getState().setMode("ws-c", "compose");
    expect(useAgentModeStore.getState().byWorkspace["ws-c"]).toBe("build");
    expect(useAgentModeStore.getState().getMode("ws-c", "compose")).toBe("build");

    // store raw compose then disable compose — getMode clamps without rewriting map
    useRuntimeFeatureStore.setState({ featureState: featureState({ plan: true, compose: true }) });
    useAgentModeStore.getState().setMode("ws-c", "compose");
    expect(useAgentModeStore.getState().byWorkspace["ws-c"]).toBe("compose");
    useRuntimeFeatureStore.setState({ featureState: featureState({ plan: true, compose: false }) });
    expect(useAgentModeStore.getState().getMode("ws-c")).toBe("build");
    expect(useAgentModeStore.getState().byWorkspace["ws-c"]).toBe("compose");
  });

  it("setMode persists clamped modes; corrupt localStorage loads empty map", async () => {
    const { useAgentModeStore, useRuntimeFeatureStore } = await loadStores();
    useRuntimeFeatureStore.setState({ featureState: featureState({ plan: true, compose: true }) });
    useAgentModeStore.getState().setMode("ws-p", "plan");
    expect(JSON.parse(localStorage.getItem("pi-agent-modes") ?? "{}")).toMatchObject({ "ws-p": "plan" });

    localStorage.setItem("pi-agent-modes", "{not-json");
    vi.resetModules();
    const reloaded = await loadStores();
    reloaded.useRuntimeFeatureStore.setState({ featureState: featureState({ plan: true, compose: true }) });
    expect(reloaded.useAgentModeStore.getState().byWorkspace).toEqual({});
    expect(reloaded.useAgentModeStore.getState().getMode("ws-p", "plan")).toBe("plan");
  });
});
