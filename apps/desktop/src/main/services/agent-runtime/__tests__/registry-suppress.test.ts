import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentRuntimeRegistry } from "../registry";
import { PendingEdits } from "../../approval/pending-edits";

interface MockSession {
    prompt: ReturnType<typeof vi.fn>;
    abort: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
    subscribers: Array<(event: unknown) => void | Promise<void>>;
}

const sessions: MockSession[] = [];

const { interceptorHandleMock } = vi.hoisted(() => ({
    interceptorHandleMock: vi.fn(async () => undefined),
}));

vi.mock("../../pi-session/factory", () => ({
    createWorkspaceSession: vi.fn(async (opts: { workspaceId: string }) => {
        const subscribers: Array<(event: unknown) => void | Promise<void>> = [];
        const session = {
            prompt: vi.fn(async () => undefined),
            abort: vi.fn(),
            dispose: vi.fn(),
            subscribe: vi.fn((subscriber: (event: unknown) => void | Promise<void>) => {
                subscribers.push(subscriber);
            }),
        };
        sessions.push({
            prompt: session.prompt,
            abort: session.abort,
            dispose: session.dispose,
            subscribe: session.subscribe,
            subscribers,
        });
        return {
            workspaceId: opts.workspaceId,
            session,
            dispose: session.dispose,
        };
    }),
    resolveBundledDesktopExtensionPaths: vi.fn(() => []),
}));

vi.mock("../../approval/interceptor", () => ({
    createApprovalInterceptor: vi.fn(() => ({
        handleEvent: interceptorHandleMock,
    })),
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

describe("AgentRuntimeRegistry event suppression (per-agent)", () => {
    let emitted: Array<{ channel: string; payload: unknown }>;
    let registry: AgentRuntimeRegistry;

    beforeEach(() => {
        sessions.length = 0;
        interceptorHandleMock.mockReset();
        interceptorHandleMock.mockResolvedValue(undefined);
        emitted = [];
        registry = new AgentRuntimeRegistry({
            getWorkspace: (workspaceId) =>
                workspaceId === "ws_1"
                    ? { id: "ws_1", name: "demo", path: "C:/demo", createdAt: 1 }
                    : undefined,
            pendingEdits: new PendingEdits(),
            send: (channel, payload) => emitted.push({ channel, payload }),
        });
    });

    const agentsEventsFor = (agentId: string) =>
        emitted.filter(
            (entry) =>
                entry.channel === "agents:event" &&
                (entry.payload as { agentId?: string }).agentId === agentId,
        );

    it("suppresses events for agent A during promptInternal while agent B still receives events", async () => {
        const agentA = await registry.create({ workspaceId: "ws_1", title: "A" });
        const agentB = await registry.create({ workspaceId: "ws_1", title: "B" });

        // Hold agent A's internal prompt in flight so suppression stays active.
        let releaseA: () => void = () => {};
        sessions[0].prompt.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    releaseA = resolve;
                }),
        );

        const pending = registry.promptInternal(agentA.id, "internal sync");
        // Yield once so promptInternal reaches the awaited prompt and suppression is active.
        await Promise.resolve();

        // Emit events for both agents while A is suppressed.
        await sessions[0].subscribers[0]({ type: "text_delta", delta: "A-hidden" });
        await sessions[1].subscribers[0]({ type: "text_delta", delta: "B-visible" });

        // Agent A events were suppressed; agent B events were forwarded.
        expect(agentsEventsFor(agentA.id)).toEqual([]);
        expect(agentsEventsFor(agentB.id)).toHaveLength(1);
        expect(agentsEventsFor(agentB.id)[0]?.payload).toMatchObject({
            agentId: agentB.id,
            event: { type: "text_delta", delta: "B-visible" },
        });

        // Release agent A's prompt to lift suppression.
        releaseA();
        await pending;

        // After suppression lifts, agent A receives events again.
        await sessions[0].subscribers[0]({ type: "text_delta", delta: "A-now-visible" });
        expect(agentsEventsFor(agentA.id)).toHaveLength(1);
        expect(agentsEventsFor(agentA.id)[0]?.payload).toMatchObject({
            agentId: agentA.id,
            event: { type: "text_delta", delta: "A-now-visible" },
        });
    });

    it("suppresses events for agent A during a mode switch while agent B stays unaffected", async () => {
        const agentA = await registry.create({ workspaceId: "ws_1", title: "A" });
        const agentB = await registry.create({ workspaceId: "ws_1", title: "B" });

        // Hold agent A's mode-switch prompt (/plan) in flight so syncRuntimeMode
        // keeps agent A suppressed. The subsequent user-message prompt resolves immediately.
        let releaseModeSwitch: () => void = () => {};
        sessions[0].prompt.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    releaseModeSwitch = resolve;
                }),
        );

        const pending = registry.prompt({
            agentId: agentA.id,
            message: "plan something",
            mode: "plan",
        });
        // Yield so the mode-switch prompt is entered and suppression activates.
        await Promise.resolve();

        // While agent A is mid-mode-switch (suppressed), agent B still forwards events.
        await sessions[0].subscribers[0]({ type: "text_delta", delta: "A-hidden" });
        await sessions[1].subscribers[0]({ type: "text_delta", delta: "B-still-visible" });

        expect(agentsEventsFor(agentA.id)).toEqual([]);
        expect(agentsEventsFor(agentB.id)).toHaveLength(1);
        expect(agentsEventsFor(agentB.id)[0]?.payload).toMatchObject({
            agentId: agentB.id,
            event: { type: "text_delta", delta: "B-still-visible" },
        });

        // Release the mode-switch; syncRuntimeMode lifts suppression and prompt() completes.
        releaseModeSwitch();
        await pending;

        // Agent A forwards events again after the mode switch finishes.
        await sessions[0].subscribers[0]({ type: "text_delta", delta: "A-back" });
        expect(agentsEventsFor(agentA.id)).toHaveLength(1);
        expect(agentsEventsFor(agentA.id)[0]?.payload).toMatchObject({
            agentId: agentA.id,
            event: { type: "text_delta", delta: "A-back" },
        });
    });

    it("releases per-agent suppression independently when two agents are suppressed concurrently", async () => {
        const agentA = await registry.create({ workspaceId: "ws_1", title: "A" });
        const agentB = await registry.create({ workspaceId: "ws_1", title: "B" });

        // Hold both prompts in flight so both agents are suppressed at the same time.
        let releaseA: () => void = () => {};
        let releaseB: () => void = () => {};
        sessions[0].prompt.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    releaseA = resolve;
                }),
        );
        sessions[1].prompt.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    releaseB = resolve;
                }),
        );

        const pendingA = registry.promptInternal(agentA.id, "A internal");
        const pendingB = registry.promptInternal(agentB.id, "B internal");
        await Promise.resolve();

        // Both suppressed: neither forwards events.
        await sessions[0].subscribers[0]({ type: "text_delta", delta: "A-hidden" });
        await sessions[1].subscribers[0]({ type: "text_delta", delta: "B-hidden" });
        expect(agentsEventsFor(agentA.id)).toEqual([]);
        expect(agentsEventsFor(agentB.id)).toEqual([]);

        // Release only agent A: A forwards, B still suppressed.
        releaseA();
        await pendingA;
        await sessions[0].subscribers[0]({ type: "text_delta", delta: "A-visible" });
        await sessions[1].subscribers[0]({ type: "text_delta", delta: "B-still-hidden" });
        expect(agentsEventsFor(agentA.id)).toHaveLength(1);
        expect(agentsEventsFor(agentB.id)).toEqual([]);

        // Release agent B: now B forwards too.
        releaseB();
        await pendingB;
        await sessions[1].subscribers[0]({ type: "text_delta", delta: "B-now-visible" });
        expect(agentsEventsFor(agentB.id)).toHaveLength(1);
        expect(agentsEventsFor(agentB.id)[0]?.payload).toMatchObject({
            agentId: agentB.id,
            event: { type: "text_delta", delta: "B-now-visible" },
        });
    });
});
