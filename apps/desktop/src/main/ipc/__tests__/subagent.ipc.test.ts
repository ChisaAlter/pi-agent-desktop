// Tests for setupSubagentIpc (Phase E Task 6 SubTask 6.7)
//
// Covers the 3 request-response handlers:
//  - subagent:list-types     — returns 3 built-ins; dream/distill carry `hidden: true`
//  - subagent:list-instances — returns SubagentInstance[] from the manager
//  - subagent:cancel         — calls manager.cancel; returns null on unknown actorId
//
// Zod validation failures return IpcError (not throw). The handler never sees
// the manager raise (all manager methods are synchronous and don't throw on
// unknown ids), but we still test the try/catch path with a mock that throws.

import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock("electron", () => ({
    ipcMain: {
        handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
            handlers.set(channel, handler);
        }),
        on: vi.fn(),
    },
}));

vi.mock("electron-log/main", () => ({
    default: {
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
    },
}));

import { setupSubagentIpc } from "../subagent.ipc";
import { isIpcError } from "@shared";
import type { SubagentInstance } from "@shared";

function makeManagerMock(opts: {
    listInstances?: (agentId: string) => SubagentInstance[];
    cancel?: (agentId: string, actorId: string) => SubagentInstance | null;
} = {}): {
    listInstances: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
} {
    return {
        listInstances: vi.fn(opts.listInstances ?? (() => [])),
        cancel: vi.fn(opts.cancel ?? (() => null)),
    };
}

describe("setupSubagentIpc", () => {
    beforeEach(() => {
        handlers.clear();
    });

    describe("subagent:list-types", () => {
        it("returns all 4 built-in subagent types (checkpoint-writer added in Task 5)", async () => {
            const manager = makeManagerMock();
            setupSubagentIpc({ subagentManager: manager as never });

            const handler = handlers.get("subagent:list-types");
            expect(handler).toBeTruthy();
            const result = await handler?.({}, {});

            expect(Array.isArray(result)).toBe(true);
            expect(result).toHaveLength(4);
            const names = (result as Array<{ name: string }>).map((r) => r.name).sort();
            expect(names).toEqual(["checkpoint-writer", "distill", "dream", "explore"].sort());
        });

        it("marks dream, distill, and checkpoint-writer as hidden", async () => {
            const manager = makeManagerMock();
            setupSubagentIpc({ subagentManager: manager as never });

            const handler = handlers.get("subagent:list-types");
            const result = (await handler?.({}, {})) as Array<{
                name: string;
                hidden?: boolean;
            }>;
            const byName = Object.fromEntries(result.map((r) => [r.name, r]));
            expect(byName.dream.hidden).toBe(true);
            expect(byName.distill.hidden).toBe(true);
            expect(byName["checkpoint-writer"].hidden).toBe(true);
            // explore is spawnable via the actor tool → hidden is
            // falsy (undefined is acceptable; the spec doesn't require `false`).
            expect(byName.explore.hidden ?? false).toBe(false);
        });

        it("accepts a workspaceId argument (currently ignored)", async () => {
            const manager = makeManagerMock();
            setupSubagentIpc({ subagentManager: manager as never });

            const handler = handlers.get("subagent:list-types");
            const result = await handler?.({}, { workspaceId: "ws-1" });
            expect(Array.isArray(result)).toBe(true);
            expect(result).toHaveLength(4);
        });

        it("returns IpcError when input shape is wrong", async () => {
            const manager = makeManagerMock();
            setupSubagentIpc({ subagentManager: manager as never });

            const handler = handlers.get("subagent:list-types");
            // workspaceId must be a string — pass a number to trigger Zod error.
            const result = await handler?.({}, { workspaceId: 42 });
            expect(isIpcError(result)).toBe(true);
        });

        it("returns defensive copies (mutating one entry doesn't affect the registry)", async () => {
            const manager = makeManagerMock();
            setupSubagentIpc({ subagentManager: manager as never });

            const handler = handlers.get("subagent:list-types");
            const first = (await handler?.({}, {})) as Array<{ name: string }>;
            const second = (await handler?.({}, {})) as Array<{ name: string }>;
            first[0].name = "tampered";
            expect(second[0].name).not.toBe("tampered");
        });
    });

    describe("subagent:list-instances", () => {
        it("returns empty array for an agent with no actors", async () => {
            const manager = makeManagerMock({ listInstances: () => [] });
            setupSubagentIpc({ subagentManager: manager as never });

            const handler = handlers.get("subagent:list-instances");
            const result = await handler?.({}, { agentId: "agent-1" });
            expect(result).toEqual([]);
            expect(manager.listInstances).toHaveBeenCalledWith("agent-1");
        });

        it("returns instances with defensive copies", async () => {
            const instance: SubagentInstance = {
                actorId: "explore-abc123",
                agentId: "agent-1",
                workspaceId: "ws-1",
                subagentType: "explore",
                description: "scout tests",
                status: "running",
                turnCount: 3,
                createdAt: 1000,
            };
            const manager = makeManagerMock({ listInstances: () => [instance] });
            setupSubagentIpc({ subagentManager: manager as never });

            const handler = handlers.get("subagent:list-instances");
            const result = (await handler?.({}, { agentId: "agent-1" })) as SubagentInstance[];
            expect(result).toHaveLength(1);
            expect(result[0]).toEqual(instance);
            // Mutate the returned copy and verify the manager's internal state
            // is unaffected (we can't reach into the mock — but the IPC layer
            // does `{ ...inst }`, so a different object identity is the proof).
            expect(result[0]).not.toBe(instance);
        });

        it("returns IpcError when agentId is missing", async () => {
            const manager = makeManagerMock();
            setupSubagentIpc({ subagentManager: manager as never });

            const handler = handlers.get("subagent:list-instances");
            const result = await handler?.({}, {});
            expect(isIpcError(result)).toBe(true);
        });

        it("returns IpcError when agentId is empty", async () => {
            const manager = makeManagerMock();
            setupSubagentIpc({ subagentManager: manager as never });

            const handler = handlers.get("subagent:list-instances");
            const result = await handler?.({}, { agentId: "" });
            expect(isIpcError(result)).toBe(true);
        });

        it("returns IpcError when manager.listInstances throws", async () => {
            const manager = makeManagerMock({
                listInstances: () => {
                    throw new Error("boom");
                },
            });
            setupSubagentIpc({ subagentManager: manager as never });

            const handler = handlers.get("subagent:list-instances");
            const result = await handler?.({}, { agentId: "agent-1" });
            expect(isIpcError(result)).toBe(true);
        });
    });

    describe("subagent:cancel", () => {
        it("returns null when the actor is unknown", async () => {
            const manager = makeManagerMock({ cancel: () => null });
            setupSubagentIpc({ subagentManager: manager as never });

            const handler = handlers.get("subagent:cancel");
            const result = await handler?.({}, { agentId: "agent-1", actorId: "explore-deadbe" });
            expect(result).toBeNull();
            expect(manager.cancel).toHaveBeenCalledWith("agent-1", "explore-deadbe");
        });

        it("returns the post-cancel snapshot when the actor is running", async () => {
            const snapshot: SubagentInstance = {
                actorId: "explore-abc123",
                agentId: "agent-1",
                workspaceId: "ws-1",
                subagentType: "explore",
                description: "scout tests",
                status: "cancelled",
                turnCount: 1,
                createdAt: 1000,
                terminatedAt: 2000,
            };
            const manager = makeManagerMock({ cancel: () => snapshot });
            setupSubagentIpc({ subagentManager: manager as never });

            const handler = handlers.get("subagent:cancel");
            const result = (await handler?.({}, { agentId: "agent-1", actorId: "explore-abc123" })) as SubagentInstance;
            expect(result).toEqual(snapshot);
            expect(result).not.toBe(snapshot); // defensive copy
        });

        it("returns IpcError when agentId or actorId is missing", async () => {
            const manager = makeManagerMock();
            setupSubagentIpc({ subagentManager: manager as never });

            const handler = handlers.get("subagent:cancel");
            expect(isIpcError(await handler?.({}, { agentId: "agent-1" }))).toBe(true);
            expect(isIpcError(await handler?.({}, { actorId: "explore-abc" }))).toBe(true);
            expect(isIpcError(await handler?.({}, {}))).toBe(true);
        });

        it("returns IpcError when manager.cancel throws", async () => {
            const manager = makeManagerMock({
                cancel: () => {
                    throw new Error("boom");
                },
            });
            setupSubagentIpc({ subagentManager: manager as never });

            const handler = handlers.get("subagent:cancel");
            const result = await handler?.({}, { agentId: "agent-1", actorId: "explore-abc" });
            expect(isIpcError(result)).toBe(true);
        });
    });
});
