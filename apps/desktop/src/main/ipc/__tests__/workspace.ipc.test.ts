import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { isIpcError } from "@shared";
import { createMutationQueue, createKeyedMutator, type KeyedStore } from "../../utils/mutation-queue";

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock("electron", () => ({
    ipcMain: {
        handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
            handlers.set(channel, handler);
        }),
    },
    dialog: {
        showOpenDialog: vi.fn(),
    },
}));

vi.mock("electron-log/main", () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

import { setupWorkspaceIpc } from "../workspace.ipc";

interface WorkspaceRecord {
    id: string;
    name: string;
    path: string;
    createdAt: number;
    lastActiveAt?: number;
}

function makeStore(seed: WorkspaceRecord[]) {
    const raw = [...seed];
    return {
        get(_key: "workspaces") {
            return raw;
        },
        set(_key: "workspaces", value: WorkspaceRecord[]) {
            raw.length = 0;
            raw.push(...value);
        },
        raw,
    };
}

describe("workspace:select", () => {
    beforeEach(() => {
        handlers.clear();
    });

    it("updates the persisted workspace lastActiveAt for the selected path", async () => {
        const previousActiveAt = Date.now() - 60_000;
        const store = makeStore([
            {
                id: "ws-1",
                name: "repo",
                path: "C:/repo",
                createdAt: previousActiveAt - 1000,
                lastActiveAt: previousActiveAt,
            },
        ]);
        setupWorkspaceIpc({
            store,
            getMainWindow: () => null,
        });

        const handler = handlers.get("workspace:select");
        expect(handler).toBeTruthy();

        const result = await handler?.({}, "C:/repo");

        expect(result).toBeUndefined();
        expect(store.raw[0]?.lastActiveAt).toBeTypeOf("number");
        expect((store.raw[0]?.lastActiveAt ?? 0)).toBeGreaterThan(previousActiveAt);
    });

    it("returns an IPC error when selecting a path that is not registered", async () => {
        const store = makeStore([
            {
                id: "ws-1",
                name: "repo",
                path: "C:/repo",
                createdAt: Date.now(),
                lastActiveAt: Date.now(),
            },
        ]);
        setupWorkspaceIpc({
            store,
            getMainWindow: () => null,
        });

        const handler = handlers.get("workspace:select");
        expect(handler).toBeTruthy();

        const result = await handler?.({}, "C:/missing");

        expect(isIpcError(result)).toBe(true);
        if (isIpcError(result)) {
            expect(result.code).toBe("ipcErrors.workspace.selectFailed");
        }
    });
});

describe("workspace:create-empty", () => {
    beforeEach(() => {
        handlers.clear();
    });

    it("creates a new empty directory under the chosen parent and registers it", async () => {
        const parentDir = mkdtempSync(join(tmpdir(), "pi-desktop-empty-ws-"));
        const store = makeStore([]);
        setupWorkspaceIpc({
            store,
            getMainWindow: () => null,
        });

        const handler = handlers.get("workspace:create-empty");
        expect(handler).toBeTruthy();

        const result = await handler?.({}, "BlankProject", parentDir);

        expect(isIpcError(result)).toBe(false);
        expect(store.raw).toHaveLength(1);
        expect(store.raw[0]?.name).toBe("BlankProject");
        expect(store.raw[0]?.path).toBe(join(parentDir, "BlankProject"));
        expect(existsSync(join(parentDir, "BlankProject"))).toBe(true);

        rmSync(parentDir, { recursive: true, force: true });
    });
});

// 回归测试: 共享 mutation queue 在并发 plan-mode 切换 + workspace:select 下
// 不丢 `planModeEnabled` 字段。
//
// 背景: `main/index.ts` 的 setWorkspacePlanMode 与 `workspace.ipc.ts` 的
// CRUD/选择原本各持一份 `workspaceMutationChain`, 两份独立 Promise tail
// 并发时会 last-write-wins 互相覆盖 workspaces 数组, 表现为 plan 开关
// 「点了又弹回」。Phase 1.1 抽出共享 `createMutationQueue` + `createKeyedMutator`
// 注入两边, 这里用真实队列验证并发写入不丢字段。
describe("shared workspace mutation queue (Phase 1.1 regression)", () => {
    interface WsRecord {
        id: string;
        name: string;
        path: string;
        createdAt: number;
        lastActiveAt?: number;
        planModeEnabled?: boolean;
    }

    function makeStore(seed: WsRecord[]): KeyedStore<"workspaces", WsRecord[]> & { raw: WsRecord[] } {
        const raw = [...seed];
        return {
            get: () => raw,
            set: (_key, value) => {
                raw.length = 0;
                raw.push(...value);
            },
            raw,
        };
    }

    it("concurrent setWorkspacePlanMode + workspace:select do not lose planModeEnabled", async () => {
        const baseTime = Date.now();
        const store = makeStore([
            {
                id: "ws-1",
                name: "repo",
                path: "C:/repo",
                createdAt: baseTime - 1000,
                lastActiveAt: baseTime - 60_000,
            },
        ]);

        const queue = createMutationQueue();
        const mutateWorkspaces = createKeyedMutator(queue, store, "workspaces");

        // 模拟 setWorkspacePlanMode: 写 planModeEnabled
        const setWorkspacePlanMode = (workspaceId: string, enabled: boolean) =>
            mutateWorkspaces((current) =>
                current.map((workspace) =>
                    workspace.id === workspaceId
                        ? { ...workspace, planModeEnabled: enabled, lastActiveAt: workspace.lastActiveAt ?? Date.now() }
                        : workspace,
                ),
            );

        // 模拟 workspace:select: 写 lastActiveAt (不触碰 planModeEnabled)
        const selectWorkspace = (path: string) =>
            mutateWorkspaces((current) => {
                const idx = current.findIndex((workspace) => workspace.path === path);
                if (idx < 0) return current;
                return current.map((workspace, index) =>
                    index === idx ? { ...workspace, lastActiveAt: Date.now() } : workspace,
                );
            });

        // 并发触发: plan toggle ON 与多次 select 同时入队。
        // 旧实现 (两份独立 chain) 会因为 select 读到尚未写入 planModeEnabled
        // 的旧数组并整体写回, 把刚设的 planModeEnabled 抹掉。
        await Promise.all([
            setWorkspacePlanMode("ws-1", true),
            selectWorkspace("C:/repo"),
            selectWorkspace("C:/repo"),
            setWorkspacePlanMode("ws-1", true),
        ]);

        expect(store.raw).toHaveLength(1);
        expect(store.raw[0]?.planModeEnabled).toBe(true);
        expect(store.raw[0]?.lastActiveAt).toBeTypeOf("number");
    });

    it("a failed mutate does not deadlock subsequent mutates", async () => {
        const store = makeStore([
            { id: "ws-1", name: "repo", path: "C:/repo", createdAt: Date.now() },
        ]);
        const queue = createMutationQueue();
        const mutateWorkspaces = createKeyedMutator(queue, store, "workspaces");

        // 第一次 mutate 抛错; 队列 tail 应继续推进, 后续 mutate 仍可执行。
        await expect(
            mutateWorkspaces(() => {
                throw new Error("boom");
            }),
        ).rejects.toThrow("boom");

        // 第二次必须能写入, 不能卡死。
        await mutateWorkspaces((current) =>
            current.map((workspace) =>
                workspace.id === "ws-1" ? { ...workspace, planModeEnabled: true } : workspace,
            ),
        );
        expect(store.raw[0]?.planModeEnabled).toBe(true);
    });
});
