// @vitest-environment jsdom

import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTab, CreateAgentInput } from "@shared";

vi.mock("./components/MiniMaxCode", async () => {
    const actual = await vi.importActual<typeof import("./components/MiniMaxCode")>("./components/MiniMaxCode");
    return {
        ...actual,
        MiniMaxCodeLayout: ({ leftSlot, centerSlot }: { leftSlot: React.ReactNode; centerSlot: React.ReactNode }) => (
            <div>
                <aside>{leftSlot}</aside>
                <main>{centerSlot}</main>
            </div>
        ),
        RightRail: () => <aside data-testid="right-rail" />,
    };
});

vi.mock("./components/Settings/SettingsPanel", () => ({
    SettingsPanel: () => null,
}));
vi.mock("./components/CommandPalette/CommandPalette", () => ({
    CommandPalette: () => null,
}));
vi.mock("./components/ShortcutsCheatsheet/ShortcutsCheatsheet", () => ({
    ShortcutsCheatsheet: () => null,
}));
vi.mock("./components/SkillsPanel/SkillsPanel", () => ({
    SkillsPanel: () => <div>SkillsPanel</div>,
}));
vi.mock("./components/Terminal/TerminalPanel", () => ({
    TerminalPanel: () => null,
}));
vi.mock("./components/ApprovalPanel/ApprovalPanel", () => ({
    ApprovalPanel: () => null,
}));
vi.mock("./components/PiStatusPanel/PiStatusPanel", () => ({
    PiStatusPanel: () => null,
}));
vi.mock("./components/Onboarding/Onboarding", () => ({
    Onboarding: () => null,
}));
vi.mock("./components/ChatView/ChatView", () => ({
    ChatView: () => <div>ChatView</div>,
}));
vi.mock("./components/GitPanel/GitPanel", () => ({
    GitPanel: () => <div>GitPanel</div>,
}));

import App from "./App";
import { useAgentStore } from "./stores/agent-store";
import { useSessionStore } from "./stores/session-store";
import { useWorkspaceStore } from "./stores/workspace-store";

const piAPI = {
    agentsList: vi.fn(async () => []),
    agentsCreate: vi.fn(async (input: CreateAgentInput): Promise<AgentTab> => ({
        id: "created_agent",
        workspaceId: input.workspaceId,
        title: input.title ?? "Agent",
        status: "idle",
        createdAt: 1,
        updatedAt: 1,
    })),
    agentsMessages: vi.fn(async () => []),
    agentsRuntimeState: vi.fn(async (agentId: string) => ({ agentId, status: "idle", isStreaming: false })),
    onAgentsState: vi.fn(() => () => undefined),
    onAgentMessages: vi.fn(() => () => undefined),
    getSettings: vi.fn(async () => ({})),
    loadPiConfig: vi.fn(async () => ({ models: [], currentModel: null })),
    refreshPiStatus: vi.fn(async () => ({ installed: true, version: "test" })),
    listWorkspaces: vi.fn(async () => []),
    listSessions: vi.fn(async () => []),
};

describe("App sidebar session navigation", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Object.defineProperty(window, "piAPI", {
            value: piAPI,
            configurable: true,
        });
        window.localStorage.setItem("pi-desktop.onboarding.completed", "true");

        useWorkspaceStore.setState({
            workspaces: [
                {
                    id: "ws_1",
                    name: "Workspace",
                    path: "C:/Ai/pi-desktop",
                    createdAt: new Date(0),
                    lastActiveAt: new Date(0),
                },
            ],
            currentWorkspaceId: "ws_1",
        });
        useSessionStore.setState({
            sessions: [
                {
                    id: "s_1",
                    title: "Session 1",
                    workspaceId: "ws_1",
                    createdAt: new Date(0),
                    updatedAt: new Date(1000),
                    messages: [],
                },
            ],
            currentSessionId: null,
        });
        useAgentStore.setState({
            agents: [
                {
                    id: "agent_1",
                    workspaceId: "ws_1",
                    title: "Default Agent",
                    status: "idle",
                    createdAt: 1,
                    updatedAt: 1,
                },
            ],
            currentAgentId: "agent_1",
            messagesByAgent: {},
            runtimeByAgent: {},
            initialized: true,
        });
    });

    it("点击历史 session 只切换当前 session，不创建新的 Agent", async () => {
        render(<App />);

        fireEvent.click(screen.getByRole("button", { name: "Session 1" }));

        await waitFor(() => {
            expect(useSessionStore.getState().currentSessionId).toBe("s_1");
        });
        expect(piAPI.agentsCreate).not.toHaveBeenCalled();
    });

    it("默认 Agent 创建请求未完成时不会重复创建", async () => {
        let resolveCreate: ((agent: AgentTab) => void) | null = null;
        piAPI.agentsCreate.mockImplementationOnce(async (input: CreateAgentInput) => {
            const agent = await new Promise<AgentTab>((resolve) => {
                resolveCreate = resolve;
            });
            return {
                ...agent,
                workspaceId: input.workspaceId,
                title: input.title ?? agent.title,
            };
        });
        useAgentStore.setState({
            agents: [],
            currentAgentId: null,
            messagesByAgent: {},
            runtimeByAgent: {},
            initialized: true,
        });

        render(<App />);

        await waitFor(() => {
            expect(piAPI.agentsCreate).toHaveBeenCalledTimes(1);
        });
        act(() => {
            useWorkspaceStore.setState({
                workspaces: [
                    {
                        id: "ws_1",
                        name: "Workspace",
                        path: "C:/Ai/pi-desktop",
                        createdAt: new Date(0),
                        lastActiveAt: new Date(1),
                    },
                ],
                currentWorkspaceId: "ws_1",
            });
        });

        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(piAPI.agentsCreate).toHaveBeenCalledTimes(1);

        await act(async () => {
            resolveCreate?.({
                id: "created_agent",
                workspaceId: "ws_1",
                title: "Workspace Agent",
                status: "idle",
                createdAt: 1,
                updatedAt: 1,
            });
        });
    });
});
