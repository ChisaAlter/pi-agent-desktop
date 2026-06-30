import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, describe, expect, it } from "vitest";
import { CheckpointService } from "../checkpoint-service";
import { MemoryService } from "../memory-service";

describe("CheckpointService", () => {
    const dirs: string[] = [];
    const memories: MemoryService[] = [];

    afterEach(async () => {
        for (const memory of memories.splice(0)) {
            await memory.close();
        }
        for (const dir of dirs.splice(0)) {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("writes structured checkpoints and rebuilds context blocks", async () => {
        const dir = mkdtempSync(join(tmpdir(), "pi-checkpoint-"));
        dirs.push(dir);
        const memory = new MemoryService({ rootDir: dir });
        memories.push(memory);
        const service = new CheckpointService(memory);

        await service.writeCheckpoint({
            workspaceId: "ws1",
            sessionId: "s1",
            summary: "已完成 settings schema 和 GoalService",
            decisions: ["默认模式 build", "max 仅实验可见"],
            nextSteps: ["接入右侧栏 plan ledger"],
        });

        const block = await service.rebuildContext({
            workspaceId: "ws1",
            sessionId: "s1",
            goal: "完成长程能力集成",
            taskLedger: [
                { id: "T1", text: "接入 Goal", status: "running" },
            ],
            recentTail: ["用户要求 /goal 和右侧任务联动"],
            query: "GoalService",
        });

        expect(block).toContain("<long_horizon_context>");
        expect(block).toContain("已完成 settings schema 和 GoalService");
        expect(block).toContain("任务目标: 完成长程能力集成");
        expect(block).toContain("T1 [running] 接入 Goal");
        expect(block).toContain("用户要求 /goal 和右侧任务联动");
    });
});
