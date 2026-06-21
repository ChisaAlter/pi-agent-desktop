import { mkdtempSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GoalService } from "../goal-service";

describe("GoalService", () => {
    const dirs: string[] = [];

    afterEach(() => {
        for (const dir of dirs.splice(0)) {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    function createService() {
        const dir = mkdtempSync(join(tmpdir(), "pi-goal-"));
        dirs.push(dir);
        const send = vi.fn();
        const service = new GoalService(join(dir, "goals.json"), send);
        return { dir, send, service };
    }

    it("persists a goal and emits a shared plan-progress T1 task", () => {
        const { dir, send, service } = createService();

        const goal = service.set({ workspaceId: "ws1", condition: "完成长程能力" });

        expect(goal.status).toBe("running");
        expect(service.get("ws1")).toMatchObject({ condition: "完成长程能力" });
        expect(JSON.parse(readFileSync(join(dir, "goals.json"), "utf8")).goals).toHaveLength(1);
        expect(send).toHaveBeenCalledWith("goal:changed", "ws1", expect.objectContaining({ condition: "完成长程能力" }));
        expect(send).toHaveBeenCalledWith("plan:progress", "ws1", expect.objectContaining({
            items: [expect.objectContaining({ id: "T1", text: "完成长程能力", status: "running" })],
        }));
    });

    it("clears active display without deleting the historical store file", () => {
        const { dir, send, service } = createService();
        service.set({ workspaceId: "ws1", condition: "通过测试" });
        send.mockClear();

        const cleared = service.clear("ws1");

        expect(cleared.status).toBe("cleared");
        expect(service.get("ws1")).toBeNull();
        expect(JSON.parse(readFileSync(join(dir, "goals.json"), "utf8")).goals).toHaveLength(0);
        expect(send).toHaveBeenCalledWith("goal:changed", "ws1", expect.objectContaining({ status: "cleared" }));
    });

    it("clears the workspace default goal when the clear request includes an agent id", () => {
        const { service } = createService();
        service.set({ workspaceId: "ws1", condition: "默认目标" });

        service.clear("ws1", "agent-1");

        expect(service.get("ws1")).toBeNull();
        expect(service.get("ws1", "agent-1")).toBeNull();
    });

    it("preserves a workspace default goal when clearing an agent-specific goal", () => {
        const { service } = createService();
        service.set({ workspaceId: "ws1", condition: "默认目标" });
        service.set({ workspaceId: "ws1", agentId: "agent-1", condition: "Agent 目标" });

        service.clear("ws1", "agent-1");

        expect(service.get("ws1")).toMatchObject({ condition: "默认目标" });
        expect(service.get("ws1", "agent-1")).toMatchObject({ condition: "默认目标" });
    });

    it("maps judge results back to goal and task status", () => {
        const { send, service } = createService();
        service.set({ workspaceId: "ws1", condition: "发布完成" });
        send.mockClear();

        const checked = service.markChecking("ws1", undefined, "需要再验证");
        const judged = service.applyJudgeResult("ws1", { ok: false, impossible: true, reason: "缺少凭据" });

        expect(checked).toMatchObject({ status: "checking", reason: "需要再验证" });
        expect(judged).toMatchObject({ status: "impossible", reason: "缺少凭据" });
        expect(send).toHaveBeenCalledWith("plan:progress", "ws1", expect.objectContaining({
            items: [expect.objectContaining({ status: "blocked" })],
        }));
    });

    it("updates the workspace default goal when judge updates arrive with an agent id fallback", () => {
        const { service } = createService();
        service.set({ workspaceId: "ws1", condition: "默认目标" });

        service.markChecking("ws1", "agent-1", "agent 检查");

        expect(service.get("ws1")).toMatchObject({ status: "checking", reason: "agent 检查" });
        expect(service.get("ws1", "agent-1")).toMatchObject({ status: "checking", reason: "agent 检查" });
    });
});
