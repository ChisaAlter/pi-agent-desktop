// Plan IPC handler tests (Task 4.6)
// 覆盖 3 个场景:
//   1. Happy path: create → list → get → update → complete → list(includeCompleted)
//   2. Unknown workspace: 返回 ipcError("ipcErrors.plan.workspaceNotFound", ...)
//   3. Zod 校验失败: 返回 ipcError("ipcErrors.plan.invalidInput", ...)
//
// Mock 模式参考 chat.ipc.test.ts: 拦截 ipcMain.handle 把 handler 装进 Map,
// 直接调用 handler 模拟主进程执行 (避免启 Electron). PlanFileService 用真实 fs +
// tmpdir (与 plan-file-service.test.ts 风格一致).

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
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

import { setupPlanIpc } from "../plan.ipc";
import { PlanFileService } from "../../services/plan/plan-file-service";
import type { IpcError, PlanRecord } from "@shared";

describe("setupPlanIpc", () => {
    const dirs: string[] = [];
    let planFileService: PlanFileService;
    let workspacePath: string;

    beforeEach(() => {
        handlers.clear();
        workspacePath = mkdtempSync(join(tmpdir(), "pi-plan-ipc-"));
        dirs.push(workspacePath);
        planFileService = new PlanFileService();
        setupPlanIpc({
            planFileService,
            getWorkspace: (id: string) =>
                id === "ws_1"
                    ? { id: "ws_1", name: "demo", path: workspacePath }
                    : undefined,
        });
    });

    afterEach(() => {
        for (const dir of dirs.splice(0)) {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    // ── 1. Happy path ─────────────────────────────────────────────────

    it("runs create → list → get → update → complete → list(includeCompleted) round trip", async () => {
        // create
        const createHandler = handlers.get("plan:create");
        expect(createHandler).toBeTruthy();
        const created = (await createHandler?.({}, {
            workspaceId: "ws_1",
            slug: "fix-login-bug",
            title: "修复登录 Bug",
            content: "## 目标\n\n- 修复登录失败",
        })) as PlanRecord;

        expect(created.id).toMatch(/^[0-9a-f-]{36}$/i);
        expect(created.filename).toMatch(/^\d+-fix-login-bug\.md$/);
        expect(created.title).toBe("修复登录 Bug");
        expect(created.status).toBe("draft");
        expect(created.content).toContain("修复登录失败");
        expect(existsSync(created.path)).toBe(true);

        // list (no options) — returns the created plan
        const listHandler = handlers.get("plan:list");
        const list1 = (await listHandler?.({}, { workspaceId: "ws_1" })) as PlanRecord[];
        expect(list1).toHaveLength(1);
        expect(list1[0].id).toBe(created.id);

        // get
        const getHandler = handlers.get("plan:get");
        const fetched = (await getHandler?.({}, {
            workspaceId: "ws_1",
            filename: created.filename,
        })) as PlanRecord;
        expect(fetched.id).toBe(created.id);
        expect(fetched.content).toBe(created.content);

        // update — flip status to "executing"
        const updateHandler = handlers.get("plan:update");
        const updated = (await updateHandler?.({}, {
            workspaceId: "ws_1",
            filename: created.filename,
            status: "executing",
            content: "## 目标\n\n- 修复登录失败\n- 加测试",
        })) as PlanRecord;
        expect(updated.status).toBe("executing");
        expect(updated.content).toContain("加测试");
        expect(updated.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);

        // list (default) — still 1 (executing is still in root plans dir)
        const list2 = (await listHandler?.({}, { workspaceId: "ws_1" })) as PlanRecord[];
        expect(list2).toHaveLength(1);
        expect(list2[0].status).toBe("executing");

        // complete — moves file to .pi/plans/completed/
        const completeHandler = handlers.get("plan:complete");
        const completed = (await completeHandler?.({}, {
            workspaceId: "ws_1",
            filename: created.filename,
        })) as PlanRecord;
        expect(completed.status).toBe("completed");
        expect(completed.path).toContain(join(".pi", "plans", "completed"));
        expect(existsSync(completed.path)).toBe(true);
        // 原位置不再有该文件
        expect(existsSync(created.path)).toBe(false);

        // list (default) — completed plan 被排除
        const list3 = (await listHandler?.({}, { workspaceId: "ws_1" })) as PlanRecord[];
        expect(list3).toHaveLength(0);

        // list (includeCompleted: true) — completed plan 出现
        const list4 = (await listHandler?.({}, {
            workspaceId: "ws_1",
            includeCompleted: true,
        })) as PlanRecord[];
        expect(list4).toHaveLength(1);
        expect(list4[0].id).toBe(created.id);
        expect(list4[0].status).toBe("completed");
    });

    // ── 2. Unknown workspace ─────────────────────────────────────────

    it("returns ipcError.plan.workspaceNotFound when workspace id is unknown", async () => {
        const createHandler = handlers.get("plan:create");
        const result = await createHandler?.({}, {
            workspaceId: "invalid-ws",
            slug: "x",
            title: "t",
            content: "c",
        });
        expect(result).toMatchObject({
            __brand: "IpcError",
            code: "ipcErrors.plan.workspaceNotFound",
            params: { id: "invalid-ws" },
        });
    });

    it("returns ipcError.plan.workspaceNotFound for plan:list when workspace is unknown", async () => {
        const listHandler = handlers.get("plan:list");
        const result = await listHandler?.({}, { workspaceId: "missing-ws" });
        expect(result).toMatchObject({
            code: "ipcErrors.plan.workspaceNotFound",
            params: { id: "missing-ws" },
        });
    });

    // ── 3. Zod validation failure ────────────────────────────────────

    it("returns ipcError.plan.invalidInput when slug is missing on plan:create", async () => {
        const createHandler = handlers.get("plan:create");
        const result = await createHandler?.({}, {
            workspaceId: "ws_1",
            // slug intentionally missing
            title: "t",
            content: "c",
        });
        expect(result).toMatchObject({
            __brand: "IpcError",
            code: "ipcErrors.plan.invalidInput",
        });
    });

    it("returns ipcError.plan.invalidInput when plan:create content exceeds the IPC size limit", async () => {
        const createHandler = handlers.get("plan:create");
        const result = await createHandler?.({}, {
            workspaceId: "ws_1",
            slug: "too-large",
            title: "t",
            content: "x".repeat(1_048_577),
        });
        expect(result).toMatchObject({
            __brand: "IpcError",
            code: "ipcErrors.plan.invalidInput",
        });
    });

    it("returns ipcError.plan.invalidInput when plan:update content exceeds the IPC size limit", async () => {
        const updateHandler = handlers.get("plan:update");
        const result = await updateHandler?.({}, {
            workspaceId: "ws_1",
            filename: "123-too-large.md",
            content: "x".repeat(1_048_577),
        });
        expect(result).toMatchObject({
            __brand: "IpcError",
            code: "ipcErrors.plan.invalidInput",
        });
    });

    it("returns ipcError.plan.invalidInput when workspaceId is empty on plan:get", async () => {
        const getHandler = handlers.get("plan:get");
        const result = await getHandler?.({}, {
            workspaceId: "",
            filename: "x.md",
        });
        expect(result).toMatchObject({
            __brand: "IpcError",
            code: "ipcErrors.plan.invalidInput",
        });
    });

    it("returns ipcError.plan.invalidInput when status enum is invalid on plan:update", async () => {
        const updateHandler = handlers.get("plan:update");
        const result = await updateHandler?.({}, {
            workspaceId: "ws_1",
            filename: "123-foo.md",
            status: "invalid-status",
        });
        expect(result).toMatchObject({
            __brand: "IpcError",
            code: "ipcErrors.plan.invalidInput",
        });
    });

    it("returns ipcError.plan.updateFailed when plan file does not exist on update", async () => {
        const updateHandler = handlers.get("plan:update");
        const result = await updateHandler?.({}, {
            workspaceId: "ws_1",
            filename: "nonexistent.md",
            status: "executing",
        });
        expect(result).toMatchObject({
            code: "ipcErrors.plan.updateFailed",
        });
    });

    it("plan:delete returns void for unknown filename (idempotent)", async () => {
        const deleteHandler = handlers.get("plan:delete");
        const result = await deleteHandler?.({}, {
            workspaceId: "ws_1",
            filename: "does-not-exist.md",
        });
        expect(result).toBeUndefined();
    });

    it("plan:get returns null for unknown filename", async () => {
        const getHandler = handlers.get("plan:get");
        const result = await getHandler?.({}, {
            workspaceId: "ws_1",
            filename: "missing.md",
        });
        expect(result).toBeNull();
    });

    // 防御性: 验证返回的 IpcError 形状完整 (有 fallback 文案).
    it("returns IpcError with fallback message on validation failure", async () => {
        const createHandler = handlers.get("plan:create");
        const result = (await createHandler?.({}, { workspaceId: "ws_1" })) as IpcError;
        expect(typeof result.fallback).toBe("string");
        expect(result.fallback.length).toBeGreaterThan(0);
    });

    // wave-102 residual
    it("returns completeFailed when completing a missing plan file", async () => {
        const result = await handlers.get("plan:complete")!({}, {
            workspaceId: "ws_1",
            filename: "missing-plan.md",
        });
        expect(result).toMatchObject({ code: "ipcErrors.plan.completeFailed" });
    });

    it("rejects invalid plan:delete input and deletes an existing plan", async () => {
        const invalid = await handlers.get("plan:delete")!({}, {
            workspaceId: "",
            filename: "x.md",
        });
        expect(invalid).toMatchObject({ code: "ipcErrors.plan.invalidInput" });

        const created = (await handlers.get("plan:create")!({}, {
            workspaceId: "ws_1",
            slug: "to-delete",
            title: "del",
            content: "body",
        })) as PlanRecord;
        expect(existsSync(created.path)).toBe(true);
        const deleted = await handlers.get("plan:delete")!({}, {
            workspaceId: "ws_1",
            filename: created.filename,
        });
        expect(deleted).toBeUndefined();
        expect(existsSync(created.path)).toBe(false);
        const listed = (await handlers.get("plan:list")!({}, { workspaceId: "ws_1" })) as PlanRecord[];
        expect(listed).toHaveLength(0);
    });
});
