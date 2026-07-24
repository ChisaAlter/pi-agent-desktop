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

    // wave-105 residual
    it("writes project-scoped checkpoint without session and omits empty sections", async () => {
        const dir = mkdtempSync(join(tmpdir(), "pi-checkpoint-empty-"));
        dirs.push(dir);
        const memory = new MemoryService({ rootDir: dir });
        memories.push(memory);
        const service = new CheckpointService(memory);

        const record = await service.writeCheckpoint({
            workspaceId: "ws-empty",
            summary: "only summary",
        });
        expect(record.scope).toBe("project");
        expect(record.sessionId).toBeUndefined();
        expect(record.text).toContain("Summary: only summary");
        expect(record.text).not.toContain("Decisions:");
        expect(record.text).not.toContain("Next steps:");

        const block = await service.rebuildContext({
            workspaceId: "ws-empty",
        });
        expect(block).toContain("<long_horizon_context>");
        expect(block).toContain("</long_horizon_context>");
        expect(block).not.toContain("任务目标:");
        expect(block).not.toContain("Task ledger:");
        expect(block).not.toContain("Recent tail:");
    });

    // wave-233 residual
    it("session-scoped checkpoint uses session scope and rebuild includes memory section", async () => {
        const dir = mkdtempSync(join(tmpdir(), "pi-checkpoint-sess-"));
        dirs.push(dir);
        const memory = new MemoryService({ rootDir: dir });
        memories.push(memory);
        const service = new CheckpointService(memory);

        const record = await service.writeCheckpoint({
            workspaceId: "ws-sess",
            sessionId: "sess-1",
            summary: "session summary",
            decisions: ["d1"],
            nextSteps: ["n1"],
        });
        expect(record.scope).toBe("session");
        expect(record.sessionId).toBe("sess-1");
        expect(record.text).toContain("Summary: session summary");
        expect(record.text).toContain("- d1");
        expect(record.text).toContain("- n1");

        const block = await service.rebuildContext({
            workspaceId: "ws-sess",
            sessionId: "sess-1",
            query: "session summary",
            goal: "g",
            taskLedger: [],
            recentTail: [],
        });
        expect(block).toContain("任务目标: g");
        expect(block).toContain("Memory / checkpoints:");
        expect(block).toContain("session summary");
        expect(block).not.toContain("Task ledger:");
        expect(block).not.toContain("Recent tail:");
    });

    it("rebuildContext prefers query over goal for memory search and omits empty goal", async () => {
        const dir = mkdtempSync(join(tmpdir(), "pi-checkpoint-query-"));
        dirs.push(dir);
        const memory = new MemoryService({ rootDir: dir });
        memories.push(memory);
        const service = new CheckpointService(memory);

        await service.writeCheckpoint({
            workspaceId: "ws-q",
            summary: "unique-checkpoint-token-xyz",
        });

        const withQuery = await service.rebuildContext({
            workspaceId: "ws-q",
            query: "unique-checkpoint-token-xyz",
        });
        expect(withQuery).toContain("unique-checkpoint-token-xyz");
        expect(withQuery).not.toContain("任务目标:");

        const emptyLedgerTail = await service.rebuildContext({
            workspaceId: "ws-q",
            taskLedger: [],
            recentTail: [],
        });
        expect(emptyLedgerTail).toContain("<long_horizon_context>");
        expect(emptyLedgerTail).not.toContain("Task ledger:");
        expect(emptyLedgerTail).not.toContain("Recent tail:");
    });
});
