// @vitest-environment jsdom
//
// Focused regression tests for usePiStream promptInFlightRef lifecycle.
// The hook lives in ../usePiStream; these tests verify that the followUp
// early-return path resets promptInFlightRef so a subsequent call (after
// agent_end resets isStreamingRef) goes through the normal streaming path
// instead of being stuck in followUp mode forever.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PiEvent } from "@shared/events";
import { usePiStream } from "../usePiStream";
import { useSessionStore } from "../../stores/session-store";
import { usePlanStore } from "../../stores/plan-store";
import { useAgentStore } from "../../stores/agent-store";
import { useAgentModeStore } from "../../stores/agent-mode-store";

let emitPiEvent: ((event: PiEvent) => void) | null = null;
const sendPrompt = vi.fn(async () => undefined);

function countStreamStartEvents(): number {
    return (window.dispatchEvent as ReturnType<typeof vi.fn>).mock.calls.filter((call) => {
        const event = call[0] as Event;
        return event?.type === "pi:stream-start";
    }).length;
}

beforeEach(() => {
    emitPiEvent = null;
    sendPrompt.mockReset();
    sendPrompt.mockResolvedValue(undefined);

    (globalThis as { window: unknown }).window = {
        dispatchEvent: vi.fn(),
        setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
        clearTimeout: (id: number) => clearTimeout(id),
        setInterval: (...args: Parameters<typeof setInterval>) => setInterval(...args),
        clearInterval: (id: number) => clearInterval(id),
        piAPI: {
            getStatus: vi.fn(async () => ({
                installed: true,
                localVersion: "0.0.0",
                latestVersion: "0.0.0",
                updateAvailable: false,
                executablePath: "pi",
                installMethod: "test",
                configExists: true,
                defaultProvider: "test",
                defaultModel: "test",
            })),
            onEvent: vi.fn((cb: (event: PiEvent) => void) => {
                emitPiEvent = cb;
                return vi.fn();
            }),
            onAgentEvent: vi.fn(() => vi.fn()),
            sendPrompt,
            stop: vi.fn(async () => undefined),
            renameSession: vi.fn(async () => undefined),
        },
    };

    useSessionStore.setState({
        currentSessionId: "s1",
        sessions: [
            {
                id: "s1",
                title: "Session",
                workspaceId: "ws1",
                createdAt: new Date(0),
                updatedAt: new Date(0),
                messages: [],
            },
        ],
    });
    usePlanStore.setState({
        enabled: false,
        activeCard: null,
        decisionRequest: null,
        pendingPlanClarification: null,
        steps: [],
        status: "idle",
    });
    useAgentStore.setState({
        agents: [],
        currentAgentId: null,
        messagesByAgent: {},
        runtimeByAgent: {},
        initialized: false,
    });
    useAgentModeStore.setState({
        byWorkspace: {},
    });
});

describe("usePiStream: followUp promptInFlightRef reset", () => {
    it("resets promptInFlightRef after followUp early return so the next call is not a follow-up", async () => {
        // First sendPrompt stays pending so promptInFlightRef remains true
        // (the normal path only resets it after the await resolves).
        let resolveFirst: (value: unknown) => void = () => {};
        const firstPromise = new Promise((resolve) => {
            resolveFirst = resolve;
        });
        sendPrompt.mockReturnValueOnce(firstPromise);

        const { result } = renderHook(() => usePiStream());

        // 1. Normal path: sets promptInFlightRef = true, awaits pending sendPrompt.
        //    "pi:stream-start" is dispatched before the await.
        await act(async () => {
            result.current.startStreaming("ws1", "hello");
        });
        expect(sendPrompt).toHaveBeenCalledTimes(1);

        // 2. FollowUp path: entered because promptInFlightRef is true.
        //    sendPrompt resolves immediately (default mock).
        //    After my fix, promptInFlightRef is reset to false before return.
        await act(async () => {
            await result.current.startStreaming("ws1", "world");
        });
        expect(sendPrompt).toHaveBeenCalledTimes(2);

        // 3. Fire agent_end to reset isStreamingRef (set by the normal path in step 1).
        //    agent_end does NOT reset promptInFlightRef — only the followUp branch does.
        await act(async () => {
            emitPiEvent?.({ type: "agent_end" });
        });

        // 4. Snapshot the "pi:stream-start" count before the next call.
        const streamStartBefore = countStreamStartEvents();

        // 5. Next call: both isStreamingRef and promptInFlightRef should be false,
        //    so this goes through the NORMAL path and dispatches "pi:stream-start".
        //    If the bug were present (promptInFlightRef not reset), this would
        //    enter followUp instead and NOT dispatch "pi:stream-start".
        await act(async () => {
            result.current.startStreaming("ws1", "third");
        });

        const streamStartAfter = countStreamStartEvents();
        expect(streamStartAfter).toBe(streamStartBefore + 1);

        // Cleanup: resolve the first sendPrompt so the pending promise settles.
        resolveFirst(undefined);
    });

    it("allows a normal call immediately after agent_end when no followUp happened", async () => {
        // This is a baseline test: without a followUp in between, a normal call
        // after agent_end should always dispatch "pi:stream-start".
        const { result } = renderHook(() => usePiStream());

        await act(async () => {
            result.current.startStreaming("ws1", "first");
        });

        await act(async () => {
            emitPiEvent?.({ type: "agent_end" });
        });

        const before = countStreamStartEvents();

        await act(async () => {
            result.current.startStreaming("ws1", "second");
        });

        const after = countStreamStartEvents();
        expect(after).toBe(before + 1);
    });
});
