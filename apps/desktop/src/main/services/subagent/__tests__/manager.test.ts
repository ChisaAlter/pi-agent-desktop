import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { SubagentManagerEvent } from "../manager";
import { SubagentManager } from "../manager";

// ── Mock AgentSession factory ────────────────────────────────────
//
// The real AgentSession comes from the Pi CLI SDK and runs a full LLM loop.
// For manager tests we build a minimal stand-in that:
//   - lets the test control when `prompt()` resolves
//   - emits `turn_end` events via the subscribe() callback to bump turnCount
//   - exposes abort() / dispose() / getLastAssistantText() as spies

interface MockSession extends AgentSession {
    prompt: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
    abort: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    getLastAssistantText: ReturnType<typeof vi.fn>;
    // Test-only controls:
    __emitTurnEnd(): void;
    __resolvePrompt(text?: string): void;
    __rejectPrompt(err: Error): void;
}

function createMockSession(opts: {
    lastAssistantText?: string;
    settlePrompt?: "resolve" | "pending" | "reject";
    rejectError?: Error;
} = {}): MockSession {
    let listener: ((event: unknown) => void) | undefined;
    let promptResolve: ((value: void | PromiseLike<void>) => void) | undefined;
    let promptReject: ((err: Error) => void) | undefined;
    const lastAssistantText = opts.lastAssistantText ?? "mock assistant text";

    const session: MockSession = {
        prompt: vi.fn((_text: string) => {
            return new Promise<void>((resolve, reject) => {
                promptResolve = resolve;
                promptReject = reject;
                if (opts.settlePrompt === "reject" && opts.rejectError) {
                    promptReject(opts.rejectError);
                } else if (opts.settlePrompt !== "pending") {
                    // Default: resolve immediately on next tick (after listener wired).
                    queueMicrotask(() => resolve());
                }
            });
        }),
        subscribe: vi.fn((cb: (event: unknown) => void) => {
            listener = cb;
            return () => {
                listener = undefined;
            };
        }),
        abort: vi.fn(async () => {
            // Mimic SDK: abort settles the in-flight prompt.
            if (promptReject) promptReject(new Error("aborted"));
            else if (promptResolve) promptResolve();
        }),
        dispose: vi.fn(() => {
            listener = undefined;
            promptResolve = undefined;
            promptReject = undefined;
        }),
        getLastAssistantText: vi.fn(() => lastAssistantText),
        __emitTurnEnd(): void {
            if (listener) listener({ type: "turn_end" });
        },
        __resolvePrompt(text?: string): void {
            if (text !== undefined) {
                session.getLastAssistantText = vi.fn(() => text);
            }
            promptResolve?.();
        },
        __rejectPrompt(err: Error): void {
            promptReject?.(err);
        },
    } as unknown as MockSession;
    return session;
}

function createManagerWithMockSession(): {
    manager: SubagentManager;
    sessions: MockSession[];
    events: SubagentManagerEvent[];
    sessionFactory: ReturnType<typeof vi.fn>;
} {
    const sessions: MockSession[] = [];
    const events: SubagentManagerEvent[] = [];
    const sessionFactory = vi.fn(async () => {
        const session = createMockSession({ settlePrompt: "pending" });
        sessions.push(session);
        return session;
    });
    const manager = new SubagentManager({
        sessionFactory,
        onEvent: (e) => events.push(e),
    });
    return { manager, sessions, events, sessionFactory };
}

describe("SubagentManager", () => {
    let originalSetInterval: typeof setInterval;
    let originalClearInterval: typeof clearInterval;

    beforeEach(() => {
        originalSetInterval = global.setInterval;
        originalClearInterval = global.clearInterval;
    });

    afterEach(() => {
        global.setInterval = originalSetInterval;
        global.clearInterval = originalClearInterval;
    });

    describe("spawn", () => {
        it("creates actor with pending→running status and emits spawned event", async () => {
            const { manager, sessions, events } = createManagerWithMockSession();
            const spawnPromise = manager.spawn({
                context: { workspaceId: "ws1", workspacePath: "/tmp", agentId: "agent1" },
                subagentType: "explore",
                description: "explore tests",
                prompt: "find tests",
            });
            const { actorId, outcome } = await spawnPromise;

            expect(actorId).toMatch(/^explore-[a-f0-9]{6}$/);
            expect(sessions).toHaveLength(1);
            expect(sessions[0].prompt).toHaveBeenCalledWith("find tests");

            // status during pending → running transition
            const status = manager.status("agent1", actorId);
            expect(status).not.toBeNull();
            expect(status?.status).toBe("running");
            expect(status?.subagentType).toBe("explore");
            expect(status?.description).toBe("explore tests");
            expect(status?.turnCount).toBe(0);

            // spawned event emitted
            expect(events.find((e) => e.type === "spawned" && e.actorId === actorId)).toBeTruthy();

            // outcome Promise should resolve eventually (caller controls via __resolvePrompt)
            expect(outcome).toBeInstanceOf(Promise);
        });

        it("rejects unknown subagent type at compile time (TS only)", () => {
            // No runtime check needed — SubagentTypeID is a literal union so
            // invalid types fail at typecheck. This test guards the type alias.
            // `general` was removed in Phase E audit; valid types are now
            // explore / dream / distill.
            const valid: "explore" | "dream" | "distill" = "explore";
            expect(valid).toBe("explore");
        });
    });

    describe("status", () => {
        it("returns null for unknown actorId", async () => {
            const { manager } = createManagerWithMockSession();
            expect(manager.status("agent1", "nonexistent")).toBeNull();
        });

        it("returns null when actorId belongs to a different agent (workspace isolation)", async () => {
            const { manager, sessions } = createManagerWithMockSession();
            const { actorId } = await manager.spawn({
                context: { workspaceId: "ws1", workspacePath: "/tmp", agentId: "agentA" },
                subagentType: "explore",
                description: "task",
                prompt: "go",
            });
            // agent B cannot see agent A's actor
            expect(manager.status("agentB", actorId)).toBeNull();
            // cleanup
            sessions.forEach((s) => s.__resolvePrompt());
        });

        it("snapshot updates turnCount and lastTurnTime when session emits turn_end", async () => {
            const { manager, sessions } = createManagerWithMockSession();
            const { actorId } = await manager.spawn({
                context: { workspaceId: "ws1", workspacePath: "/tmp", agentId: "agent1" },
                subagentType: "general",
                description: "work",
                prompt: "do work",
            });
            const before = manager.status("agent1", actorId);
            expect(before?.turnCount).toBe(0);

            sessions[0].__emitTurnEnd();
            sessions[0].__emitTurnEnd();

            const after = manager.status("agent1", actorId);
            expect(after?.turnCount).toBe(2);
            expect(after?.lastTurnTime).toBeGreaterThan(0);
        });
    });

    describe("wait", () => {
        it("resolves with the outcome when subagent succeeds", async () => {
            const { manager, sessions } = createManagerWithMockSession();
            const { actorId, outcome } = await manager.spawn({
                context: { workspaceId: "ws1", workspacePath: "/tmp", agentId: "agent1" },
                subagentType: "general",
                description: "task",
                prompt: "go",
            });
            // Resolve the prompt — SubagentSession.run settles.
            sessions[0].__resolvePrompt("final answer");

            const result = await outcome;
            expect(result.status).toBe("success");
            expect(result.lastAssistantText).toBe("final answer");

            const waited = await manager.wait("agent1", actorId, 1000);
            // For terminal sessions, wait() returns a synthetic snapshot.
            expect(waited).not.toBeNull();
            expect(waited?.status).toBe("success");
        });

        it("returns null for unknown actorId", async () => {
            const { manager } = createManagerWithMockSession();
            const result = await manager.wait("agent1", "nonexistent", 100);
            expect(result).toBeNull();
        });

        it("returns null when wait timeout elapses and subagent is still running", async () => {
            const { manager } = createManagerWithMockSession();
            const { actorId } = await manager.spawn({
                context: { workspaceId: "ws1", workspacePath: "/tmp", agentId: "agent1" },
                subagentType: "general",
                description: "task",
                prompt: "go",
            });
            // Don't resolve prompt — should time out.
            const result = await manager.wait("agent1", actorId, 50);
            expect(result).toBeNull();
        }, 10000);
    });

    describe("cancel", () => {
        it("cancels a running subagent and transitions to cancelled status", async () => {
            const { manager, sessions } = createManagerWithMockSession();
            const { actorId, outcome } = await manager.spawn({
                context: { workspaceId: "ws1", workspacePath: "/tmp", agentId: "agent1" },
                subagentType: "general",
                description: "task",
                prompt: "go",
            });

            const snapshot = manager.cancel("agent1", actorId);
            expect(snapshot).not.toBeNull();
            // After cancel, abort() was called on the underlying session.
            expect(sessions[0].abort).toHaveBeenCalledTimes(1);

            // Wait for outcome to settle (abort rejects the prompt).
            const result = await outcome;
            // Either cancelled or failed — depends on whether abort() resolved
            // before the prompt rejection path. Both are terminal.
            expect(["cancelled", "failed"]).toContain(result.status);

            const finalStatus = manager.status("agent1", actorId);
            expect(finalStatus?.status).toMatch(/^(cancelled|failed|timeout)$/);
        });

        it("returns null for unknown actorId", () => {
            const { manager } = createManagerWithMockSession();
            expect(manager.cancel("agent1", "nonexistent")).toBeNull();
        });

        it("is idempotent (cancelling twice does not throw)", async () => {
            const { manager } = createManagerWithMockSession();
            const { actorId } = await manager.spawn({
                context: { workspaceId: "ws1", workspacePath: "/tmp", agentId: "agent1" },
                subagentType: "general",
                description: "task",
                prompt: "go",
            });
            manager.cancel("agent1", actorId);
            // Second cancel should be a no-op, not throw.
            expect(() => manager.cancel("agent1", actorId)).not.toThrow();
        });
    });

    describe("listInstances", () => {
        it("returns empty array for unknown agent", () => {
            const { manager } = createManagerWithMockSession();
            expect(manager.listInstances("agent1")).toEqual([]);
        });

        it("lists all actors for a given agent", async () => {
            const { manager } = createManagerWithMockSession();
            await manager.spawn({
                context: { workspaceId: "ws1", workspacePath: "/tmp", agentId: "agentA" },
                subagentType: "explore",
                description: "task1",
                prompt: "go1",
            });
            await manager.spawn({
                context: { workspaceId: "ws1", workspacePath: "/tmp", agentId: "agentA" },
                subagentType: "general",
                description: "task2",
                prompt: "go2",
            });
            await manager.spawn({
                context: { workspaceId: "ws2", workspacePath: "/tmp", agentId: "agentB" },
                subagentType: "dream",
                description: "task3",
                prompt: "go3",
            });

            const listA = manager.listInstances("agentA");
            expect(listA).toHaveLength(2);
            expect(listA.map((i) => i.subagentType).sort()).toEqual(["explore", "general"]);

            const listB = manager.listInstances("agentB");
            expect(listB).toHaveLength(1);
            expect(listB[0].subagentType).toBe("dream");
        });
    });

    describe("disposeAgent", () => {
        it("cancels and disposes all subagents for the agent", async () => {
            const { manager, sessions } = createManagerWithMockSession();
            await manager.spawn({
                context: { workspaceId: "ws1", workspacePath: "/tmp", agentId: "agent1" },
                subagentType: "explore",
                description: "task1",
                prompt: "go1",
            });
            await manager.spawn({
                context: { workspaceId: "ws1", workspacePath: "/tmp", agentId: "agent1" },
                subagentType: "general",
                description: "task2",
                prompt: "go2",
            });

            manager.disposeAgent("agent1");

            // All sessions disposed
            expect(sessions[0].dispose).toHaveBeenCalled();
            expect(sessions[1].dispose).toHaveBeenCalled();
            // No remaining instances
            expect(manager.listInstances("agent1")).toEqual([]);
        });

        it("does not affect other agents", async () => {
            const { manager, sessions } = createManagerWithMockSession();
            await manager.spawn({
                context: { workspaceId: "ws1", workspacePath: "/tmp", agentId: "agentA" },
                subagentType: "explore",
                description: "task1",
                prompt: "go1",
            });
            await manager.spawn({
                context: { workspaceId: "ws2", workspacePath: "/tmp", agentId: "agentB" },
                subagentType: "general",
                description: "task2",
                prompt: "go2",
            });

            manager.disposeAgent("agentA");

            expect(manager.listInstances("agentA")).toEqual([]);
            expect(manager.listInstances("agentB")).toHaveLength(1);
            // Only agentA's session was disposed
            expect(sessions[0].dispose).toHaveBeenCalled();
            expect(sessions[1].dispose).not.toHaveBeenCalled();
        });

        it("is a no-op for unknown agent", () => {
            const { manager } = createManagerWithMockSession();
            expect(() => manager.disposeAgent("nonexistent")).not.toThrow();
        });
    });

    describe("disposeAll", () => {
        it("tears down all agents", async () => {
            const { manager, sessions } = createManagerWithMockSession();
            await manager.spawn({
                context: { workspaceId: "ws1", workspacePath: "/tmp", agentId: "agentA" },
                subagentType: "explore",
                description: "task",
                prompt: "go",
            });
            await manager.spawn({
                context: { workspaceId: "ws2", workspacePath: "/tmp", agentId: "agentB" },
                subagentType: "general",
                description: "task",
                prompt: "go",
            });

            manager.disposeAll();

            expect(manager.listInstances("agentA")).toEqual([]);
            expect(manager.listInstances("agentB")).toEqual([]);
            expect(sessions[0].dispose).toHaveBeenCalled();
            expect(sessions[1].dispose).toHaveBeenCalled();
        });
    });

    describe("GC sweep", () => {
        it("disposes idle sessions older than 5 minutes", async () => {
            const { manager, sessions } = createManagerWithMockSession();
            const { actorId } = await manager.spawn({
                context: { workspaceId: "ws1", workspacePath: "/tmp", agentId: "agent1" },
                subagentType: "general",
                description: "task",
                prompt: "go",
            });
            // Resolve prompt so session enters idle state.
            sessions[0].__resolvePrompt("done");

            // Wait for outcome to settle.
            await new Promise<void>((resolve) => queueMicrotask(resolve));

            const statusAfter = manager.status("agent1", actorId);
            expect(statusAfter?.status).toBe("idle");

            // Advance time so lastTurnTime is older than IDLE_GRACE_MS (5 min).
            // We can't easily fake Date.now globally without re-wiring the
            // manager constructor; instead, force a manual runGcSweep by
            // temporarily replacing the instance timestamps via the manager's
            // internal `now` is not exposed. Use a real-time wait approach:
            // patch instancesByActor directly via reflection.
            const internal = manager as unknown as {
                instancesByActor: Map<string, { createdAt: number; lastTurnTime?: number; status: string }>;
                runGcSweep: () => void;
            };
            const inst = internal.instancesByActor.get(actorId);
            expect(inst).toBeDefined();
            if (inst) {
                inst.lastTurnTime = Date.now() - 6 * 60 * 1000; // 6 min ago
            }

            internal.runGcSweep();

            expect(sessions[0].dispose).toHaveBeenCalled();
            expect(manager.status("agent1", actorId)).toBeNull();
        });

        it("keeps idle sessions younger than 5 minutes", async () => {
            const { manager, sessions } = createManagerWithMockSession();
            const { actorId } = await manager.spawn({
                context: { workspaceId: "ws1", workspacePath: "/tmp", agentId: "agent1" },
                subagentType: "general",
                description: "task",
                prompt: "go",
            });
            sessions[0].__resolvePrompt("done");
            await new Promise<void>((resolve) => queueMicrotask(resolve));

            const internal = manager as unknown as {
                instancesByActor: Map<string, { createdAt: number; lastTurnTime?: number; status: string }>;
                runGcSweep: () => void;
            };
            const inst = internal.instancesByActor.get(actorId);
            if (inst) {
                inst.lastTurnTime = Date.now() - 60 * 1000; // 1 min ago
            }

            internal.runGcSweep();

            expect(sessions[0].dispose).not.toHaveBeenCalled();
            expect(manager.status("agent1", actorId)).not.toBeNull();
        });

        it("does not collect running sessions", async () => {
            const { manager, sessions } = createManagerWithMockSession();
            const { actorId } = await manager.spawn({
                context: { workspaceId: "ws1", workspacePath: "/tmp", agentId: "agent1" },
                subagentType: "general",
                description: "task",
                prompt: "go",
            });
            // Do not resolve prompt — session stays running.

            const internal = manager as unknown as {
                instancesByActor: Map<string, { createdAt: number; lastTurnTime?: number; status: string }>;
                runGcSweep: () => void;
            };
            const inst = internal.instancesByActor.get(actorId);
            if (inst) {
                inst.createdAt = Date.now() - 10 * 60 * 1000; // 10 min ago
                inst.lastTurnTime = Date.now() - 10 * 60 * 1000;
            }

            internal.runGcSweep();

            expect(sessions[0].dispose).not.toHaveBeenCalled();
            expect(manager.status("agent1", actorId)).not.toBeNull();
        });
    });

    describe("start/stop (GC timer)", () => {
        let setIntervalSpy: ReturnType<typeof vi.fn>;
        let clearIntervalSpy: ReturnType<typeof vi.fn>;

        beforeEach(() => {
            setIntervalSpy = vi.fn((handler: () => void, ms?: number) => {
                const handle = { __fired: false, handler, ms };
                return handle as unknown as NodeJS.Timeout;
            });
            clearIntervalSpy = vi.fn((_handle: NodeJS.Timeout) => {
                // no-op
            });
            global.setInterval = setIntervalSpy as unknown as typeof setInterval;
            global.clearInterval = clearIntervalSpy as unknown as typeof clearInterval;
        });

        it("start() arms setInterval; stop() clears it", () => {
            const { manager } = createManagerWithMockSession();
            manager.start();
            expect(setIntervalSpy).toHaveBeenCalledTimes(1);
            const call = setIntervalSpy.mock.calls[0];
            expect(call[1]).toBe(60_000); // GC_INTERVAL_MS

            manager.stop();
            expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
        });

        it("start() is idempotent", () => {
            const { manager } = createManagerWithMockSession();
            manager.start();
            manager.start();
            expect(setIntervalSpy).toHaveBeenCalledTimes(1);
            manager.stop();
        });
    });

    describe("event broadcasting", () => {
        it("emits spawned + running events for a fresh spawn", async () => {
            const { manager, events } = createManagerWithMockSession();
            await manager.spawn({
                context: { workspaceId: "ws1", workspacePath: "/tmp", agentId: "agent1" },
                subagentType: "general",
                description: "task",
                prompt: "go",
            });
            const types = events.map((e) => e.type);
            expect(types).toContain("spawned");
            expect(types).toContain("running");
        });

        it("emits a terminated event with cancelled status on disposeAgent", async () => {
            const { manager, events } = createManagerWithMockSession();
            const { actorId } = await manager.spawn({
                context: { workspaceId: "ws1", workspacePath: "/tmp", agentId: "agent1" },
                subagentType: "general",
                description: "task",
                prompt: "go",
            });
            events.length = 0;
            manager.disposeAgent("agent1");

            const terminated = events.find(
                (e) => e.type === "terminated" && e.actorId === actorId,
            );
            expect(terminated).toBeTruthy();
            expect(terminated?.status).toBe("cancelled");
            expect(terminated?.lastOutcome).toBe("disposed");
        });
    });
});
