import type { PlanProgressItem } from "@shared";
import type { MemoryRecord, MemoryService } from "./memory-service";

export interface CheckpointInput {
    workspaceId: string;
    sessionId?: string;
    summary: string;
    decisions?: string[];
    nextSteps?: string[];
}

export interface RebuildContextInput {
    workspaceId: string;
    sessionId?: string;
    goal?: string;
    taskLedger?: PlanProgressItem[];
    recentTail?: string[];
    query?: string;
}

export class CheckpointService {
    constructor(private readonly memory: MemoryService) {}

    async writeCheckpoint(input: CheckpointInput): Promise<MemoryRecord> {
        const text = [
            `Summary: ${input.summary}`,
            ...(input.decisions?.length ? ["Decisions:", ...input.decisions.map((item) => `- ${item}`)] : []),
            ...(input.nextSteps?.length ? ["Next steps:", ...input.nextSteps.map((item) => `- ${item}`)] : []),
        ].join("\n");
        return this.memory.put({
            scope: input.sessionId ? "session" : "project",
            workspaceId: input.workspaceId,
            sessionId: input.sessionId,
            kind: "checkpoint",
            text,
            tags: ["checkpoint", "long-horizon"],
        });
    }

    async rebuildContext(input: RebuildContextInput): Promise<string> {
        const memories = await this.memory.search(input.query || input.goal || "", {
            workspaceId: input.workspaceId,
            sessionId: input.sessionId,
            limit: 5,
        });
        const lines = ["<long_horizon_context>"];
        if (input.goal) lines.push(`任务目标: ${input.goal}`);
        if (input.taskLedger?.length) {
            lines.push("Task ledger:");
            lines.push(...input.taskLedger.map((item) => `${item.id} [${item.status}] ${item.text}`));
        }
        if (memories.length) {
            lines.push("Memory / checkpoints:");
            lines.push(...memories.map((item) => `- (${item.kind}) ${item.text}`));
        }
        if (input.recentTail?.length) {
            lines.push("Recent tail:");
            lines.push(...input.recentTail.map((item) => `- ${item}`));
        }
        lines.push("</long_horizon_context>");
        return lines.join("\n");
    }
}
