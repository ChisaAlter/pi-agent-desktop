import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { usePlanStore } from "../plan-store";

if (typeof (globalThis as Record<string, unknown>).window === "undefined") {
  (globalThis as Record<string, unknown>).window = globalThis;
}

beforeEach(() => {
  usePlanStore.setState({
    enabled: false,
    activeCard: null,
    decisionRequest: null,
    renderedPlanCardIds: [],
    activeExecution: null,
    steps: [],
    status: "idle",
    lastError: null,
  });
  delete (globalThis as Record<string, unknown>).piAPI;
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).piAPI;
});

describe("setCard", () => {
  it("treats structured plan cards as authoritative even when the content looks like guidance", () => {
    usePlanStore.getState().setCard({
      id: "plan_1",
      title: "计划模式提示",
      content: "请告诉我你的目标和验收标准。",
      createdAt: Date.now(),
    });

    expect(usePlanStore.getState().activeCard).toMatchObject({
      id: "plan_1",
      title: "计划模式提示",
      content: "请告诉我你的目标和验收标准。",
    });
    expect(usePlanStore.getState().decisionRequest?.card?.id).toBe("plan_1");
    expect(usePlanStore.getState().activeExecution?.phase).toBe("awaiting_confirmation");
  });
});

describe("setEnabled revert logic", () => {
  it("reverts to previous value on IPC failure (not !enabled)", async () => {
    expect(usePlanStore.getState().enabled).toBe(false);

    const mockPlanSetEnabled = vi.fn().mockRejectedValue(new Error("IPC error"));
    (globalThis as Record<string, unknown>).piAPI = {
      planSetEnabled: mockPlanSetEnabled,
    };

    usePlanStore.getState().setEnabled("ws-1", true);

    expect(usePlanStore.getState().enabled).toBe(true);

    await vi.waitFor(() => {
      expect(usePlanStore.getState().enabled).toBe(false);
    });

    expect(usePlanStore.getState().lastError).toBe("IPC error");
  });

  it("reverts to correct previous value when toggling from true to false", async () => {
    usePlanStore.setState({ enabled: true });

    const mockPlanSetEnabled = vi.fn().mockResolvedValue("some error");
    (globalThis as Record<string, unknown>).piAPI = {
      planSetEnabled: mockPlanSetEnabled,
    };

    usePlanStore.getState().setEnabled("ws-1", false);

    expect(usePlanStore.getState().enabled).toBe(false);

    await vi.waitFor(() => {
      expect(usePlanStore.getState().enabled).toBe(true);
    });

    expect(usePlanStore.getState().lastError).toBe("some error");
  });

  it("clears lastError on successful toggle", async () => {
    usePlanStore.setState({ lastError: "previous error" });

    const mockPlanSetEnabled = vi.fn().mockResolvedValue(undefined);
    (globalThis as Record<string, unknown>).piAPI = {
      planSetEnabled: mockPlanSetEnabled,
    };

    usePlanStore.getState().setEnabled("ws-1", true);

    expect(usePlanStore.getState().lastError).toBeNull();

    await vi.waitFor(() => {
      expect(usePlanStore.getState().enabled).toBe(true);
    });
  });

  it("clearError clears lastError", () => {
    usePlanStore.setState({ lastError: "some error" });
    expect(usePlanStore.getState().lastError).toBe("some error");

    usePlanStore.getState().clearError();
    expect(usePlanStore.getState().lastError).toBeNull();
  });

  it("sets default error message on non-Error catch", async () => {
    const mockPlanSetEnabled = vi.fn().mockRejectedValue("string error");
    (globalThis as Record<string, unknown>).piAPI = {
      planSetEnabled: mockPlanSetEnabled,
    };

    usePlanStore.getState().setEnabled("ws-1", true);

    await vi.waitFor(() => {
      expect(usePlanStore.getState().enabled).toBe(false);
    });

    expect(usePlanStore.getState().lastError).toBe("计划模式切换失败");
  });
});
