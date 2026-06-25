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

    it("forwards raw plan-mode prompts because the runtime extension now owns plan behavior", async () => {
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
        expect(outbound).toBe("改输入区");
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
                workflow: { enabled: false, supported: false, loadedFrom: "unsupported" },
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
            expect(readFileSync(result.path, "utf8")).toContain("- 创建文件");
        } finally {
            rmSync(workspacePath, { force: true, recursive: true });
        }
    });
});
