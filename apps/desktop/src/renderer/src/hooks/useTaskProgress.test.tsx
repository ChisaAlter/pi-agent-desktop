// @vitest-environment jsdom

import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GoalState, LongHorizonTaskRecord, PlanProgressUpdate } from "@shared";
import { mapTaskStatus, toProgressItem, useTaskProgress } from "./useTaskProgress";
import { useWorkspaceStore } from "../stores/workspace-store";

let emitPlanProgress: ((update: PlanProgressUpdate) => void) | null = null;
let emitGoalChanged: ((goal: GoalState) => void) | null = null;
const taskList = vi.fn<() => Promise<LongHorizonTaskRecord[]>>();

function HookHost({
    agentId,
    exposeClear,
}: {
    agentId?: string | null;
    exposeClear?: boolean;
}): React.JSX.Element {
    const { tasks, clearFinished } = useTaskProgress(agentId);
    return (
        <div>
            {exposeClear ? (
                <button type="button" onClick={clearFinished}>
                    clear-finished
                </button>
            ) : null}
            <ul>
                {tasks.map((task) => (
                    <li key={task.id}>
                        {task.name}:{task.status}
                    </li>
                ))}
            </ul>
        </div>
    );
}

describe("mapTaskStatus / toProgressItem", () => {
    it("maps long-horizon statuses onto UI progress statuses", () => {
        expect(mapTaskStatus("running")).toBe("running");
        expect(mapTaskStatus("completed")).toBe("completed");
        expect(mapTaskStatus("failed")).toBe("failed");
        expect(mapTaskStatus("blocked")).toBe("failed");
        expect(mapTaskStatus("pending")).toBe("pending");
        expect(mapTaskStatus("waiting")).toBe("pending");
    });

    it("projects registry rows into progress items", () => {
        expect(
            toProgressItem({
                id: "T9",
                workspaceId: "ws1",
                source: "goal",
                text: "ship",
                status: "blocked",
                ordinal: 1,
                createdAt: 10,
                updatedAt: 20,
            }),
        ).toEqual({
            id: "T9",
            name: "ship",
            status: "failed",
            timestamp: 20,
        });
    });
});

beforeEach(() => {
    emitPlanProgress = null;
    emitGoalChanged = null;
    taskList.mockReset();
    useWorkspaceStore.setState({
        workspaces: [
            {
                id: "ws1",
                name: "demo",
                path: "C:/demo",
                createdAt: new Date(1),
                lastActiveAt: new Date(1),
            },
        ],
        currentWorkspaceId: "ws1",
        lastError: null,
    });
    (globalThis as { window: unknown }).window = window;
    Object.assign(window, {
        piAPI: {
            // Phase B Task 4 renamed the legacy surface to legacyTaskList;
            // the hook calls legacyTaskList, so the mock must match.
            legacyTaskList: taskList,
            onPlanProgress: vi.fn((cb: (update: PlanProgressUpdate) => void) => {
                emitPlanProgress = cb;
                return vi.fn();
            }),
            onGoalChanged: vi.fn((cb: (goal: GoalState) => void) => {
                emitGoalChanged = cb;
                return vi.fn();
            }),
        },
    });
});

describe("useTaskProgress", () => {
    it("loads task registry rows for the current workspace", async () => {
        taskList.mockResolvedValue([
            {
                id: "T1",
                workspaceId: "ws1",
                source: "goal",
                text: "finish migration",
                status: "running",
                ordinal: 0,
                createdAt: 1,
                updatedAt: 2,
            },
        ]);

        await act(async () => {
            render(<HookHost />);
        });

        await screen.findByText("finish migration:running");
        expect(taskList).toHaveBeenCalledWith({ workspaceId: "ws1", agentId: undefined });
    });

    it("passes the current agent scope through to task list queries when provided", async () => {
        taskList.mockResolvedValue([
            {
                id: "T_agent",
                workspaceId: "ws1",
                agentId: "agent-1",
                source: "goal",
                text: "agent scoped task",
                status: "running",
                ordinal: 0,
                createdAt: 1,
                updatedAt: 2,
            },
        ]);

        await act(async () => {
            render(<HookHost agentId="agent-1" />);
        });

        await screen.findByText("agent scoped task:running");
        expect(taskList).toHaveBeenCalledWith({ workspaceId: "ws1", agentId: "agent-1" });
    });

    it("refreshes task registry rows when plan progress updates arrive", async () => {
        taskList
            .mockResolvedValueOnce([
                {
                    id: "T1",
                    workspaceId: "ws1",
                    source: "plan",
                    text: "old plan step",
                    status: "running",
                    ordinal: 0,
                    createdAt: 1,
                    updatedAt: 2,
                },
            ])
            .mockResolvedValueOnce([
                {
                    id: "T2",
                    workspaceId: "ws1",
                    source: "plan",
                    text: "new plan step",
                    status: "waiting",
                    ordinal: 0,
                    createdAt: 3,
                    updatedAt: 4,
                },
            ]);

        await act(async () => {
            render(<HookHost />);
        });
        await screen.findByText("old plan step:running");

        await act(async () => {
            emitPlanProgress?.({
                workspaceId: "ws1",
                status: "executing",
                items: [{ id: "T2", text: "new plan step", status: "waiting" }],
            });
        });

        await screen.findByText("new plan step:pending");
        expect(taskList).toHaveBeenCalledTimes(2);
    });

    it("refreshes task registry rows when goal state changes", async () => {
        taskList
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([
                {
                    id: "T1",
                    workspaceId: "ws1",
                    source: "goal",
                    text: "ship desktop build",
                    status: "running",
                    ordinal: 0,
                    createdAt: 5,
                    updatedAt: 6,
                },
            ]);

        await act(async () => {
            render(<HookHost />);
        });

        await act(async () => {
            emitGoalChanged?.({
                id: "goal-1",
                workspaceId: "ws1",
                condition: "ship desktop build",
                status: "running",
                updatedAt: 6,
            });
        });

        await waitFor(() => {
            expect(screen.getByText("ship desktop build:running")).toBeTruthy();
        });
        expect(taskList).toHaveBeenCalledTimes(2);
    });

    it("clearFinished keeps only running/pending tasks", async () => {
        taskList.mockResolvedValue([
            {
                id: "T1",
                workspaceId: "ws1",
                source: "goal",
                text: "done",
                status: "completed",
                ordinal: 0,
                createdAt: 1,
                updatedAt: 2,
            },
            {
                id: "T2",
                workspaceId: "ws1",
                source: "goal",
                text: "active",
                status: "running",
                ordinal: 1,
                createdAt: 1,
                updatedAt: 2,
            },
            {
                id: "T3",
                workspaceId: "ws1",
                source: "goal",
                text: "wait",
                status: "waiting",
                ordinal: 2,
                createdAt: 1,
                updatedAt: 2,
            },
        ]);

        await act(async () => {
            render(<HookHost exposeClear />);
        });
        await screen.findByText("done:completed");
        await screen.findByText("active:running");
        await screen.findByText("wait:pending");

        await act(async () => {
            screen.getByText("clear-finished").click();
        });

        expect(screen.queryByText("done:completed")).toBeNull();
        expect(screen.getByText("active:running")).toBeTruthy();
        expect(screen.getByText("wait:pending")).toBeTruthy();
    });
});
