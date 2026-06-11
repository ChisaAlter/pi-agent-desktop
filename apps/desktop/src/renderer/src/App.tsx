// Pi Desktop v1.0 - 整合 App (M7) — MiniMax Code 风格 (1:1 还原目标 UI)
// 三栏布局: MiniMaxCodeLayout (左 220px MiniMaxCodeSidebar / 中 flex-1 ChatView / 右 280px TaskProgress)
// v1.0.4: 包了 I18nProvider 顶层, 顶部标题栏 / 状态栏 / 占位文案走 t()
// v1.1: 接入 MiniMaxCode 三栏 layout, 移除非必需的旧 UI hook(保留 modal 触发能力)
// v1.2: Modal/浮层用 createPortal 挂到 body(避免 layout overflow:hidden 裁剪)
// v1.0.12: chat panel 改用真 ChatView(已接通 usePiStream/useSessionStore/MessageBubble),
//          删 demo 任务 / 删 5 个假按钮 / 删 routeToSkillSearch; TaskProgressPanel 走空态
//          UI 一概不动,只把链路接通
// v1.0.16: 删 task-store(死代码) + CommandPalette 3 callback 真接通

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
// 2026-06-06 hotfix: 持久化失败顶部提示
import { PersistenceBanner } from "./components/PersistenceBanner/PersistenceBanner";
import { ToastContainer } from "./components/Toast/ToastContainer";
import { WorkspaceNoticeBanner, emitWorkspaceNotice } from "./components/WorkspaceNoticeBanner/WorkspaceNoticeBanner";
import { SettingsPanel } from "./components/Settings/SettingsPanel";
import { CommandPalette } from "./components/CommandPalette/CommandPalette";
import { ShortcutsCheatsheet } from "./components/ShortcutsCheatsheet/ShortcutsCheatsheet";
import { SkillsPanel } from "./components/SkillsPanel/SkillsPanel";
import { TerminalPanel } from "./components/Terminal/TerminalPanel";
import { ApprovalPanel } from "./components/ApprovalPanel/ApprovalPanel";
import { PiStatusPanel } from "./components/PiStatusPanel/PiStatusPanel";
import { Onboarding } from "./components/Onboarding/Onboarding";
import { ChatView } from "./components/ChatView/ChatView";
import { GitPanel } from "./components/GitPanel/GitPanel";
import { SessionCenter } from "./components/SessionCenter/SessionCenter";
import { FileWorkspace } from "./components/FileWorkspace/FileWorkspace";
import { SearchHistory } from "./components/SearchHistory/SearchHistory";
import {
    MiniMaxCodeLayout,
    MiniMaxCodeSidebar,
    RightRail,
} from "./components/MiniMaxCode";
import { useWorkspaceStore } from "./stores/workspace-store";
import { useSettingsStore } from "./stores/settings-store";
import { usePiStatusStore } from "./stores/pi-status-store";
import { useApprovalStore } from "./stores/approval-store";
import { useSessionStore } from "./stores/session-store";
import { useAgentStore } from "./stores/agent-store";
import { isFirstLaunch } from "./utils/first-launch";
import { useShortcuts } from "./shortcuts";
import { I18nProvider } from "./i18n";
import { logger } from "./utils/logger";
import { useTaskProgress } from "./hooks/useTaskProgress";
import { ensurePermissionSubscriptions } from "./stores/permission-store";
import { ensurePlanSubscriptions } from "./stores/plan-store";
import { ensureQueueSubscription } from "./stores/queue-store";
import type { TerminalCommandMode } from "./utils/terminal-command";
import { isIpcError } from "@shared";
import { applyTheme, watchSystemTheme, type Theme } from "./utils/theme";

type MainPanel = "chat" | "skills" | "git" | "sessions" | "files";
type FileWorkspaceTarget = { path: string; mode?: "edit" | "diff"; nonce: number };
type GitPanelTarget = { file: string; nonce: number };
type TerminalCommandTarget = { command: string; mode: TerminalCommandMode; nonce: number };
type PaletteCommandStatus = { message: string; tone: "success" | "error" };

function panelForSection(section: string): MainPanel {
    if (section === "skills") return "skills";
    if (section === "sessions") return "sessions";
    if (section === "git") return "git";
    if (section === "files" || section === "workspace") return "files";
    return "chat";
}

function emitCommandPaletteStatus(status: PaletteCommandStatus): void {
    window.dispatchEvent(new CustomEvent("command-palette:status", { detail: status }));
}

async function selectWorkspaceForRoute(path: string): Promise<void> {
    if (!window.piAPI?.selectWorkspace) return;
    try {
        const result = await window.piAPI.selectWorkspace(path);
        if (isIpcError(result)) {
            emitWorkspaceNotice({ message: result.fallback, tone: "error" });
        }
    } catch (error) {
        emitWorkspaceNotice({
            message: error instanceof Error ? error.message : String(error),
            tone: "error",
        });
    }
}

function App(): React.ReactElement {
    return (
        <I18nProvider>
            <ErrorBoundary>
                <AppShell />
            </ErrorBoundary>
        </I18nProvider>
    );
}

function AppShell(): React.ReactElement {
    const [activeSection, setActiveSection] = useState<string>("chat");
    const [showTerminal, setShowTerminal] = useState(false);
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [showCheatsheet, setShowCheatsheet] = useState(false);
    const [showOnboarding, setShowOnboarding] = useState(false);
    const [showSearchHistory, setShowSearchHistory] = useState(false);
    const [leftCollapsed, setLeftCollapsed] = useState(false);
    const [rightCollapsed, setRightCollapsed] = useState(false);
    const [fileWorkspaceTarget, setFileWorkspaceTarget] = useState<FileWorkspaceTarget | null>(null);
    const [gitPanelTarget, setGitPanelTarget] = useState<GitPanelTarget | null>(null);
    const [terminalCommandTarget, setTerminalCommandTarget] = useState<TerminalCommandTarget | null>(null);
    const sessions = useSessionStore((s) => s.sessions);
    const currentSessionId = useSessionStore((s) => s.currentSessionId);
    const currentSession = useSessionStore((s) =>
        s.currentSessionId
            ? s.sessions.find((session) => session.id === s.currentSessionId) ?? null
            : null,
    );

    const { getCurrentWorkspace, workspaces } = useWorkspaceStore();
    const workspaceError = useWorkspaceStore((state) => state.lastError);
    const clearWorkspaceError = useWorkspaceStore((state) => state.clearError);
    const { loadPiConfig, openSettings, settings } = useSettingsStore();
    const { status, refreshStatus } = usePiStatusStore();
    const pendingApprovalCount = useApprovalStore(
        (s) => s.changes.filter((c) => c.status === "pending").length,
    );
    const agents = useAgentStore((s) => s.agents);
    const agentsInitialized = useAgentStore((s) => s.initialized);
    const createAgent = useAgentStore((s) => s.createAgent);
    const currentWorkspace = getCurrentWorkspace();
    const pendingDefaultAgentWorkspaces = useRef<Set<string>>(new Set());

    useEffect(() => {
        if (!workspaceError) return;
        emitWorkspaceNotice({ message: workspaceError, tone: "error" });
        clearWorkspaceError();
    }, [clearWorkspaceError, workspaceError]);

    useEffect(() => {
        if (!currentWorkspace || !agentsInitialized) return;
        if (agents.some((agent) => agent.workspaceId === currentWorkspace.id)) return;
        if (pendingDefaultAgentWorkspaces.current.has(currentWorkspace.id)) return;

        pendingDefaultAgentWorkspaces.current.add(currentWorkspace.id);
        void createAgent(currentWorkspace.id, `${currentWorkspace.name} Agent`).finally(() => {
            pendingDefaultAgentWorkspaces.current.delete(currentWorkspace.id);
        });
    }, [agents, agentsInitialized, createAgent, currentWorkspace]);

    useEffect(() => {
        if (!currentWorkspace) return;
        const selected = currentSessionId
            ? sessions.find((session) => session.id === currentSessionId)
            : null;
        if (!selected && activeSection === "new-task") return;
        if (selected) {
            if (selected.workspaceId === currentWorkspace.id) return;
            const selectedWorkspace = workspaces.find((workspace) => workspace.id === selected.workspaceId);
            if (selectedWorkspace) {
                useWorkspaceStore.getState().setCurrentWorkspace(selectedWorkspace.id);
                void selectWorkspaceForRoute(selectedWorkspace.path);
                if (activeSection === "new-task") setActiveSection("chat");
                return;
            }
        }

        const nextSession = sessions
            .filter((session) => session.workspaceId === currentWorkspace.id && !session.archived)
            .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
        useSessionStore.setState({ currentSessionId: nextSession?.id ?? null });
        if (activeSection === "chat" || activeSection === "new-task") {
            setActiveSection(nextSession ? "chat" : "new-task");
        }
    }, [activeSection, currentSessionId, currentWorkspace, sessions, workspaces]);

    useEffect(() => {
        ensurePermissionSubscriptions();
        ensurePlanSubscriptions();
        ensureQueueSubscription();
    }, []);

    // v2.0: 自动右栏 — 空对话页隐藏右栏, 有消息后显示
    useEffect(() => {
        const hasMessages = (currentSession?.messages?.length ?? 0) > 0;
        setRightCollapsed((prev) => {
            if (hasMessages && prev) return false;
            if (!hasMessages && !prev) return true;
            return prev;
        });
    }, [currentSession?.messages?.length]);

    useEffect(() => {
        if (activeSection === "new-task" && currentSession) {
            setActiveSection("chat");
        }
    }, [activeSection, currentSession]);

    // v1.1: 暗色主题切换 — 同步 settings.theme 到 data-theme 属性
    useEffect(() => {
        const theme = (settings.theme as Theme) || "system";
        applyTheme(theme);

        if (theme === "system") {
            const unwatch = watchSystemTheme(() => {
                applyTheme("system");
            });
            return unwatch;
        }
        return;
    }, [settings.theme]);

    // v1.0.17: TaskProgressPanel 接通真数据
    const taskProgress = useTaskProgress();
    const titleBarStatus = taskProgress.tasks.some((task) => task.status === "running")
        ? { label: "运行中", tone: "busy" as const }
        : status?.installed
            ? { label: "Pi 已就绪", tone: "ready" as const }
            : { label: "Pi 未安装", tone: "error" as const };

    // 启动时拉 Pi 状态
    useEffect(() => {
        void refreshStatus();
        const id = setInterval(() => void refreshStatus(), 30000);
        return () => clearInterval(id);
    }, [refreshStatus]);

    // mount-only: 把 store action 引用存到 ref, 避免 deps 数组污染
    const loadPiConfigRef = useRef(loadPiConfig);
    loadPiConfigRef.current = loadPiConfig;
    useEffect(() => {
        void loadPiConfigRef.current();
    }, []);

    // 首启检测：localStorage 没标完成 OR 当前没 workspace → 展示引导
    const showOnboardingRef = useRef(setShowOnboarding);
    showOnboardingRef.current = setShowOnboarding;
    useEffect(() => {
        if (isFirstLaunch() || (!currentWorkspace && workspaces.length === 0)) {
            showOnboardingRef.current(true);
        }
    }, [workspaces.length, currentWorkspace]);

    // v1.0.14: SkillsPanel 等子组件用 window event 触发切到 chat + 注入 prompt
    //   (绕开"通过 prop 链层层传递" — 简单解耦,跟已有 skills-panel:set-tab 事件一致风格)
    const [chatPrefill, setChatPrefill] = useState<string | null>(null);
    // v1.0.14: 审批面板的"关闭"开关 — 之前 onToggle={undefined} 是个死函数
    //   pendingApprovalCount > 0 时挂载, 用户点 X 调 onToggle 调 approvalStore 的 clearChanges
    //   让 store 变空 → pendingCount = 0 → portal 不再挂载
    const [approvalVisible, setApprovalVisible] = useState(false);
    useEffect(() => {
        // 当 pendingApprovalCount > 0 时自动显示
        if (pendingApprovalCount > 0) setApprovalVisible(true);
    }, [pendingApprovalCount]);
    const closeApproval = useCallback(() => {
        setApprovalVisible(false);
        useApprovalStore.getState().clearChanges();
    }, []);
    useEffect(() => {
        const onPrefill = (e: Event): void => {
            const detail = (e as CustomEvent<{ text: string }>).detail;
            setActiveSection("chat");
            setChatPrefill(detail?.text ?? "");
        };
        const onSwitchSection = (e: Event): void => {
            const detail = (e as CustomEvent<{ section: string }>).detail;
            if (detail?.section) setActiveSection(detail.section);
        };
        const onOpenFile = (e: Event): void => {
            const detail = (e as CustomEvent<{ path?: string; mode?: "edit" | "diff" }>).detail;
            if (!detail?.path) return;
            setFileWorkspaceTarget({ path: detail.path, mode: detail.mode, nonce: Date.now() });
            setActiveSection("files");
        };
        const onOpenGitDiff = (e: Event): void => {
            const detail = (e as CustomEvent<{ file?: string }>).detail;
            if (!detail?.file) return;
            setGitPanelTarget({ file: detail.file, nonce: Date.now() });
            setActiveSection("git");
        };
        const onRunTerminalCommand = (e: Event): void => {
            const detail = (e as CustomEvent<{ command?: string; mode?: TerminalCommandMode }>).detail;
            const command = detail?.command?.trim();
            if (!command) return;
            setTerminalCommandTarget({ command, mode: detail?.mode ?? "run", nonce: Date.now() });
            setShowTerminal(true);
        };
        window.addEventListener("chatpanel:prefill", onPrefill);
        window.addEventListener("app:switch-section", onSwitchSection);
        window.addEventListener("workspace:open-file", onOpenFile);
        window.addEventListener("workspace:open-git-diff", onOpenGitDiff);
        window.addEventListener("terminal:run-command", onRunTerminalCommand);
        return () => {
            window.removeEventListener("chatpanel:prefill", onPrefill);
            window.removeEventListener("app:switch-section", onSwitchSection);
            window.removeEventListener("workspace:open-file", onOpenFile);
            window.removeEventListener("workspace:open-git-diff", onOpenGitDiff);
            window.removeEventListener("terminal:run-command", onRunTerminalCommand);
        };
    }, []);

    // v1.0.16: CommandPalette 3 个 callback 真接通
    //  - onSelectFile: 用 chatpanel:prefill 事件把 @path 灌进 ChatInput(走 mention 格式)
    //  - onSelectHistory: 切到 chat + 切到该 session
    //  - onRunCommand: case 分发到 setActiveSection / openSettings / setShowTerminal / selectDirectory
    const handleSelectFile = useCallback((path: string) => {
        setActiveSection("chat");
        window.dispatchEvent(
            new CustomEvent("chatpanel:prefill", { detail: { text: `@${path} ` } }),
        );
    }, []);
    const handleSelectHistory = useCallback((sessionId: string) => {
        setActiveSection("chat");
        useSessionStore.getState().setCurrentSession(sessionId);
    }, []);
    const routeSection = useCallback((section: string) => {
        if (section === "settings") {
            openSettings();
            return;
        }
        if (section === "search") {
            setPaletteOpen(true);
            return;
        }
        if (section === "new-task") {
            useSessionStore.setState({ currentSessionId: null });
            if (currentWorkspace) {
                void useAgentStore.getState().createAgent(currentWorkspace.id, `${currentWorkspace.name} Agent`);
            }
            setActiveSection("new-task");
            return;
        }
        if (section.startsWith("session:")) {
            const sessionId = section.slice("session:".length);
            useSessionStore.getState().setCurrentSession(sessionId);
            const session = useSessionStore.getState().sessions.find((item) => item.id === sessionId);
            const workspace = session
                ? useWorkspaceStore.getState().workspaces.find((item) => item.id === session.workspaceId)
                : undefined;
            if (workspace) {
                useWorkspaceStore.getState().setCurrentWorkspace(workspace.id);
                void selectWorkspaceForRoute(workspace.path);
            }
            setActiveSection("chat");
            return;
        }
        setActiveSection(section);
    }, [currentWorkspace, openSettings]);
    const handleRunCommand = useCallback((cmdId: string) => {
        switch (cmdId) {
            case "new_chat":
                routeSection("new-task");
                return;
            case "open_files":
                routeSection("files");
                return;
            case "open_git":
                routeSection("git");
                return;
            case "open_sessions":
                routeSection("sessions");
                return;
            case "open_skills":
                routeSection("skills");
                return;
            case "open_settings":
                routeSection("settings");
                return;
            case "switch_workspace":
                void (async () => {
                    if (!window.piAPI?.selectDirectory) {
                        emitCommandPaletteStatus({ message: "目录选择器不可用", tone: "error" });
                        return;
                    }
                    const path = await window.piAPI.selectDirectory();
                    if (isIpcError(path)) {
                        logger.error("[App] selectDirectory failed:", path.fallback);
                        emitCommandPaletteStatus({ message: path.fallback, tone: "error" });
                        return;
                    }
                    if (!path) return;
                    const name = path.split(/[\\/]/).pop() ?? path;
                    try {
                        const ws = await useWorkspaceStore.getState().createWorkspace(name, path);
                        if (!ws) {
                            const message = useWorkspaceStore.getState().lastError ?? "创建 workspace 失败";
                            logger.error("[App] createWorkspace failed:", message);
                            emitCommandPaletteStatus({ message, tone: "error" });
                            return;
                        }
                        const result = await window.piAPI.selectWorkspace?.(path);
                        if (isIpcError(result)) {
                            logger.error("[App] selectWorkspace failed:", result.fallback);
                            emitCommandPaletteStatus({ message: result.fallback, tone: "error" });
                            return;
                        }
                        emitCommandPaletteStatus({ message: `已切换到 ${name}`, tone: "success" });
                    } catch (e) {
                        logger.error("[App] switch_workspace failed:", e);
                        emitCommandPaletteStatus({
                            message: e instanceof Error ? e.message : String(e),
                            tone: "error",
                        });
                    }
                })();
                return;
            case "toggle_terminal":
                setShowTerminal((v) => !v);
                return;
            default:
                logger.warn("[App] unknown command palette cmd:", cmdId);
        }
    }, [routeSection]);

    // 全局快捷键
    const shortcutHandlers = useMemo(
        () => ({
            "open-command-palette": () => setPaletteOpen((v) => !v),
            "toggle-terminal": () => setShowTerminal((v) => !v),
            "open-settings": () => openSettings(),
            "new-chat": () => {
                useSessionStore.setState({ currentSessionId: null });
                setActiveSection("new-task");
            },
            "show-shortcuts-question": () => setShowCheatsheet((v) => !v),
            "search-history": () => setShowSearchHistory((v) => !v),
            "close-overlay": () => {
                if (showSearchHistory) {
                    setShowSearchHistory(false);
                } else if (showCheatsheet) {
                    setShowCheatsheet(false);
                } else if (paletteOpen) {
                    setPaletteOpen(false);
                } else if (showTerminal) {
                    setShowTerminal(false);
                }
            },
        }),
        [openSettings, paletteOpen, showCheatsheet, showTerminal, showSearchHistory],
    );
    useShortcuts(shortcutHandlers);

    // 解析当前 section → 决定中间内容
    // v1.0.17: "settings" 只通过 openSettings() 打开模态框，不再在主内容区占位
    // v1.1: "git" 渲染 GitPanel
    const activePanel = panelForSection(activeSection);

    const panelFallback = (name: string) => (error: Error, reset: () => void) => (
        <div className="flex items-center justify-center h-full bg-[#f5f5f5] p-4">
            <div className="bg-white rounded-xl p-6 max-w-sm shadow text-center">
                <div className="text-3xl mb-2">⚠️</div>
                <h2 className="text-sm font-semibold text-[#1a1a1a] mb-1">{name}加载失败</h2>
                <p className="text-xs text-[#666] mb-3">{error.message}</p>
                <button
                    onClick={reset}
                    className="px-3 py-1.5 bg-[#1a1a1a] text-white rounded text-xs hover:bg-[#333] transition-colors"
                >
                    重试
                </button>
            </div>
        </div>
    );

    // modal/浮层 portal 目标(SSR-safe)
    const portalTarget = typeof document !== "undefined" ? document.body : null;

    return (
        <>
            {/* 2026-06-06 hotfix: 持久化失败时, 顶部 banner 提示 */}
            <PersistenceBanner />
            <ToastContainer />
            <WorkspaceNoticeBanner />
            <MiniMaxCodeLayout
                title="Pi Agent"
                subtitle={currentWorkspace ? currentWorkspace.path : "未选择工作区"}
                statusLabel={titleBarStatus.label}
                statusTone={titleBarStatus.tone}
                leftCollapsed={leftCollapsed}
                rightCollapsed={rightCollapsed}
                onCollapseLeft={() => setLeftCollapsed((v) => !v)}
                onCollapseRight={() => setRightCollapsed((v) => !v)}
                leftSlot={
                    <MiniMaxCodeSidebar
                        currentSection={activeSection}
                        currentWorkspaceId={currentWorkspace?.id}
                        onSectionChange={routeSection}
                    />
                }
                centerSlot={
                    <>
                        {activePanel === "chat" && (
                            <ErrorBoundary fallback={panelFallback("聊天")}>
                                <ChatView prefillText={chatPrefill} onPrefillConsumed={() => setChatPrefill(null)} />
                            </ErrorBoundary>
                        )}
                        {activePanel === "skills" && (
                            <ErrorBoundary fallback={panelFallback("技能")}>
                                <div className="flex-1 overflow-hidden">
                                    <SkillsPanel />
                                </div>
                            </ErrorBoundary>
                        )}
                        {activePanel === "sessions" && (
                            <ErrorBoundary fallback={panelFallback("会话")}>
                                <div className="flex-1 overflow-hidden">
                                    <SessionCenter onOpenChat={() => setActiveSection("chat")} />
                                </div>
                            </ErrorBoundary>
                        )}
                        {activePanel === "git" && currentWorkspace && (
                            <ErrorBoundary fallback={panelFallback("Git")}>
                                <div className="flex-1 overflow-hidden">
                                    <GitPanel workspacePath={currentWorkspace.path} initialTarget={gitPanelTarget} />
                                </div>
                            </ErrorBoundary>
                        )}
                        {activePanel === "files" && currentWorkspace && (
                            <ErrorBoundary fallback={panelFallback("文件")}>
                                <div className="flex-1 overflow-hidden">
                                    <FileWorkspace workspacePath={currentWorkspace.path} initialTarget={fileWorkspaceTarget} />
                                </div>
                            </ErrorBoundary>
                        )}
                    </>
                }
                rightSlot={
                    <RightRail
                        workspacePath={currentWorkspace?.path}
                        workspaceId={currentWorkspace?.id}
                        tasks={taskProgress.tasks}
                    />
                }
            />

            {/* Modal/浮层 全部用 createPortal 挂到 body,绕开 layout overflow:hidden */}
            {portalTarget &&
                createPortal(
                    <>
                        <SettingsPanel />
                        <CommandPalette
                            isOpen={paletteOpen}
                            onClose={() => setPaletteOpen(false)}
                            workspacePath={currentWorkspace?.path ?? ""}
                            workspaceId={currentWorkspace?.id}
                            onSelectFile={handleSelectFile}
                            onSelectHistory={handleSelectHistory}
                            onRunCommand={handleRunCommand}
                        />
                        <ShortcutsCheatsheet
                            isOpen={showCheatsheet}
                            onClose={() => setShowCheatsheet(false)}
                        />
                        <SearchHistory
                            isOpen={showSearchHistory}
                            onClose={() => setShowSearchHistory(false)}
                            onNavigate={(sessionId) => {
                                useSessionStore.setState({ currentSessionId: sessionId });
                                setShowSearchHistory(false);
                            }}
                        />
                        {!status?.installed && <PiStatusPanel />}
                        {showOnboarding && (
                            <Onboarding onComplete={() => setShowOnboarding(false)} />
                        )}
                    </>,
                    portalTarget,
                )}

            {/* 终端面板:固定底部 280px,不影响三栏主体 */}
            {showTerminal && currentWorkspace && (
                <div
                    style={{
                        position: "fixed",
                        left: 0,
                        right: 0,
                        bottom: 0,
                        height: 280,
                        zIndex: 40,
                        background: "#ffffff",
                        borderTop: "1px solid var(--mm-border)",
                    }}
                >
                    <TerminalPanel
                        isOpen={showTerminal}
                        workspacePath={currentWorkspace.path}
                        initialCommand={terminalCommandTarget}
                        onClose={() => setShowTerminal(false)}
                    />
                </div>
            )}

            {/* 审批浮窗(有点击行为时显示) — v1.0.14 关闭按钮真接 */}
            {approvalVisible &&
                pendingApprovalCount > 0 &&
                portalTarget &&
                createPortal(
                    <ApprovalPanel isOpen onToggle={closeApproval} />,
                    portalTarget,
                )}
        </>
    );
}

export default App;
