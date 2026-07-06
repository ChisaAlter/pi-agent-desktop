import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SubagentInstance, SubagentResult } from "@shared";
import { createActorTool } from "../actor-tool";
import type { SubagentManager } from "../manager";

// ── Mock SubagentManager ────────────────────────────────────────
//
// The actor tool only calls 4 manager methods (spawn / status / wait / cancel).
// We mock each directly with vi.fn() so tests can control return values and
// assert call args without spinning up a real SubagentSession.

function createMockManager(): {
    manager: SubagentManager;
    spawn: ReturnType<typeof vi.fn>;
    status: ReturnType<typeof vi.fn>;
    wait: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
} {
    const spawn = vi.fn();
    const status = vi.fn();
    const wait = vi.fn();
    const cancel = vi.fn();
    const manager = {
        spawn,
        status,
        wait,
        cancel,
        // Methods not used by the actor tool but required by the interface:
        listInstances: vi.fn(() => []),
        disposeAgent: vi.fn(),
        disposeAll: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
    } as unknown as SubagentManager;
    return { manager, spawn, status, wait, cancel };
}

function createSuccessResult(actorId: string, text = "task done"): SubagentResult {
    return {
        actorId,
        status: "success",
        lastAssistantText: text,
        turnCount: 1,
        startedAt: 1000,
        endedAt: 2000,
    };
}

function createSnapshot(actorId: string, overrides: Partial<SubagentInstance> = {}): SubagentInstance {
    return {
        actorId,
        agentId: "agent1",
        workspaceId: "ws1",
        subagentType: "explore",
        description: "test task",
        status: "running",
        turnCount: 1,
        createdAt: 1000,
        ...overrides,
    };
}

const WORKSPACE = { workspaceId: "ws1", workspacePath: "/tmp/repo" };

async function callActor(
    tool: ReturnType<typeof createActorTool>,
    operation: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }>; details: unknown }> {
    const result = await tool.execute(
        "test-call-id",
        { operation } as never,
        undefined,
        undefined,
        {} as never,
    );
    return result as unknown as { content: Array<{ type: string; text: string }>; details: unknown };
}

// ── Tests ───────────────────────────────────────────────────────

describe("createActorTool", () => {
    let mockManager: ReturnType<typeof createMockManager>;

    beforeEach(() => {
        mockManager = createMockManager();
    });

    describe("tool metadata", () => {
        it("exposes name/label/description and TypeBox parameters schema", () => {
            const tool = createActorTool(mockManager.manager, "agent1", WORKSPACE);
            expect(tool.name).toBe("actor");
            expect(tool.label).toBe("Actor");
            expect(tool.description).toContain("subagent");
            expect(tool.parameters).toBeDefined();
        });
    });

    describe("run action", () => {
        it("spawns subagent and returns success result with summary attr", async () => {
            const actorId = "explore-abc123";
            mockManager.spawn.mockResolvedValue({
                actorId,
                outcome: Promise.resolve(createSuccessResult(actorId, "summary line\nmore detail")),
            });

            const tool = createActorTool(mockManager.manager, "agent1", WORKSPACE);
            const result = await callActor(tool, {
                action: "run",
                subagent_type: "explore",
                description: "find tests",
                prompt: "find all test files",
            });

            expect(mockManager.spawn).toHaveBeenCalledWith(
                expect.objectContaining({
                    context: { workspaceId: "ws1", workspacePath: "/tmp/repo", agentId: "agent1" },
                    subagentType: "explore",
                    description: "find tests",
                    prompt: "find all test files",
                }),
            );
            const text = result.content[0].text;
            expect(text).toContain(`actor_id: ${actorId}`);
            expect(text).toContain('<actor_result status="success" summary="summary line">');
            expect(text).toContain("summary line\nmore detail");
            expect(text).toContain("</actor_result>");
        });

        it("omits summary attribute when first line is too long", async () => {
            const actorId = "general-xyz789";
            const longLine = "a".repeat(120);
            const text = `${longLine}\nsecond line`;
            mockManager.spawn.mockResolvedValue({
                actorId,
                outcome: Promise.resolve(createSuccessResult(actorId, text)),
            });

            const tool = createActorTool(mockManager.manager, "agent1", WORKSPACE);
            const result = await callActor(tool, {
                action: "run",
                subagent_type: "general",
                description: "long task",
                prompt: "go",
            });

            const resultText = result.content[0].text;
            expect(resultText).toContain('<actor_result status="success">');
            expect(resultText).not.toContain("summary=");
        });

        it("returns cancelled result format when subagent is cancelled", async () => {
            const actorId = "explore-can1";
            const cancelledResult: SubagentResult = {
                actorId,
                status: "cancelled",
                turnCount: 0,
                startedAt: 1000,
                endedAt: 2000,
            };
            mockManager.spawn.mockResolvedValue({
                actorId,
                outcome: Promise.resolve(cancelledResult),
            });

            const tool = createActorTool(mockManager.manager, "agent1", WORKSPACE);
            const result = await callActor(tool, {
                action: "run",
                subagent_type: "explore",
                description: "task",
                prompt: "go",
            });

            const text = result.content[0].text;
            expect(text).toContain('<actor_result status="cancelled">task was cancelled</actor_result>');
        });

        it("returns timeout result format when subagent times out", async () => {
            const actorId = "general-tim1";
            const timeoutResult: SubagentResult = {
                actorId,
                status: "timeout",
                turnCount: 5,
                startedAt: 1000,
                endedAt: 600000,
            };
            mockManager.spawn.mockResolvedValue({
                actorId,
                outcome: Promise.resolve(timeoutResult),
            });

            const tool = createActorTool(mockManager.manager, "agent1", WORKSPACE);
            const result = await callActor(tool, {
                action: "run",
                subagent_type: "general",
                description: "slow task",
                prompt: "go",
            });

            const text = result.content[0].text;
            expect(text).toContain('<actor_result status="timeout">task did not complete within timeout</actor_result>');
        });

        it("returns failure result format with escaped error message", async () => {
            const actorId = "general-fail";
            const failedResult: SubagentResult = {
                actorId,
                status: "failed",
                error: "LLM returned 500 <error>",
                turnCount: 0,
                startedAt: 1000,
                endedAt: 2000,
            };
            mockManager.spawn.mockResolvedValue({
                actorId,
                outcome: Promise.resolve(failedResult),
            });

            const tool = createActorTool(mockManager.manager, "agent1", WORKSPACE);
            const result = await callActor(tool, {
                action: "run",
                subagent_type: "general",
                description: "failing task",
                prompt: "go",
            });

            const text = result.content[0].text;
            expect(text).toContain('<actor_result status="failure">');
            expect(text).toContain("&lt;error&gt;");
            expect(text).toContain("</actor_result>");
        });

        it("rejects context='full' with a helpful error message", async () => {
            const tool = createActorTool(mockManager.manager, "agent1", WORKSPACE);
            await expect(
                callActor(tool, {
                    action: "run",
                    subagent_type: "explore",
                    description: "task",
                    prompt: "go",
                    context: "full",
                }),
            ).rejects.toThrow(/context='full' is not supported/);

            // Manager.spawn must not have been called — the tool fails fast.
            expect(mockManager.spawn).not.toHaveBeenCalled();
        });

        it("accepts context='none' and passes through to spawn", async () => {
            const actorId = "explore-non1";
            mockManager.spawn.mockResolvedValue({
                actorId,
                outcome: Promise.resolve(createSuccessResult(actorId)),
            });

            const tool = createActorTool(mockManager.manager, "agent1", WORKSPACE);
            await callActor(tool, {
                action: "run",
                subagent_type: "explore",
                description: "task",
                prompt: "go",
                context: "none",
            });

            expect(mockManager.spawn).toHaveBeenCalled();
        });

        it("accepts context='state' (treated as 'none' until Task 4)", async () => {
            const actorId = "general-sta1";
            mockManager.spawn.mockResolvedValue({
                actorId,
                outcome: Promise.resolve(createSuccessResult(actorId)),
            });

            const tool = createActorTool(mockManager.manager, "agent1", WORKSPACE);
            await callActor(tool, {
                action: "run",
                subagent_type: "general",
                description: "task",
                prompt: "go",
                context: "state",
            });

            expect(mockManager.spawn).toHaveBeenCalled();
        });

        it("forwards timeout_ms to manager.spawn", async () => {
            const actorId = "general-tmo1";
            mockManager.spawn.mockResolvedValue({
                actorId,
                outcome: Promise.resolve(createSuccessResult(actorId)),
            });

            const tool = createActorTool(mockManager.manager, "agent1", WORKSPACE);
            await callActor(tool, {
                action: "run",
                subagent_type: "general",
                description: "task",
                prompt: "go",
                timeout_ms: 30000,
            });

            expect(mockManager.spawn).toHaveBeenCalledWith(
                expect.objectContaining({ timeoutMs: 30000 }),
            );
        });
    });

    describe("status action", () => {
        it("returns snapshot for known actorId", async () => {
            const actorId = "explore-sta1";
            mockManager.status.mockReturnValue(createSnapshot(actorId, { status: "running", turnCount: 3 }));

            const tool = createActorTool(mockManager.manager, "agent1", WORKSPACE);
            const result = await callActor(tool, {
                action: "status",
                actor_id: actorId,
            });

            expect(mockManager.status).toHaveBeenCalledWith("agent1", actorId);
            const text = result.content[0].text;
            expect(text).toContain(`actor_id: ${actorId}`);
            expect(text).toContain("status: running");
            expect(text).toContain("subagent_type: explore");
            expect(text).toContain("turn_count: 3");
        });

        it("returns 'unknown' for unknown actorId", async () => {
            mockManager.status.mockReturnValue(null);

            const tool = createActorTool(mockManager.manager, "agent1", WORKSPACE);
            const result = await callActor(tool, {
                action: "status",
                actor_id: "nonexistent",
            });

            const text = result.content[0].text;
            expect(text).toContain("status: unknown");
        });

        it("includes last_outcome when present", async () => {
            const actorId = "general-out1";
            mockManager.status.mockReturnValue(
                createSnapshot(actorId, { lastOutcome: "success" }),
            );

            const tool = createActorTool(mockManager.manager, "agent1", WORKSPACE);
            const result = await callActor(tool, {
                action: "status",
                actor_id: actorId,
            });

            const text = result.content[0].text;
            expect(text).toContain("last_outcome: success");
        });
    });

    describe("wait action", () => {
        it("returns formatted result when wait resolves", async () => {
            const actorId = "explore-wai1";
            mockManager.wait.mockResolvedValue(createSuccessResult(actorId, "done waiting"));

            const tool = createActorTool(mockManager.manager, "agent1", WORKSPACE);
            const result = await callActor(tool, {
                action: "wait",
                actor_id: actorId,
                timeout_ms: 5000,
            });

            expect(mockManager.wait).toHaveBeenCalledWith("agent1", actorId, 5000);
            const text = result.content[0].text;
            expect(text).toContain('<actor_result status="success"');
            expect(text).toContain("done waiting");
        });

        it("returns 'unknown' when wait returns null", async () => {
            mockManager.wait.mockResolvedValue(null);

            const tool = createActorTool(mockManager.manager, "agent1", WORKSPACE);
            const result = await callActor(tool, {
                action: "wait",
                actor_id: "nonexistent",
            });

            const text = result.content[0].text;
            expect(text).toContain("status: unknown");
        });

        it("uses default timeout when timeout_ms omitted", async () => {
            const actorId = "general-wai2";
            mockManager.wait.mockResolvedValue(createSuccessResult(actorId));

            const tool = createActorTool(mockManager.manager, "agent1", WORKSPACE);
            await callActor(tool, {
                action: "wait",
                actor_id: actorId,
            });

            // manager.wait defaults to 10 min when timeout_ms is undefined.
            expect(mockManager.wait).toHaveBeenCalledWith("agent1", actorId, undefined);
        });
    });

    describe("cancel action", () => {
        it("returns snapshot for cancelled actor", async () => {
            const actorId = "explore-can1";
            mockManager.cancel.mockReturnValue(
                createSnapshot(actorId, { status: "cancelled", lastOutcome: "cancelled" }),
            );

            const tool = createActorTool(mockManager.manager, "agent1", WORKSPACE);
            const result = await callActor(tool, {
                action: "cancel",
                actor_id: actorId,
            });

            expect(mockManager.cancel).toHaveBeenCalledWith("agent1", actorId);
            const text = result.content[0].text;
            expect(text).toContain("status: cancelled");
        });

        it("returns 'unknown' for unknown actorId", async () => {
            mockManager.cancel.mockReturnValue(null);

            const tool = createActorTool(mockManager.manager, "agent1", WORKSPACE);
            const result = await callActor(tool, {
                action: "cancel",
                actor_id: "nonexistent",
            });

            const text = result.content[0].text;
            expect(text).toContain("status: unknown");
        });

        it("is idempotent — calling cancel on already-cancelled actor returns snapshot", async () => {
            const actorId = "general-can2";
            mockManager.cancel.mockReturnValue(
                createSnapshot(actorId, { status: "cancelled" }),
            );

            const tool = createActorTool(mockManager.manager, "agent1", WORKSPACE);
            const first = await callActor(tool, { action: "cancel", actor_id: actorId });
            const second = await callActor(tool, { action: "cancel", actor_id: actorId });

            // Manager.cancel is called twice; both return the same snapshot.
            expect(mockManager.cancel).toHaveBeenCalledTimes(2);
            expect(first.content[0].text).toContain("status: cancelled");
            expect(second.content[0].text).toContain("status: cancelled");
        });
    });

    describe("result details payload", () => {
        it("attaches SubagentResult as details on run", async () => {
            const actorId = "general-det1";
            const result = createSuccessResult(actorId, "details test");
            mockManager.spawn.mockResolvedValue({
                actorId,
                outcome: Promise.resolve(result),
            });

            const tool = createActorTool(mockManager.manager, "agent1", WORKSPACE);
            const output = await callActor(tool, {
                action: "run",
                subagent_type: "general",
                description: "task",
                prompt: "go",
            });

            expect(output.details).toEqual({ result });
        });

        it("attaches SubagentInstance as details on status", async () => {
            const actorId = "general-det2";
            const snapshot = createSnapshot(actorId);
            mockManager.status.mockReturnValue(snapshot);

            const tool = createActorTool(mockManager.manager, "agent1", WORKSPACE);
            const output = await callActor(tool, {
                action: "status",
                actor_id: actorId,
            });

            expect(output.details).toEqual({ snapshot });
        });
    });

    describe("summary extraction edge cases", () => {
        it("handles empty lastAssistantText", async () => {
            const actorId = "general-emp1";
            mockManager.spawn.mockResolvedValue({
                actorId,
                outcome: Promise.resolve(createSuccessResult(actorId, "")),
            });

            const tool = createActorTool(mockManager.manager, "agent1", WORKSPACE);
            const result = await callActor(tool, {
                action: "run",
                subagent_type: "general",
                description: "task",
                prompt: "go",
            });

            const text = result.content[0].text;
            // No summary attr when there's no text.
            expect(text).toContain('<actor_result status="success">');
            expect(text).not.toContain("summary=");
        });

        it("escapes XML special chars in summary attribute", async () => {
            const actorId = "general-esc1";
            const summary = `He said "hi" & <left>`;
            mockManager.spawn.mockResolvedValue({
                actorId,
                outcome: Promise.resolve(createSuccessResult(actorId, summary)),
            });

            const tool = createActorTool(mockManager.manager, "agent1", WORKSPACE);
            const result = await callActor(tool, {
                action: "run",
                subagent_type: "general",
                description: "task",
                prompt: "go",
            });

            const text = result.content[0].text;
            expect(text).toContain('summary="He said &quot;hi&quot; &amp; &lt;left&gt;"');
        });
    });
});
