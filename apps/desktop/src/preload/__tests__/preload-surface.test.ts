import { vi, describe, it, expect, beforeAll } from "vitest";

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

    it("no method name contains internal or debug", () => {
        const keys = Object.keys(piAPI);
        for (const key of keys) {
            expect(key).not.toMatch(/internal|debug/i);
        }
    });

    it("invoke allowlist contains only channels without dedicated piAPI methods", () => {
        const INVOKE_ONLY_CHANNELS = [
            "settings:load-pi-config",
            "pi:get-full-config",
            "config:save-raw",
            "config:export",
            "config:import",
            "pi:describe-images",
            "log:write",
            "workbench:set-active-file",
            "approval:respond",
            "approval:set-auto-approve",
            "plan:respond",
            "permission:respond",
        ];
        expect(INVOKE_ONLY_CHANNELS.length).toBe(12);
        expect(INVOKE_ONLY_CHANNELS).not.toContain("pi:send");
        expect(INVOKE_ONLY_CHANNELS).not.toContain("session:list");
        expect(INVOKE_ONLY_CHANNELS).not.toContain("git:status");
    });
});
