import { existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GoalService } from "../goal-service";

describe("GoalService", () => {
    const dirs: string[] = [];
    const services: GoalService[] = [];

    afterEach(() => {
        for (const service of services.splice(0)) {
            service.close();
        }
        for (const dir of dirs.splice(0)) {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    function createService() {
        const dir = mkdtempSync(join(tmpdir(), "pi-goal-"));
        dirs.push(dir);
        const send = vi.fn();
        const service = new GoalService(join(dir, "goals.json"), send);
        services.push(service);
        return { dir, send, service };
    }

    it("persists a goal and emits a shared plan-progress T1 task", () => {
        const { dir, send, service } = createService();

        const goal = service.set({ workspaceId: "ws1", condition: "完成长程能力" });
        const reloaded = new GoalService(join(dir, "goals.json"), vi.fn());
        services.push(reloaded);

        expect(goal.status).toBe("running");
        expect(service.get("ws1")).toMatchObject({ condition: "完成长程能力" });
        expect(reloaded.get("ws1")).toMatchObject({ condition: "完成长程能力" });
        expect(existsSync(join(dir, "long-horizon.db"))).toBe(true);
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
        const reloaded = new GoalService(join(dir, "goals.json"), vi.fn());
        services.push(reloaded);

        expect(cleared.status).toBe("cleared");
        expect(service.get("ws1")).toBeNull();
        expect(reloaded.get("ws1")).toBeNull();
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

    it("migrates a legacy goals.json file into long-horizon.db on first load", () => {
        const dir = mkdtempSync(join(tmpdir(), "pi-goal-"));
        dirs.push(dir);
        writeFileSync(join(dir, "goals.json"), JSON.stringify({
            goals: [
                {
                    id: "legacy-goal",
                    workspaceId: "ws1",
                    condition: "legacy 目标",
                    status: "running",
                    createdAt: 1,
                    updatedAt: 2,
                },
            ],
        }), "utf8");

        const service = new GoalService(join(dir, "goals.json"), vi.fn());
        services.push(service);

        expect(service.get("ws1")).toMatchObject({ id: "legacy-goal", condition: "legacy 目标" });
        expect(existsSync(join(dir, "goals.json.migrated"))).toBe(true);
        expect(existsSync(join(dir, "long-horizon.db"))).toBe(true);
    });
});
