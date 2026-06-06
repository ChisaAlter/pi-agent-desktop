import { describe, it, expect, vi } from "vitest";
import { createWorkspaceSession } from "../factory";

vi.mock("@earendil-works/pi-coding-agent", () => ({
    createEventBus: vi.fn(() => ({})),
    getAgentDir: vi.fn(() => "C:/tmp/pi-agent"),
    DefaultResourceLoader: vi.fn().mockImplementation(() => ({
        reload: vi.fn().mockResolvedValue(undefined),
    })),
    createAgentSession: vi.fn().mockResolvedValue({
        session: {
            prompt: vi.fn(),
            subscribe: vi.fn(),
            abort: vi.fn(),
            dispose: vi.fn(),
            bindExtensions: vi.fn().mockResolvedValue(undefined),
        },
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
            expect.objectContaining({
                cwd: "C:/some/path",
                resourceLoader: expect.anything(),
            })
        );
    });
});
