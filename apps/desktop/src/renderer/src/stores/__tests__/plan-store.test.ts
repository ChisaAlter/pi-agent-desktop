import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { usePlanStore } from "../plan-store";

if (typeof (globalThis as Record<string, unknown>).window === "undefined") {
  (globalThis as Record<string, unknown>).window = globalThis;
}

beforeEach(() => {
  usePlanStore.setState({
    enabled: false,
    workspaceId: null,
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

  it("keeps the current execution phase when the same plan card is re-emitted during execution", () => {
    usePlanStore.setState({
      activeExecution: {
        activePlanId: "plan_running",
        title: "计划",
        filename: "create-plan-probe",
        sourceMessageId: "pm_existing",
        phase: "executing",
      },
      status: "executing",
      decisionRequest: null,
    });

    usePlanStore.getState().setCard({
      id: "plan_retry",
      title: "创建并验证 plan_probe.txt",
      filename: "create-plan-probe",
      content: "1. 创建文件\n2. 验证文件存在",
      createdAt: Date.now(),
    });

    expect(usePlanStore.getState().activeExecution).toMatchObject({
      activePlanId: "plan_running",
      sourceMessageId: "pm_existing",
      phase: "executing",
      filename: "create-plan-probe",
      title: "创建并验证 plan_probe.txt",
    });
    expect(usePlanStore.getState().status).toBe("executing");
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

describe("setProgress completion rules", () => {
  it("marks execution complete only when progress returns to idle with all steps completed", () => {
    usePlanStore.setState({
      activeExecution: {
        activePlanId: "plan_1",
        title: "执行计划",
        phase: "executing",
      },
      steps: [
        { id: "s1", text: "写入文件", status: "completed" },
        { id: "s2", text: "验证结果", status: "completed" },
      ],
      status: "executing",
    });

    usePlanStore.getState().setProgress({
      status: "idle",
      items: [],
    });

    expect(usePlanStore.getState().activeExecution?.phase).toBe("completed");
    expect(usePlanStore.getState().status).toBe("completed");
  });

  it("does not mark execution complete when idle arrives but steps are still incomplete", () => {
    usePlanStore.setState({
      activeExecution: {
        activePlanId: "plan_2",
        title: "执行计划",
        phase: "executing",
      },
      steps: [
        { id: "s1", text: "写入文件", status: "completed" },
        { id: "s2", text: "验证结果", status: "pending" },
      ],
      status: "executing",
    });

    usePlanStore.getState().setProgress({
      status: "idle",
      items: [],
    });

    expect(usePlanStore.getState().activeExecution?.phase).toBe("executing");
    expect(usePlanStore.getState().status).toBe("idle");
  });
});

describe("setAwaitingConfirmation", () => {
  it("does not reopen waiting confirmation for the same executing plan", () => {
    usePlanStore.setState({
      activeExecution: {
        activePlanId: "plan_running",
        title: "测试计划",
        filename: "create-plan-probe",
        sourceMessageId: "pm_existing",
        phase: "executing",
      },
      status: "executing",
    });

    usePlanStore.getState().setAwaitingConfirmation({
      activePlanId: "plan_retry",
      title: "创建并验证 plan_probe.txt",
      filename: "create-plan-probe",
      sourceMessageId: "pm_retry",
    });

    expect(usePlanStore.getState().activeExecution).toMatchObject({
      activePlanId: "plan_running",
      sourceMessageId: "pm_existing",
      phase: "executing",
      filename: "create-plan-probe",
      title: "创建并验证 plan_probe.txt",
    });
    expect(usePlanStore.getState().status).toBe("executing");
  });
});

// ── Task 5: IPC persistence wired into store mutations ────────────────
// SubTasks 5.1–5.6: setCard → planCreate / planUpdate, startExecution →
// planUpdate(status: executing), markCompleted → planComplete, cancel →
// planDelete, and rollback + lastError on IPC failure.

const PLAN_RECORD_FIXTURE = {
  id: "rec_1",
  filename: "1730000000000-test-plan.md",
  path: "/tmp/.pi/plans/1730000000000-test-plan.md",
  title: "Test Plan",
  status: "draft" as const,
  createdAt: 1730000000000,
  updatedAt: 1730000000000,
  content: "1. step one\n2. step two",
};

describe("setCard IPC persistence", () => {
  it("creates a plan file when no existing filename is present", async () => {
    usePlanStore.setState({ workspaceId: "ws-1", activeExecution: null });
    const mockPlanCreate = vi.fn().mockResolvedValue(PLAN_RECORD_FIXTURE);
    const mockPlanUpdate = vi.fn().mockResolvedValue({ ...PLAN_RECORD_FIXTURE, status: "draft" });
    (globalThis as Record<string, unknown>).piAPI = {
      planCreate: mockPlanCreate,
      planUpdate: mockPlanUpdate,
    };

    usePlanStore.getState().setCard({
      id: "plan_1",
      title: "Test Plan",
      content: "1. step one\n2. step two",
      createdAt: Date.now(),
    });

    // optimistic state already applied synchronously
    expect(usePlanStore.getState().activeExecution?.phase).toBe("awaiting_confirmation");
    expect(mockPlanCreate).toHaveBeenCalledTimes(1);
    expect(mockPlanCreate).toHaveBeenCalledWith("ws-1", {
      slug: "test-plan",
      title: "Test Plan",
      content: "1. step one\n2. step two",
    });
    expect(mockPlanUpdate).not.toHaveBeenCalled();

    await vi.waitFor(() => {
      expect(usePlanStore.getState().activeExecution?.filename).toBe(PLAN_RECORD_FIXTURE.filename);
    });
  });

  it("updates an existing plan file when filename is already present", async () => {
    usePlanStore.setState({
      workspaceId: "ws-1",
      activeExecution: {
        activePlanId: "plan_existing",
        title: "Old Title",
        filename: "existing.md",
        phase: "awaiting_confirmation",
      },
    });
    const mockPlanCreate = vi.fn().mockResolvedValue(PLAN_RECORD_FIXTURE);
    const mockPlanUpdate = vi.fn().mockResolvedValue({ ...PLAN_RECORD_FIXTURE, filename: "existing.md" });
    (globalThis as Record<string, unknown>).piAPI = {
      planCreate: mockPlanCreate,
      planUpdate: mockPlanUpdate,
    };

    usePlanStore.getState().setCard({
      id: "plan_existing",
      title: "Old Title",
      filename: "existing.md",
      content: "updated content",
      createdAt: Date.now(),
    });

    expect(mockPlanUpdate).toHaveBeenCalledTimes(1);
    expect(mockPlanUpdate).toHaveBeenCalledWith("ws-1", "existing.md", { content: "updated content" });
    expect(mockPlanCreate).not.toHaveBeenCalled();
  });
});

describe("startExecution IPC persistence", () => {
  it("calls planUpdate with status executing for an existing filename", async () => {
    usePlanStore.setState({
      workspaceId: "ws-1",
      activeExecution: {
        activePlanId: "plan_existing",
        title: "Test Plan",
        filename: "existing.md",
        phase: "awaiting_confirmation",
      },
    });
    const mockPlanUpdate = vi.fn().mockResolvedValue({ ...PLAN_RECORD_FIXTURE, filename: "existing.md", status: "executing" });
    (globalThis as Record<string, unknown>).piAPI = { planUpdate: mockPlanUpdate };

    usePlanStore.getState().startExecution({
      activePlanId: "plan_existing",
      title: "Test Plan",
      filename: "existing.md",
      sourceMessageId: "msg_1",
      executionMessageId: "msg_2",
    });

    expect(usePlanStore.getState().activeExecution?.phase).toBe("executing");
    expect(mockPlanUpdate).toHaveBeenCalledTimes(1);
    expect(mockPlanUpdate).toHaveBeenCalledWith("ws-1", "existing.md", { status: "executing" });
  });
});

describe("markCompleted IPC persistence", () => {
  it("calls planComplete with the current filename", async () => {
    usePlanStore.setState({
      workspaceId: "ws-1",
      activeExecution: {
        activePlanId: "plan_1",
        title: "Test Plan",
        filename: "existing.md",
        phase: "executing",
      },
      steps: [],
      status: "executing",
    });
    const mockPlanComplete = vi.fn().mockResolvedValue({ ...PLAN_RECORD_FIXTURE, filename: "existing.md", status: "completed" });
    (globalThis as Record<string, unknown>).piAPI = { planComplete: mockPlanComplete };

    usePlanStore.getState().markCompleted();

    expect(usePlanStore.getState().activeExecution?.phase).toBe("completed");
    expect(mockPlanComplete).toHaveBeenCalledTimes(1);
    expect(mockPlanComplete).toHaveBeenCalledWith("ws-1", "existing.md");
  });

  it("skips IPC when filename is missing but still updates local state", () => {
    usePlanStore.setState({
      workspaceId: "ws-1",
      activeExecution: {
        activePlanId: "plan_1",
        title: "Test Plan",
        phase: "executing",
      },
      steps: [],
      status: "executing",
    });
    const mockPlanComplete = vi.fn();
    (globalThis as Record<string, unknown>).piAPI = { planComplete: mockPlanComplete };

    usePlanStore.getState().markCompleted();

    expect(usePlanStore.getState().activeExecution?.phase).toBe("completed");
    expect(mockPlanComplete).not.toHaveBeenCalled();
  });
});

describe("cancel IPC persistence", () => {
  it("calls planDelete with the current filename and clears local state", async () => {
    usePlanStore.setState({
      workspaceId: "ws-1",
      activeExecution: {
        activePlanId: "plan_1",
        title: "Test Plan",
        filename: "existing.md",
        phase: "executing",
      },
      activeCard: { id: "plan_1", title: "Test Plan", content: "x", createdAt: 0 },
      steps: [{ id: "s1", text: "step", status: "pending" }],
      status: "executing",
    });
    const mockPlanDelete = vi.fn().mockResolvedValue(undefined);
    (globalThis as Record<string, unknown>).piAPI = { planDelete: mockPlanDelete };

    usePlanStore.getState().cancel();

    expect(usePlanStore.getState().activeExecution).toBeNull();
    expect(usePlanStore.getState().activeCard).toBeNull();
    expect(usePlanStore.getState().steps).toEqual([]);
    expect(mockPlanDelete).toHaveBeenCalledTimes(1);
    expect(mockPlanDelete).toHaveBeenCalledWith("ws-1", "existing.md");
  });
});

describe("IPC failure rollback", () => {
  it("reverts optimistic setCard state and sets lastError when planCreate rejects", async () => {
    usePlanStore.setState({
      workspaceId: "ws-1",
      activeExecution: null,
      status: "idle",
    });
    const mockPlanCreate = vi.fn().mockRejectedValue(new Error("disk full"));
    (globalThis as Record<string, unknown>).piAPI = { planCreate: mockPlanCreate };

    usePlanStore.getState().setCard({
      id: "plan_1",
      title: "Test Plan",
      content: "1. step",
      createdAt: Date.now(),
    });

    await vi.waitFor(() => {
      expect(usePlanStore.getState().lastError).toBe("disk full");
    });

    // previous state restored
    expect(usePlanStore.getState().activeExecution).toBeNull();
    expect(usePlanStore.getState().activeCard).toBeNull();
    expect(usePlanStore.getState().status).toBe("idle");
  });

  it("reverts optimistic state when planComplete returns an IpcError", async () => {
    usePlanStore.setState({
      workspaceId: "ws-1",
      activeExecution: {
        activePlanId: "plan_1",
        title: "Test Plan",
        filename: "existing.md",
        phase: "executing",
      },
      steps: [{ id: "s1", text: "step", status: "pending" }],
      status: "executing",
    });
    const ipcErr = {
      __brand: "IpcError" as const,
      code: "plan.completeFailed",
      fallback: "完成 plan 文件失败",
    };
    const mockPlanComplete = vi.fn().mockResolvedValue(ipcErr);
    (globalThis as Record<string, unknown>).piAPI = { planComplete: mockPlanComplete };

    usePlanStore.getState().markCompleted();

    await vi.waitFor(() => {
      expect(usePlanStore.getState().lastError).toBe("完成 plan 文件失败");
    });

    expect(usePlanStore.getState().activeExecution?.phase).toBe("executing");
    expect(usePlanStore.getState().status).toBe("executing");
    expect(usePlanStore.getState().steps[0]?.status).toBe("pending");
  });

  it("reverts cancel and restores activeExecution when planDelete rejects", async () => {
    usePlanStore.setState({
      workspaceId: "ws-1",
      activeExecution: {
        activePlanId: "plan_1",
        title: "Test Plan",
        filename: "existing.md",
        phase: "executing",
      },
      activeCard: { id: "plan_1", title: "Test Plan", content: "x", createdAt: 0 },
      steps: [{ id: "s1", text: "step", status: "pending" }],
      status: "executing",
    });
    const mockPlanDelete = vi.fn().mockRejectedValue(new Error("delete denied"));
    (globalThis as Record<string, unknown>).piAPI = { planDelete: mockPlanDelete };

    usePlanStore.getState().cancel();

    await vi.waitFor(() => {
      expect(usePlanStore.getState().lastError).toBe("delete denied");
    });

    // restored
    expect(usePlanStore.getState().activeExecution?.phase).toBe("executing");
    expect(usePlanStore.getState().activeExecution?.filename).toBe("existing.md");
    expect(usePlanStore.getState().activeCard?.id).toBe("plan_1");
    expect(usePlanStore.getState().steps).toHaveLength(1);
    expect(usePlanStore.getState().status).toBe("executing");
  });
});

// wave-129 residual
describe("plan-store residual phase helpers", () => {
  it("setCard strips inline thinking and caps markdown steps at 12", () => {
    const lines = Array.from({ length: 15 }, (_, i) => `- step ${i + 1}`).join("\n");
    usePlanStore.getState().setCard({
      id: "plan_think",
      title: "With Think",
      content: `<think>secret</think>\n${lines}`,
      createdAt: 1,
    });
    const state = usePlanStore.getState();
    expect(state.activeCard?.content).not.toContain("<think>");
    expect(state.activeCard?.content).toContain("step 1");
    expect(state.steps).toHaveLength(12);
    expect(state.steps[0]?.text).toBe("step 1");
    expect(state.steps[11]?.text).toBe("step 12");
  });

  it("markPausing/markPaused/markFailed and setGoal cleared semantics", () => {
    usePlanStore.setState({
      activeExecution: {
        activePlanId: "p1",
        title: "T",
        filename: "t.md",
        phase: "executing",
      },
      status: "executing",
      goal: { id: "g1", title: "G", status: "active" } as never,
    });
    usePlanStore.getState().markPausing();
    expect(usePlanStore.getState().activeExecution?.phase).toBe("pausing");
    expect(usePlanStore.getState().status).toBe("executing");
    usePlanStore.getState().markPaused();
    expect(usePlanStore.getState().activeExecution?.phase).toBe("paused");
    expect(usePlanStore.getState().status).toBe("waiting_decision");
    usePlanStore.getState().markFailed();
    expect(usePlanStore.getState().activeExecution?.phase).toBe("failed");
    expect(usePlanStore.getState().status).toBe("idle");

    usePlanStore.getState().setGoal({ id: "g2", title: "Keep", status: "running" } as never);
    expect(usePlanStore.getState().goal).toMatchObject({ id: "g2", status: "running" });
    usePlanStore.getState().setGoal({ id: "g2", title: "Keep", status: "cleared" } as never);
    expect(usePlanStore.getState().goal).toBeNull();
  });

  it("markPlanCardRendered is idempotent and reset clears rendered ids", () => {
    usePlanStore.getState().markPlanCardRendered("card-a");
    usePlanStore.getState().markPlanCardRendered("card-a");
    usePlanStore.getState().markPlanCardRendered("card-b");
    expect(usePlanStore.getState().renderedPlanCardIds).toEqual(["card-a", "card-b"]);
    usePlanStore.getState().reset();
    expect(usePlanStore.getState()).toMatchObject({
      activeCard: null,
      decisionRequest: null,
      pendingPlanClarification: null,
      renderedPlanCardIds: [],
      activeExecution: null,
      goal: null,
      steps: [],
      status: "idle",
    });
  });

  it("setProgress preserves steps when update.items is empty", () => {
    usePlanStore.setState({
      steps: [
        { id: "s1", text: "a", status: "completed" },
        { id: "s2", text: "b", status: "pending" },
      ],
      status: "executing",
      activeExecution: {
        activePlanId: "p1",
        title: "T",
        phase: "executing",
      },
    });
    usePlanStore.getState().setProgress({ status: "executing", items: [] });
    expect(usePlanStore.getState().steps).toHaveLength(2);
    expect(usePlanStore.getState().status).toBe("executing");
  });
});
