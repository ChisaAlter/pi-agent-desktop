import { describe, it, expect, vi } from "vitest";
import { createWorkspaceSession } from "../factory";

vi.mock("@earendil-works/pi-coding-agent", () => ({
    createAgentSession: vi.fn().mockResolvedValue({
        session: { prompt: vi.fn(), subscribe: vi.fn(), abort: vi.fn(), dispose: vi.fn() },
        extensionsResult: { extensions: [] },
    }),
}));

describe("createWorkspaceSession", () => {
    it("creates a session for a workspace path", async () => {
        const session = await createWorkspaceSession({
            workspaceId: "ws_1",
            workspacePath: process.cwd(),
        });
        expect(session).toBeDefined();
        expect(session.workspaceId).toBe("ws_1");
        expect(session.session).toBeDefined();
        expect(typeof session.dispose).toBe("function");
    });

    it("calls createAgentSession with the given cwd", async () => {
        const { createAgentSession } = await import("@earendil-works/pi-coding-agent");
        await createWorkspaceSession({
            workspaceId: "ws_2",
            workspacePath: "C:/some/path",
        });
        expect(createAgentSession).toHaveBeenCalledWith(
            expect.objectContaining({ cwd: "C:/some/path" })
        );
    });
});
