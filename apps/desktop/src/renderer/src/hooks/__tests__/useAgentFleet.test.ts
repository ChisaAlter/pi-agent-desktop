import { describe, expect, it } from "vitest";
import type { AgentRuntimeState, AgentTab } from "@shared";
import { computeFleetStatus, extractFleetSummary, emptyFleetCounts, type FleetBlockedSignals } from "../useAgentFleet";

function makeAgent(overrides: Partial<AgentTab> = {}): AgentTab {
    return {
        id: "agent-1",
        workspaceId: "ws-1",
        title: "测试 Agent",
        status: "idle",
        createdAt: 1,
        updatedAt: 1,
        ...overrides,
    };
}

function makeRuntime(overrides: Partial<AgentRuntimeState> = {}): AgentRuntimeState {
    return {
        agentId: "agent-1",
        status: "idle",
        isStreaming: false,
        ...overrides,
    };
}

const noSignals: FleetBlockedSignals = { pendingPermission: false, pendingPlan: false, pendingApproval: false, queueBlocked: false };

describe("computeFleetStatus — herdr 式五态合成", () => {
    it("closed / error 直接透传, 优先于一切", () => {
        expect(computeFleetStatus(makeAgent({ status: "closed" }), makeRuntime(), noSignals)).toBe("closed");
        expect(computeFleetStatus(makeAgent({ status: "error" }), makeRuntime(), noSignals)).toBe("error");
        // error 优先于 blocked 信号
        expect(
            computeFleetStatus(
                makeAgent({ status: "error" }),
                makeRuntime(),
                { ...noSignals, pendingPermission: true },
            ),
        ).toBe("error");
    });

    it("阻塞信号优先于 running: 等审批/等计划/排队/等权限都是 blocked", () => {
        const running = makeAgent({ status: "running" });
        expect(computeFleetStatus(running, makeRuntime({ isStreaming: true }), noSignals)).toBe("working");
        expect(
            computeFleetStatus(running, makeRuntime({ isStreaming: true }), { ...noSignals, pendingPermission: true }),
        ).toBe("blocked");
        expect(
            computeFleetStatus(running, makeRuntime({ isStreaming: true }), { ...noSignals, pendingPlan: true }),
        ).toBe("blocked");
        expect(
            computeFleetStatus(running, makeRuntime({ isStreaming: true }), { ...noSignals, pendingApproval: true }),
        ).toBe("blocked");
        expect(
            computeFleetStatus(running, makeRuntime({ isStreaming: true }), { ...noSignals, queueBlocked: true }),
        ).toBe("blocked");
    });

    it("running / starting / isStreaming → working", () => {
        expect(computeFleetStatus(makeAgent({ status: "running" }), makeRuntime(), noSignals)).toBe("working");
        expect(computeFleetStatus(makeAgent({ status: "starting" }), makeRuntime(), noSignals)).toBe("working");
        expect(computeFleetStatus(makeAgent(), makeRuntime({ isStreaming: true }), noSignals)).toBe("working");
        expect(computeFleetStatus(makeAgent(), makeRuntime({ status: "running" }), noSignals)).toBe("working");
    });

    it("idle 无信号 → idle", () => {
        expect(computeFleetStatus(makeAgent(), makeRuntime(), noSignals)).toBe("idle");
    });
});

describe("extractFleetSummary — 活动行提取", () => {
    it("取最后一条非空 assistant 文本做摘要, 并保留计数", () => {
        const result = extractFleetSummary([
            { id: "u1", agentId: "a", role: "user", content: "hello", createdAt: 1 },
            { id: "m1", agentId: "a", role: "assistant", content: "   ", createdAt: 2 },
            { id: "m2", agentId: "a", role: "assistant", content: "这是最终回答", createdAt: 3 },
        ]);
        expect(result.summary).toBe("这是最终回答");
        expect(result.messageCount).toBe(3);
        expect(result.hasAssistantOutput).toBe(true);
    });

    it("没有 assistant 文本时用最后一条工具调用做活动行", () => {
        const result = extractFleetSummary([
            { id: "u1", agentId: "a", role: "user", content: "hello", createdAt: 1 },
            { id: "t1", agentId: "a", role: "tool", content: '{"name":"bash"}', createdAt: 2 },
        ]);
        expect(result.summary).toBe("");
        expect(result.toolCall).toBe('{"name":"bash"}');
        expect(result.hasAssistantOutput).toBe(false);
    });

    it("超长摘要截断为头 + 省略号 + 尾", () => {
        const long = "a".repeat(500);
        const result = extractFleetSummary([
            { id: "m1", agentId: "a", role: "assistant", content: long, createdAt: 1 },
        ]);
        expect(result.summary.length).toBeLessThan(140);
        expect(result.summary).toContain("…");
    });

    it("摘要剥掉 markdown 代码围栏标记", () => {
        const result = extractFleetSummary([
            { id: "m1", agentId: "a", role: "assistant", content: "已将 base.txt 内容改为：\n```text\nhello-from-live-agent\n```", createdAt: 1 },
        ]);
        expect(result.summary).not.toContain("```");
        expect(result.summary).toContain("hello-from-live-agent");
    });

    it("空消息列表 → 空摘要", () => {
        const result = extractFleetSummary([]);
        expect(result.summary).toBe("");
        expect(result.toolCall).toBeNull();
        expect(result.messageCount).toBe(0);
        expect(result.hasAssistantOutput).toBe(false);
    });
});

describe("emptyFleetCounts", () => {
    it("全状态初始为 0", () => {
        const counts = emptyFleetCounts();
        expect(counts).toEqual({ working: 0, blocked: 0, done: 0, idle: 0, error: 0, closed: 0 });
    });
});
