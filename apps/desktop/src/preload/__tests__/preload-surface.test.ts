import { ipcRenderer } from "electron";
import { vi, describe, it, expect, beforeAll, beforeEach } from "vitest";

vi.mock("electron", () => ({
    contextBridge: { exposeInMainWorld: vi.fn() },
    ipcRenderer: {
        invoke: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
        send: vi.fn(),
        removeListener: vi.fn(),
    },
}));

let piAPI: Record<string, unknown>;

beforeAll(async () => {
    const mod = await import("../index");
    piAPI = mod.piAPI;
});

describe("preload surface audit", () => {
    beforeEach(() => {
        vi.mocked(ipcRenderer.invoke).mockClear();
    });

    const HIGH_FREQUENCY_METHODS = [
        "sendPrompt",
        "onEvent",
        "onError",
        "onPiJsonEvent",
        "getStatus",
        "refreshPiStatus",
        "installPi",
        "updatePi",
        "uninstallPi",
        "onPiStatusChanged",
        "onPiInstallProgress",
        "respondApproval",
        "onApprovalRequest",
        "onApprovalDeferred",
        "onApprovalReview",
        "setAutoApprove",
        "stop",
        "listWorkspaces",
        "createWorkspace",
        "deleteWorkspace",
        "listSessions",
        "createSession",
        "renameSession",
        "deleteSession",
        "archiveSession",
        "updateSessionMetadata",
        "appendMessage",
        "updateMessage",
        "updateToolCall",
        "invoke",
    ];

    it("piAPI high-frequency direct methods <= 30", () => {
        expect(HIGH_FREQUENCY_METHODS.length).toBeLessThanOrEqual(30);
    });

    it("all high-frequency methods exist on piAPI", () => {
        for (const method of HIGH_FREQUENCY_METHODS) {
            expect(piAPI).toHaveProperty(method);
            expect(typeof piAPI[method]).toBe("function");
        }
    });

    it("exposes dedicated updater methods instead of forcing invoke-only usage", () => {
        const methods = [
            "updaterGetState",
            "updaterCheck",
            "updaterDownload",
            "updaterInstall",
            "onUpdaterStateChanged",
        ];
        for (const method of methods) {
            expect(piAPI).toHaveProperty(method);
            expect(typeof piAPI[method]).toBe("function");
        }
    });

    it("exposes Pi config change subscription for model list refreshes", () => {
        expect(piAPI).toHaveProperty("onPiConfigChanged");
        expect(typeof piAPI.onPiConfigChanged).toBe("function");
    });

    it("forwards optional workspace ids when listing local skills", async () => {
        const listSkills = piAPI.listSkills as (input?: { workspaceId?: string }) => Promise<unknown>;
        await listSkills({ workspaceId: "ws-1" });
        expect(ipcRenderer.invoke).toHaveBeenCalledWith("pi:list-skills", { workspaceId: "ws-1" });
    });

    it("exposes permission sync on the dedicated agents channel", async () => {
        const syncPermissions = piAPI.agentsSyncPermissions as (agentId: string) => Promise<unknown>;
        await syncPermissions("agent_1");
        expect(ipcRenderer.invoke).toHaveBeenCalledWith("agents:sync-permissions", "agent_1");
    });

    it("no method name contains internal or debug", () => {
        const keys = Object.keys(piAPI);
        for (const key of keys) {
            expect(key).not.toMatch(/internal|debug/i);
        }
    });

    it("invoke allowlist contains only channels without dedicated piAPI methods", () => {
        // Historical contract list mixed invoke+send channels. Product ALLOWED_INVOKE
        // is the set enforced by piAPI.invoke; send-only channels live on piAPI.send.
        const INVOKE_ONLY_CHANNELS = [
            "settings:load-pi-config",
            "pi:get-full-config",
            "config:save-raw",
            "config:export",
            "config:import",
            "log:write",
            "workbench:set-active-file",
            "approval:respond",
            "approval:set-auto-approve",
            "plan:respond",
            "permission:respond",
        ];
        expect(INVOKE_ONLY_CHANNELS.length).toBe(11);
        expect(INVOKE_ONLY_CHANNELS).not.toContain("pi:send");
        expect(INVOKE_ONLY_CHANNELS).not.toContain("session:list");
        expect(INVOKE_ONLY_CHANNELS).not.toContain("git:status");
        // Task 24.4: pi:describe-images now has a dedicated describeImages method,
        // so it must NOT be routed through the generic send allowlist.
        expect(INVOKE_ONLY_CHANNELS).not.toContain("pi:describe-images");
    });

    // wave-140 residual
    it("forwards memorySearch / memoryListRecent / describeImages on dedicated channels", async () => {
        const memorySearch = piAPI.memorySearch as (input: { query: string }) => Promise<unknown>;
        const memoryListRecent = piAPI.memoryListRecent as (input: {
            limit?: number;
        }) => Promise<unknown>;
        const describeImages = piAPI.describeImages as (
            images: Array<{ mimeType: string; data: string }>,
        ) => Promise<unknown>;

        await memorySearch({ query: "plan" });
        await memoryListRecent({ limit: 5 });
        await describeImages([{ mimeType: "image/png", data: "abc" }]);

        expect(ipcRenderer.invoke).toHaveBeenCalledWith("pi:memory-search", { query: "plan" });
        expect(ipcRenderer.invoke).toHaveBeenCalledWith("pi:memory-list-recent", { limit: 5 });
        expect(ipcRenderer.invoke).toHaveBeenCalledWith("pi:describe-images", [
            { mimeType: "image/png", data: "abc" },
        ]);
    });

    it("enforces product invoke allowlist and rejects high-risk channels", async () => {
        const invoke = piAPI.invoke as (channel: string, ...args: unknown[]) => Promise<unknown>;
        const allowed = [
            "settings:load-pi-config",
            "pi:get-full-config",
            "config:save-raw",
            "config:export",
            "config:import",
            "goal:set",
            "goal:clear",
            "goal:get",
        ];
        for (const channel of allowed) {
            vi.mocked(ipcRenderer.invoke).mockClear();
            await invoke(channel, { ok: true });
            expect(ipcRenderer.invoke).toHaveBeenCalledWith(channel, { ok: true });
        }

        await expect(invoke("pi:send", "ws", "hi")).rejects.toThrow(/Channel not allowed/);
        await expect(invoke("session:list")).rejects.toThrow(/Channel not allowed/);
        await expect(invoke("shell:exec")).rejects.toThrow(/Channel not allowed/);
        // Rejected channels must not reach ipcRenderer.invoke
        const invokeChannels = vi
            .mocked(ipcRenderer.invoke)
            .mock.calls.map((c) => c[0] as string);
        expect(invokeChannels).not.toContain("pi:send");
        expect(invokeChannels).not.toContain("session:list");
        expect(invokeChannels).not.toContain("shell:exec");
    });

    it("enforces product send allowlist and drops blocked fire-and-forget channels", () => {
        const send = piAPI.send as (channel: string, ...args: unknown[]) => void;
        const allowedSend = [
            "log:write",
            "workbench:set-active-file",
            "approval:respond",
            "approval:set-auto-approve",
            "plan:respond",
            "permission:respond",
            "desktop-overlay:set-main-context",
            "desktop-overlay:set-window-state",
        ];
        for (const channel of allowedSend) {
            vi.mocked(ipcRenderer.send).mockClear();
            send(channel, { x: 1 });
            expect(ipcRenderer.send).toHaveBeenCalledWith(channel, { x: 1 });
        }

        vi.mocked(ipcRenderer.send).mockClear();
        send("pi:send", "ws", "nope");
        send("shell:exec", "rm -rf /");
        expect(ipcRenderer.send).not.toHaveBeenCalled();
    });

    it("exposes long-horizon / goal / diagnostics dedicated methods", () => {
        for (const method of [
            "memorySearch",
            "memoryListRecent",
            "legacyTaskList",
            "taskCreate",
            "taskList",
            "goalSet",
            "goalGet",
            "goalClear",
            "diagnosticsExport",
            "describeImages",
        ]) {
            expect(piAPI).toHaveProperty(method);
            expect(typeof piAPI[method]).toBe("function");
        }
    });
});
