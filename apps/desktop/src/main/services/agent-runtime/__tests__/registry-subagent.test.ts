/**
 * Phase E Task 7.7 — tests for SubagentManager integration in
 * AgentRuntimeRegistry.
 *
 * Coverage:
 *  - `getSubagentManager` returning null/undefined → no `customTools` injected
 *    (primary agent still works, just without the `actor` tool).
 *  - `getSubagentManager` returning a manager → `customTools` array passed
 *    to `createWorkspaceSession` contains exactly one entry.
 *  - `stop()` cascades into `manager.disposeAgent(agentId)`.
 *  - `disposeAll()` cascades into `manager.disposeAll()`.
 *  - `createActorTool` throwing (e.g., empty subagent registry) is caught —
 *    session creation survives with an empty `customTools` array.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentRuntimeRegistry } from "../registry";
import { PendingEdits } from "../../approval/pending-edits";

const sessions: Array<{
    prompt: ReturnType<typeof vi.fn>;
    abort: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
    subscribers: Array<(event: unknown) => void | Promise<void>>;
}> = [];

// Track the opts passed to `createWorkspaceSession` so we can assert on
// `customTools` shape.
let lastSessionOpts: { customTools?: unknown[] } | null = null;

vi.mock("../../pi-session/factory", () => ({
    createWorkspaceSession: vi.fn(async (opts: { workspaceId: string }) => {
        lastSessionOpts = opts;
        const index = sessions.length + 1;
        const subscribers: Array<(event: unknown) => void | Promise<void>> = [];
        const session = {
            prompt: vi.fn(async () => {
                const delta = index === 2 ? "short" : index === 3 ? "longer candidate answer" : "";
                if (delta) {
                    await Promise.all(subscribers.map((subscriber) => subscriber({ type: "text_delta", delta })));
                }
            }),
            abort: vi.fn(),
            dispose: vi.fn(),
            subscribe: vi.fn((subscriber: (event: unknown) => void | Promise<void>) => {
                subscribers.push(subscriber);
            }),
            subscribers,
        };
        sessions.push(session);
        return {
            workspaceId: opts.workspaceId,
            session,
            dispose: session.dispose,
        };
    }),
    resolveBundledDesktopExtensionPaths: vi.fn(() => []),
}));

vi.mock("../../approval/interceptor", () => ({
    createApprovalInterceptor: vi.fn(() => ({ handleEvent: vi.fn(async () => undefined) })),
}));

vi.mock("electron-log/main", () => ({
    default: {
        error: vi.fn(),
        warn: vi.fn(),
    },
}));

vi.mock("../../extensions/extension-ui-bridge", () => ({
    createExtensionUiBridge: vi.fn(() => ({})),
}));

// Stub `createActorTool` so we don't need the real Pi CLI SDK to construct it.
// The stubbed factory records calls and lets us simulate the throw path.
// `vi.hoisted` is required because `vi.mock` is hoisted above const
// declarations — without it, `createActorToolMock` would be undefined inside
// the mock factory.
const { createActorToolMock } = vi.hoisted(() => ({
    createActorToolMock: vi.fn(() => ({ name: "actor", _stub: true }) as never),
}));
vi.mock("../../subagent/actor-tool", () => ({
    createActorTool: (...args: unknown[]) => createActorToolMock(...args),
}));

describe("AgentRuntimeRegistry — subagent integration (Phase E Task 7)", () => {
    let emitted: Array<{ channel: string; payload: unknown }>;
    let registry: AgentRuntimeRegistry;
    let disposeAgentMock: ReturnType<typeof vi.fn>;
    let disposeAllMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        sessions.length = 0;
        lastSessionOpts = null;
        createActorToolMock.mockReset();
        createActorToolMock.mockReturnValue({ name: "actor", _stub: true } as never);
        disposeAgentMock = vi.fn();
        disposeAllMock = vi.fn();
        emitted = [];
    });

    function buildRegistry(getSubagentManager?: () => unknown): AgentRuntimeRegistry {
        return new AgentRuntimeRegistry({
            getWorkspace: (workspaceId) =>
                workspaceId === "ws_1"
                    ? { id: "ws_1", name: "demo", path: "C:/demo", createdAt: 1 }
                    : undefined,
            pendingEdits: new PendingEdits(),
            send: (channel, payload) => emitted.push({ channel, payload }),
            getSubagentManager: getSubagentManager as never,
        });
    }

    it("does not inject customTools when getSubagentManager is absent", async () => {
        registry = buildRegistry();
        await registry.create({ workspaceId: "ws_1", title: "A" });

        expect(lastSessionOpts).not.toBeNull();
        expect(lastSessionOpts?.customTools ?? []).toEqual([]);
        expect(createActorToolMock).not.toHaveBeenCalled();
    });

    it("does not inject customTools when getSubagentManager returns null", async () => {
        registry = buildRegistry(() => null);
        await registry.create({ workspaceId: "ws_1", title: "A" });

        expect(lastSessionOpts?.customTools ?? []).toEqual([]);
        expect(createActorToolMock).not.toHaveBeenCalled();
    });

    it("injects the actor tool when getSubagentManager returns a manager", async () => {
        const manager = { disposeAgent: disposeAgentMock, disposeAll: disposeAllMock } as never;
        registry = buildRegistry(() => manager);
        const agent = await registry.create({ workspaceId: "ws_1", title: "A" });

        expect(createActorToolMock).toHaveBeenCalledTimes(1);
        // Called with (manager, agentId, workspace) — workspace shape asserted
        // via the third argument.
        const call = createActorToolMock.mock.calls[0] as unknown[];
        expect(call[0]).toBe(manager);
        expect(call[1]).toBe(agent.id);
        expect(call[2]).toMatchObject({
            workspaceId: "ws_1",
            workspacePath: "C:/demo",
        });

        // customTools passed to factory contains exactly one entry.
        expect(lastSessionOpts?.customTools).toHaveLength(1);
    });

    it("survives createActorTool throwing (continues with empty customTools)", async () => {
        createActorToolMock.mockImplementation(() => {
            throw new Error("subagent registry misconfigured");
        });
        const manager = { disposeAgent: disposeAgentMock, disposeAll: disposeAllMock } as never;
        registry = buildRegistry(() => manager);

        // Should NOT throw — error is caught inside `buildPrimaryCustomTools`.
        const agent = await registry.create({ workspaceId: "ws_1", title: "A" });
        expect(agent.id).toBeTruthy();
        expect(lastSessionOpts?.customTools ?? []).toEqual([]);
    });

    it("stop() cascades into subagentManager.disposeAgent(agentId)", async () => {
        const manager = { disposeAgent: disposeAgentMock, disposeAll: disposeAllMock } as never;
        registry = buildRegistry(() => manager);
        const agent = await registry.create({ workspaceId: "ws_1", title: "A" });

        registry.stop(agent.id);

        expect(disposeAgentMock).toHaveBeenCalledTimes(1);
        expect(disposeAgentMock).toHaveBeenCalledWith(agent.id);
        expect(disposeAllMock).not.toHaveBeenCalled();
    });

    it("stop() is safe when getSubagentManager is absent (no-op)", async () => {
        registry = buildRegistry();
        const agent = await registry.create({ workspaceId: "ws_1", title: "A" });

        expect(() => registry.stop(agent.id)).not.toThrow();
    });

    it("stop() is safe when disposeAgent throws (error swallowed)", async () => {
        disposeAgentMock.mockImplementation(() => {
            throw new Error("dispose failed");
        });
        const manager = { disposeAgent: disposeAgentMock, disposeAll: disposeAllMock } as never;
        registry = buildRegistry(() => manager);
        const agent = await registry.create({ workspaceId: "ws_1", title: "A" });

        // Should not throw — error is caught and logged.
        expect(() => registry.stop(agent.id)).not.toThrow();
    });

    it("disposeAll() cascades into subagentManager.disposeAll() after stopping runtimes", async () => {
        const manager = { disposeAgent: disposeAgentMock, disposeAll: disposeAllMock } as never;
        registry = buildRegistry(() => manager);
        const agent = await registry.create({ workspaceId: "ws_1", title: "A" });

        registry.disposeAll();

        // stop() was called for the runtime, which in turn calls disposeAgent.
        expect(disposeAgentMock).toHaveBeenCalledWith(agent.id);
        // Then the defensive disposeAll sweep is invoked.
        expect(disposeAllMock).toHaveBeenCalledTimes(1);
    });

    it("disposeAll() is safe when getSubagentManager is absent", async () => {
        registry = buildRegistry();
        await registry.create({ workspaceId: "ws_1", title: "A" });

        expect(() => registry.disposeAll()).not.toThrow();
    });

    it("disposeWorkspace() cascades into stop() → disposeAgent", async () => {
        const manager = { disposeAgent: disposeAgentMock, disposeAll: disposeAllMock } as never;
        registry = buildRegistry(() => manager);
        const agent = await registry.create({ workspaceId: "ws_1", title: "A" });

        registry.disposeWorkspace("ws_1");

        expect(disposeAgentMock).toHaveBeenCalledWith(agent.id);
    });
});
