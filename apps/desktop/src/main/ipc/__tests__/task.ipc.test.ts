// Task IPC handler tests (Phase B Task 4.6)
// 覆盖 5 个场景:
//   1. Happy path: create → list → get → start → done → list(includeTerminal)
//   2. Unknown workspace: getWorkspaceSessionId 返回 null → ipcError("task.sessionNotFound")
//   3. Zod 校验失败: create 传空 summary → ipcError("task.invalidInput")
//   4. 状态机错误: start on done task → ipcError("task.invalidState")
//   5. Task not found: start 传不存在的 id → ipcError("task.notFound")
//
// Mock 模式参考 plan.ipc.test.ts: 拦截 ipcMain.handle 把 handler 装进 Map,
// 直接调用 handler 模拟主进程执行 (避免启 Electron). TaskRegistry 用真实
// SQLite + tmpdir (与 task-registry.test.ts 风格一致).

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock("electron", () => ({
    ipcMain: {
        handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
            handlers.set(channel, handler);
        }),
    },
}));

vi.mock("electron-log/main", () => ({
    default: {
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
    },
}));

import { setupTaskIpc } from "../task.ipc";
import { LongHorizonDatabase } from "../../services/long-horizon/database";
import { TaskRegistry } from "../../services/long-horizon/task-registry";
import type { IpcError, TaskRecord } from "@shared";

describe("setupTaskIpc", () => {
    const dirs: string[] = [];
    const databases: LongHorizonDatabase[] = [];
    let taskRegistry: TaskRegistry;
    // 默认 resolve: workspaceId === "ws_1" → sessionId === "ws_1"
    let getWorkspaceSessionId: (workspaceId: string) => string | null;

    beforeEach(() => {
        handlers.clear();
        const dir = mkdtempSync(join(tmpdir(), "pi-task-ipc-"));
        dirs.push(dir);
        const db = new LongHorizonDatabase(dir);
        databases.push(db);
        taskRegistry = new TaskRegistry(db);
        getWorkspaceSessionId = vi.fn((workspaceId: string) =>
            workspaceId === "ws_1" ? "ws_1" : null);
        setupTaskIpc({ taskRegistry, getWorkspaceSessionId });
    });

    afterEach(async () => {
        for (const db of databases.splice(0)) {
            await db.close();
        }
        for (const dir of dirs.splice(0)) {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    // ── 1. Happy path ─────────────────────────────────────────────────

    it("runs create → list → get → start → done → list(includeTerminal) round trip", async () => {
        // create
        const createHandler = handlers.get("task:create");
        expect(createHandler).toBeTruthy();
        const created = (await createHandler?.({}, {
            workspaceId: "ws_1",
            summary: "build feature X",
        })) as TaskRecord;

        expect(created.id).toBe("T1");
        expect(created.sessionId).toBe("ws_1");
        expect(created.status).toBe("open");
        expect(created.summary).toBe("build feature X");
        expect(created.parentTaskId).toBeUndefined();
        expect(created.owner).toBeUndefined();
        expect(created.endedAt).toBeUndefined();

        // list (default) — returns the created task (open is non-terminal)
        const listHandler = handlers.get("task:list");
        const list1 = (await listHandler?.({}, { workspaceId: "ws_1" })) as TaskRecord[];
        expect(list1).toHaveLength(1);
        expect(list1[0].id).toBe("T1");

        // get
        const getHandler = handlers.get("task:get");
        const fetched = (await getHandler?.({}, {
            workspaceId: "ws_1",
            id: "T1",
        })) as TaskRecord;
        expect(fetched.id).toBe("T1");
        expect(fetched.summary).toBe("build feature X");

        // start
        const startHandler = handlers.get("task:start");
        const started = (await startHandler?.({}, {
            workspaceId: "ws_1",
            id: "T1",
            owner: "agent-1",
        })) as TaskRecord;
        expect(started.status).toBe("in_progress");
        expect(started.owner).toBe("agent-1");

        // done
        const doneHandler = handlers.get("task:done");
        const completed = (await doneHandler?.({}, {
            workspaceId: "ws_1",
            id: "T1",
            eventSummary: "feature shipped",
        })) as TaskRecord;
        expect(completed.status).toBe("done");
        expect(completed.endedAt).toBeGreaterThan(0);

        // list (default) — done task 被排除 (terminal)
        const list2 = (await listHandler?.({}, { workspaceId: "ws_1" })) as TaskRecord[];
        expect(list2).toHaveLength(0);

        // list (includeTerminal: true) — done task 出现
        const list3 = (await listHandler?.({}, {
            workspaceId: "ws_1",
            includeTerminal: true,
        })) as TaskRecord[];
        expect(list3).toHaveLength(1);
        expect(list3[0].id).toBe("T1");
        expect(list3[0].status).toBe("done");
    });

    it("uses an explicit sessionId instead of the workspace-only resolver", async () => {
        const createHandler = handlers.get("task:create");
        const result = (await createHandler?.({}, {
            workspaceId: "ws_1",
            sessionId: "native-session-1",
            summary: "explicit session task",
        })) as TaskRecord;

        expect(result.sessionId).toBe("native-session-1");
        expect(getWorkspaceSessionId).not.toHaveBeenCalled?.();
    });


    it("returns ipcError.task.sessionNotFound when workspaceId has no session", async () => {
        const createHandler = handlers.get("task:create");
        const result = await createHandler?.({}, {
            workspaceId: "invalid-ws",
            summary: "test",
        });
        expect(result).toMatchObject({
            __brand: "IpcError",
            code: "ipcErrors.task.sessionNotFound",
            params: { id: "invalid-ws" },
        });
    });

    it("returns ipcError.task.sessionNotFound for task:list when workspace is unknown", async () => {
        const listHandler = handlers.get("task:list");
        const result = await listHandler?.({}, { workspaceId: "missing-ws" });
        expect(result).toMatchObject({
            code: "ipcErrors.task.sessionNotFound",
            params: { id: "missing-ws" },
        });
    });

    // ── 3. Zod validation failure ────────────────────────────────────

    it("returns ipcError.task.invalidInput when summary is empty on task:create", async () => {
        const createHandler = handlers.get("task:create");
        const result = await createHandler?.({}, {
            workspaceId: "ws_1",
            summary: "",
        });
        expect(result).toMatchObject({
            __brand: "IpcError",
            code: "ipcErrors.task.invalidInput",
        });
    });

    it("returns ipcError.task.invalidInput when id format is invalid on task:get", async () => {
        const getHandler = handlers.get("task:get");
        const result = await getHandler?.({}, {
            workspaceId: "ws_1",
            id: "not-a-task-id",
        });
        expect(result).toMatchObject({
            __brand: "IpcError",
            code: "ipcErrors.task.invalidInput",
        });
    });

    it("returns ipcError.task.invalidInput when workspaceId is empty on task:list", async () => {
        const listHandler = handlers.get("task:list");
        const result = await listHandler?.({}, { workspaceId: "" });
        expect(result).toMatchObject({
            __brand: "IpcError",
            code: "ipcErrors.task.invalidInput",
        });
    });

    // ── 4. State machine error ───────────────────────────────────────

    it("returns ipcError.task.invalidState when starting an already-done task", async () => {
        // create + done
        const createHandler = handlers.get("task:create");
        const created = (await createHandler?.({}, {
            workspaceId: "ws_1",
            summary: "done task",
        })) as TaskRecord;
        const doneHandler = handlers.get("task:done");
        await doneHandler?.({}, { workspaceId: "ws_1", id: created.id });

        // start on done task → invalidState
        const startHandler = handlers.get("task:start");
        const result = await startHandler?.({}, {
            workspaceId: "ws_1",
            id: created.id,
        });
        expect(result).toMatchObject({
            __brand: "IpcError",
            code: "ipcErrors.task.invalidState",
            params: { id: created.id },
        });
    });

    // ── 5. Task not found ────────────────────────────────────────────

    it("returns ipcError.task.notFound when starting a non-existent task", async () => {
        const startHandler = handlers.get("task:start");
        const result = await startHandler?.({}, {
            workspaceId: "ws_1",
            id: "T999",
        });
        expect(result).toMatchObject({
            __brand: "IpcError",
            code: "ipcErrors.task.notFound",
            params: { id: "T999" },
        });
    });

    it("task:get returns null for a non-existent task", async () => {
        const getHandler = handlers.get("task:get");
        const result = await getHandler?.({}, {
            workspaceId: "ws_1",
            id: "T999",
        });
        expect(result).toBeNull();
    });

    // ── Additional coverage: block / unblock / abandon / rename ──────

    it("runs block → unblock round trip", async () => {
        const createHandler = handlers.get("task:create");
        const created = (await createHandler?.({}, {
            workspaceId: "ws_1",
            summary: "blockable task",
        })) as TaskRecord;

        const blockHandler = handlers.get("task:block");
        const blocked = (await blockHandler?.({}, {
            workspaceId: "ws_1",
            id: created.id,
            eventSummary: "waiting on dep",
        })) as TaskRecord;
        expect(blocked.status).toBe("blocked");

        const unblockHandler = handlers.get("task:unblock");
        const unblocked = (await unblockHandler?.({}, {
            workspaceId: "ws_1",
            id: created.id,
        })) as TaskRecord;
        expect(unblocked.status).toBe("in_progress");
    });

    it("runs abandon round trip", async () => {
        const createHandler = handlers.get("task:create");
        const created = (await createHandler?.({}, {
            workspaceId: "ws_1",
            summary: "doomed task",
        })) as TaskRecord;

        const abandonHandler = handlers.get("task:abandon");
        const abandoned = (await abandonHandler?.({}, {
            workspaceId: "ws_1",
            id: created.id,
        })) as TaskRecord;
        expect(abandoned.status).toBe("abandoned");
        expect(abandoned.endedAt).toBeGreaterThan(0);
    });

    it("runs rename round trip", async () => {
        const createHandler = handlers.get("task:create");
        const created = (await createHandler?.({}, {
            workspaceId: "ws_1",
            summary: "old name",
        })) as TaskRecord;

        const renameHandler = handlers.get("task:rename");
        const renamed = (await renameHandler?.({}, {
            workspaceId: "ws_1",
            id: created.id,
            summary: "new name",
        })) as TaskRecord;
        expect(renamed.summary).toBe("new name");
        expect(renamed.id).toBe(created.id);
    });

    it("creates a sub-task with parentId", async () => {
        const createHandler = handlers.get("task:create");
        const parent = (await createHandler?.({}, {
            workspaceId: "ws_1",
            summary: "parent",
        })) as TaskRecord;

        const child = (await createHandler?.({}, {
            workspaceId: "ws_1",
            summary: "child",
            parentId: parent.id,
        })) as TaskRecord;

        expect(child.id).toBe("T1.1");
        expect(child.parentTaskId).toBe("T1");
    });

    // 防御性: 验证返回的 IpcError 形状完整 (有 fallback 文案).
    it("returns IpcError with fallback message on validation failure", async () => {
        const createHandler = handlers.get("task:create");
        const result = (await createHandler?.({}, { workspaceId: "ws_1" })) as IpcError;
        expect(typeof result.fallback).toBe("string");
        expect(result.fallback.length).toBeGreaterThan(0);
    });
});
