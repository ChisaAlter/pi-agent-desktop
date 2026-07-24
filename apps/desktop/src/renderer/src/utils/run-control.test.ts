// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const markPausing = vi.fn();
const markPaused = vi.fn();
const addToast = vi.fn();

vi.mock("../stores/plan-store", () => ({
  usePlanStore: {
    getState: () => ({
      activeExecution: activeExecutionRef.current,
      markPausing,
      markPaused,
    }),
  },
}));

vi.mock("../stores/toast-store", () => ({
  addToast,
}));

// Mutable active execution shared with the mock above.
const activeExecutionRef: { current: { phase: string } | null } = {
  current: null,
};

describe("requestRunControlStop", () => {
  beforeEach(() => {
    vi.resetModules();
    markPausing.mockReset();
    markPaused.mockReset();
    addToast.mockReset();
    activeExecutionRef.current = null;
    vi.unstubAllGlobals();
  });

  async function load() {
    return import("./run-control");
  }

  it("returns false when window.piAPI is missing", async () => {
    vi.stubGlobal("window", {});
    const { requestRunControlStop } = await load();
    await expect(requestRunControlStop({ workspaceId: "ws-1" })).resolves.toBe(false);
  });

  it("prefers agentsAbort when agentId is provided", async () => {
    const agentsAbort = vi.fn(async () => undefined);
    const stop = vi.fn(async () => undefined);
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", {
      piAPI: { agentsAbort, stop },
      dispatchEvent,
    });
    const { requestRunControlStop } = await load();
    const ok = await requestRunControlStop({
      workspaceId: "ws-1",
      agentId: "agent-1",
    });
    expect(ok).toBe(true);
    expect(agentsAbort).toHaveBeenCalledWith("agent-1");
    expect(stop).not.toHaveBeenCalled();
    expect(dispatchEvent).toHaveBeenCalledWith(expect.any(CustomEvent));
  });

  it("falls back to workspace stop when agentsAbort fails", async () => {
    const agentsAbort = vi.fn(async () => {
      throw new Error("abort failed");
    });
    const stop = vi.fn(async () => undefined);
    vi.stubGlobal("window", {
      piAPI: { agentsAbort, stop },
      dispatchEvent: vi.fn(),
    });
    const { requestRunControlStop } = await load();
    const ok = await requestRunControlStop({
      workspaceId: "ws-1",
      agentId: "agent-1",
    });
    expect(ok).toBe(true);
    expect(stop).toHaveBeenCalledWith("ws-1");
  });

  it("marks plan pausing then paused for plan execution", async () => {
    activeExecutionRef.current = { phase: "executing" };
    const stop = vi.fn(async () => undefined);
    vi.stubGlobal("window", {
      piAPI: { stop },
      dispatchEvent: vi.fn(),
    });
    const { requestRunControlStop } = await load();
    const ok = await requestRunControlStop({
      workspaceId: "ws-1",
      runContext: "plan_execution",
      markPlanPausing: true,
    });
    expect(ok).toBe(true);
    expect(markPausing).toHaveBeenCalled();
    expect(markPaused).toHaveBeenCalled();
  });

  it("surfaces stop failures via toast and onError", async () => {
    const stop = vi.fn(async () => ({
      code: "ipcErrors.chat.stopFailed",
      fallback: "stop denied",
    }));
    const onError = vi.fn();
    vi.stubGlobal("window", {
      piAPI: { stop },
      dispatchEvent: vi.fn(),
    });
    const { requestRunControlStop } = await load();
    const ok = await requestRunControlStop({
      workspaceId: "ws-1",
      onError,
    });
    expect(ok).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("stop denied"));
    expect(addToast).toHaveBeenCalledWith("停止响应失败", "error");
  });

  it("uses pause toast copy when plan execution stop fails", async () => {
    activeExecutionRef.current = { phase: "executing" };
    const stop = vi.fn(async () => ({
      code: "ERR",
      fallback: "cannot stop",
    }));
    vi.stubGlobal("window", {
      piAPI: { stop },
      dispatchEvent: vi.fn(),
    });
    const { requestRunControlStop } = await load();
    const ok = await requestRunControlStop({
      workspaceId: "ws-1",
      runContext: "plan_execution",
    });
    expect(ok).toBe(false);
    expect(addToast).toHaveBeenCalledWith("暂停执行失败", "error");
  });

  // wave-109 residual
  it("returns false when neither agentId nor workspaceId can stop", async () => {
    vi.stubGlobal("window", {
      piAPI: {},
      dispatchEvent: vi.fn(),
    });
    const { requestRunControlStop } = await load();
    await expect(requestRunControlStop({})).resolves.toBe(false);
    expect(addToast).not.toHaveBeenCalled();
  });

  it("returns false when stop IPC is missing for workspace path", async () => {
    const onError = vi.fn();
    vi.stubGlobal("window", {
      piAPI: {},
      dispatchEvent: vi.fn(),
    });
    const { requestRunControlStop } = await load();
    const ok = await requestRunControlStop({
      workspaceId: "ws-1",
      onError,
    });
    expect(ok).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("stop IPC 不可用"));
    expect(addToast).toHaveBeenCalledWith("停止响应失败", "error");
  });

  it("combines agentsAbort and workspace stop errors in onError", async () => {
    const agentsAbort = vi.fn(async () => {
      throw new Error("agent boom");
    });
    const stop = vi.fn(async () => {
      throw new Error("workspace boom");
    });
    const onError = vi.fn();
    vi.stubGlobal("window", {
      piAPI: { agentsAbort, stop },
      dispatchEvent: vi.fn(),
    });
    const { requestRunControlStop } = await load();
    const ok = await requestRunControlStop({
      workspaceId: "ws-1",
      agentId: "agent-1",
      onError,
    });
    expect(ok).toBe(false);
    expect(onError).toHaveBeenCalledWith(
      expect.stringMatching(/workspace boom.*agentsAbort: agent boom/),
    );
  });

  it("does not markPausing when markPlanPausing is false", async () => {
    activeExecutionRef.current = { phase: "executing" };
    const stop = vi.fn(async () => undefined);
    vi.stubGlobal("window", {
      piAPI: { stop },
      dispatchEvent: vi.fn(),
    });
    const { requestRunControlStop } = await load();
    await requestRunControlStop({
      workspaceId: "ws-1",
      runContext: "plan_execution",
      markPlanPausing: false,
    });
    expect(markPausing).not.toHaveBeenCalled();
    expect(markPaused).toHaveBeenCalled();
  });

  it("treats activeExecution pausing phase as plan context for toast", async () => {
    activeExecutionRef.current = { phase: "pausing" };
    const stop = vi.fn(async () => ({
      code: "ERR",
      fallback: "nope",
    }));
    vi.stubGlobal("window", {
      piAPI: { stop },
      dispatchEvent: vi.fn(),
    });
    const { requestRunControlStop } = await load();
    const ok = await requestRunControlStop({ workspaceId: "ws-1" });
    expect(ok).toBe(false);
    expect(addToast).toHaveBeenCalledWith("暂停执行失败", "error");
  });

  // wave-119 residual
  it("stringifies non-Error abort throws in combined error path", async () => {
    const agentsAbort = vi.fn(async () => {
      throw "abort-string";
    });
    const stop = vi.fn(async () => {
      throw "workspace-string";
    });
    const onError = vi.fn();
    vi.stubGlobal("window", {
      piAPI: { agentsAbort, stop },
      dispatchEvent: vi.fn(),
    });
    const { requestRunControlStop } = await load();
    const ok = await requestRunControlStop({
      workspaceId: "ws-1",
      agentId: "agent-1",
      onError,
    });
    expect(ok).toBe(false);
    expect(onError).toHaveBeenCalledWith(
      expect.stringMatching(/workspace-string.*agentsAbort: abort-string/),
    );
  });

  it("does not markPaused when stop fails under plan execution", async () => {
    activeExecutionRef.current = { phase: "executing" };
    const stop = vi.fn(async () => ({
      code: "ERR",
      fallback: "denied",
    }));
    vi.stubGlobal("window", {
      piAPI: { stop },
      dispatchEvent: vi.fn(),
    });
    const { requestRunControlStop } = await load();
    const ok = await requestRunControlStop({
      workspaceId: "ws-1",
      runContext: "plan_execution",
      markPlanPausing: true,
    });
    expect(ok).toBe(false);
    expect(markPausing).toHaveBeenCalled();
    expect(markPaused).not.toHaveBeenCalled();
  });

  it("dispatches pi:stream-end CustomEvent type on success", async () => {
    const dispatchEvent = vi.fn();
    const stop = vi.fn(async () => undefined);
    vi.stubGlobal("window", {
      piAPI: { stop },
      dispatchEvent,
    });
    const { requestRunControlStop } = await load();
    await requestRunControlStop({ workspaceId: "ws-1" });
    const event = dispatchEvent.mock.calls[0]?.[0] as CustomEvent;
    expect(event).toBeInstanceOf(CustomEvent);
    expect(event.type).toBe("pi:stream-end");
  });

  it("skips agentsAbort when agentId is empty string", async () => {
    const agentsAbort = vi.fn(async () => undefined);
    const stop = vi.fn(async () => undefined);
    vi.stubGlobal("window", {
      piAPI: { agentsAbort, stop },
      dispatchEvent: vi.fn(),
    });
    const { requestRunControlStop } = await load();
    const ok = await requestRunControlStop({
      workspaceId: "ws-1",
      agentId: "",
    });
    expect(ok).toBe(true);
    expect(agentsAbort).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledWith("ws-1");
  });

  // wave-127 residual
  it("stops via agentsAbort alone without workspaceId", async () => {
    const agentsAbort = vi.fn(async () => undefined);
    const stop = vi.fn(async () => undefined);
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", {
      piAPI: { agentsAbort, stop },
      dispatchEvent,
    });
    const { requestRunControlStop } = await load();
    const ok = await requestRunControlStop({ agentId: "agent-only" });
    expect(ok).toBe(true);
    expect(agentsAbort).toHaveBeenCalledWith("agent-only");
    expect(stop).not.toHaveBeenCalled();
    expect(dispatchEvent).toHaveBeenCalled();
  });

  it("returns false with onError when agentsAbort fails and workspaceId missing", async () => {
    const agentsAbort = vi.fn(async () => {
      throw new Error("abort-only-fail");
    });
    const onError = vi.fn();
    vi.stubGlobal("window", {
      piAPI: { agentsAbort },
      dispatchEvent: vi.fn(),
    });
    const { requestRunControlStop } = await load();
    const ok = await requestRunControlStop({ agentId: "agent-1", onError });
    expect(ok).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("abort-only-fail"));
    expect(addToast).toHaveBeenCalledWith("停止响应失败", "error");
  });

  it("does not markPausing when phase is not executing even if markPlanPausing true", async () => {
    activeExecutionRef.current = { phase: "pausing" };
    const stop = vi.fn(async () => undefined);
    vi.stubGlobal("window", {
      piAPI: { stop },
      dispatchEvent: vi.fn(),
    });
    const { requestRunControlStop } = await load();
    await requestRunControlStop({
      workspaceId: "ws-1",
      markPlanPausing: true,
    });
    expect(markPausing).not.toHaveBeenCalled();
    expect(markPaused).toHaveBeenCalled();
  });

  // wave-142 residual
  it("uses plan toast title when plan_execution stop fails", async () => {
    activeExecutionRef.current = { phase: "executing" };
    const onError = vi.fn();
    const stop = vi.fn(async () => {
      throw new Error("plan-stop-fail");
    });
    vi.stubGlobal("window", {
      piAPI: { stop },
      dispatchEvent: vi.fn(),
    });
    const { requestRunControlStop } = await load();
    const ok = await requestRunControlStop({
      workspaceId: "ws-1",
      runContext: "plan_execution",
      markPlanPausing: true,
      onError,
    });
    expect(ok).toBe(false);
    expect(markPausing).toHaveBeenCalled();
    expect(markPaused).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("plan-stop-fail"));
    expect(addToast).toHaveBeenCalledWith("暂停执行失败", "error");
  });

  it("surfaces ipcError.fallback from workspace stop failures", async () => {
    const stop = vi.fn(async () => ({
      __brand: "IpcError",
      code: "ipcErrors.stop.failed",
      fallback: "工作区停止被拒绝",
    }));
    const onError = vi.fn();
    vi.stubGlobal("window", {
      piAPI: { stop },
      dispatchEvent: vi.fn(),
    });
    const { requestRunControlStop } = await load();
    const ok = await requestRunControlStop({ workspaceId: "ws-1", onError });
    expect(ok).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("工作区停止被拒绝"));
    expect(addToast).toHaveBeenCalledWith("停止响应失败", "error");
  });

  it("combines workspace stop error with prior agentsAbort error", async () => {
    const agentsAbort = vi.fn(async () => {
      throw new Error("abort-first");
    });
    const stop = vi.fn(async () => {
      throw new Error("ws-second");
    });
    const onError = vi.fn();
    vi.stubGlobal("window", {
      piAPI: { agentsAbort, stop },
      dispatchEvent: vi.fn(),
    });
    const { requestRunControlStop } = await load();
    const ok = await requestRunControlStop({
      workspaceId: "ws-1",
      agentId: "agent-1",
      onError,
    });
    expect(ok).toBe(false);
    expect(onError.mock.calls[0]?.[0]).toContain("ws-second");
    expect(onError.mock.calls[0]?.[0]).toContain("abort-first");
  });

  it("returns false without toast when piAPI present but no stop targets", async () => {
    vi.stubGlobal("window", {
      piAPI: {},
      dispatchEvent: vi.fn(),
    });
    const { requestRunControlStop } = await load();
    await expect(requestRunControlStop({})).resolves.toBe(false);
    expect(addToast).not.toHaveBeenCalled();
  });

  // wave-153 residual
  it("treats null agentId like missing and uses workspace stop", async () => {
    const agentsAbort = vi.fn(async () => undefined);
    const stop = vi.fn(async () => undefined);
    vi.stubGlobal("window", {
      piAPI: { agentsAbort, stop },
      dispatchEvent: vi.fn(),
    });
    const { requestRunControlStop } = await load();
    const ok = await requestRunControlStop({
      workspaceId: "ws-1",
      agentId: null,
    });
    expect(ok).toBe(true);
    expect(agentsAbort).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledWith("ws-1");
  });

  it("normalizes blank Error messages and non-string throws to 未知错误", async () => {
    const agentsAbort = vi.fn(async () => {
      throw new Error("   ");
    });
    const stop = vi.fn(async () => {
      throw 42;
    });
    const onError = vi.fn();
    vi.stubGlobal("window", {
      piAPI: { agentsAbort, stop },
      dispatchEvent: vi.fn(),
    });
    const { requestRunControlStop } = await load();
    const ok = await requestRunControlStop({
      workspaceId: "ws-1",
      agentId: "agent-1",
      onError,
    });
    expect(ok).toBe(false);
    expect(onError).toHaveBeenCalledWith(
      expect.stringMatching(/未知错误.*agentsAbort: 未知错误/),
    );
  });

  it("skips agentsAbort when method is missing even if agentId is set", async () => {
    const stop = vi.fn(async () => undefined);
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", {
      piAPI: { stop },
      dispatchEvent,
    });
    const { requestRunControlStop } = await load();
    const ok = await requestRunControlStop({
      workspaceId: "ws-1",
      agentId: "agent-1",
    });
    expect(ok).toBe(true);
    expect(stop).toHaveBeenCalledWith("ws-1");
    expect(dispatchEvent).toHaveBeenCalled();
  });

  it("does not markPaused when activeExecution is cleared after a successful stop", async () => {
    activeExecutionRef.current = { phase: "executing" };
    const stop = vi.fn(async () => {
      // simulate plan store clearing execution between pause mark and pause complete
      activeExecutionRef.current = null;
    });
    vi.stubGlobal("window", {
      piAPI: { stop },
      dispatchEvent: vi.fn(),
    });
    const { requestRunControlStop } = await load();
    const ok = await requestRunControlStop({
      workspaceId: "ws-1",
      runContext: "plan_execution",
      markPlanPausing: true,
    });
    expect(ok).toBe(true);
    expect(markPausing).toHaveBeenCalled();
    expect(markPaused).not.toHaveBeenCalled();
  });

  it("clears prior agentsAbort error when workspace stop recovers", async () => {
    const agentsAbort = vi.fn(async () => {
      throw new Error("abort-noise");
    });
    const stop = vi.fn(async () => undefined);
    const onError = vi.fn();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", {
      piAPI: { agentsAbort, stop },
      dispatchEvent,
    });
    const { requestRunControlStop } = await load();
    const ok = await requestRunControlStop({
      workspaceId: "ws-1",
      agentId: "agent-1",
      onError,
    });
    expect(ok).toBe(true);
    expect(onError).not.toHaveBeenCalled();
    expect(addToast).not.toHaveBeenCalled();
    expect(dispatchEvent).toHaveBeenCalled();
  });

  // wave-169 residual
  it("returns false when piAPI missing entirely", async () => {
    vi.stubGlobal("window", {});
    const { requestRunControlStop } = await load();
    await expect(requestRunControlStop({ workspaceId: "ws-1" })).resolves.toBe(false);
    expect(addToast).not.toHaveBeenCalled();
  });

  it("combines agentsAbort and workspace stop errors when both fail", async () => {
    const agentsAbort = vi.fn(async () => {
      throw new Error("abort-fail");
    });
    const stop = vi.fn(async () => {
      throw new Error("stop-fail");
    });
    const onError = vi.fn();
    vi.stubGlobal("window", {
      piAPI: { agentsAbort, stop },
      dispatchEvent: vi.fn(),
    });
    const { requestRunControlStop } = await load();
    const ok = await requestRunControlStop({
      workspaceId: "ws-1",
      agentId: "agent-1",
      onError,
    });
    expect(ok).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("stop-fail"));
    expect(onError.mock.calls[0][0]).toContain("agentsAbort: abort-fail");
    expect(addToast).toHaveBeenCalledWith("停止响应失败", "error");
  });

  it("string throw from stop is normalized into stop failure message", async () => {
    const stop = vi.fn(async () => {
      throw "plain-string-error";
    });
    const onError = vi.fn();
    vi.stubGlobal("window", {
      piAPI: { stop },
      dispatchEvent: vi.fn(),
    });
    const { requestRunControlStop } = await load();
    const ok = await requestRunControlStop({ workspaceId: "ws-1", onError });
    expect(ok).toBe(false);
    expect(onError).toHaveBeenCalledWith("停止失败: plain-string-error");
  });

  it("non-string non-Error throw falls back to 未知错误", async () => {
    const stop = vi.fn(async () => {
      throw { code: 42 };
    });
    const onError = vi.fn();
    vi.stubGlobal("window", {
      piAPI: { stop },
      dispatchEvent: vi.fn(),
    });
    const { requestRunControlStop } = await load();
    const ok = await requestRunControlStop({ workspaceId: "ws-1", onError });
    expect(ok).toBe(false);
    expect(onError).toHaveBeenCalledWith("停止失败: 未知错误");
  });

  // wave-178 residual
  it("returns false without toast when workspaceId and agentId both missing", async () => {
    const stop = vi.fn();
    const agentsAbort = vi.fn();
    vi.stubGlobal("window", {
      piAPI: { stop, agentsAbort },
      dispatchEvent: vi.fn(),
    });
    const { requestRunControlStop } = await load();
    await expect(requestRunControlStop({})).resolves.toBe(false);
    expect(stop).not.toHaveBeenCalled();
    expect(agentsAbort).not.toHaveBeenCalled();
    expect(addToast).not.toHaveBeenCalled();
  });

  it("treats IpcError stop result as failure using fallback text", async () => {
    const stop = vi.fn(async () => ({
      __brand: "IpcError" as const,
      code: "ipcErrors.stop",
      fallback: "workspace busy",
    }));
    const onError = vi.fn();
    vi.stubGlobal("window", {
      piAPI: { stop },
      dispatchEvent: vi.fn(),
    });
    const { requestRunControlStop } = await load();
    const ok = await requestRunControlStop({ workspaceId: "ws-1", onError });
    expect(ok).toBe(false);
    expect(onError).toHaveBeenCalledWith("停止失败: workspace busy");
    expect(addToast).toHaveBeenCalledWith("停止响应失败", "error");
  });

  it("empty Error.message and blank string errors fall back to 未知错误", async () => {
    const stop = vi.fn(async () => {
      throw new Error("   ");
    });
    const onError = vi.fn();
    vi.stubGlobal("window", {
      piAPI: { stop },
      dispatchEvent: vi.fn(),
    });
    const { requestRunControlStop } = await load();
    await requestRunControlStop({ workspaceId: "ws-1", onError });
    expect(onError).toHaveBeenCalledWith("停止失败: 未知错误");
  });

  // wave-194 residual
  it("marks plan pausing then paused when stop succeeds under plan_execution", async () => {
    activeExecutionRef.current = { phase: "executing" };
    const stop = vi.fn(async () => undefined);
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", {
      piAPI: { stop },
      dispatchEvent,
    });
    const { requestRunControlStop } = await load();
    const ok = await requestRunControlStop({
      workspaceId: "ws-1",
      runContext: "plan_execution",
      markPlanPausing: true,
    });
    expect(ok).toBe(true);
    expect(markPausing).toHaveBeenCalledTimes(1);
    expect(markPaused).toHaveBeenCalledTimes(1);
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "pi:stream-end" }),
    );
  });

  it("uses 暂停执行失败 toast when plan stop fails after agentsAbort and workspace stop both fail", async () => {
    activeExecutionRef.current = { phase: "executing" };
    const agentsAbort = vi.fn(async () => {
      throw new Error("abort-down");
    });
    const stop = vi.fn(async () => {
      throw new Error("stop-down");
    });
    const onError = vi.fn();
    vi.stubGlobal("window", {
      piAPI: { agentsAbort, stop },
      dispatchEvent: vi.fn(),
    });
    const { requestRunControlStop } = await load();
    const ok = await requestRunControlStop({
      workspaceId: "ws-1",
      agentId: "a1",
      runContext: "plan_execution",
      onError,
    });
    expect(ok).toBe(false);
    expect(addToast).toHaveBeenCalledWith("暂停执行失败", "error");
    expect(onError).toHaveBeenCalledWith(
      expect.stringMatching(/停止失败: stop-down \(agentsAbort: abort-down\)/),
    );
  });

  it("skips markPausing when markPlanPausing is false even if phase is executing", async () => {
    activeExecutionRef.current = { phase: "executing" };
    const stop = vi.fn(async () => undefined);
    vi.stubGlobal("window", {
      piAPI: { stop },
      dispatchEvent: vi.fn(),
    });
    const { requestRunControlStop } = await load();
    await requestRunControlStop({
      workspaceId: "ws-1",
      runContext: "plan_execution",
      markPlanPausing: false,
    });
    expect(markPausing).not.toHaveBeenCalled();
    expect(markPaused).toHaveBeenCalledTimes(1);
  });

  // wave-200 residual
  it("task context uses 停止响应失败 toast on dual-fail (not plan toast)", async () => {
    activeExecutionRef.current = null;
    const agentsAbort = vi.fn(async () => {
      throw new Error("a");
    });
    const stop = vi.fn(async () => {
      throw new Error("b");
    });
    const onError = vi.fn();
    vi.stubGlobal("window", {
      piAPI: { agentsAbort, stop },
      dispatchEvent: vi.fn(),
    });
    const { requestRunControlStop } = await load();
    const ok = await requestRunControlStop({
      workspaceId: "ws-1",
      agentId: "a1",
      runContext: "task",
      onError,
    });
    expect(ok).toBe(false);
    expect(addToast).toHaveBeenCalledWith("停止响应失败", "error");
    expect(markPaused).not.toHaveBeenCalled();
  });

  it("agentsAbort success without workspaceId still stream-ends and skips stop()", async () => {
    const agentsAbort = vi.fn(async () => undefined);
    const stop = vi.fn(async () => undefined);
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", {
      piAPI: { agentsAbort, stop },
      dispatchEvent,
    });
    const { requestRunControlStop } = await load();
    const ok = await requestRunControlStop({ agentId: "only-agent" });
    expect(ok).toBe(true);
    expect(agentsAbort).toHaveBeenCalledWith("only-agent");
    expect(stop).not.toHaveBeenCalled();
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "pi:stream-end" }),
    );
  });

  it("returns false without toast when piAPI present but no agentId/workspaceId", async () => {
    vi.stubGlobal("window", {
      piAPI: { stop: vi.fn(), agentsAbort: vi.fn() },
      dispatchEvent: vi.fn(),
    });
    const { requestRunControlStop } = await load();
    await expect(requestRunControlStop({})).resolves.toBe(false);
    expect(addToast).not.toHaveBeenCalled();
  });

  // wave-208 residual
  it("workspace stop maps IpcError.fallback into toast and onError", async () => {
    const stop = vi.fn(async () => ({
      __brand: "IpcError" as const,
      code: "STOP_FAILED",
      fallback: "workspace busy",
    }));
    const onError = vi.fn();
    vi.stubGlobal("window", {
      piAPI: { stop },
      dispatchEvent: vi.fn(),
    });
    const { requestRunControlStop } = await load();
    const ok = await requestRunControlStop({
      workspaceId: "ws-1",
      onError,
    });
    expect(ok).toBe(false);
    expect(addToast).toHaveBeenCalledWith("停止响应失败", "error");
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("workspace busy"));
  });

  it("plan_execution dual-fail uses 暂停执行失败 toast and string error normalization", async () => {
    activeExecutionRef.current = { phase: "executing" };
    const agentsAbort = vi.fn(async () => {
      throw "abort-string";
    });
    const stop = vi.fn(async () => {
      throw new Error("stop-err");
    });
    const onError = vi.fn();
    vi.stubGlobal("window", {
      piAPI: { agentsAbort, stop },
      dispatchEvent: vi.fn(),
    });
    const { requestRunControlStop } = await load();
    const ok = await requestRunControlStop({
      workspaceId: "ws-1",
      agentId: "a1",
      runContext: "plan_execution",
      markPlanPausing: true,
      onError,
    });
    expect(ok).toBe(false);
    expect(markPausing).toHaveBeenCalledTimes(1);
    expect(markPaused).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith("暂停执行失败", "error");
    expect(onError.mock.calls[0]![0]).toMatch(/stop-err/);
    expect(onError.mock.calls[0]![0]).toMatch(/abort-string/);
  });

  it("missing stop IPC without agentsAbort surfaces 停止失败 message", async () => {
    const onError = vi.fn();
    vi.stubGlobal("window", {
      piAPI: {},
      dispatchEvent: vi.fn(),
    });
    const { requestRunControlStop } = await load();
    const ok = await requestRunControlStop({
      workspaceId: "ws-1",
      onError,
    });
    expect(ok).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("stop IPC 不可用"));
    expect(addToast).toHaveBeenCalledWith("停止响应失败", "error");
  });

  // wave-213 residual
  it("empty agentId+workspaceId returns false without toast; successful stop returns true", async () => {
    const stop = vi.fn(async () => undefined);
    const onError = vi.fn();
    vi.stubGlobal("window", {
      piAPI: { stop },
      dispatchEvent: vi.fn(),
    });
    const { requestRunControlStop } = await load();
    const empty = await requestRunControlStop({
      agentId: "",
      workspaceId: "",
      onError,
    });
    expect(empty).toBe(false);
    expect(stop).not.toHaveBeenCalled();
    expect(addToast).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();

    const ok = await requestRunControlStop({
      workspaceId: "ws-ok",
      agentId: "a-ok",
    });
    expect(ok).toBe(true);
    expect(stop).toHaveBeenCalled();
  });

  // wave-222 residual
  it("plan_execution marks pausing then paused on successful workspace stop", async () => {
    activeExecutionRef.current = { phase: "executing" };
    const stop = vi.fn(async () => undefined);
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", {
      piAPI: { stop },
      dispatchEvent,
    });
    const { requestRunControlStop } = await load();
    const ok = await requestRunControlStop({
      workspaceId: "ws-plan",
      runContext: "plan_execution",
      markPlanPausing: true,
    });
    expect(ok).toBe(true);
    expect(markPausing).toHaveBeenCalledTimes(1);
    expect(markPaused).toHaveBeenCalledTimes(1);
    expect(dispatchEvent).toHaveBeenCalledWith(expect.any(CustomEvent));
    expect(addToast).not.toHaveBeenCalled();
  });

  it("workspace stop IpcError uses fallback; plan toast uses pause label", async () => {
    activeExecutionRef.current = { phase: "executing" };
    const stop = vi.fn(async () => ({ __brand: "IpcError" as const, code: "STOP", fallback: "busy" }));
    const onError = vi.fn();
    vi.stubGlobal("window", {
      piAPI: { stop },
      dispatchEvent: vi.fn(),
    });
    const { requestRunControlStop } = await load();
    const ok = await requestRunControlStop({
      workspaceId: "ws-fail",
      runContext: "plan_execution",
      markPlanPausing: true,
      onError,
    });
    expect(ok).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("busy"));
    expect(addToast).toHaveBeenCalledWith("暂停执行失败", "error");
    expect(markPaused).not.toHaveBeenCalled();
  });

  // wave-270 residual
  it("returns false without toast when piAPI exists but no agentId/workspaceId", async () => {
    vi.stubGlobal("window", {
      piAPI: { stop: vi.fn(), agentsAbort: vi.fn() },
      dispatchEvent: vi.fn(),
    });
    const { requestRunControlStop } = await load();
    const ok = await requestRunControlStop({});
    expect(ok).toBe(false);
    expect(addToast).not.toHaveBeenCalled();
    expect(markPaused).not.toHaveBeenCalled();
  });

  it("workspace stop without stop IPC fails with 不可用; agentsAbort then workspace combines errors", async () => {
    const agentsAbort = vi.fn(async () => {
      throw new Error("abort-down");
    });
    const onError = vi.fn();
    vi.stubGlobal("window", {
      piAPI: { agentsAbort },
      dispatchEvent: vi.fn(),
    });
    const { requestRunControlStop } = await load();
    const ok = await requestRunControlStop({
      workspaceId: "ws-1",
      agentId: "a1",
      onError,
    });
    expect(ok).toBe(false);
    expect(onError).toHaveBeenCalledWith(
      expect.stringMatching(/stop IPC 不可用[\s\S]*agentsAbort: abort-down|停止失败/),
    );
    expect(addToast).toHaveBeenCalledWith("停止响应失败", "error");
  });

  it("runContext plan_execution marks paused even without activeExecution phase when stop ok", async () => {
    activeExecutionRef.current = { phase: "executing" };
    const stop = vi.fn(async () => undefined);
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", {
      piAPI: { stop },
      dispatchEvent,
    });
    const { requestRunControlStop } = await load();
    const ok = await requestRunControlStop({
      workspaceId: "ws-plan",
      runContext: "plan_execution",
      markPlanPausing: true,
    });
    expect(ok).toBe(true);
    expect(markPausing).toHaveBeenCalledTimes(1);
    expect(markPaused).toHaveBeenCalledTimes(1);
    expect(dispatchEvent).toHaveBeenCalledWith(expect.any(CustomEvent));
  });


  // wave-281 residual
  it("returns false without toast when piAPI present but no agentId/workspaceId", async () => {
    vi.stubGlobal("window", {
      piAPI: { agentsAbort: vi.fn(), stop: vi.fn() },
      dispatchEvent: vi.fn(),
    });
    const { requestRunControlStop } = await load();
    const onError = vi.fn();
    const ok = await requestRunControlStop({ onError });
    expect(ok).toBe(false);
    expect(onError).not.toHaveBeenCalled();
    expect(addToast).not.toHaveBeenCalled();
  });

  it("workspace stop treats isIpcError result as failure with fallback message", async () => {
    const stop = vi.fn(async () => ({ __brand: "IpcError", code: "x", fallback: "stop-denied" }));
    const onError = vi.fn();
    vi.stubGlobal("window", {
      piAPI: { stop },
      dispatchEvent: vi.fn(),
    });
    const { requestRunControlStop } = await load();
    const ok = await requestRunControlStop({
      workspaceId: "ws-1",
      onError,
    });
    expect(ok).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("stop-denied"));
    expect(addToast).toHaveBeenCalledWith("停止响应失败", "error");
  });

});
