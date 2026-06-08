// @vitest-environment jsdom

import React from "react";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PiEvent } from "@shared/events";
import { useTaskProgress } from "./useTaskProgress";

let emitPiEvent: ((event: PiEvent) => void) | null = null;
let emitAgentEvent: ((payload: { agentId: string; workspaceId: string; event: PiEvent }) => void) | null = null;

function HookHost(): React.JSX.Element {
    const { tasks } = useTaskProgress();
    return (
        <ul>
            {tasks.map((task) => (
                <li key={task.id}>{task.name}</li>
            ))}
        </ul>
    );
}

beforeEach(() => {
    emitPiEvent = null;
    emitAgentEvent = null;
    (globalThis as { window: unknown }).window = window;
    Object.assign(window, {
        piAPI: {
            onEvent: vi.fn((cb: (event: PiEvent) => void) => {
                emitPiEvent = cb;
                return vi.fn();
            }),
            onAgentEvent: vi.fn((cb: (payload: { agentId: string; workspaceId: string; event: PiEvent }) => void) => {
                emitAgentEvent = cb;
                return vi.fn();
            }),
        },
    });
});

describe("useTaskProgress", () => {
    it("does not create a fake task for stream start alone", async () => {
        await act(async () => {
            render(<HookHost />);
        });

        act(() => {
            window.dispatchEvent(new CustomEvent("pi:stream-start"));
        });

        expect(screen.queryByText("Agent 任务")).toBeNull();
    });

    it("creates an activity item when a real tool execution starts", async () => {
        await act(async () => {
            render(<HookHost />);
        });
        expect(emitPiEvent).toBeTruthy();

        act(() => {
            emitPiEvent?.({
                type: "tool_execution_start",
                toolCallId: "tc_1",
                toolName: "bash",
                args: { command: "pnpm test" },
            });
        });

        expect(screen.getByText("运行命令")).toBeTruthy();
    });

    it("creates an activity item from agent-scoped events", async () => {
        await act(async () => {
            render(<HookHost />);
        });
        expect(emitAgentEvent).toBeTruthy();

        act(() => {
            emitAgentEvent?.({
                agentId: "agent_1",
                workspaceId: "ws1",
                event: {
                    type: "tool_execution_start",
                    toolCallId: "tc_2",
                    toolName: "read",
                    args: { path: "README.md" },
                },
            });
        });

        expect(screen.getByText("读取文件")).toBeTruthy();
    });
});
