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
import { SettingsPanel } from "./components/Settings/SettingsPanel";
import { CommandPalette } from "./components/CommandPalette/CommandPalette";
import { ShortcutsCheatsheet } from "./components/ShortcutsCheatsheet/ShortcutsCheatsheet";
import { SkillsPanel } from "./components/SkillsPanel/SkillsPanel";
import { TerminalPanel } from "./components/Terminal/TerminalPanel";
import { useAgentStore } from "./stores/agent-store";
import { ApprovalPanel } from "./components/ApprovalPanel/ApprovalPanel";
import { PiStatusPanel } from "./components/PiStatusPanel/PiStatusPanel";
import { Onboarding } from "./components/Onboarding/Onboarding";
import { ChatView } from "./components/ChatView/ChatView";
import { GitPanel } from "./components/GitPanel/GitPanel";
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
import { isFirstLaunch } from "./utils/first-launch";
import { useShortcuts } from "./shortcuts";
import { I18nProvider } from "./i18n";
import { logger } from "./utils/logger";
import { useTaskProgress } from "./hooks/useTaskProgress";
import { ensurePermissionSubscriptions } from "./stores/permission-store";
import { ensurePlanSubscriptions } from "./stores/plan-store";

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

    const { getCurrentWorkspace, workspaces } = useWorkspaceStore();
    const { loadPiConfig, openSettings, settings } = useSettingsStore();
    const { status, refreshStatus } = usePiStatusStore();
    const pendingApprovalCount = useApprovalStore(
        (s) => s.changes.filter((c) => c.status === "pending").length,
    );
    const currentWorkspace = getCurrentWorkspace();
    const currentAgent = useAgentStore((state) => state.getCurrentAgent());
    const { initialized: agentsInitialized, init: initAgents, createAgent } = useAgentStore();
    const creatingDefaultAgentWorkspaceRef = useRef<string | null>(null);

    // Auto-create default Agent on first load when workspace exists but no agents
    useEffect(() => {
        void initAgents();
    }, [initAgents]);

    useEffect(() => {
        const api = window.piAPI as unknown as { agentsCreate?: unknown };
        const hasCurrentWorkspaceAgent = Boolean(
            currentWorkspace &&
                currentAgent &&
                currentAgent.workspaceId === currentWorkspace.id,
        );
        if (
            agentsInitialized &&
            currentWorkspace &&
            !hasCurrentWorkspaceAgent &&
            creatingDefaultAgentWorkspaceRef.current !== currentWorkspace.id &&
            typeof api.agentsCreate === 'function'
        ) {
            const workspaceId = currentWorkspace.id;
            creatingDefaultAgentWorkspaceRef.current = workspaceId;
            void createAgent(workspaceId, `${currentWorkspace.name} Agent`)
                .catch((error) => logger.error("[App] create default agent failed:", error))
                .finally(() => {
                    if (creatingDefaultAgentWorkspaceRef.current === workspaceId) {
                        creatingDefaultAgentWorkspaceRef.current = null;
                    }
                });
        }
    }, [agentsInitialized, currentWorkspace, currentAgent, createAgent]);

    useEffect(() => {
        ensurePermissionSubscriptions();
        ensurePlanSubscriptions();
    }, []);

    // v1.1: 暗色主题切换 — 同步 settings.theme 到 data-theme 属性
    useEffect(() => {
        document.documentElement.setAttribute("data-theme", settings.theme ?? "light");
    }, [settings.theme]);

    // v1.0.17: TaskProgressPanel 接通真数据
    const taskProgress = useTaskProgress();

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
        window.addEventListener("chatpanel:prefill", onPrefill);
        return () => window.removeEventListener("chatpanel:prefill", onPrefill);
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
    const handleRunCommand = useCallback((cmdId: string) => {
        switch (cmdId) {
            case "new_chat":
                setActiveSection("chat");
                if (currentWorkspace) {
                    void useAgentStore.getState().createAgent(currentWorkspace.id, `${currentWorkspace.name} Agent`);
                }
                return;
            case "open_skills":
                setActiveSection("skills");
                return;
            case "open_settings":
                openSettings();
                return;
            case "switch_workspace":
                void (async () => {
                    if (!window.piAPI?.selectDirectory) return;
                    const path = await window.piAPI.selectDirectory();
                    if (!path) return;
                    const name = path.split(/[\\/]/).pop() ?? path;
                    try {
                        if (window.piAPI.createWorkspace) {
                            const ws = await window.piAPI.createWorkspace(name, path);
                            useWorkspaceStore.getState().addWorkspace(ws.name, ws.path);
                        } else {
                            useWorkspaceStore.getState().addWorkspace(name, path);
                        }
                        await window.piAPI.selectWorkspace?.(path);
                    } catch (e) {
                        logger.error("[App] switch_workspace failed:", e);
                    }
                })();
                return;
            case "toggle_terminal":
                setShowTerminal((v) => !v);
                return;
            default:
                logger.warn("[App] unknown command palette cmd:", cmdId);
        }
    }, [currentWorkspace, openSettings]);

    // 全局快捷键
    const shortcutHandlers = useMemo(
        () => ({
            "open-command-palette": () => setPaletteOpen((v) => !v),
            "toggle-terminal": () => setShowTerminal((v) => !v),
            "open-settings": () => openSettings(),
            "new-chat": () => setActiveSection("chat"),
            "show-shortcuts-question": () => setShowCheatsheet((v) => !v),
            "close-overlay": () => {
                if (showCheatsheet) {
                    setShowCheatsheet(false);
                } else if (paletteOpen) {
                    setPaletteOpen(false);
                } else if (showTerminal) {
                    setShowTerminal(false);
                }
            },
        }),
        [openSettings, paletteOpen, showCheatsheet, showTerminal],
    );
    useShortcuts(shortcutHandlers);

    // 解析当前 section → 决定中间内容
    // v1.0.17: "settings" 只通过 openSettings() 打开模态框，不再在主内容区占位
    // v1.1: "git" 渲染 GitPanel
    const activePanel: "chat" | "skills" | "git" =
        activeSection === "skills"
            ? "skills"
            : activeSection === "git"
                ? "git"
                : "chat";

    // modal/浮层 portal 目标(SSR-safe)
    const portalTarget = typeof document !== "undefined" ? document.body : null;

    return (
        <>
            <MiniMaxCodeLayout
                leftSlot={
                    <MiniMaxCodeSidebar
                        currentSection={activeSection}
                        onSectionChange={(s: string) => {
                            // Sidebar section 路由表 (v1.0.16 删 "scheduled-tasks" 路由):
                            //  - new-task          → 切到 chat(ChatView 接管)
                            //  - mobile-control    → 打开 CommandPalette(没真接入手机操控,先给个搜索入口)
                            //  - settings          → 打开设置面板
                            //  - session:*         → 切到 chat + 切换当前历史 session
                            //  - skills            → 已有 view, 直接切
                            if (s === "settings") {
                                openSettings();
                                return;
                            }
                            if (s === "new-task") {
                                setActiveSection("chat");
                                if (currentWorkspace) {
                                    void useAgentStore.getState().createAgent(currentWorkspace.id, `${currentWorkspace.name} Agent`);
                                }
                                return;
                            }
                            if (s.startsWith("session:")) {
                                setActiveSection("chat");
                                const sessionId = s.slice("session:".length);
                                useSessionStore.getState().setCurrentSession(sessionId);
                                return;
                            }
                            // new-task / skills / chat 默认 fallback
                            setActiveSection(s);
                        }}
                    />
                }
                centerSlot={
                    <>
                        {activePanel === "chat" && (
                            <ChatView prefillText={chatPrefill} onPrefillConsumed={() => setChatPrefill(null)} />
                        )}
                        {activePanel === "skills" && (
                            <div className="flex-1 overflow-hidden">
                                <SkillsPanel />
                            </div>
                        )}
                        {activePanel === "git" && currentWorkspace && (
                            <div className="flex-1 overflow-hidden">
                                <GitPanel workspacePath={currentWorkspace.path} />
                            </div>
                        )}
                    </>
                }
                rightSlot={
                    <RightRail
                        workspacePath={currentWorkspace?.path}
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
                            onSelectFile={handleSelectFile}
                            onSelectHistory={handleSelectHistory}
                            onRunCommand={handleRunCommand}
                        />
                        <ShortcutsCheatsheet
                            isOpen={showCheatsheet}
                            onClose={() => setShowCheatsheet(false)}
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
                        key={currentAgent?.id ?? currentWorkspace.id}
                        isOpen={showTerminal}
                        agentId={currentAgent?.id}
                        workspacePath={currentWorkspace.path}
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
