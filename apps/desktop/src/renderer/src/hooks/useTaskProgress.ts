import { useCallback, useEffect, useRef, useState } from "react";
import { isIpcError, type GoalState, type LongHorizonTaskRecord, type PlanProgressUpdate } from "@shared";
import type { TaskProgressItem, TaskStatus } from "../components/MiniMaxCode/TaskProgressPanel";
import { useWorkspaceStore } from "../stores/workspace-store";

export function mapTaskStatus(status: LongHorizonTaskRecord["status"]): TaskStatus {
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

export function toProgressItem(task: LongHorizonTaskRecord): TaskProgressItem {
    return {
        id: task.id,
        name: task.text,
        status: mapTaskStatus(task.status),
        timestamp: task.updatedAt,
    };
}

export function useTaskProgress(agentId?: string | null): {
    tasks: TaskProgressItem[];
    clearFinished: () => void;
} {
    const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
    const [tasks, setTasks] = useState<TaskProgressItem[]>([]);
    const refreshRevisionRef = useRef(0);

    // 用 ref 跟踪当前 workspaceId, 让订阅 effect 只在 mount 时注册一次,
    // 避免 workspaceId 切换期间 unsubscribe→resubscribe 的窗口丢失事件.
    const workspaceIdRef = useRef(workspaceId);
    useEffect(() => {
        workspaceIdRef.current = workspaceId;
    }, [workspaceId]);

    const refreshTasks = useCallback(async () => {
        const currentWorkspaceId = workspaceIdRef.current;
        if (!currentWorkspaceId || !window.piAPI?.legacyTaskList) {
            setTasks([]);
            return;
        }
        const revision = ++refreshRevisionRef.current;
        const result = await window.piAPI.legacyTaskList({ workspaceId: currentWorkspaceId, agentId: agentId ?? undefined });
        if (revision !== refreshRevisionRef.current) return;
        if (isIpcError(result)) {
            setTasks([]);
            return;
        }
        setTasks(result.map(toProgressItem));
    }, [agentId]);

    useEffect(() => {
        void refreshTasks();
    }, [refreshTasks, workspaceId]);

    useEffect(() => {
        const onPlanProgress = (update: PlanProgressUpdate): void => {
            const currentWorkspaceId = workspaceIdRef.current;
            if (!currentWorkspaceId || (update.workspaceId && update.workspaceId !== currentWorkspaceId)) return;
            void refreshTasks();
        };
        const onGoalChanged = (goal: GoalState): void => {
            const currentWorkspaceId = workspaceIdRef.current;
            if (!currentWorkspaceId || goal.workspaceId !== currentWorkspaceId) return;
            void refreshTasks();
        };

        const unsubPlan = window.piAPI?.onPlanProgress?.(onPlanProgress);
        const unsubGoal = window.piAPI?.onGoalChanged?.(onGoalChanged);
        return () => {
            if (typeof unsubPlan === "function") unsubPlan();
            if (typeof unsubGoal === "function") unsubGoal();
        };
    }, [refreshTasks]);

    const clearFinished = useCallback(() => {
        setTasks((prev) => prev.filter((task) => task.status === "running" || task.status === "pending"));
    }, []);

    return { tasks, clearFinished };
}
