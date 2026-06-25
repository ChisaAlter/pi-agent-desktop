import { useCallback, useEffect, useRef, useState } from "react";
import { isIpcError, type GoalState, type LongHorizonTaskRecord, type PlanProgressUpdate } from "@shared";
import type { TaskProgressItem, TaskStatus } from "../components/MiniMaxCode/TaskProgressPanel";
import { useWorkspaceStore } from "../stores/workspace-store";

function mapTaskStatus(status: LongHorizonTaskRecord["status"]): TaskStatus {
    switch (status) {
        case "running":
            return "running";
        case "completed":
            return "completed";
        case "failed":
        case "blocked":
            return "failed";
        case "pending":
        case "waiting":
        default:
            return "pending";
    }
}

function toProgressItem(task: LongHorizonTaskRecord): TaskProgressItem {
    return {
        id: task.id,
        name: task.text,
        status: mapTaskStatus(task.status),
        timestamp: task.updatedAt,
    };
}

export function useTaskProgress(): {
    tasks: TaskProgressItem[];
    clearFinished: () => void;
} {
    const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
    const [tasks, setTasks] = useState<TaskProgressItem[]>([]);
    const refreshRevisionRef = useRef(0);

    const refreshTasks = useCallback(async () => {
        if (!workspaceId || !window.piAPI?.taskList) {
            setTasks([]);
            return;
        }
        const revision = ++refreshRevisionRef.current;
        const result = await window.piAPI.taskList({ workspaceId, agentId: undefined });
        if (revision !== refreshRevisionRef.current) return;
        if (isIpcError(result)) {
            setTasks([]);
            return;
        }
        setTasks(result.map(toProgressItem));
    }, [workspaceId]);

    useEffect(() => {
        void refreshTasks();
    }, [refreshTasks]);

    useEffect(() => {
        const onPlanProgress = (update: PlanProgressUpdate): void => {
            if (!workspaceId || (update.workspaceId && update.workspaceId !== workspaceId)) return;
            void refreshTasks();
        };
        const onGoalChanged = (goal: GoalState): void => {
            if (!workspaceId || goal.workspaceId !== workspaceId) return;
            void refreshTasks();
        };

        const unsubPlan = window.piAPI?.onPlanProgress?.(onPlanProgress);
        const unsubGoal = window.piAPI?.onGoalChanged?.(onGoalChanged);
        return () => {
            if (typeof unsubPlan === "function") unsubPlan();
            if (typeof unsubGoal === "function") unsubGoal();
        };
    }, [refreshTasks, workspaceId]);

    const clearFinished = useCallback(() => {
        setTasks((prev) => prev.filter((task) => task.status === "running" || task.status === "pending"));
    }, []);

    return { tasks, clearFinished };
}
