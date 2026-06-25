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
            rightFloatingOpen,
            onCollapseRight,
        }: {
            leftSlot: React.ReactNode;
            centerSlot: React.ReactNode;
            topBarSlot?: React.ReactNode;
            rightCollapsed?: boolean;
            rightFloatingOpen?: boolean;
            onCollapseRight?: () => void;
        }) => (
            <div
                data-testid="layout-shell"
                data-right-collapsed={String(Boolean(rightCollapsed))}
                data-right-floating-open={String(Boolean(rightFloatingOpen))}
            >
                {topBarSlot}
                {onCollapseRight ? (
                    <button type="button" onClick={onCollapseRight}>
                        {rightCollapsed ? "展开右侧栏" : "折叠右侧栏"}
                    </button>
                ) : null}
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
import { useRuntimeFeatureStore } from "./stores/runtime-feature-store";
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
        window.localStorage.removeItem("pi-desktop-left-sidebar-width");
        Object.defineProperty(window, "innerWidth", {
            value: 1400,
            configurable: true,
        });

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
        useRuntimeFeatureStore.setState({
            featureState: {
                primaryAgents: [],
                systemAgents: [],
                enabledToolIds: ["task", "memory"],
                features: {
                    planMode: { enabled: true, supported: true, loadedFrom: "pi-openplan" },
                    composeMode: { enabled: true, supported: true, loadedFrom: "desktop" },
                    maxMode: { enabled: true, supported: true, loadedFrom: "desktop", candidates: 3 },
                    memory: {
                        enabled: true,
                        supported: true,
                        loadedFrom: "desktop",
                        ccIndex: false,
                        reconcileOnSearch: true,
                        searchScoreFloor: 0.15,
                    },
                    history: { enabled: true, supported: true, loadedFrom: "desktop" },
                    checkpoint: { enabled: true, supported: true, loadedFrom: "desktop" },
                    goal: { enabled: true, supported: true, loadedFrom: "desktop" },
                    task: { enabled: true, supported: true, loadedFrom: "desktop" },
                    actor: { enabled: true, supported: true, loadedFrom: "desktop" },
                    subagents: { enabled: true, supported: true, loadedFrom: "desktop" },
                    workflow: {
                        enabled: false,
                        supported: false,
                        loadedFrom: "unsupported",
                        maxConcurrentAgents: 4,
                        maxLifecycleAgents: 100,
                        maxDepth: 4,
                    },
                    dream: { enabled: false, supported: false, loadedFrom: "unsupported" },
                    distill: { enabled: false, supported: false, loadedFrom: "unsupported" },
                },
            },
            loading: false,
            lastError: null,
            lastLoadedAt: Date.now(),
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

    it("主导航切换为对话任务记忆工具设置五个真实一级入口", () => {
        render(<App />);

        expect(screen.getByRole("tab", { name: "对话" })).toBeTruthy();
        expect(screen.getByRole("tab", { name: "任务" })).toBeTruthy();
        expect(screen.getByRole("tab", { name: "记忆" })).toBeTruthy();
        expect(screen.getByRole("tab", { name: "工具" })).toBeTruthy();
        expect(screen.getByRole("tab", { name: "设置" })).toBeTruthy();
        expect(screen.queryByRole("tab", { name: "技能" })).toBeNull();
        expect(screen.queryByRole("tab", { name: "Git" })).toBeNull();
        expect(screen.queryByRole("tab", { name: "历史" })).toBeNull();

        fireEvent.click(screen.getByRole("tab", { name: "设置" }));

        expect(window.piAPI.openSettingsWindow).toHaveBeenCalledTimes(1);
    });

    it("点击任务和记忆标签时进入对应主区而不是历史搜索回退", async () => {
        render(<App />);

        fireEvent.click(screen.getByRole("tab", { name: "任务" }));
        expect(await screen.findByText("任务总览")).toBeTruthy();
        expect(screen.queryByText("ChatView")).toBeNull();

        fireEvent.click(screen.getByRole("tab", { name: "记忆" }));
        expect(await screen.findByRole("heading", { name: "记忆" })).toBeTruthy();
        expect(screen.queryByText("输入关键词搜索所有对话")).toBeNull();
    });

    it("点击侧栏新对话加号会进入新对话并请求聚焦输入框", async () => {
        const dispatchSpy = vi.spyOn(window, "dispatchEvent");
        render(<App />);

        fireEvent.click(screen.getByRole("button", { name: "快速新建对话" }));

        await waitFor(() => {
            expect(useSessionStore.getState().currentSessionId).toBeNull();
            expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: "chat-input:focus" }));
        });
        dispatchSpy.mockRestore();
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

        await waitFor(() => {
            expect(screen.getByTestId("layout-shell").getAttribute("data-right-collapsed")).toBe("false");
        });
    });

    it("切到非聊天功能页时隐藏右栏，避免空白栏挤压主内容", async () => {
        useSettingsStore.setState({
            rightRailCollapsed: false,
        });

        render(<App />);

        await waitFor(() => {
            expect(screen.getByTestId("layout-shell").getAttribute("data-right-collapsed")).toBe("false");
        });

        fireEvent.click(screen.getByRole("tab", { name: "工具" }));

        expect(screen.getByTestId("layout-shell").getAttribute("data-right-collapsed")).toBe("true");
        expect(screen.getByText("SkillsPanel")).toBeTruthy();
    });

    it("手动点击展开右栏时不受空间阈值限制", async () => {
        Object.defineProperty(window, "innerWidth", {
            value: 850,
            configurable: true,
        });
        useSettingsStore.setState({
            rightRailCollapsed: true,
        });

        render(<App />);

        fireEvent.click(screen.getByRole("button", { name: "展开右侧栏" }));

        await waitFor(() => {
            expect(screen.getByTestId("layout-shell").getAttribute("data-right-collapsed")).toBe("false");
            expect(screen.getByTestId("layout-shell").getAttribute("data-right-floating-open")).toBe("true");
        });
    });
});
