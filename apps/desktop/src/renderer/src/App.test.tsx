// @vitest-environment jsdom

import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTab, CreateAgentInput } from "@shared";

vi.mock("./components/MiniMaxCode", async () => {
    const actual = await vi.importActual<typeof import("./components/MiniMaxCode")>("./components/MiniMaxCode");
    return {
        ...actual,
        MiniMaxCodeLayout: ({
            leftSlot,
            centerSlot,
            topBarSlot,
            rightCollapsed,
        }: {
            leftSlot: React.ReactNode;
            centerSlot: React.ReactNode;
            topBarSlot?: React.ReactNode;
            rightCollapsed?: boolean;
        }) => (
            <div data-testid="layout-shell" data-right-collapsed={String(Boolean(rightCollapsed))}>
                {topBarSlot}
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

import App from "./App";
import { useAgentStore } from "./stores/agent-store";
import { usePermissionStore } from "./stores/permission-store";
import { useSessionStore } from "./stores/session-store";
import { useSettingsStore } from "./stores/settings-store";
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
    openSettingsWindow: vi.fn(async () => undefined),
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
                    createdAt: new Date(),
                    updatedAt: new Date(),
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
        usePermissionStore.setState({
            mode: "smart",
            pending: [],
        });
        useSettingsStore.setState({
            rightRailCollapsed: true,
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

    it("启动空态不会自动注入 dev 权限请求", async () => {
        vi.useFakeTimers();
        render(<App />);

        act(() => {
            vi.advanceTimersByTime(1600);
        });

        expect(usePermissionStore.getState().pending).toHaveLength(0);
        vi.useRealTimers();
    });

    it("主导航只展示 Pi Agent 当前真实一级入口，设置通过按钮打开独立窗口", () => {
        render(<App />);

        expect(screen.getByRole("tab", { name: "对话" })).toBeTruthy();
        expect(screen.getByRole("tab", { name: "技能" })).toBeTruthy();
        expect(screen.getByRole("tab", { name: "Git" })).toBeTruthy();
        expect(screen.getByRole("tab", { name: "历史" })).toBeTruthy();
        expect(screen.queryByRole("tab", { name: "任务" })).toBeNull();
        expect(screen.queryByRole("tab", { name: "记忆" })).toBeNull();
        expect(screen.queryByRole("tab", { name: "工具" })).toBeNull();
        expect(screen.queryByRole("tab", { name: "设置" })).toBeNull();

        fireEvent.click(screen.getByRole("button", { name: "打开设置窗口" }));

        expect(window.piAPI.openSettingsWindow).toHaveBeenCalledTimes(1);
    });

    it("agent 对话收到首条消息时自动展开右栏", async () => {
        useSessionStore.setState((state) => ({
            sessions: state.sessions.map((session) => ({ ...session, messages: [] })),
            currentSessionId: "s_1",
        }));
        useAgentStore.setState((state) => ({
            ...state,
            messagesByAgent: {
                agent_1: [
                    {
                        id: "agent-message-1",
                        agentId: "agent_1",
                        role: "assistant",
                        content: "done",
                        createdAt: Date.now(),
                    },
                ],
            },
        }));

        await act(async () => {
            render(<App />);
        });

        expect(screen.getByTestId("layout-shell").getAttribute("data-right-collapsed")).toBe("false");
    });
});
