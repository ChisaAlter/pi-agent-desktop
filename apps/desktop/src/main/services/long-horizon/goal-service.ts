import { dirname } from "path";
import { randomUUID } from "crypto";
import type { GoalJudgeResult, GoalSetInput, GoalState, PlanProgressUpdate } from "@shared";
import { LongHorizonDatabase } from "./database";
import type { TaskService } from "./task-service";

type Send = (channel: string, workspaceId: string, payload: unknown) => void;

interface GoalServiceOptions {
    database?: LongHorizonDatabase;
    rootDir?: string;
    legacyStateFile?: string;
    send: Send;
    taskService?: Pick<TaskService, "setSourceTasks">;
}

export class GoalService {
    private readonly database: LongHorizonDatabase;
    private readonly ownsDatabase: boolean;
    private readonly send: Send;
    private readonly taskService?: Pick<TaskService, "setSourceTasks">;

    constructor(stateFile: string, send: Send);
    constructor(options: GoalServiceOptions);
    constructor(stateFileOrOptions: string | GoalServiceOptions, maybeSend?: Send) {
        if (typeof stateFileOrOptions === "string") {
            if (!maybeSend) throw new Error("GoalService requires a send callback");
            this.database = new LongHorizonDatabase(dirname(stateFileOrOptions));
            this.ownsDatabase = true;
            this.database.migrateLegacyGoalsFile(stateFileOrOptions);
            this.send = maybeSend;
            return;
        }

        const rootDir = stateFileOrOptions.rootDir
            ?? (stateFileOrOptions.legacyStateFile ? dirname(stateFileOrOptions.legacyStateFile) : undefined);
        this.database = stateFileOrOptions.database ?? new LongHorizonDatabase(rootDir ?? ".");
        this.ownsDatabase = !stateFileOrOptions.database;
        if (stateFileOrOptions.legacyStateFile) {
            this.database.migrateLegacyGoalsFile(stateFileOrOptions.legacyStateFile);
        }
        this.send = stateFileOrOptions.send;
        this.taskService = stateFileOrOptions.taskService;
    }

    get(workspaceId: string, agentId?: string): GoalState | null {
        return this.database.getGoal(workspaceId, agentId);
    }

    set(input: GoalSetInput): GoalState {
        const now = Date.now();
        const goal = this.database.upsertGoal({
            id: randomUUID(),
            workspaceId: input.workspaceId,
            agentId: input.agentId,
            condition: input.condition.trim(),
            status: "running",
            createdAt: now,
            updatedAt: now,
        });
        this.emit(goal);
        this.emitTopLevelTask(goal);
        return goal;
    }

    clear(workspaceId: string, agentId?: string): GoalState {
        const previous = this.database.clearGoal(workspaceId, agentId);
        const now = Date.now();
        const cleared: GoalState = {
            id: previous?.id ?? randomUUID(),
            workspaceId,
            agentId: previous?.agentId ?? agentId,
            condition: previous?.condition ?? "",
            status: "cleared",
            reason: "已清除",
            createdAt: previous?.createdAt ?? now,
            updatedAt: now,
        };
        this.taskService?.setSourceTasks(workspaceId, previous?.agentId ?? agentId, "goal", []);
        this.emit(cleared);
        return cleared;
    }

    markChecking(workspaceId: string, agentId?: string, reason = "judge 检查中"): GoalState | null {
        return this.update(workspaceId, agentId, { status: "checking", reason });
    }

    applyJudgeResult(workspaceId: string, result: GoalJudgeResult, agentId?: string): GoalState | null {
        const status = result.ok ? "satisfied" : result.impossible ? "impossible" : "running";
        return this.update(workspaceId, agentId, { status, reason: result.reason });
    }

    private update(
        workspaceId: string,
        agentId: string | undefined,
        updates: Pick<Partial<GoalState>, "status" | "reason">,
    ): GoalState | null {
        const current = this.database.getGoal(workspaceId, agentId);
        if (!current) return null;
        const next = this.database.upsertGoal({
            ...current,
            ...updates,
            updatedAt: Date.now(),
        });
        this.emit(next);
        this.emitTopLevelTask(next);
        return next;
    }

    private emit(goal: GoalState): void {
        this.send("goal:changed", goal.workspaceId, goal);
    }

    private emitTopLevelTask(goal: GoalState): void {
        const taskStatus: PlanProgressUpdate["items"][number]["status"] =
            goal.status === "satisfied" ? "completed"
                : goal.status === "impossible" ? "blocked"
                    : "running";
        this.taskService?.setSourceTasks(goal.workspaceId, goal.agentId, "goal", [
            { id: "T1", text: goal.condition, status: taskStatus },
        ]);
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

    close(): void {
        if (this.ownsDatabase) {
            this.database.close();
        }
    }
}
