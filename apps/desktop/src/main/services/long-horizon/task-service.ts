import type { LongHorizonTaskListInput, LongHorizonTaskRecord } from "@shared";
import type { LongHorizonDatabase } from "./database";

export class TaskService {
    constructor(private readonly database: LongHorizonDatabase) {}

    setSourceTasks(
        workspaceId: string,
        agentId: string | undefined,
        source: "goal" | "plan",
        items: Array<Pick<LongHorizonTaskRecord, "id" | "text" | "status">>,
    ): void {
        this.database.setSourceTasks(workspaceId, agentId, source, items);
    }

    list(input: LongHorizonTaskListInput): LongHorizonTaskRecord[] {
        return this.database.listTasks(input);
    }

    getActive(input: LongHorizonTaskListInput): LongHorizonTaskRecord | null {
        return this.database.getActiveTask(input);
    }
}
