import type { LongHorizonTaskListInput, LongHorizonTaskRecord } from "@shared";
import type { LongHorizonDatabase } from "./database";

export class TaskService {
    constructor(private readonly database: LongHorizonDatabase) {}

    async setSourceTasks(
        workspaceId: string,
        agentId: string | undefined,
        source: "goal" | "plan",
        items: Array<Pick<LongHorizonTaskRecord, "id" | "text" | "status">>,
    ): Promise<void> {
        await this.database.setSourceTasks(workspaceId, agentId, source, items);
    }

    async list(input: LongHorizonTaskListInput): Promise<LongHorizonTaskRecord[]> {
        return this.database.listTasks(input);
    }

    async getActive(input: LongHorizonTaskListInput): Promise<LongHorizonTaskRecord | null> {
        return this.database.getActiveTask(input);
    }
}
