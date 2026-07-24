import { beforeEach, describe, expect, it } from "vitest";
import { useQueueStore } from "./queue-store";

describe("queue-store", () => {
  beforeEach(() => {
    useQueueStore.getState().clear();
  });

  it("tracks running state from agent lifecycle events", () => {
    useQueueStore.getState().applyEvent({ type: "agent_start" });
    expect(useQueueStore.getState().running).toBe(true);

    useQueueStore.getState().applyEvent({ type: "agent_end" });
    expect(useQueueStore.getState().running).toBe(false);
  });

  it("stores steering and follow-up queues from queue_update", () => {
    useQueueStore.getState().applyEvent({
      type: "queue_update",
      steering: ["adjust plan"],
      followUp: ["run tests"],
    });

    expect(useQueueStore.getState().steering).toEqual(["adjust plan"]);
    expect(useQueueStore.getState().followUp).toEqual(["run tests"]);
    expect(useQueueStore.getState().items.map((item) => [item.label, item.status])).toEqual([
      ["adjust plan", "waiting"],
      ["run tests", "pending"],
    ]);
    expect(useQueueStore.getState().updatedAt).toEqual(expect.any(Number));
  });

  it("marks errors as not running without clearing queue details", () => {
    useQueueStore.getState().applyEvent({
      type: "queue_update",
      steering: ["keep context"],
      followUp: [],
    });
    useQueueStore.getState().applyEvent({ type: "agent_start" });
    useQueueStore.getState().applyEvent({ type: "extension_error", message: "tool crashed" } as never);

    expect(useQueueStore.getState().running).toBe(false);
    expect(useQueueStore.getState().steering).toEqual(["keep context"]);
    expect(useQueueStore.getState().lastError).toBe("tool crashed");
  });

  it("records the latest completion time from agent lifecycle events", () => {
    useQueueStore.getState().applyEvent({ type: "agent_start" });
    useQueueStore.getState().applyEvent({ type: "agent_end" });

    expect(useQueueStore.getState().running).toBe(false);
    expect(useQueueStore.getState().lastCompletedAt).toEqual(expect.any(Number));
    expect(useQueueStore.getState().lastError).toBeNull();
    expect(useQueueStore.getState().items[0]).toMatchObject({
      id: "queue:running",
      label: "当前任务已完成",
      status: "completed",
    });
  });

  it("tracks auto retry lifecycle as running activity", () => {
    useQueueStore.getState().applyEvent({
      type: "auto_retry_start",
      attempt: 1,
      maxAttempts: 3,
      delayMs: 2000,
      errorMessage: "429 Too Many Requests",
    });

    expect(useQueueStore.getState().running).toBe(true);
    expect(useQueueStore.getState().autoRetrying).toBe(true);
    expect(useQueueStore.getState().lastActivity).toBe("自动重试中");

    useQueueStore.getState().applyEvent({ type: "auto_retry_end", success: true, attempt: 1 });

    expect(useQueueStore.getState().autoRetrying).toBe(false);
    expect(useQueueStore.getState().lastActivity).toBe("自动重试结束");
  });

  it("records tool execution activity and visible tool errors", () => {
    useQueueStore.getState().applyEvent({
      type: "tool_execution_start",
      toolCallId: "tc1",
      toolName: "bash",
      args: { command: "pnpm test" },
    });

    expect(useQueueStore.getState().running).toBe(true);
    expect(useQueueStore.getState().lastActivity).toBe("bash 运行中");

    useQueueStore.getState().applyEvent({
      type: "tool_execution_end",
      toolCallId: "tc1",
      toolName: "bash",
      isError: true,
    });

    expect(useQueueStore.getState().lastActivity).toBe("bash 失败");
    expect(useQueueStore.getState().lastError).toBe("bash 执行失败");
    expect(useQueueStore.getState().items[0]).toMatchObject({
      id: "tool:tc1",
      label: "bash 失败",
      status: "error",
    });
  });

  it("keeps completed and queued task items without stale queue duplicates", () => {
    useQueueStore.getState().applyEvent({ type: "agent_start" });
    useQueueStore.getState().applyEvent({
      type: "queue_update",
      steering: ["first steer"],
      followUp: ["first follow"],
    });
    useQueueStore.getState().applyEvent({
      type: "queue_update",
      steering: ["second steer"],
      followUp: [],
    });

    const labels = useQueueStore.getState().items.map((item) => item.label);
    expect(labels).toContain("当前任务运行中");
    expect(labels).toContain("second steer");
    expect(labels).not.toContain("first steer");
    expect(labels).not.toContain("first follow");
  });

  // wave-110 residual
  it("tracks turn_start/turn_end labels separately from agent lifecycle", () => {
    useQueueStore.getState().applyEvent({ type: "turn_start" });
    expect(useQueueStore.getState()).toMatchObject({
      running: true,
      lastActivity: "Turn 已开始",
    });
    useQueueStore.getState().applyEvent({ type: "turn_end" });
    expect(useQueueStore.getState()).toMatchObject({
      running: false,
      lastActivity: "Turn 已结束",
      lastCompletedAt: expect.any(Number),
    });
    expect(useQueueStore.getState().items[0]).toMatchObject({
      id: "queue:running",
      meta: "Turn",
      status: "completed",
    });
  });

  it("falls back to 工具 when toolName is blank and clears lastError on success", () => {
    useQueueStore.getState().applyEvent({
      type: "tool_execution_start",
      toolCallId: "tc-blank",
      toolName: "   ",
      args: {},
    } as never);
    expect(useQueueStore.getState().lastActivity).toBe("工具 运行中");

    useQueueStore.getState().applyEvent({
      type: "tool_execution_end",
      toolCallId: "tc-blank",
      toolName: "   ",
      isError: true,
    } as never);
    expect(useQueueStore.getState().lastError).toBe("工具 执行失败");

    useQueueStore.getState().applyEvent({
      type: "tool_execution_end",
      toolCallId: "tc-blank",
      toolName: "bash",
      isError: false,
    } as never);
    expect(useQueueStore.getState().lastError).toBeNull();
    expect(useQueueStore.getState().lastActivity).toBe("bash 完成");
  });

  it("caps items at 12 and uses extension_error fallback copy", () => {
    for (let i = 0; i < 15; i += 1) {
      useQueueStore.getState().applyEvent({
        type: "tool_execution_start",
        toolCallId: `tc-${i}`,
        toolName: `tool-${i}`,
        args: {},
      } as never);
    }
    expect(useQueueStore.getState().items).toHaveLength(12);
    expect(useQueueStore.getState().items[0]?.id).toBe("tool:tc-14");

    useQueueStore.getState().applyEvent({ type: "extension_error" } as never);
    expect(useQueueStore.getState().running).toBe(false);
    expect(useQueueStore.getState().lastError).toBe("任务运行时出现扩展错误");
  });

  it("ignores unrelated event types", () => {
    useQueueStore.getState().applyEvent({ type: "agent_start" });
    const before = useQueueStore.getState();
    useQueueStore.getState().applyEvent({ type: "text_delta", delta: "x" } as never);
    const after = useQueueStore.getState();
    expect(after.running).toBe(before.running);
    expect(after.items).toEqual(before.items);
    expect(after.updatedAt).toBe(before.updatedAt);
  });

  // wave-119 residual
  it("tool_execution_update upserts the same tool id as running", () => {
    useQueueStore.getState().applyEvent({
      type: "tool_execution_start",
      toolCallId: "tc-upd",
      toolName: "bash",
      args: {},
    } as never);
    useQueueStore.getState().applyEvent({
      type: "tool_execution_update",
      toolCallId: "tc-upd",
      toolName: "bash",
      args: { progress: 1 },
    } as never);
    const tools = useQueueStore.getState().items.filter((item) => item.id === "tool:tc-upd");
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      label: "bash 运行中",
      status: "running",
    });
  });

  it("extension_error prefers message over error/reason and keeps steering", () => {
    useQueueStore.getState().applyEvent({
      type: "queue_update",
      steering: ["keep"],
      followUp: [],
    });
    useQueueStore.getState().applyEvent({
      type: "extension_error",
      message: "primary",
      error: "secondary",
      reason: "tertiary",
    } as never);
    expect(useQueueStore.getState().lastError).toBe("primary");
    expect(useQueueStore.getState().steering).toEqual(["keep"]);
  });

  it("queue_update with empty queues clears lastActivity and trims to 6 each", () => {
    useQueueStore.getState().applyEvent({
      type: "queue_update",
      steering: Array.from({ length: 8 }, (_, i) => `s${i}`),
      followUp: Array.from({ length: 8 }, (_, i) => `f${i}`),
    });
    const labels = useQueueStore.getState().items.map((item) => item.label);
    expect(labels.filter((label) => label.startsWith("s"))).toHaveLength(6);
    expect(labels.filter((label) => label.startsWith("f"))).toHaveLength(6);

    useQueueStore.getState().applyEvent({
      type: "queue_update",
      steering: [],
      followUp: [],
    });
    expect(useQueueStore.getState().lastActivity).toBeNull();
    expect(useQueueStore.getState().items.some((item) => item.id.startsWith("queue:steer:"))).toBe(false);
  });

  it("clear resets snapshot fields including lastCompletedAt", () => {
    useQueueStore.getState().applyEvent({ type: "agent_start" });
    useQueueStore.getState().applyEvent({ type: "agent_end" });
    useQueueStore.getState().clear();
    expect(useQueueStore.getState()).toMatchObject({
      steering: [],
      followUp: [],
      items: [],
      updatedAt: null,
      running: false,
      autoRetrying: false,
      lastActivity: null,
      lastError: null,
      lastCompletedAt: null,
    });
  });

  // wave-128 residual
  it("agent_end after tool error marks completed and clears running without wiping lastError", () => {
    useQueueStore.getState().applyEvent({ type: "agent_start" });
    useQueueStore.getState().applyEvent({
      type: "tool_execution_end",
      toolCallId: "tc-err",
      toolName: "Bash",
      isError: true,
    } as never);
    expect(useQueueStore.getState().lastError).toBe("Bash 执行失败");
    useQueueStore.getState().applyEvent({ type: "agent_end" });
    const next = useQueueStore.getState();
    expect(next.running).toBe(false);
    expect(next.lastActivity).toBe("Agent 已结束");
    expect(next.lastCompletedAt).toEqual(expect.any(Number));
    // product: agent_end does not clear lastError set by tool failure
    expect(next.lastError).toBe("Bash 执行失败");
    expect(next.items.find((item) => item.id === "queue:running")?.status).toBe("completed");
  });

  it("applyEvent no-ops unknown and nullish-like payloads without throwing", () => {
    useQueueStore.getState().applyEvent({ type: "agent_start" });
    const before = useQueueStore.getState();
    expect(() => {
      useQueueStore.getState().applyEvent({ type: "not_a_real_event" } as never);
      useQueueStore.getState().applyEvent({ type: "message_update" } as never);
    }).not.toThrow();
    const after = useQueueStore.getState();
    expect(after.running).toBe(before.running);
    expect(after.lastActivity).toBe(before.lastActivity);
    expect(after.items).toEqual(before.items);
  });

  it("extension_error uses message/error/reason fallbacks", () => {
    useQueueStore.getState().applyEvent({ type: "agent_start" });
    useQueueStore.getState().applyEvent({
      type: "extension_error",
      error: "hook blew up",
    } as never);
    expect(useQueueStore.getState()).toMatchObject({
      running: false,
      lastActivity: "扩展错误",
      lastError: "hook blew up",
    });
    useQueueStore.getState().clear();
    useQueueStore.getState().applyEvent({ type: "extension_error" } as never);
    expect(useQueueStore.getState().lastError).toBe("任务运行时出现扩展错误");
  });

  // wave-144 residual
  it("turn_start/turn_end label items without clearing lastError on end", () => {
    useQueueStore.getState().applyEvent({ type: "turn_start" } as never);
    expect(useQueueStore.getState()).toMatchObject({
      running: true,
      lastActivity: "Turn 已开始",
      lastError: null,
    });
    useQueueStore.getState().applyEvent({
      type: "tool_execution_end",
      toolCallId: "tc1",
      toolName: "Read",
      isError: true,
    } as never);
    useQueueStore.getState().applyEvent({ type: "turn_end" } as never);
    const next = useQueueStore.getState();
    expect(next.running).toBe(false);
    expect(next.lastActivity).toBe("Turn 已结束");
    expect(next.lastError).toBe("Read 执行失败");
    expect(next.items.find((item) => item.id === "queue:running")?.meta).toBe("Turn");
  });

  it("auto_retry_start/end toggles autoRetrying and upserts retry item", () => {
    useQueueStore.getState().applyEvent({ type: "auto_retry_start" } as never);
    expect(useQueueStore.getState()).toMatchObject({
      running: true,
      autoRetrying: true,
      lastActivity: "自动重试中",
    });
    expect(useQueueStore.getState().items.some((i) => i.id === "queue:auto-retry")).toBe(true);
    useQueueStore.getState().applyEvent({ type: "auto_retry_end" } as never);
    expect(useQueueStore.getState().autoRetrying).toBe(false);
    expect(useQueueStore.getState().lastActivity).toBe("自动重试结束");
    expect(
      useQueueStore.getState().items.find((i) => i.id === "queue:auto-retry")?.status,
    ).toBe("completed");
  });

  it("tool_execution uses blank toolName fallback and clears lastError on success", () => {
    useQueueStore.getState().applyEvent({
      type: "tool_execution_start",
      toolCallId: "tc-blank",
      toolName: "   ",
    } as never);
    expect(useQueueStore.getState().lastActivity).toBe("工具 运行中");
    useQueueStore.getState().applyEvent({
      type: "tool_execution_end",
      toolCallId: "tc-blank",
      toolName: "   ",
      isError: true,
    } as never);
    expect(useQueueStore.getState().lastError).toBe("工具 执行失败");
    useQueueStore.getState().applyEvent({
      type: "tool_execution_end",
      toolCallId: "tc-ok",
      toolName: "Write",
      isError: false,
    } as never);
    expect(useQueueStore.getState().lastError).toBeNull();
    expect(useQueueStore.getState().lastActivity).toBe("Write 完成");
  });

  it("queue_update caps steer/followUp display items and may drop older non-queue items at 12", () => {
    useQueueStore.getState().applyEvent({
      type: "tool_execution_start",
      toolCallId: "keep-me",
      toolName: "Bash",
    } as never);
    // product: items = [steer≤6, follow≤6, non-queue...].slice(0, 12)
    // with 6+6 queued, tool item is beyond the cap and is dropped
    useQueueStore.getState().applyEvent({
      type: "queue_update",
      steering: Array.from({ length: 10 }, (_, i) => `steer-${i}`),
      followUp: Array.from({ length: 10 }, (_, i) => `follow-${i}`),
    } as never);
    const full = useQueueStore.getState();
    expect(full.steering).toHaveLength(10);
    expect(full.followUp).toHaveLength(10);
    expect(full.items.filter((i) => i.id.startsWith("queue:steer:"))).toHaveLength(6);
    expect(full.items.filter((i) => i.id.startsWith("queue:follow:"))).toHaveLength(6);
    expect(full.items).toHaveLength(12);
    expect(full.items.some((i) => i.id === "tool:keep-me")).toBe(false);
    expect(full.lastActivity).toBe("队列已更新");

    // smaller queues leave room for tool items after the queue rows
    useQueueStore.getState().clear();
    useQueueStore.getState().applyEvent({
      type: "tool_execution_start",
      toolCallId: "keep-me",
      toolName: "Bash",
    } as never);
    useQueueStore.getState().applyEvent({
      type: "queue_update",
      steering: ["s0", "s1"],
      followUp: ["f0"],
    } as never);
    const small = useQueueStore.getState();
    expect(small.items.some((i) => i.id === "tool:keep-me")).toBe(true);
    expect(small.items.filter((i) => i.id.startsWith("queue:steer:"))).toHaveLength(2);
    expect(small.items.filter((i) => i.id.startsWith("queue:follow:"))).toHaveLength(1);
  });

  it("extension_error prefers message over error/reason", () => {
    useQueueStore.getState().applyEvent({
      type: "extension_error",
      message: "primary",
      error: "secondary",
      reason: "tertiary",
    } as never);
    expect(useQueueStore.getState().lastError).toBe("primary");
  });

  // wave-204 residual
  it("agent_end clears autoRetrying and records lastCompletedAt", () => {
    useQueueStore.getState().applyEvent({ type: "auto_retry_start" } as never);
    expect(useQueueStore.getState().autoRetrying).toBe(true);
    useQueueStore.getState().applyEvent({ type: "agent_end" } as never);
    const next = useQueueStore.getState();
    expect(next.running).toBe(false);
    expect(next.autoRetrying).toBe(false);
    expect(next.lastCompletedAt).toEqual(expect.any(Number));
    expect(next.lastActivity).toBe("Agent 已结束");
    expect(next.items.find((i) => i.id === "queue:running")?.status).toBe("completed");
  });

  it("tool_execution_update with blank name uses 工具 fallback and keeps running", () => {
    useQueueStore.getState().applyEvent({
      type: "tool_execution_update",
      toolCallId: "tc-u",
      toolName: "  ",
    } as never);
    const s = useQueueStore.getState();
    expect(s.running).toBe(true);
    expect(s.lastActivity).toBe("工具 运行中");
    expect(s.items.find((i) => i.id === "tool:tc-u")).toMatchObject({
      label: "工具 运行中",
      status: "running",
      meta: "Tool",
    });
  });

  it("upsertQueueItem replaces same id and caps items at 12", () => {
    for (let i = 0; i < 15; i++) {
      useQueueStore.getState().applyEvent({
        type: "tool_execution_start",
        toolCallId: `tc-${i}`,
        toolName: `T${i}`,
      } as never);
    }
    expect(useQueueStore.getState().items).toHaveLength(12);
    // newest upserts land at front; oldest drop off
    expect(useQueueStore.getState().items[0]?.id).toBe("tool:tc-14");
    useQueueStore.getState().applyEvent({
      type: "tool_execution_end",
      toolCallId: "tc-14",
      toolName: "T14",
      isError: false,
    } as never);
    const updated = useQueueStore.getState().items.find((i) => i.id === "tool:tc-14");
    expect(updated?.status).toBe("completed");
    expect(updated?.label).toBe("T14 完成");
    expect(useQueueStore.getState().items).toHaveLength(12);
  });

  it("empty queue_update clears lastActivity; clear resets all snapshot fields", () => {
    useQueueStore.getState().applyEvent({
      type: "queue_update",
      steering: ["a"],
      followUp: ["b"],
    } as never);
    expect(useQueueStore.getState().lastActivity).toBe("队列已更新");
    useQueueStore.getState().applyEvent({
      type: "queue_update",
      steering: [],
      followUp: [],
    } as never);
    expect(useQueueStore.getState().steering).toEqual([]);
    expect(useQueueStore.getState().followUp).toEqual([]);
    expect(useQueueStore.getState().lastActivity).toBeNull();
    useQueueStore.getState().applyEvent({ type: "agent_start" } as never);
    useQueueStore.getState().clear();
    expect(useQueueStore.getState()).toMatchObject({
      steering: [],
      followUp: [],
      items: [],
      updatedAt: null,
      running: false,
      autoRetrying: false,
      lastActivity: null,
      lastError: null,
      lastCompletedAt: null,
    });
  });

  it("extension_error falls back to reason then default text", () => {
    useQueueStore.getState().applyEvent({
      type: "extension_error",
      reason: "only-reason",
    } as never);
    expect(useQueueStore.getState().lastError).toBe("only-reason");
    useQueueStore.getState().clear();
    useQueueStore.getState().applyEvent({
      type: "extension_error",
      message: "   ",
    } as never);
    // product: whitespace-only message is falsy after trim → default
    expect(useQueueStore.getState().lastError).toBe("任务运行时出现扩展错误");
  });
});
