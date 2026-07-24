// @vitest-environment jsdom

import React from "react";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTab, CreateAgentInput } from "@shared";

function collectRendererSources(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return collectRendererSources(path);
        if (entry.name.includes(".test.")) return [];
        return /\.(css|tsx)$/.test(entry.name) ? [path] : [];
    });
}

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
        }: {
            leftSlot: React.ReactNode;
            centerSlot: React.ReactNode;
            topBarSlot?: React.ReactNode;
            rightCollapsed?: boolean;
            rightFloatingOpen?: boolean;
        }) => (
            <div
                data-testid="layout-shell"
                data-right-collapsed={String(Boolean(rightCollapsed))}
                data-right-floating-open={String(Boolean(rightFloatingOpen))}
            >
                {topBarSlot}
                <aside>{leftSlot}</aside>
                <main>{centerSlot}</main>
            </div>
        ),
        RightRail: () => <aside data-testid="right-rail" />,
    };
});

vi.mock("./components/CommandPalette/CommandPalette", () => ({
    CommandPalette: ({
        isOpen,
        onSelectHistory,
        onRunCommand,
    }: {
        isOpen: boolean;
        onSelectHistory?: (sessionId: string, messageId?: string) => void;
        onRunCommand?: (cmdId: string) => boolean | void | Promise<boolean | void>;
    }) => (isOpen ? (
        <div data-testid="command-palette">
            <button type="button" onClick={() => onSelectHistory?.("s_1", "m_palette_hit")}>
                mock-palette-history-hit
            </button>
            <button type="button" onClick={() => void onRunCommand?.("open_settings")}>
                mock-palette-open-settings
            </button>
        </div>
    ) : null),
}));
vi.mock("./components/ShortcutsCheatsheet/ShortcutsCheatsheet", () => ({
    ShortcutsCheatsheet: () => null,
}));
vi.mock("./components/SkillsPanel/SkillsPanel", () => ({
    SkillsPanel: () => <div>SkillsPanel</div>,
}));
vi.mock("./components/FileWorkspace/FileWorkspace", () => ({
    FileWorkspace: () => <div>FileWorkspace</div>,
}));
vi.mock("./components/GitPanel/GitPanel", () => ({
    GitPanel: () => <div>GitPanel</div>,
}));
vi.mock("./components/Terminal/TerminalPanel", () => ({
    TerminalPanel: ({ isOpen }: { isOpen: boolean }) => isOpen ? <div>TerminalPanel</div> : null,
}));
vi.mock("./components/ApprovalPanel/ApprovalPanel", () => ({
    ApprovalPanel: () => null,
}));
vi.mock("./components/PiStatusPanel/PiStatusPanel", () => ({
    PiStatusPanel: () => null,
}));
vi.mock("./components/Onboarding/Onboarding", () => ({
    Onboarding: ({ onComplete }: { onComplete?: () => void }) => (
        <div data-testid="onboarding-modal">
            <button type="button" onClick={onComplete}>
                dismiss-onboarding
            </button>
        </div>
    ),
}));
vi.mock("./components/ChatView/ChatView", () => ({
    ChatView: ({
        active,
        focusMessageId,
        rightRailCollapsed,
        onToggleRightRail,
    }: {
        active?: boolean;
        focusMessageId?: string | null;
        rightRailCollapsed?: boolean;
        onToggleRightRail?: () => void;
    }) => (
        <div data-testid="chat-view" data-active={String(active ?? true)} data-focus-message-id={focusMessageId ?? ""}>
            ChatView
            <button type="button" onClick={onToggleRightRail}>
                {rightRailCollapsed ? "展开右侧栏" : "收起右侧栏"}
            </button>
        </div>
    ),
}));
vi.mock("./components/SearchHistory/SearchHistory", () => ({
    SearchHistory: ({
        isOpen,
        onNavigate,
    }: {
        isOpen: boolean;
        onNavigate: (sessionId: string, messageId: string) => void;
    }) => (isOpen ? (
        <button type="button" onClick={() => onNavigate("s_1", "m_hit")}>
            mock-search-hit
        </button>
    ) : null),
}));
vi.mock("./components/SessionCenter/SessionCenter", () => ({
    SessionCenter: ({
        onOpenChat,
    }: {
        onOpenChat?: () => void;
    }) => (
        <div data-testid="session-center">
            SessionCenter
            <button type="button" onClick={onOpenChat}>
                mock-session-center-open-chat
            </button>
        </div>
    ),
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
        sessionId: input.sessionId,
        sessionPath: input.sessionPath,
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
        window.localStorage.setItem("pi-desktop:firstLaunchDone", "true");
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
            loaded: true,
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
            sessionsLoading: false,
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
        useAgentStore.setState({
            agents: [
                {
                    id: "agent_session",
                    workspaceId: "ws_1",
                    title: "Session 1 Agent",
                    status: "idle",
                    sessionId: "s_1",
                    createdAt: 1,
                    updatedAt: 1,
                },
            ],
            currentAgentId: "agent_session",
            messagesByAgent: {},
            runtimeByAgent: {},
            initialized: true,
        });
        render(<App />);

        fireEvent.click(screen.getByRole("button", { name: "Session 1" }));

        await waitFor(() => {
            expect(useSessionStore.getState().currentSessionId).toBe("s_1");
        });
        expect(piAPI.agentsCreate).not.toHaveBeenCalled();
    });

    it("当前 workspace 已有活动 session 且缺少绑定 agent 时，会补建 session-bound agent", async () => {
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
            currentSessionId: "s_1",
            sessionsLoading: false,
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
            expect(piAPI.agentsCreate).toHaveBeenCalledWith({
                workspaceId: "ws_1",
                title: "Session 1 Agent",
                sessionId: "s_1",
            });
        });
        expect(piAPI.agentsCreate).toHaveBeenCalledTimes(1);

        await act(async () => {
            useSessionStore.setState({ sessionsLoading: true });
        });
        await act(async () => {
            useSessionStore.setState({ sessionsLoading: false });
        });

        await waitFor(() => {
            expect(piAPI.agentsCreate).toHaveBeenCalledTimes(1);
        });
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
        useSessionStore.setState({
            sessions: [],
            currentSessionId: null,
            sessionsLoading: false,
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

    it("主窗口重新获得焦点时会刷新 Pi 模型配置", async () => {
        render(<App />);

        await waitFor(() => {
            expect(piAPI.loadPiConfig).toHaveBeenCalledTimes(1);
        });

        act(() => {
            window.dispatchEvent(new Event("focus"));
        });

        await waitFor(() => {
            expect(piAPI.loadPiConfig).toHaveBeenCalledTimes(2);
        });
    });

    it("主导航只保留对话、运行、工作台和扩展，设置使用右侧图标按钮", () => {
        render(<App />);

        expect(screen.getByRole("tab", { name: "对话" })).toBeTruthy();
        expect(screen.getByRole("tab", { name: "运行" })).toBeTruthy();
        expect(screen.getByRole("tab", { name: "工作台" })).toBeTruthy();
        expect(screen.getByRole("tab", { name: "扩展" })).toBeTruthy();
        expect(screen.queryByRole("tab", { name: "记忆" })).toBeNull();
        expect(screen.queryByRole("tab", { name: "设置" })).toBeNull();
        expect(screen.queryByRole("tab", { name: "技能" })).toBeNull();
        expect(screen.queryByRole("tab", { name: "Git" })).toBeNull();
        expect(screen.queryByRole("tab", { name: "历史" })).toBeNull();

        fireEvent.click(screen.getByRole("button", { name: "打开设置" }));

        expect(window.piAPI.openSettingsWindow).toHaveBeenCalledTimes(1);
    });

    it("Slash 模型命令会让独立设置窗口定位到模型页", async () => {
        render(<App />);

        window.dispatchEvent(new CustomEvent("slash-command:open-settings-tab", {
            detail: { tab: "model" },
        }));

        await waitFor(() => {
            expect(window.piAPI.openSettingsWindow).toHaveBeenCalledWith("model");
        });
    });

    it("运行页默认展示任务，并把记忆降为页内二级入口", async () => {
        render(<App />);
        const chatView = screen.getByTestId("chat-view");

        fireEvent.click(screen.getByRole("tab", { name: "运行" }));
        expect(await screen.findByText("任务总览")).toBeTruthy();
        expect(chatView.isConnected).toBe(true);
        expect(chatView.getAttribute("data-active")).toBe("false");

        fireEvent.click(screen.getByRole("tab", { name: "记忆管理" }));
        expect(await screen.findByRole("heading", { name: "记忆" })).toBeTruthy();
        expect(screen.queryByText("输入关键词搜索所有对话")).toBeNull();

        fireEvent.click(screen.getByRole("tab", { name: "对话" }));
        expect(screen.getByTestId("chat-view")).toBe(chatView);
        expect(chatView.getAttribute("data-active")).toBe("true");
    });

    it("工作台把文件、Git 和终端收拢为页内视图", async () => {
        render(<App />);

        fireEvent.click(screen.getByRole("tab", { name: "工作台" }));
        expect(await screen.findByText("FileWorkspace")).toBeTruthy();

        fireEvent.click(screen.getByRole("tab", { name: "Git" }));
        expect(await screen.findByText("GitPanel")).toBeTruthy();

        fireEvent.click(screen.getByRole("tab", { name: "终端" }));
        expect(await screen.findByText("TerminalPanel")).toBeTruthy();
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

    it("history 路由进入真实 SessionCenter，而不是回退成搜索覆盖层", async () => {
        render(<App />);

        act(() => {
            window.dispatchEvent(new CustomEvent("app:switch-section", { detail: { section: "history" } }));
        });

        expect(await screen.findByTestId("session-center")).toBeTruthy();
        expect(screen.queryByRole("button", { name: "mock-search-hit" })).toBeNull();
    });

    it("快速历史搜索仍保留消息定位信息并传给 ChatView", async () => {
        render(<App />);

        act(() => {
            fireEvent.keyDown(window, { key: "F", ctrlKey: true, shiftKey: true });
        });
        fireEvent.click(await screen.findByRole("button", { name: "mock-search-hit" }));

        await waitFor(() => {
            expect(useSessionStore.getState().currentSessionId).toBe("s_1");
        });
        expect(screen.getByTestId("chat-view").getAttribute("data-focus-message-id")).toBe("m_hit");
    });

    it("命令面板历史结果会把 messageId 传给 ChatView 做精确定位", async () => {
        render(<App />);

        act(() => {
            window.dispatchEvent(new CustomEvent("app:switch-section", { detail: { section: "search" } }));
        });
        fireEvent.click(await screen.findByRole("button", { name: "mock-palette-history-hit" }));

        await waitFor(() => {
            expect(useSessionStore.getState().currentSessionId).toBe("s_1");
        });
        expect(screen.getByTestId("chat-view").getAttribute("data-focus-message-id")).toBe("m_palette_hit");
    });

    it("工作区仍在异步恢复时不会误弹 onboarding", async () => {
        useWorkspaceStore.setState({
            workspaces: [],
            currentWorkspaceId: null,
            lastError: null,
            loaded: false,
        });
        useSessionStore.setState({
            sessions: [],
            currentSessionId: null,
            sessionsLoading: false,
        });

        render(<App />);

        expect(screen.queryByTestId("onboarding-modal")).toBeNull();

        act(() => {
            useWorkspaceStore.setState({
                workspaces: [
                    {
                        id: "ws_restored",
                        name: "Restored Workspace",
                        path: "C:/Ai/restored",
                        createdAt: new Date(0),
                        lastActiveAt: new Date(1),
                    },
                ],
                currentWorkspaceId: "ws_restored",
                lastError: null,
                loaded: true,
            });
        });

        await waitFor(() => {
            expect(screen.queryByTestId("onboarding-modal")).toBeNull();
        });
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

        fireEvent.click(screen.getByRole("tab", { name: "扩展" }));

        expect(screen.getByTestId("layout-shell").getAttribute("data-right-collapsed")).toBe("true");
        expect(screen.getByText("SkillsPanel")).toBeTruthy();
    });

    it("保留访问过的主面板，只让当前面板可交互", () => {
        render(<App />);

        const chatLayer = screen.getByTestId("motion-panel-chat");
        expect(chatLayer.getAttribute("data-active")).toBe("true");
        expect(chatLayer.getAttribute("aria-hidden")).toBe("false");

        fireEvent.click(screen.getByRole("tab", { name: "扩展" }));

        const skillsLayer = screen.getByTestId("motion-panel-skills");
        expect(skillsLayer.getAttribute("data-active")).toBe("true");
        expect(chatLayer.getAttribute("data-active")).toBe("false");
        expect(chatLayer.getAttribute("aria-hidden")).toBe("true");
        expect(chatLayer.hasAttribute("inert")).toBe(true);

        fireEvent.click(screen.getByRole("tab", { name: "对话" }));

        expect(screen.getByTestId("motion-panel-skills")).toBe(skillsLayer);
        expect(skillsLayer.getAttribute("data-active")).toBe("false");
        expect(skillsLayer.getAttribute("aria-hidden")).toBe("true");
        expect(skillsLayer.hasAttribute("inert")).toBe(true);
        expect(chatLayer.getAttribute("data-active")).toBe("true");
    });

    it("权限请求在非聊天页到达时会自动切回对话页，并显示在主窗口 composer lane", async () => {
        render(<App />);
        fireEvent.click(screen.getByRole("tab", { name: "扩展" }));

        act(() => {
            usePermissionStore.setState({
                mode: "smart",
                pending: [
                    {
                        requestId: "perm_main_lane",
                        workspaceId: "ws_1",
                        kind: "select",
                        source: "permission",
                        title: "Return to chat permission",
                        createdAt: Date.now(),
                    },
                ],
            });
        });

        await waitFor(() => {
            expect(screen.getByTestId("motion-panel-skills").getAttribute("data-active")).toBe("false");
            expect(screen.getByTestId("motion-panel-chat").getAttribute("data-active")).toBe("true");
        });
        expect(screen.getByRole("alertdialog", { name: "权限请求 1" })).toBeTruthy();
    });

    it("主窗口可见时会把运行提醒拉回对话页，但不再渲染 workspace 浮卡", async () => {
        render(<App />);
        fireEvent.click(screen.getByRole("tab", { name: "扩展" }));

        act(() => {
            window.dispatchEvent(new CustomEvent("pi:stream-start", {
                detail: { runContext: "task" },
            }));
        });

        await waitFor(() => {
            expect(screen.getByTestId("motion-panel-skills").getAttribute("data-active")).toBe("false");
            expect(screen.getByTestId("motion-panel-chat").getAttribute("data-active")).toBe("true");
        });
        expect(screen.queryByRole("status", { name: "任务运行中提醒" })).toBeNull();
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

    it("defines the shared motion vocabulary without broad transitions or permanent compositor hints", () => {
        const globalsCssPath = resolve(process.cwd(), "src/renderer/src/styles/globals.css");
        const globalsCss = readFileSync(globalsCssPath, "utf8");
        const overlayPaths = [
            "src/renderer/src/components/CommandPalette/CommandPalette.tsx",
            "src/renderer/src/components/Onboarding/Onboarding.tsx",
            "src/renderer/src/components/ShortcutsCheatsheet/ShortcutsCheatsheet.tsx",
            "src/renderer/src/components/Settings/tabs/ManagedModelsPanel.tsx",
        ];

        expect(globalsCss).not.toMatch(/\/\* 平滑过渡 \*\/[\s\S]*?\*\s*\{\s*transition-property:/);
        expect(globalsCss).toContain("--motion-instant: 70ms");
        expect(globalsCss).toContain("--motion-fast: 100ms");
        expect(globalsCss).toContain("--motion-panel: 160ms");
        expect(globalsCss).toContain("--motion-overlay: 180ms");
        expect(globalsCss).toContain("--motion-emphasized: 220ms");
        expect(globalsCss).toContain("--motion-ease: cubic-bezier(0.2, 0, 0, 1)");
        expect(globalsCss).toContain("--motion-ease-out: cubic-bezier(0.16, 1, 0.3, 1)");
        expect(globalsCss).toMatch(/\.pi-motion-control[\s\S]*transition-property:[^;]*\btransform\b/);
        expect(globalsCss).not.toMatch(/:active:not\(:disabled\)[\s\S]*scale:\s*0\.96/);
        expect(globalsCss).not.toContain("transition: all");
        expect(globalsCss).not.toContain("will-change:");
        expect(globalsCss).toMatch(/prefers-reduced-motion:\s*reduce[\s\S]*transition-duration:\s*1ms/);
        for (const overlayPath of overlayPaths) {
            expect(readFileSync(resolve(process.cwd(), overlayPath), "utf8")).not.toContain("backdrop-blur");
        }
    });

    it("uses only explicit transition properties across renderer source", () => {
        const rendererRoot = resolve(process.cwd(), "src/renderer/src");
        for (const sourcePath of collectRendererSources(rendererRoot)) {
            expect(readFileSync(sourcePath, "utf8"), sourcePath).not.toContain("transition-all");
        }
    });
    it("does not keep a forced gray chat background override in globals.css", () => {
        const globalsCssPath = resolve(process.cwd(), "src/renderer/src/styles/globals.css");
        const globalsCss = readFileSync(globalsCssPath, "utf8");

        expect(globalsCss).not.toContain('[data-mm-window-kind="main"] [data-testid="chat-view-root"]');
        expect(globalsCss).not.toContain('[data-theme="dark"] [data-testid="chat-view-root"]');
    });

    it("exposes panel-load fallback retry focus-visible classes for keyboard a11y", () => {
        const appSource = readFileSync(resolve(process.cwd(), "src/renderer/src/App.tsx"), "utf8");
        expect(appSource).toContain("focus-visible:ring-2");
        expect(appSource).toContain("focus-visible:ring-[#2563eb]");
        expect(appSource).toMatch(/panelLoadFailed[\s\S]*type="button"/);
    });
});
