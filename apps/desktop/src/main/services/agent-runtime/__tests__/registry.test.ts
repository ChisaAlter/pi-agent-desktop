import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentRuntimeRegistry } from "../registry";
import { PendingEdits } from "../../approval/pending-edits";

const sessions: Array<{
    prompt: ReturnType<typeof vi.fn>;
    abort: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
}> = [];

vi.mock("../../pi-session/factory", () => ({
    createWorkspaceSession: vi.fn(async (opts: { workspaceId: string }) => {
        const session = {
            prompt: vi.fn(async () => undefined),
            abort: vi.fn(),
            dispose: vi.fn(),
            subscribe: vi.fn(),
        };
        sessions.push(session);
        return {
            workspaceId: opts.workspaceId,
            session,
            dispose: session.dispose,
        };
    }),
}));

vi.mock("../../approval/interceptor", () => ({
    createApprovalInterceptor: vi.fn(() => ({
        handleEvent: vi.fn(async () => undefined),
    })),
}));

vi.mock("../../extensions/extension-ui-bridge", () => ({
    createExtensionUiBridge: vi.fn(() => ({})),
}));

describe("AgentRuntimeRegistry", () => {
    let emitted: Array<{ channel: string; payload: unknown }>;
    let registry: AgentRuntimeRegistry;

    beforeEach(() => {
        sessions.length = 0;
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

    it("creates independent agents for the same workspace", async () => {
        const first = await registry.create({ workspaceId: "ws_1", title: "A" });
        const second = await registry.create({ workspaceId: "ws_1", title: "B" });

        expect(first.id).not.toBe(second.id);
        expect(first.workspaceId).toBe("ws_1");
        expect(second.workspaceId).toBe("ws_1");
        expect(sessions).toHaveLength(2);
        expect(registry.list().map((agent) => agent.title)).toEqual(["A", "B"]);
    });

    it("routes prompt, messages, and state by agent id", async () => {
        const agent = await registry.create({ workspaceId: "ws_1", title: "A" });

        await registry.prompt({ agentId: agent.id, message: "hello" });

        expect(sessions[0].prompt).toHaveBeenCalledWith("hello");
        expect(registry.getMessages(agent.id)[0]).toMatchObject({
            agentId: agent.id,
            role: "user",
            content: "hello",
        });
        expect(registry.getRuntimeState(agent.id)).toMatchObject({
            status: "running",
            isStreaming: true,
        });
    });

    it("restarts with the same session path and replaces runtime", async () => {
        const agent = await registry.create({
            workspaceId: "ws_1",
            title: "Imported",
            sessionPath: "C:/pi/session.jsonl",
        });

        const restarted = await registry.restart(agent.id);

        expect(restarted.id).not.toBe(agent.id);
        expect(restarted.title).toBe("Imported");
        expect(restarted.sessionPath).toBe("C:/pi/session.jsonl");
        expect(sessions[0].dispose).toHaveBeenCalled();
        expect(sessions).toHaveLength(2);
    });

    it("stops one agent without touching another", async () => {
        const first = await registry.create({ workspaceId: "ws_1", title: "A" });
        const second = await registry.create({ workspaceId: "ws_1", title: "B" });

        registry.stop(first.id);

        expect(sessions[0].dispose).toHaveBeenCalled();
        expect(sessions[1].dispose).not.toHaveBeenCalled();
        expect(registry.list().map((agent) => agent.id)).toEqual([second.id]);
    });

    it("emits agent-scoped pi events", async () => {
        const agent = await registry.create({ workspaceId: "ws_1", title: "A" });
        const subscribed = sessions[0].subscribe.mock.calls[0][0];

        await subscribed({ type: "agent_start" });

        expect(emitted).toContainEqual({
            channel: "agents:event",
            payload: { agentId: agent.id, workspaceId: "ws_1", event: { type: "agent_start" } },
        });
        expect(emitted.find((item) => item.channel === "pi:event")).toBeUndefined();
    });

    it("marks the agent as error when prompt fails", async () => {
        const agent = await registry.create({ workspaceId: "ws_1", title: "A" });
        sessions[0].prompt.mockRejectedValueOnce(new Error("network down"));

        await expect(registry.prompt({ agentId: agent.id, message: "hello" })).rejects.toThrow("network down");

        expect(registry.getRuntimeState(agent.id)).toMatchObject({
            status: "error",
            isStreaming: false,
        });
        expect(registry.getMessages(agent.id)).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    agentId: agent.id,
                    role: "error",
                    content: expect.stringContaining("network down"),
                }),
            ]),
        );
    });
});
