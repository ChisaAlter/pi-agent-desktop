import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const listeners = new Map<string, (...args: unknown[]) => unknown>();
const webContentsSend = vi.fn();
const { execFileSyncMock, rmSyncMock } = vi.hoisted(() => ({
    execFileSyncMock: vi.fn(),
    rmSyncMock: vi.fn(),
}));

vi.mock("electron", () => ({
    ipcMain: {
        handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
            handlers.set(channel, handler);
        }),
        on: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
            listeners.set(channel, listener);
        }),
    },
    BrowserWindow: {
        getAllWindows: vi.fn(() => [
            {
                isDestroyed: () => false,
                webContents: { send: webContentsSend },
            },
        ]),
    },
}));

vi.mock("electron-log/main", () => ({
    default: {
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
    },
}));

vi.mock("child_process", () => ({
    execFileSync: execFileSyncMock,
}));

vi.mock("fs", async (importOriginal) => {
    const actual = await importOriginal<typeof import("fs")>();
    return {
        ...actual,
        rmSync: rmSyncMock,
    };
});

import { setupChatIpc } from "../chat.ipc";
import { PLAN_DIRECTIVE } from "../../services/agent-modes/plan-prompt";

describe("setupChatIpc", () => {
    beforeEach(() => {
        handlers.clear();
        listeners.clear();
        webContentsSend.mockClear();
        execFileSyncMock.mockReset();
        rmSyncMock.mockReset();
    });

    it("sends renderer event payload directly without a workspace envelope", async () => {
        const event = { type: "agent_start" };
        const registry = {
            get: vi.fn(async (_id, _path, _pendingEdits, send) => ({
                session: {
                    prompt: vi.fn(async () => {
                        send("pi:event", "ws_1", event);
                    }),
                    abort: vi.fn(),
                },
            })),
            has: vi.fn(() => true),
        };

        setupChatIpc({
            registry: registry as any,
            getWorkspace: () => ({ id: "ws_1", name: "demo", path: "C:/demo" }),
            getDefaultWorkspace: () => undefined,
            pendingEdits: { autoApprove: false } as any,
        });

        const handler = handlers.get("pi:send");
        expect(handler).toBeTruthy();

        await handler?.({}, "ws_1", "hello");

        expect(webContentsSend).toHaveBeenCalledWith("pi:event", event);
    });

    it("prepends the plan-mode directive when plan mode is enabled (CRIT-2)", async () => {
        const prompt = vi.fn(async () => undefined);
        const registry = {
            get: vi.fn(async () => ({
                session: { prompt, abort: vi.fn() },
            })),
            has: vi.fn(() => true),
        };

        setupChatIpc({
            registry: registry as any,
            getWorkspace: () => ({ id: "ws_1", name: "demo", path: "C:/demo" }),
            getDefaultWorkspace: () => undefined,
            pendingEdits: { autoApprove: false } as any,
        });

        const handler = handlers.get("pi:send");
        await handler?.({}, "ws_1", "改输入区", { mode: "plan" });

        expect(prompt).toHaveBeenCalledTimes(1);
        const outbound = prompt.mock.calls[0]?.[0] as string;
        // Default long-horizon settings have planMode.enabled = true, so the
        // directive must be prepended (followed by a blank line) before the
        // user's content. This is the CRIT-2 fix: previously plan mode passed
        // the prompt through unchanged, leaving the agent without constraints.
        expect(outbound).toBe(`${PLAN_DIRECTIVE}\n\n改输入区`);
        expect(outbound).toContain(PLAN_DIRECTIVE);
        expect(outbound.endsWith("改输入区")).toBe(true);
    });

    it("passes plan-mode prompts through unchanged when plan mode is disabled (CRIT-2)", async () => {
        const prompt = vi.fn(async () => undefined);
        const registry = {
            get: vi.fn(async () => ({
                session: { prompt, abort: vi.fn() },
            })),
            has: vi.fn(() => true),
        };

        setupChatIpc({
            registry: registry as any,
            getWorkspace: () => ({ id: "ws_1", name: "demo", path: "C:/demo" }),
            getDefaultWorkspace: () => undefined,
            pendingEdits: { autoApprove: false } as any,
            // Per-workspace override flips plan mode OFF even though the
            // global default would be ON.
            getWorkspacePlanMode: () => false,
        });

        const handler = handlers.get("pi:send");
        await handler?.({}, "ws_1", "改输入区", { mode: "plan" });

        expect(prompt).toHaveBeenCalledTimes(1);
        const outbound = prompt.mock.calls[0]?.[0] as string;
        // When plan mode is disabled, buildAgentModePrompt returns the trimmed
        // content untouched — no directive, no transformation.
        expect(outbound).toBe("改输入区");
        expect(outbound).not.toContain(PLAN_DIRECTIVE);
    });

    it("rebuilds long-horizon context before storing the current prompt in memory", async () => {
        const order: string[] = [];
        const prompt = vi.fn(async () => undefined);
        const registry = {
            get: vi.fn(async () => ({
                session: { prompt, abort: vi.fn() },
            })),
            has: vi.fn(() => true),
        };

        setupChatIpc({
            registry: registry as any,
            getWorkspace: () => ({ id: "ws_1", name: "demo", path: "C:/demo" }),
            getDefaultWorkspace: () => undefined,
            pendingEdits: { autoApprove: false } as any,
            memoryService: {
                put: vi.fn(() => {
                    order.push("put");
                    return {};
                }),
            } as any,
            checkpointService: {
                rebuildContext: vi.fn(() => {
                    order.push("rebuild");
                    return "<long_horizon_context>history</long_horizon_context>";
                }),
            } as any,
            getSettings: () => ({
                longHorizon: {
                    enabled: true,
                    defaultMode: "build",
                    maxMode: { enabled: true, candidates: 5 },
                    memory: { enabled: true },
                    checkpoint: { enabled: true },
                    goal: { enabled: true },
                    subagents: { enabled: true },
                    composeWorkflow: { enabled: true },
                },
            }) as any,
        });

        const handler = handlers.get("pi:send");
        await handler?.({}, "ws_1", "当前用户目标");

        expect(order).toEqual(["rebuild", "put"]);
        expect(prompt.mock.calls[0]?.[0]).toContain("<long_horizon_context>history</long_horizon_context>");
    });

    it("does not inject compose slash commands when the session did not register them", async () => {
        const session = {
            extensionRunner: { getRegisteredCommands: vi.fn(() => []) },
            promptTemplates: [],
            resourceLoader: { getSkills: vi.fn(() => ({ skills: [] })) },
        };
        const registry = {
            get: vi.fn(async () => ({ session })),
            has: vi.fn(() => true),
        };

        setupChatIpc({
            registry: registry as any,
            getWorkspace: () => ({ id: "ws_1", name: "demo", path: "C:/demo" }),
            getDefaultWorkspace: () => undefined,
            pendingEdits: { autoApprove: false } as any,
        });

        const handler = handlers.get("pi:list-slash-commands");
        const buildResult = await handler?.({}, "ws_1", undefined, "build") as Array<{ name: string }>;
        const composeResult = await handler?.({}, "ws_1", undefined, "compose") as Array<{ name: string }>;

        expect(buildResult.some((command) => command.name === "compose:plan")).toBe(false);
        expect(composeResult.some((command) => command.name === "compose:plan")).toBe(false);
    });

    it("surfaces compose slash commands only from the loaded session extension bundle", async () => {
        const session = {
            extensionRunner: {
                getRegisteredCommands: vi.fn(() => [
                    { invocationName: "compose:plan", description: "plan via compose bundle" },
                ]),
            },
            promptTemplates: [],
            resourceLoader: { getSkills: vi.fn(() => ({ skills: [] })) },
        };
        const registry = {
            get: vi.fn(async () => ({ session })),
            has: vi.fn(() => true),
        };

        setupChatIpc({
            registry: registry as any,
            getWorkspace: () => ({ id: "ws_1", name: "demo", path: "C:/demo" }),
            getDefaultWorkspace: () => undefined,
            pendingEdits: { autoApprove: false } as any,
        });

        const handler = handlers.get("pi:list-slash-commands");
        const buildResult = await handler?.({}, "ws_1", undefined, "build") as Array<{ name: string; source: string }>;
        const composeResult = await handler?.({}, "ws_1", undefined, "compose") as Array<{ name: string; source: string }>;

        expect(buildResult.filter((command) => command.name === "compose:plan")).toEqual([
            expect.objectContaining({ name: "compose:plan", source: "extension" }),
        ]);
        expect(composeResult.filter((command) => command.name === "compose:plan")).toEqual([
            expect.objectContaining({ name: "compose:plan", source: "extension" }),
        ]);
    });

    it("does not fall back to the default workspace when a provided workspace id is unknown", async () => {
        const registry = {
            get: vi.fn(),
            has: vi.fn(() => false),
        };

        setupChatIpc({
            registry: registry as any,
            getWorkspace: () => undefined,
            getDefaultWorkspace: () => ({ id: "default", name: "default", path: "C:/default" }),
            pendingEdits: { autoApprove: false } as any,
        });

        const handler = handlers.get("pi:send");
        const result = await handler?.({}, "missing_ws", "hello");

        expect(result).toMatchObject({
            code: "ipcErrors.chat.workspaceNotFound",
            params: { id: "missing_ws" },
        });
        expect(registry.get).not.toHaveBeenCalled();
    });

    it("does not stop the default workspace when the requested workspace id is unknown", async () => {
        const registry = {
            get: vi.fn(),
            has: vi.fn(() => true),
        };

        setupChatIpc({
            registry: registry as any,
            getWorkspace: () => undefined,
            getDefaultWorkspace: () => ({ id: "default", name: "default", path: "C:/default" }),
            pendingEdits: { autoApprove: false } as any,
        });

        const handler = handlers.get("pi:stop");
        const result = await handler?.({}, "missing_ws");

        expect(result).toMatchObject({
            code: "ipcErrors.chat.workspaceNotFound",
            params: { id: "missing_ws" },
        });
        expect(registry.has).not.toHaveBeenCalled();
        expect(registry.get).not.toHaveBeenCalled();
    });

    it("normalizes git undo paths before invoking git", async () => {
        setupChatIpc({
            registry: { get: vi.fn(), has: vi.fn() } as any,
            getWorkspace: () => undefined,
            getDefaultWorkspace: () => undefined,
            pendingEdits: { autoApprove: false } as any,
        });

        const handler = handlers.get("git:undo");
        const result = await handler?.({}, "C:/repo", "src\\app.ts");

        expect(result).toBeUndefined();
        expect(execFileSyncMock).toHaveBeenCalledWith("git", ["checkout", "--", "src/app.ts"], {
            cwd: expect.stringMatching(/[\\/]repo$/),
            stdio: "ignore",
        });
        expect(rmSyncMock).not.toHaveBeenCalled();
    });

    it("blocks git undo outside the workspace before running git or deleting files", async () => {
        setupChatIpc({
            registry: { get: vi.fn(), has: vi.fn() } as any,
            getWorkspace: () => undefined,
            getDefaultWorkspace: () => undefined,
            pendingEdits: { autoApprove: false } as any,
        });

        const handler = handlers.get("git:undo");
        const result = await handler?.({}, "C:/repo", "C:/outside/secret.txt");

        expect(result).toMatchObject({
            code: "ipcErrors.files.protectedPath",
        });
        expect(execFileSyncMock).not.toHaveBeenCalled();
        expect(rmSyncMock).not.toHaveBeenCalled();
    });

    it("blocks git undo for protected credential files inside the workspace", async () => {
        setupChatIpc({
            registry: { get: vi.fn(), has: vi.fn() } as any,
            getWorkspace: () => undefined,
            getDefaultWorkspace: () => undefined,
            pendingEdits: { autoApprove: false } as any,
        });

        const handler = handlers.get("git:undo");
        const result = await handler?.({}, "C:/repo", ".env.local");

        expect(result).toMatchObject({
            code: "ipcErrors.files.protectedPath",
        });
        expect(execFileSyncMock).not.toHaveBeenCalled();
        expect(rmSyncMock).not.toHaveBeenCalled();
    });

    it("uses Node deletion for untracked files after git checkout fallback fails", async () => {
        execFileSyncMock.mockImplementationOnce(() => {
            throw new Error("not tracked");
        });
        // git status --porcelain returns untracked marker so the new safety guard allows deletion.
        execFileSyncMock.mockReturnValueOnce("?? src/new.ts\n");

        setupChatIpc({
            registry: { get: vi.fn(), has: vi.fn() } as any,
            getWorkspace: () => undefined,
            getDefaultWorkspace: () => undefined,
            pendingEdits: { autoApprove: false } as any,
        });

        const handler = handlers.get("git:undo");
        const result = await handler?.({}, "C:/repo", "src/new.ts");

        expect(result).toBeUndefined();
        expect(rmSyncMock).toHaveBeenCalledWith(expect.stringMatching(/[\\/]repo[\\/]src[\\/]new\.ts$/), { force: true });
    });

    it("lists builtin and dynamic Pi slash commands for the workspace session", async () => {
        const session = {
            extensionRunner: {
                getRegisteredCommands: vi.fn(() => [
                    { invocationName: "plan", description: "Plan work", sourceInfo: { scope: "project" } },
                ]),
            },
            promptTemplates: [
                { name: "review", description: "Review code", sourceInfo: { scope: "user" } },
            ],
            resourceLoader: {
                getSkills: vi.fn(() => ({
                    skills: [
                        { name: "tdd", description: "Use TDD", sourceInfo: { scope: "user" } },
                    ],
                })),
            },
        };
        const registry = {
            get: vi.fn(async () => ({ session })),
            has: vi.fn(() => true),
        };

        setupChatIpc({
            registry: registry as any,
            getWorkspace: () => ({ id: "ws_1", name: "demo", path: "C:/demo" }),
            getDefaultWorkspace: () => undefined,
            pendingEdits: { autoApprove: false } as any,
        });

        const handler = handlers.get("pi:list-slash-commands");
        const result = await handler?.({}, "ws_1");

        expect(result).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: "model", source: "builtin", desktopAction: "open-models" }),
            expect.objectContaining({ name: "plan", source: "extension" }),
            expect.objectContaining({ name: "review", source: "prompt" }),
            expect.objectContaining({ name: "skill:tdd", source: "skill" }),
        ]));
    });

    it("does not advertise desktop-unsupported builtin slash commands in the picker list", async () => {
        const session = {
            extensionRunner: { getRegisteredCommands: vi.fn(() => []) },
            promptTemplates: [],
            resourceLoader: { getSkills: vi.fn(() => ({ skills: [] })) },
        };
        const registry = {
            get: vi.fn(async () => ({ session })),
            has: vi.fn(() => true),
        };

        setupChatIpc({
            registry: registry as any,
            getWorkspace: () => ({ id: "ws_1", name: "demo", path: "C:/demo" }),
            getDefaultWorkspace: () => undefined,
            pendingEdits: { autoApprove: false } as any,
        });

        const handler = handlers.get("pi:list-slash-commands");
        const result = await handler?.({}, "ws_1") as Array<{ name: string; desktopAction?: string }>;

        expect(result.some((command) => command.name === "tree")).toBe(false);
        expect(result.some((command) => command.name === "clone")).toBe(false);
        expect(result.some((command) => command.name === "import")).toBe(false);
        expect(result.some((command) => command.name === "share")).toBe(false);
        expect(result.some((command) => command.name === "session")).toBe(false);
        expect(result).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: "model", desktopAction: "open-models" }),
            expect.objectContaining({ name: "settings", desktopAction: "open-settings" }),
        ]));
    });

    it("runs compact and reload builtin slash commands against the workspace session", async () => {
        const compact = vi.fn(async () => ({ summary: "ok" }));
        const reload = vi.fn(async () => undefined);
        const session = {
            compact,
            reload,
            extensionRunner: { getRegisteredCommands: vi.fn(() => []) },
            promptTemplates: [],
            resourceLoader: { getSkills: vi.fn(() => ({ skills: [] })) },
        };
        const registry = {
            get: vi.fn(async () => ({ session })),
            has: vi.fn(() => true),
        };

        setupChatIpc({
            registry: registry as any,
            getWorkspace: () => ({ id: "ws_1", name: "demo", path: "C:/demo" }),
            getDefaultWorkspace: () => undefined,
            pendingEdits: { autoApprove: false } as any,
        });

        const handler = handlers.get("pi:run-builtin-slash-command");
        const compactResult = await handler?.({}, { workspaceId: "ws_1", command: "compact", args: "keep API facts" });
        const reloadResult = await handler?.({}, { workspaceId: "ws_1", command: "reload", args: "" });

        expect(compact).toHaveBeenCalledWith("keep API facts");
        expect(reload).toHaveBeenCalledTimes(1);
        expect(compactResult).toMatchObject({ handled: true, command: "compact", action: "compact" });
        expect(reloadResult).toMatchObject({ handled: true, command: "reload", action: "reload" });
    });

    it("returns an unsupported result for interactive CLI-only slash commands", async () => {
        setupChatIpc({
            registry: { get: vi.fn(), has: vi.fn() } as any,
            getWorkspace: () => ({ id: "ws_1", name: "demo", path: "C:/demo" }),
            getDefaultWorkspace: () => undefined,
            pendingEdits: { autoApprove: false } as any,
        });

        const handler = handlers.get("pi:run-builtin-slash-command");
        const result = await handler?.({}, { workspaceId: "ws_1", command: "tree", args: "" });

        expect(result).toMatchObject({
            handled: true,
            command: "tree",
            action: "unsupported",
            keepInput: true,
        });
    });

    it("returns MiMoCode runtime feature state from settings", async () => {
        setupChatIpc({
            registry: { get: vi.fn(), has: vi.fn() } as any,
            getWorkspace: () => ({ id: "ws_1", name: "demo", path: "C:/demo" }),
            getDefaultWorkspace: () => undefined,
            pendingEdits: { autoApprove: false } as any,
            getSettings: () => ({
                longHorizon: {
                    enabled: true,
                    defaultMode: "build",
                    planMode: { enabled: true },
                    composeMode: { enabled: false },
                    maxMode: { enabled: true, candidates: 2 },
                    memory: { enabled: true, ccIndex: true, reconcileOnSearch: true, searchScoreFloor: 0.2 },
                    history: { enabled: false },
                    checkpoint: { enabled: true },
                    goal: { enabled: true },
                    subagents: { enabled: true },
                    task: { enabled: true },
                    actor: { enabled: true },
                    workflow: { enabled: false, maxConcurrentAgents: 2, maxLifecycleAgents: 8, maxDepth: 3 },
                    dream: { enabled: false },
                    distill: { enabled: true },
                    composeWorkflow: { enabled: false },
                },
            }) as any,
        });

        const handler = handlers.get("pi:runtime-feature-state");
        const result = await handler?.({});

        expect(result).toMatchObject({
            primaryAgents: [
                expect.objectContaining({ id: "build" }),
                expect.objectContaining({ id: "plan" }),
            ],
            systemAgents: [
                expect.objectContaining({ id: "checkpoint-writer" }),
            ],
            enabledToolIds: expect.not.arrayContaining(["history", "workflow"]),
            features: {
                planMode: { enabled: true, supported: true, loadedFrom: "pi-openplan" },
                composeMode: { enabled: false, supported: true, loadedFrom: "disabled" },
                maxMode: { enabled: false, supported: false, loadedFrom: "unsupported", candidates: 2 },
                memory: { enabled: true, supported: true, loadedFrom: "desktop", ccIndex: true, searchScoreFloor: 0.2 },
                workflow: { enabled: false, supported: true, loadedFrom: "disabled" },
            },
        });
    });

    it("searches long-horizon memory through typed IPC", async () => {
        const search = vi.fn(() => [{ id: "m1", kind: "note", text: "goal judge memory", score: 1 }]);
        setupChatIpc({
            registry: { get: vi.fn(), has: vi.fn() } as any,
            getWorkspace: () => ({ id: "ws_1", name: "demo", path: "C:/demo" }),
            getDefaultWorkspace: () => undefined,
            pendingEdits: { autoApprove: false } as any,
            memoryService: { search } as any,
            getSettings: () => ({
                longHorizon: {
                    enabled: true,
                    defaultMode: "build",
                    planMode: { enabled: true },
                    composeMode: { enabled: true },
                    maxMode: { enabled: true, candidates: 5 },
                    memory: { enabled: true, ccIndex: false, reconcileOnSearch: true, searchScoreFloor: 0.15 },
                    history: { enabled: true },
                    checkpoint: { enabled: true },
                    goal: { enabled: true },
                    subagents: { enabled: true },
                    task: { enabled: true },
                    actor: { enabled: true },
                    workflow: { enabled: false, maxConcurrentAgents: 4, maxLifecycleAgents: 100, maxDepth: 4 },
                    dream: { enabled: false },
                    distill: { enabled: false },
                    composeWorkflow: { enabled: false },
                },
            }) as any,
        });

        const handler = handlers.get("pi:memory-search");
        const result = await handler?.({}, { workspaceId: "ws_1", query: "goal judge", limit: 3 });

        expect(search).toHaveBeenCalledWith("goal judge", {
            workspaceId: "ws_1",
            limit: 3,
            includeHistoryFallback: true,
            searchScoreFloor: 0.15,
        });
        expect(result).toEqual([expect.objectContaining({ id: "m1" })]);
    });

    it("lists recent long-horizon memory through typed IPC", async () => {
        const listRecent = vi.fn(() => [{ id: "m2", kind: "checkpoint", layer: "checkpoints", text: "recent checkpoint" }]);
        setupChatIpc({
            registry: { get: vi.fn(), has: vi.fn() } as any,
            getWorkspace: () => ({ id: "ws_1", name: "demo", path: "C:/demo" }),
            getDefaultWorkspace: () => undefined,
            pendingEdits: { autoApprove: false } as any,
            memoryService: { listRecent } as any,
            getSettings: () => ({
                longHorizon: {
                    enabled: true,
                    defaultMode: "build",
                    planMode: { enabled: true },
                    composeMode: { enabled: true },
                    maxMode: { enabled: true, candidates: 5 },
                    memory: { enabled: true, ccIndex: false, reconcileOnSearch: true, searchScoreFloor: 0.15 },
                    history: { enabled: true },
                    checkpoint: { enabled: true },
                    goal: { enabled: true },
                    subagents: { enabled: true },
                    task: { enabled: true },
                    actor: { enabled: true },
                    workflow: { enabled: false, maxConcurrentAgents: 4, maxLifecycleAgents: 100, maxDepth: 4 },
                    dream: { enabled: false },
                    distill: { enabled: false },
                    composeWorkflow: { enabled: false },
                },
            }) as any,
        });

        const handler = handlers.get("pi:memory-list-recent");
        const result = await handler?.({}, { workspaceId: "ws_1", limit: 2 });

        expect(listRecent).toHaveBeenCalledWith({ workspaceId: "ws_1", sessionId: undefined, limit: 2 });
        expect(result).toEqual([expect.objectContaining({ id: "m2" })]);
    });

    it("lists task registry rows and the active task through typed IPC", async () => {
        const list = vi.fn(() => [{ id: "T1", source: "goal", text: "finish migration", status: "running" }]);
        const getActive = vi.fn(() => ({ id: "T1", source: "goal", text: "finish migration", status: "running" }));
        setupChatIpc({
            registry: { get: vi.fn(), has: vi.fn() } as any,
            getWorkspace: () => ({ id: "ws_1", name: "demo", path: "C:/demo" }),
            getDefaultWorkspace: () => undefined,
            pendingEdits: { autoApprove: false } as any,
            taskService: { list, getActive } as any,
            getSettings: () => ({
                longHorizon: {
                    enabled: true,
                    defaultMode: "build",
                    planMode: { enabled: true },
                    composeMode: { enabled: true },
                    maxMode: { enabled: true, candidates: 5 },
                    memory: { enabled: true, ccIndex: false, reconcileOnSearch: true, searchScoreFloor: 0.15 },
                    history: { enabled: true },
                    checkpoint: { enabled: true },
                    goal: { enabled: true },
                    subagents: { enabled: true },
                    task: { enabled: true },
                    actor: { enabled: true },
                    workflow: { enabled: false, maxConcurrentAgents: 4, maxLifecycleAgents: 100, maxDepth: 4 },
                    dream: { enabled: false },
                    distill: { enabled: false },
                    composeWorkflow: { enabled: false },
                },
            }) as any,
        });

        const listHandler = handlers.get("pi:task-list");
        const activeHandler = handlers.get("pi:task-get-active");
        const listResult = await listHandler?.({}, { workspaceId: "ws_1", agentId: "agent-1" });
        const activeResult = await activeHandler?.({}, { workspaceId: "ws_1", agentId: "agent-1" });

        expect(list).toHaveBeenCalledWith({ workspaceId: "ws_1", agentId: "agent-1" });
        expect(getActive).toHaveBeenCalledWith({ workspaceId: "ws_1", agentId: "agent-1" });
        expect(listResult).toEqual([expect.objectContaining({ id: "T1" })]);
        expect(activeResult).toEqual(expect.objectContaining({ id: "T1" }));
    });

    it("refreshes the current workspace session when plan mode enablement changes", async () => {
        const refreshWorkspace = vi.fn(async () => undefined);
        setupChatIpc({
            registry: { get: vi.fn(), has: vi.fn() } as any,
            agentRegistry: {
                refreshWorkspace,
            } as any,
            getWorkspace: () => ({ id: "ws_1", name: "demo", path: "C:/demo" }),
            getDefaultWorkspace: () => undefined,
            pendingEdits: { autoApprove: false } as any,
        });

        const handler = handlers.get("plan:set-enabled");
        const result = await handler?.({}, "ws_1", true);

        expect(result).toBeUndefined();
        expect(refreshWorkspace).toHaveBeenCalledWith("ws_1");
    });

    it("persists planModeEnabled=true when plan:set-enabled is invoked with true (CRIT-1)", async () => {
        const refreshWorkspace = vi.fn(async () => undefined);
        const setWorkspacePlanMode = vi.fn(async (_id: string, _enabled: boolean) => undefined);
        setupChatIpc({
            registry: { get: vi.fn(), has: vi.fn() } as any,
            agentRegistry: { refreshWorkspace } as any,
            getWorkspace: () => ({ id: "ws_1", name: "demo", path: "C:/demo" }),
            getDefaultWorkspace: () => undefined,
            pendingEdits: { autoApprove: false } as any,
            setWorkspacePlanMode,
        });

        const handler = handlers.get("plan:set-enabled");
        const result = await handler?.({}, "ws_1", true);

        expect(result).toBeUndefined();
        expect(setWorkspacePlanMode).toHaveBeenCalledWith("ws_1", true);
        expect(refreshWorkspace).toHaveBeenCalledWith("ws_1");
    });

    it("persists planModeEnabled=false when plan:set-enabled is invoked with false (CRIT-1)", async () => {
        const refreshWorkspace = vi.fn(async () => undefined);
        const setWorkspacePlanMode = vi.fn(async (_id: string, _enabled: boolean) => undefined);
        setupChatIpc({
            registry: { get: vi.fn(), has: vi.fn() } as any,
            agentRegistry: { refreshWorkspace } as any,
            getWorkspace: () => ({ id: "ws_1", name: "demo", path: "C:/demo" }),
            getDefaultWorkspace: () => undefined,
            pendingEdits: { autoApprove: false } as any,
            setWorkspacePlanMode,
        });

        const handler = handlers.get("plan:set-enabled");
        const result = await handler?.({}, "ws_1", false);

        expect(result).toBeUndefined();
        expect(setWorkspacePlanMode).toHaveBeenCalledWith("ws_1", false);
        expect(refreshWorkspace).toHaveBeenCalledWith("ws_1");
    });

    it("round-trips planModeEnabled through setWorkspacePlanMode → getWorkspacePlanMode (CRIT-1)", async () => {
        // In-memory mock store mirroring the production electron-store persistence pattern
        const store = new Map<string, boolean>();
        const setWorkspacePlanMode = vi.fn(async (id: string, enabled: boolean) => {
            store.set(id, enabled);
        });
        const getWorkspacePlanMode = vi.fn((id: string) => store.get(id));

        const refreshWorkspace = vi.fn(async () => undefined);
        setupChatIpc({
            registry: { get: vi.fn(), has: vi.fn() } as any,
            agentRegistry: { refreshWorkspace } as any,
            getWorkspace: () => ({ id: "ws_1", name: "demo", path: "C:/demo" }),
            getDefaultWorkspace: () => undefined,
            pendingEdits: { autoApprove: false } as any,
            setWorkspacePlanMode,
            getWorkspacePlanMode,
        });

        const handler = handlers.get("plan:set-enabled");

        // Before toggle: no per-workspace override → falls back to global (undefined)
        expect(getWorkspacePlanMode("ws_1")).toBeUndefined();

        // Toggle ON
        await handler?.({}, "ws_1", true);
        expect(store.get("ws_1")).toBe(true);
        expect(getWorkspacePlanMode("ws_1")).toBe(true);

        // Toggle OFF
        await handler?.({}, "ws_1", false);
        expect(store.get("ws_1")).toBe(false);
        expect(getWorkspacePlanMode("ws_1")).toBe(false);
    });

    it("returns ipcError when workspace is unknown for plan:set-enabled (CRIT-1)", async () => {
        const setWorkspacePlanMode = vi.fn(async () => undefined);
        setupChatIpc({
            registry: { get: vi.fn(), has: vi.fn() } as any,
            getWorkspace: () => undefined,
            getDefaultWorkspace: () => undefined,
            pendingEdits: { autoApprove: false } as any,
            setWorkspacePlanMode,
        });

        const handler = handlers.get("plan:set-enabled");
        const result = await handler?.({}, "missing_ws", true);

        expect(result).toMatchObject({
            code: "ipcErrors.chat.workspaceNotFound",
            params: { id: "missing_ws" },
        });
        expect(setWorkspacePlanMode).not.toHaveBeenCalled();
    });

    it("returns ipcError when setWorkspacePlanMode throws (CRIT-1)", async () => {
        const refreshWorkspace = vi.fn(async () => undefined);
        const setWorkspacePlanMode = vi.fn(async () => {
            throw new Error("disk full");
        });
        setupChatIpc({
            registry: { get: vi.fn(), has: vi.fn() } as any,
            agentRegistry: { refreshWorkspace } as any,
            getWorkspace: () => ({ id: "ws_1", name: "demo", path: "C:/demo" }),
            getDefaultWorkspace: () => undefined,
            pendingEdits: { autoApprove: false } as any,
            setWorkspacePlanMode,
        });

        const handler = handlers.get("plan:set-enabled");
        const result = await handler?.({}, "ws_1", true);

        expect(result).toMatchObject({
            code: "ipcErrors.chat.promptFailed",
            params: { workspace: "demo" },
        });
        expect(refreshWorkspace).not.toHaveBeenCalled();
    });

    it("overrides global planModeEnabled with the per-workspace toggle when building prompts (CRIT-1)", async () => {
        // In-memory mock store so we can toggle and observe the value flow into modeOptions
        const store = new Map<string, boolean>();
        const setWorkspacePlanMode = vi.fn(async (id: string, enabled: boolean) => {
            store.set(id, enabled);
        });
        const getWorkspacePlanMode = vi.fn((id: string) => store.get(id));

        const prompt = vi.fn(async () => undefined);
        // Capture the getMode callback so we can observe the normalized mode after each toggle
        let capturedGetMode: (() => string) | undefined;
        const registry = {
            get: vi.fn(async (_id: unknown, _path: unknown, _pe: unknown, _send: unknown, getMode: () => string) => {
                capturedGetMode = getMode;
                return { session: { prompt, abort: vi.fn() } };
            }),
            has: vi.fn(() => true),
        };

        setupChatIpc({
            registry: registry as any,
            getWorkspace: () => ({ id: "ws_1", name: "demo", path: "C:/demo" }),
            getDefaultWorkspace: () => undefined,
            pendingEdits: { autoApprove: false } as any,
            getSettings: () => ({
                longHorizon: {
                    enabled: true,
                    defaultMode: "build",
                    planMode: { enabled: false }, // global toggle OFF
                    composeMode: { enabled: false },
                    maxMode: { enabled: false },
                    memory: { enabled: false },
                    history: { enabled: false },
                    checkpoint: { enabled: false },
                    goal: { enabled: false },
                    subagents: { enabled: false },
                    task: { enabled: false },
                    actor: { enabled: false },
                    workflow: { enabled: false },
                    dream: { enabled: false },
                    distill: { enabled: false },
                    composeWorkflow: { enabled: false },
                },
            }) as any,
            setWorkspacePlanMode,
            getWorkspacePlanMode,
        });

        const planHandler = handlers.get("plan:set-enabled");
        const sendHandler = handlers.get("pi:send");

        // Before per-workspace toggle: global planMode.enabled=false → mode normalized to "build"
        await sendHandler?.({}, "ws_1", "first", { mode: "plan" });
        expect(capturedGetMode).toBeTruthy();
        expect(capturedGetMode!()).toBe("build");

        // Enable plan mode per-workspace → overrides global → mode normalized to "plan"
        await planHandler?.({}, "ws_1", true);
        expect(getWorkspacePlanMode("ws_1")).toBe(true);
        await sendHandler?.({}, "ws_1", "second", { mode: "plan" });
        expect(capturedGetMode!()).toBe("plan");

        // Disable plan mode per-workspace → overrides global → mode normalized back to "build"
        await planHandler?.({}, "ws_1", false);
        expect(getWorkspacePlanMode("ws_1")).toBe(false);
        await sendHandler?.({}, "ws_1", "third", { mode: "plan" });
        expect(capturedGetMode!()).toBe("build");
    });

    it("materializes inline plans using a preferred filename when provided", async () => {
        const workspacePath = mkdtempSync(join(tmpdir(), "pi-desktop-plan-"));
        try {
            setupChatIpc({
                registry: { get: vi.fn(), has: vi.fn() } as any,
                getWorkspace: () => ({ id: "ws_1", name: "demo", path: workspacePath }),
                getDefaultWorkspace: () => undefined,
                pendingEdits: { autoApprove: false } as any,
            });

            const handler = handlers.get("plan:materialize-inline");
            const result = await handler?.({}, {
                workspaceId: "ws_1",
                title: "计划",
                content: "- 创建文件\n- 验证结果",
                preferredFilename: "plan-123.md",
            }) as { filename: string; path: string };

            expect(result).toMatchObject({
                filename: "plan-123.md",
                path: join(workspacePath, ".pi", "plans", "plan-123.md"),
            });
            expect(existsSync(result.path)).toBe(true);
            const written = readFileSync(result.path, "utf8");
            expect(written).toContain("Plan:");
            expect(written).toContain("1. 创建文件");
            expect(written).toContain("2. 验证结果");
        } finally {
            rmSync(workspacePath, { force: true, recursive: true });
        }
    });

    it("normalizes plan-card markdown into an executable plan format without duplicating nested frontmatter", async () => {
        const workspacePath = mkdtempSync(join(tmpdir(), "pi-desktop-plan-normalize-"));
        try {
            setupChatIpc({
                registry: { get: vi.fn(), has: vi.fn() } as any,
                getWorkspace: () => ({ id: "ws_1", name: "demo", path: workspacePath }),
                getDefaultWorkspace: () => undefined,
                pendingEdits: { autoApprove: false } as any,
            });

            const handler = handlers.get("plan:materialize-inline");
            const result = await handler?.({}, {
                workspaceId: "ws_1",
                title: "创建 plan_probe.txt 并验证",
                content: [
                    "---",
                    "title: 创建 plan_probe.txt 并验证",
                    "type: chore",
                    "---",
                    "",
                    "## 步骤",
                    "",
                    "| 步骤 | 操作 | 输出 |",
                    "|------|------|------|",
                    "| 1 | 写入 plan_probe.txt | PLAN_OK |",
                    "| 2 | read 验证文件存在 | 确认内容 |",
                    "",
                    "## 验证",
                    "",
                    "- `plan_probe.txt` 存在于当前工作区",
                    "- 内容为 `PLAN_OK`",
                ].join("\n"),
                preferredFilename: "create-plan-probe.md",
            }) as { filename: string; path: string };

            const written = readFileSync(result.path, "utf8");
            expect(written).toContain('title: "创建 plan_probe.txt 并验证"');
            expect(written).toContain("type: chore");
            expect(written).toContain("Plan:\n1. 写入 plan_probe.txt\n2. read 验证文件存在");
            expect(written).not.toContain("---\n---");
            expect(written).not.toContain("\n---\ntitle: 创建 plan_probe.txt 并验证\ntype: chore\n---");
        } finally {
            rmSync(workspacePath, { force: true, recursive: true });
        }
    });

    it("extracts executable steps from step headings instead of plan detail bullets", async () => {
        const workspacePath = mkdtempSync(join(tmpdir(), "pi-desktop-plan-headings-"));
        try {
            setupChatIpc({
                registry: { get: vi.fn(), has: vi.fn() } as any,
                getWorkspace: () => ({ id: "ws_1", name: "demo", path: workspacePath }),
                getDefaultWorkspace: () => undefined,
                pendingEdits: { autoApprove: false } as any,
            });

            const handler = handlers.get("plan:materialize-inline");
            const result = await handler?.({}, {
                workspaceId: "ws_1",
                title: "创建并验证 plan_probe.txt",
                content: [
                    "## 步骤",
                    "",
                    "### 步骤 1：创建 plan_probe.txt",
                    "- **操作**：写入文件 `plan_probe.txt`",
                    "- **内容**：`PLAN_OK`（单行，无换行符）",
                    "- **路径**：`<workspace>/plan_probe.txt`",
                    "",
                    "### 步骤 2：验证文件存在",
                    "- **操作**：检查文件 `plan_probe.txt` 是否存在于工作区",
                    "- **方法**：使用 `ls` 或 `read` 确认文件路径可访问",
                    "- **预期**：文件存在且内容为 `PLAN_OK`",
                    "",
                    "## 验证",
                    "- `ls` 输出包含 `plan_probe.txt`",
                    "- `read` 文件返回 `PLAN_OK`",
                    "",
                    "## 风险",
                    "- 无。单文件写入，无副作用。",
                ].join("\n"),
                preferredFilename: "create-plan-probe.md",
            }) as { filename: string; path: string };

            const written = readFileSync(result.path, "utf8");
            expect(written).toContain("Plan:\n1. 创建 plan_probe.txt\n2. 验证文件存在");
            expect(written).not.toContain("内容：PLAN_OK");
            expect(written).not.toContain("路径：<workspace>/plan_probe.txt");
            expect(written).not.toContain("方法：使用 ls 或 read");
            expect(written).not.toContain("预期：文件存在且内容为 PLAN_OK");
            expect(written).not.toContain("无。单文件写入，无副作用。");
        } finally {
            rmSync(workspacePath, { force: true, recursive: true });
        }
    });

    // ── Phase C Task 4: goal:evaluate IPC handler ───────────────────────
    // 4 tests covering the success path, disabled-goal guard, Zod validation,
    // and workspace-not-found. The handler delegates to GoalService.evaluate
    // + applyVerdict; we mock both to verify the IPC plumbing without
    // spinning up a real judge LLM call.

    /** Helper: minimal LongHorizonSettings shape with goal evaluation enabled. */
    const longHorizonWithGoalEnabled = () => ({
        enabled: true,
        defaultMode: "build" as const,
        planMode: { enabled: true },
        composeMode: { enabled: true },
        maxMode: { enabled: true, candidates: 5 },
        memory: { enabled: true, ccIndex: false, reconcileOnSearch: true, searchScoreFloor: 0.15 },
        history: { enabled: true },
        checkpoint: { enabled: true },
        goal: { enabled: true },
        subagents: { enabled: true },
        task: { enabled: true },
        actor: { enabled: true },
        workflow: { enabled: false, maxConcurrentAgents: 4, maxLifecycleAgents: 100, maxDepth: 4 },
        dream: { enabled: false },
        distill: { enabled: false },
        composeWorkflow: { enabled: false },
    });

    it("goal:evaluate returns the verdict from goalService.evaluate on the success path", async () => {
        const evaluate = vi.fn(async () => ({
            verdict: "satisfied" as const,
            reason: "goal completed",
            confidence: 0.9,
        }));
        const applyVerdict = vi.fn(async () => null);
        const goalGet = vi.fn(async () => ({
            id: "g1",
            workspaceId: "ws_1",
            condition: "完成测试并通过验证",
            status: "running" as const,
            updatedAt: Date.now(),
        }));
        const transcriptLookup = vi.fn(async () => [
            { id: "u1", role: "user", content: "请实现" },
            { id: "a1", role: "assistant", content: "已完成" },
        ]);
        setupChatIpc({
            registry: { get: vi.fn(), has: vi.fn() } as any,
            getWorkspace: () => ({ id: "ws_1", name: "demo", path: "C:/demo" }),
            getDefaultWorkspace: () => undefined,
            pendingEdits: { autoApprove: false } as any,
            goalService: { get: goalGet, evaluate, applyVerdict } as any,
            transcriptLookup,
            getSettings: () => ({ longHorizon: longHorizonWithGoalEnabled() }) as any,
        });

        const handler = handlers.get("goal:evaluate");
        const result = await handler?.({}, { workspaceId: "ws_1" });

        // evaluate was called with the active goal's condition + resolved transcript
        expect(transcriptLookup).toHaveBeenCalledWith("ws_1", undefined);
        expect(evaluate).toHaveBeenCalledWith({
            workspaceId: "ws_1",
            agentId: undefined,
            condition: "完成测试并通过验证",
            transcript: [
                { id: "u1", role: "user", content: "请实现" },
                { id: "a1", role: "assistant", content: "已完成" },
            ],
        });
        // applyVerdict was called to persist + broadcast the verdict
        expect(applyVerdict).toHaveBeenCalledWith("ws_1", expect.objectContaining({ verdict: "satisfied" }), undefined);
        // The handler returns the verdict shape (not an IpcError)
        expect(result).toMatchObject({ verdict: "satisfied", reason: "goal completed" });
    });

    it("goal:evaluate returns inconclusive verdict without persisting checking status", async () => {
        const evaluate = vi.fn(async () => ({
            verdict: "inconclusive" as const,
            reason: "needs more work",
            confidence: 0.2,
        }));
        const applyVerdict = vi.fn(async () => null);
        setupChatIpc({
            registry: { get: vi.fn(), has: vi.fn() } as any,
            getWorkspace: () => ({ id: "ws_1", name: "demo", path: "C:/demo" }),
            getDefaultWorkspace: () => undefined,
            pendingEdits: { autoApprove: false } as any,
            goalService: {
                get: vi.fn(async () => ({
                    id: "g1",
                    workspaceId: "ws_1",
                    condition: "完成测试并通过验证",
                    status: "running" as const,
                    updatedAt: Date.now(),
                })),
                evaluate,
                applyVerdict,
            } as any,
            transcriptLookup: vi.fn(async () => [{ id: "a1", role: "assistant", content: "还在处理中" }]),
            getSettings: () => ({ longHorizon: longHorizonWithGoalEnabled() }) as any,
        });

        const handler = handlers.get("goal:evaluate");
        const result = await handler?.({}, { workspaceId: "ws_1" });

        expect(result).toMatchObject({ verdict: "inconclusive", reason: "needs more work" });
        expect(applyVerdict).not.toHaveBeenCalled();
    });

    it.each(["satisfied", "impossible", "checking"] as const)(
        "goal:evaluate returns ipcErrors.goal.notRunning for %s goals without evaluating",
        async (status) => {
            const evaluate = vi.fn();
            const applyVerdict = vi.fn();
            const transcriptLookup = vi.fn();
            setupChatIpc({
                registry: { get: vi.fn(), has: vi.fn() } as any,
                getWorkspace: () => ({ id: "ws_1", name: "demo", path: "C:/demo" }),
                getDefaultWorkspace: () => undefined,
                pendingEdits: { autoApprove: false } as any,
                goalService: {
                    get: vi.fn(async () => ({
                        id: "g1",
                        workspaceId: "ws_1",
                        condition: "完成测试并通过验证",
                        status,
                        updatedAt: Date.now(),
                    })),
                    evaluate,
                    applyVerdict,
                } as any,
                transcriptLookup,
                getSettings: () => ({ longHorizon: longHorizonWithGoalEnabled() }) as any,
            });

            const handler = handlers.get("goal:evaluate");
            const result = await handler?.({}, { workspaceId: "ws_1" });

            expect(result).toMatchObject({
                code: "ipcErrors.goal.notRunning",
                params: { workspaceId: "ws_1", status },
            });
            expect(transcriptLookup).not.toHaveBeenCalled();
            expect(evaluate).not.toHaveBeenCalled();
            expect(applyVerdict).not.toHaveBeenCalled();
        },
    );

    it("goal:evaluate returns ipcErrors.goal.disabled when longHorizon.goal.enabled is false", async () => {
        const evaluate = vi.fn();
        setupChatIpc({
            registry: { get: vi.fn(), has: vi.fn() } as any,
            getWorkspace: () => ({ id: "ws_1", name: "demo", path: "C:/demo" }),
            getDefaultWorkspace: () => undefined,
            pendingEdits: { autoApprove: false } as any,
            goalService: { get: vi.fn(), evaluate, applyVerdict: vi.fn() } as any,
            getSettings: () => ({
                longHorizon: { ...longHorizonWithGoalEnabled(), goal: { enabled: false } },
            }) as any,
        });

        const handler = handlers.get("goal:evaluate");
        const result = await handler?.({}, { workspaceId: "ws_1" });

        expect(result).toMatchObject({ code: "ipcErrors.goal.disabled" });
        // evaluate must not run when the goal feature is disabled
        expect(evaluate).not.toHaveBeenCalled();
    });

    it("goal:evaluate returns ipcErrors.goal.invalidInput when Zod validation fails", async () => {
        const evaluate = vi.fn();
        setupChatIpc({
            registry: { get: vi.fn(), has: vi.fn() } as any,
            getWorkspace: () => ({ id: "ws_1", name: "demo", path: "C:/demo" }),
            getDefaultWorkspace: () => undefined,
            pendingEdits: { autoApprove: false } as any,
            goalService: { get: vi.fn(), evaluate, applyVerdict: vi.fn() } as any,
            getSettings: () => ({ longHorizon: longHorizonWithGoalEnabled() }) as any,
        });

        const handler = handlers.get("goal:evaluate");
        // Empty workspaceId fails the z.string().min(1) check
        const result = await handler?.({}, { workspaceId: "" });

        expect(result).toMatchObject({ code: "ipcErrors.goal.invalidInput" });
        expect(evaluate).not.toHaveBeenCalled();
    });

    it("goal:evaluate returns ipcErrors.goal.notFound when the workspace is unknown", async () => {
        const evaluate = vi.fn();
        setupChatIpc({
            registry: { get: vi.fn(), has: vi.fn() } as any,
            // Unknown workspace id — getWorkspace returns undefined
            getWorkspace: () => undefined,
            getDefaultWorkspace: () => undefined,
            pendingEdits: { autoApprove: false } as any,
            goalService: { get: vi.fn(), evaluate, applyVerdict: vi.fn() } as any,
            getSettings: () => ({ longHorizon: longHorizonWithGoalEnabled() }) as any,
        });

        const handler = handlers.get("goal:evaluate");
        const result = await handler?.({}, { workspaceId: "missing_ws" });

        expect(result).toMatchObject({
            code: "ipcErrors.goal.notFound",
            params: { id: "missing_ws" },
        });
        expect(evaluate).not.toHaveBeenCalled();
    });
});
