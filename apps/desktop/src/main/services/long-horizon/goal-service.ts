import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { randomUUID } from "crypto";
import type { GoalJudgeResult, GoalSetInput, GoalState, PlanProgressUpdate } from "@shared";

type Send = (channel: string, workspaceId: string, payload: unknown) => void;

interface GoalStoreFile {
    goals: GoalState[];
}

function key(workspaceId: string, agentId?: string): string {
    return `${workspaceId}:${agentId ?? "default"}`;
}

export class GoalService {
    private readonly goals = new Map<string, GoalState>();

    constructor(
        private readonly stateFile: string,
        private readonly send: Send,
    ) {
        this.load();
    }

    get(workspaceId: string, agentId?: string): GoalState | null {
        return this.findGoal(workspaceId, agentId)?.goal ?? null;
    }

    set(input: GoalSetInput): GoalState {
        const now = Date.now();
        const goal: GoalState = {
            id: randomUUID(),
            workspaceId: input.workspaceId,
            agentId: input.agentId,
            condition: input.condition.trim(),
            status: "running",
            createdAt: now,
            updatedAt: now,
        };
        this.goals.set(key(input.workspaceId, input.agentId), goal);
        this.persist();
        this.emit(goal);
        this.emitTopLevelTask(goal);
        return goal;
    }

    clear(workspaceId: string, agentId?: string): GoalState {
        const found = this.findGoal(workspaceId, agentId);
        const previous = found?.goal ?? null;
        const now = Date.now();
        const goal: GoalState = {
            id: previous?.id ?? randomUUID(),
            workspaceId,
            agentId,
            condition: previous?.condition ?? "",
            status: "cleared",
            reason: "已清除",
            createdAt: previous?.createdAt ?? now,
            updatedAt: now,
        };
        this.goals.delete(found?.key ?? key(workspaceId, agentId));
        this.persist();
        this.emit(goal);
        return goal;
    }

    markChecking(workspaceId: string, agentId?: string, reason = "judge 检查中"): GoalState | null {
        return this.update(workspaceId, agentId, { status: "checking", reason });
    }

    applyJudgeResult(workspaceId: string, result: GoalJudgeResult, agentId?: string): GoalState | null {
        const status = result.ok ? "satisfied" : result.impossible ? "impossible" : "running";
        return this.update(workspaceId, agentId, {
            status,
            reason: result.reason,
        });
    }

    private update(
        workspaceId: string,
        agentId: string | undefined,
        updates: Pick<Partial<GoalState>, "status" | "reason">,
    ): GoalState | null {
        const current = this.get(workspaceId, agentId);
        if (!current) return null;
        const next: GoalState = { ...current, ...updates, updatedAt: Date.now() };
        this.goals.set(this.findGoal(workspaceId, agentId)?.key ?? key(workspaceId, agentId), next);
        this.persist();
        this.emit(next);
        this.emitTopLevelTask(next);
        return next;
    }

    private findGoal(workspaceId: string, agentId?: string): { key: string; goal: GoalState } | null {
        const directKey = key(workspaceId, agentId);
        const direct = this.goals.get(directKey);
        if (direct) return { key: directKey, goal: direct };
        const fallbackKey = key(workspaceId);
        const fallback = this.goals.get(fallbackKey);
        return fallback ? { key: fallbackKey, goal: fallback } : null;
    }

    private emit(goal: GoalState): void {
        this.send("goal:changed", goal.workspaceId, goal);
    }

    private emitTopLevelTask(goal: GoalState): void {
        if (goal.status === "cleared") return;
        const taskStatus: PlanProgressUpdate["items"][number]["status"] =
            goal.status === "satisfied" ? "completed"
                : goal.status === "impossible" ? "blocked"
                    : goal.status === "checking" ? "running"
                        : "running";
        this.send("plan:progress", goal.workspaceId, {
            workspaceId: goal.workspaceId,
            status: goal.status === "satisfied" ? "completed" : "executing",
            items: [
                {
                    id: "T1",
                    text: goal.condition,
                    status: taskStatus,
                },
            ],
        } satisfies PlanProgressUpdate);
    }

    private load(): void {
        if (!existsSync(this.stateFile)) return;
        try {
            const parsed = JSON.parse(readFileSync(this.stateFile, "utf8")) as GoalStoreFile;
            for (const goal of parsed.goals ?? []) {
                if (!goal?.workspaceId || goal.status === "cleared") continue;
                this.goals.set(key(goal.workspaceId, goal.agentId), goal);
            }
        } catch {
            this.goals.clear();
        }
    }

    private persist(): void {
        mkdirSync(dirname(this.stateFile), { recursive: true });
        writeFileSync(
            this.stateFile,
            JSON.stringify({ goals: [...this.goals.values()] } satisfies GoalStoreFile, null, 2),
            "utf8",
        );
    }
}
