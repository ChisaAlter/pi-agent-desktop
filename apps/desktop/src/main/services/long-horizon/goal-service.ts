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
    private readonly migrationPromise: Promise<void>;

    constructor(stateFile: string, send: Send);
    constructor(options: GoalServiceOptions);
    constructor(stateFileOrOptions: string | GoalServiceOptions, maybeSend?: Send) {
        if (typeof stateFileOrOptions === "string") {
            if (!maybeSend) throw new Error("GoalService requires a send callback");
            this.database = new LongHorizonDatabase(dirname(stateFileOrOptions));
            this.ownsDatabase = true;
            this.migrationPromise = this.database.migrateLegacyGoalsFile(stateFileOrOptions);
            this.send = maybeSend;
            return;
        }

        const rootDir = stateFileOrOptions.rootDir
            ?? (stateFileOrOptions.legacyStateFile ? dirname(stateFileOrOptions.legacyStateFile) : undefined);
        this.database = stateFileOrOptions.database ?? new LongHorizonDatabase(rootDir ?? ".");
        this.ownsDatabase = !stateFileOrOptions.database;
        this.migrationPromise = stateFileOrOptions.legacyStateFile
            ? this.database.migrateLegacyGoalsFile(stateFileOrOptions.legacyStateFile)
            : Promise.resolve();
        this.send = stateFileOrOptions.send;
        this.taskService = stateFileOrOptions.taskService;
    }

    async ready(): Promise<void> {
        await this.migrationPromise;
    }

    async get(workspaceId: string, agentId?: string): Promise<GoalState | null> {
        return this.database.getGoal(workspaceId, agentId);
    }

    async set(input: GoalSetInput): Promise<GoalState> {
        const now = Date.now();
        const goal = await this.database.upsertGoal({
            id: randomUUID(),
            workspaceId: input.workspaceId,
            agentId: input.agentId,
            condition: input.condition.trim(),
            status: "running",
            createdAt: now,
            updatedAt: now,
        });
        this.emit(goal);
        await this.emitTopLevelTask(goal);
        return goal;
    }

    async clear(workspaceId: string, agentId?: string): Promise<GoalState> {
        const previous = await this.database.clearGoal(workspaceId, agentId);
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
        await this.taskService?.setSourceTasks(workspaceId, previous?.agentId ?? agentId, "goal", []);
        this.emit(cleared);
        return cleared;
    }

    async markChecking(workspaceId: string, agentId?: string, reason = "judge 检查中"): Promise<GoalState | null> {
        return this.update(workspaceId, agentId, { status: "checking", reason });
    }

    async applyJudgeResult(workspaceId: string, result: GoalJudgeResult, agentId?: string): Promise<GoalState | null> {
        const status = result.ok ? "satisfied" : result.impossible ? "impossible" : "running";
        return this.update(workspaceId, agentId, { status, reason: result.reason });
    }

    private async update(
        workspaceId: string,
        agentId: string | undefined,
        updates: Pick<Partial<GoalState>, "status" | "reason">,
    ): Promise<GoalState | null> {
        const current = await this.database.getGoal(workspaceId, agentId);
        if (!current) return null;
        const next = await this.database.upsertGoal({
            ...current,
            ...updates,
            updatedAt: Date.now(),
        });
        this.emit(next);
        await this.emitTopLevelTask(next);
        return next;
    }

    private emit(goal: GoalState): void {
        this.send("goal:changed", goal.workspaceId, goal);
    }

    private async emitTopLevelTask(goal: GoalState): Promise<void> {
        const taskStatus: PlanProgressUpdate["items"][number]["status"] =
            goal.status === "satisfied" ? "completed"
                : goal.status === "impossible" ? "blocked"
                    : "running";
        const taskId = `goal:${goal.id}`;
        await this.taskService?.setSourceTasks(goal.workspaceId, goal.agentId, "goal", [
            { id: taskId, text: goal.condition, status: taskStatus },
        ]);
        this.send("plan:progress", goal.workspaceId, {
            workspaceId: goal.workspaceId,
            status: goal.status === "satisfied" ? "completed" : "executing",
            items: [
                {
                    id: taskId,
                    text: goal.condition,
                    status: taskStatus,
                },
            ],
        } satisfies PlanProgressUpdate);
    }

    async close(): Promise<void> {
        if (this.ownsDatabase) {
            await this.database.close();
        }
    }
}
