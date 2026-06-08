// useTaskProgress — map Pi events into TaskProgressItem[] for TaskProgressPanel
// v1.0.17: 接通真数据 — 订阅 Pi 事件流,自动映射为任务进度

import { useState, useCallback, useRef, useEffect } from "react";
import type { TaskProgressItem } from "../components/MiniMaxCode/TaskProgressPanel";
import type { PiEvent } from "@shared/events";

let taskCounter = 0;

export function useTaskProgress(): {
    tasks: TaskProgressItem[];
    clearFinished: () => void;
} {
    const [tasks, setTasks] = useState<TaskProgressItem[]>([]);
    const currentTaskIdRef = useRef<string | null>(null);

    // 订阅 Pi 事件流,映射为任务进度
    useEffect(() => {
        if (!window.piAPI?.onEvent && !window.piAPI?.onAgentEvent) return;

        const handler = (event: PiEvent): void => {
            const toolLabels: Record<string, string> = {
                bash: "运行命令",
                read: "读取文件",
                write: "写入文件",
                edit: "编辑文件",
                grep: "搜索内容",
                find: "查找文件",
                ls: "列出目录",
            };

            switch (event.type) {
                case "agent_start": {
                    break;
                }

                case "tool_execution_start": {
                    const e = event as { toolCallId: string; toolName: string; args: Record<string, unknown> };
                    const label = toolLabels[e.toolName] ?? e.toolName;
                    const currentId = currentTaskIdRef.current;
                    if (!currentId) {
                        const id = `task_${++taskCounter}_${Date.now()}`;
                        currentTaskIdRef.current = id;
                        setTasks((prev) => [
                            ...prev,
                            {
                                id,
                                name: label,
                                status: "running",
                                timestamp: Date.now(),
                            },
                        ]);
                        break;
                    }
                    setTasks((prev) =>
                        prev.map((t) =>
                            t.id === currentId ? { ...t, name: label } : t,
                        ),
                    );
                    break;
                }

                case "tool_execution_end": {
                    // Individual tool completion doesn't change task status — agent continues
                    break;
                }

                case "turn_end": {
                    const currentId = currentTaskIdRef.current;
                    if (!currentId) break;
                    setTasks((prev) =>
                        prev.map((t) =>
                            t.id === currentId ? { ...t, status: "completed" as const } : t,
                        ),
                    );
                    currentTaskIdRef.current = null;
                    break;
                }

                case "agent_end": {
                    const currentId = currentTaskIdRef.current;
                    if (currentId) {
                        // Mark any still-running task as completed
                        setTasks((prev) =>
                            prev.map((t) =>
                                t.id === currentId && t.status === "running"
                                    ? { ...t, status: "completed" as const }
                                    : t,
                            ),
                        );
                    }
                    currentTaskIdRef.current = null;
                    break;
                }

                case "extension_error": {
                    const currentId = currentTaskIdRef.current;
                    if (!currentId) break;
                    setTasks((prev) =>
                        prev.map((t) =>
                            t.id === currentId && t.status === "running"
                                ? { ...t, status: "failed" as const }
                                : t,
                        ),
                    );
                    break;
                }
            }
        };

        const unsub = window.piAPI.onEvent?.(handler);
        const unsubAgent = window.piAPI.onAgentEvent?.((payload) => handler(payload.event));
        return () => {
            if (typeof unsub === "function") unsub();
            if (typeof unsubAgent === "function") unsubAgent();
        };
    }, []);

    // Local stream events only close existing activity. They should not create
    // a fake "plan" task because Pi does not expose a plan/progress primitive.
    useEffect(() => {
        const onStreamStart = (): void => undefined;

        const onStreamEnd = (): void => {
            const currentId = currentTaskIdRef.current;
            if (currentId) {
                setTasks((prev) =>
                    prev.map((t) =>
                        t.id === currentId && t.status === "running"
                            ? { ...t, status: "completed" as const }
                            : t,
                    ),
                );
                currentTaskIdRef.current = null;
            }
        };

        window.addEventListener("pi:stream-start" as string, onStreamStart as EventListener);
        window.addEventListener("pi:stream-end" as string, onStreamEnd as EventListener);
        return () => {
            window.removeEventListener("pi:stream-start" as string, onStreamStart as EventListener);
            window.removeEventListener("pi:stream-end" as string, onStreamEnd as EventListener);
        };
    }, []);

    const clearFinished = useCallback(() => {
        setTasks((prev) => prev.filter((t) => t.status === "running"));
    }, []);

    return { tasks, clearFinished };
}
