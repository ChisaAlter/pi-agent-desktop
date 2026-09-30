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
import { useTranslation } from "react-i18next";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { MotionPanelLayer } from "./components/common/MotionPanelLayer";
// 2026-06-06 hotfix: 持久化失败顶部提示
import { PersistenceBanner } from "./components/PersistenceBanner/PersistenceBanner";
import { ToastContainer } from "./components/Toast/ToastContainer";
import { WorkspaceNoticeBanner, emitWorkspaceNotice } from "./components/WorkspaceNoticeBanner/WorkspaceNoticeBanner";
import { CommandPalette } from "./components/CommandPalette/CommandPalette";
import { ShortcutsCheatsheet } from "./components/ShortcutsCheatsheet/ShortcutsCheatsheet";
import { SkillsPanel } from "./components/SkillsPanel/SkillsPanel";
import { ApprovalPanel } from "./components/ApprovalPanel/ApprovalPanel";
import { Onboarding } from "./components/Onboarding/Onboarding";
import { ChatView } from "./components/ChatView/ChatView";
import { PermissionRequestStack } from "./components/ChatView/PermissionRequestStack";
import { RunPanel, type RunView } from "./components/RunPanel/RunPanel";
import { HerdrControlSurface } from "./components/Herdr/HerdrControlSurface";
import { HerdrContextRail } from "./components/Herdr/HerdrContextRail";
import { HerdrLayoutSwitcher } from "./components/Herdr/HerdrLayoutSwitcher";
import { HerdrStatusBar } from "./components/Herdr/HerdrStatusBar";
import { HerdrTree } from "./components/Herdr/HerdrTree";
import { MissionCockpit } from "./components/Herdr/MissionCockpit";
import { SearchHistory } from "./components/SearchHistory/SearchHistory";
import { SessionCenter } from "./components/SessionCenter/SessionCenter";
import { TopTabBar } from "./components/TopTabBar/TopTabBar";
import { WorkbenchPanel, type WorkbenchView } from "./components/Workbench/WorkbenchPanel";
import {
    MiniMaxCodeLayout,
    MiniMaxCodeSidebar,
    RightRail,
} from "./components/MiniMaxCode";
import { useWorkspaceStore } from "./stores/workspace-store";
import { useSettingsStore } from "./stores/settings-store";
import { usePiStatusStore } from "./stores/pi-status-store";
import { useUpdaterStore } from "./stores/updater-store";
import { useApprovalStore } from "./stores/approval-store";
import { useSessionStore } from "./stores/session-store";
import { useAgentStore } from "./stores/agent-store";
import { isFirstLaunch } from "./utils/first-launch";
import { useShortcuts } from "./shortcuts";
import { I18nProvider } from "./i18n";
import { logger } from "./utils/logger";
import { useTaskProgress } from "./hooks/useTaskProgress";
import { ensurePermissionSubscriptions, usePermissionStore } from "./stores/permission-store";
import { ensurePlanSubscriptions } from "./stores/plan-store";
import { ensureQueueSubscription } from "./stores/queue-store";
import { ensureSubagentSubscriptions } from "./stores/subagent-store";
import { ensureFleetSignalSubscriptions } from "./stores/fleet-signals-store";
import { ensureHerdrSubscriptions } from "./stores/herdr-store";
import { useRuntimeFeatureStore } from "./stores/runtime-feature-store";
import type { TerminalCommandMode } from "./utils/terminal-command";
import { isIpcError, type DeferredEdit, type SettingsWindowTab } from "@shared";
import { applyTheme, watchSystemTheme, type Theme } from "./utils/theme";
import { addToast } from "./stores/toast-store";
import { resolveActiveAgent } from "./utils/active-agent";

type MainPanel = "chat" | "agents" | "mission" | "run" | "workbench" | "skills" | "history";

/**
 * Canonical section identifiers for the center panel router.
 *
 * - "chat" / "run" / "workbench" / "extensions" map to center panels
 * - "new-task" renders ChatView in blank-slate mode (no current session)
 * - "history" renders the full SessionCenter management surface
 * - `session:<id>` is a transient navigation action — resolved to "chat" after
 *   switching the current session; never stored as activeSection.
 *
 * "settings" and "search" are intercepted by routeSection() and do not become
 * persistent center-panel sections.
 */
type SectionId = "chat" | "agents" | "mission" | "run" | "workbench" | "extensions" | "new-task" | "history";

/**
 * Input type for routeSection() — covers all values that can arrive from
 * TopTabBar, MiniMaxCodeSidebar, CommandPalette, slash commands, and
 * window events. Values NOT in SectionId are intercepted and handled
 * (open settings window, open palette, etc.) before reaching setActiveSection.
 */
type TerminalCommandTarget = { command: string; mode: TerminalCommandMode; nonce: number };
type PaletteCommandStatus = { message: string; tone: "success" | "error" };
type FileWorkspaceTarget = { path: string; mode?: "edit" | "diff"; nonce: number };

/** Validate that an unknown section string from a DOM event is a valid SectionId. */
function isValidSectionId(value: string): value is SectionId {
    switch (value) {
        case "chat": case "agents": case "mission": case "run": case "workbench":
            case "extensions": case "new-task": case "history":
            return true;
        default:
            return false;
    }
}

const LEFT_SIDEBAR_WIDTH_KEY = "pi-desktop-left-sidebar-width";
const DEFAULT_LEFT_SIDEBAR_WIDTH = 190;
const MIN_LEFT_SIDEBAR_WIDTH = 160;
const MAX_LEFT_SIDEBAR_WIDTH = 320;
const RIGHT_RAIL_AUTO_OPEN_MIN_WIDTH = 960;

/** Herdr 布局模式 → 左栏宽度（原型 CSS 变量 studio 270 / mission 220 / terminal 230） */
const HERDR_LEFT_WIDTH: Record<"studio" | "mission" | "terminal", number> = {
    studio: 270,
    mission: 220,
    terminal: 230,
};

/** Herdr 布局模式 → 右栏宽度（studio 310 / mission 335 / terminal 270） */
const HERDR_RIGHT_WIDTH: Record<"studio" | "mission" | "terminal", string> = {
    studio: "w-[310px]",
    mission: "w-[335px]",
    terminal: "w-[270px]",
};

/**
 * Herdr 布局模式 → 中心内容右内边距（浮层右栏不占位，内容需避开，
 * 视觉上与原型静态右栏一致——内容止于 1130/1105/1170）。
 */
const HERDR_CENTER_PADDING: Record<"studio" | "mission" | "terminal", string> = {
    studio: "pr-[310px]",
    mission: "pr-[335px]",
    terminal: "pr-[270px]",
};

function clampLeftSidebarWidth(width: number): number {
    return Math.max(MIN_LEFT_SIDEBAR_WIDTH, Math.min(MAX_LEFT_SIDEBAR_WIDTH, Math.round(width)));
}

function readStoredLeftSidebarWidth(): number {
    if (typeof window === "undefined") return DEFAULT_LEFT_SIDEBAR_WIDTH;
    const raw = window.localStorage?.getItem(LEFT_SIDEBAR_WIDTH_KEY);
    const parsed = raw ? Number(raw) : DEFAULT_LEFT_SIDEBAR_WIDTH;
    return Number.isFinite(parsed) ? clampLeftSidebarWidth(parsed) : DEFAULT_LEFT_SIDEBAR_WIDTH;
}

function panelForSection(section: SectionId): MainPanel {
    switch (section) {
        case "run": return "run";
        case "workbench": return "workbench";
        case "extensions": return "skills";
        case "agents": return "agents";
        case "mission": return "mission";
        case "chat": return "chat";
        case "new-task": return "chat";
        case "history": return "history";
    }
}

function normalizeWorkspaceTarget(path: string, workspacePath?: string): string {
    const trimmed = path.trim().replace(/^["']|["']$/g, "");
    if (!workspacePath || /^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith("\\\\")) {
        return trimmed;
    }
    return `${workspacePath.replace(/[\\/]+$/, "")}\\${trimmed.replace(/^[\\/]+/, "")}`;
}

function emitCommandPaletteStatus(status: PaletteCommandStatus): void {
    window.dispatchEvent(new CustomEvent("command-palette:status", { detail: status }));
}

function requestChatInputFocus(): void {
    window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("chat-input:focus"));
    }, 0);
}

function isNativeWindowDragTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    // Never interrupt -webkit-app-region:drag with focus-steal IPC.
    if (target.closest("[data-mmcode-region=\"titlebar-drag-surface\"]")) return true;
    if (target.closest(".app-region-drag")) {
        // Drag surface itself, or non-interactive chrome inside the titlebar.
        const interactive = target.closest(
            "button, a, input, textarea, select, [role='tab'], [role='button'], .app-region-no-drag, [data-window-drag-exclude='true']",
        );
        return !interactive;
    }
    // Titlebar chrome (logo/title) is drag unless it is a control.
    if (target.closest("[data-mmcode-region=\"titlebar\"]")) {
        const interactive = target.closest(
            "button, a, input, textarea, select, [role='tab'], [role='button'], .app-region-no-drag, [data-window-drag-exclude='true']",
        );
        return !interactive;
    }
    return false;
}

function requestWindowForeground(event?: Event): void {
    // Only ask main to steal focus when the document is actually unfocused.
    if (typeof document !== "undefined" && document.hasFocus()) return;
    // Titlebar native drag must not trigger softFocus/webContents thrash mid-press.
    if (event && isNativeWindowDragTarget(event.target)) return;
    window.piAPI?.send?.("window:foreground-on-pointer");
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
    const { t } = useTranslation();

    // Windows first-click: one capture pointerdown is enough. Do not also listen
    // to mousedown (double IPC) and never steal focus from native titlebar drag.
    useEffect(() => {
        const onPointerDown = (event: PointerEvent): void => {
            requestWindowForeground(event);
        };
        window.addEventListener("pointerdown", onPointerDown, true);
        return () => {
            window.removeEventListener("pointerdown", onPointerDown, true);
        };
    }, []);

    const [activeSection, setActiveSection] = useState<SectionId>("chat");
    // Herdr 控制面 section（智能体/任务编排）：左槽换 HerdrTree、右槽换 ContextRail、
    // 显示布局切换器与全局状态条（D4/D5）
    const isHerdrSection = activeSection === "agents" || activeSection === "mission";
    const [runView, setRunView] = useState<RunView>("tasks");
    const [workbenchView, setWorkbenchView] = useState<WorkbenchView>("files");
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [showCheatsheet, setShowCheatsheet] = useState(false);
    const [showOnboarding, setShowOnboarding] = useState(false);
    const [showSearchHistory, setShowSearchHistory] = useState(false);
    const [leftCollapsed, setLeftCollapsed] = useState(false);
    const [leftSidebarWidth, setLeftSidebarWidthState] = useState(readStoredLeftSidebarWidth);
    const [workspaceHasRoomForRightRail, setWorkspaceHasRoomForRightRail] = useState(false);
    const [terminalCommandTarget, setTerminalCommandTarget] = useState<TerminalCommandTarget | null>(null);
    const [fileWorkspaceTarget, setFileWorkspaceTarget] = useState<FileWorkspaceTarget | null>(null);
    const [searchTarget, setSearchTarget] = useState<{ sessionId: string; messageId: string } | null>(null);
    const currentSessionId = useSessionStore((s) => s.currentSessionId);
    const sessionsLoading = useSessionStore((s) => s.sessionsLoading);
    const currentSession = useSessionStore((s) =>
        s.currentSessionId
            ? s.sessions.find((session) => session.id === s.currentSessionId) ?? null
            : null,
    );

    const workspaces = useWorkspaceStore((state) => state.workspaces);
    const getCurrentWorkspace = useWorkspaceStore((state) => state.getCurrentWorkspace);
    const currentWorkspace = getCurrentWorkspace();
    const workspacesLoaded = useWorkspaceStore((state) => state.loaded);
    const workspaceError = useWorkspaceStore((state) => state.lastError);
    const clearWorkspaceError = useWorkspaceStore((state) => state.clearError);
    const loadPiConfig = useSettingsStore((state) => state.loadPiConfig);
    const settings = useSettingsStore((state) => state.settings);
    const rightRailCollapsed = useSettingsStore((state) => state.rightRailCollapsed);
    const sidebarGroupMode = useSettingsStore((state) => state.sidebarGroupMode);
    const setSidebarGroupMode = useSettingsStore((state) => state.setSidebarGroupMode);
    const herdrLayoutMode = useSettingsStore((state) => state.herdrLayoutMode);
    const status = usePiStatusStore((state) => state.status);
    const piStatusLoading = usePiStatusStore((state) => state.loading);
    const refreshStatus = usePiStatusStore((state) => state.refreshStatus);
    const updaterState = useUpdaterStore((state) => state.state);
    const setupUpdaterListeners = useUpdaterStore((state) => state.setupListeners);
    const cleanupUpdaterListeners = useUpdaterStore((state) => state.cleanupListeners);
    const hydrateUpdaterState = useUpdaterStore((state) => state.hydrate);
    const refreshRuntimeFeatureState = useRuntimeFeatureStore((state) => state.refresh);
    const pendingApprovalCount = useApprovalStore(
        (s) => s.changes.filter((c) => c.status === "pending" && c.workspaceId === currentWorkspace?.id).length,
    );
    const pendingApprovalFileCount = useApprovalStore(
        (s) => new Set(s.changes.filter((c) => c.status === "pending" && c.workspaceId === currentWorkspace?.id).map((c) => c.filePath)).size,
    );
    const agents = useAgentStore((s) => s.agents);
    const currentAgentId = useAgentStore((s) => s.currentAgentId);
    const agentsInitialized = useAgentStore((s) => s.initialized);
    const createAgent = useAgentStore((s) => s.createAgent);
    const pendingPermissions = usePermissionStore((s) => s.pending);
    const pendingDefaultAgentWorkspaces = useRef<Set<string>>(new Set());
    const pendingSessionAgentSessions = useRef<Set<string>>(new Set());
    const rightRailManualPreferenceRef = useRef<"open" | "collapsed" | null>(null);
    const updaterSetupRef = useRef(setupUpdaterListeners);
    const updaterCleanupRef = useRef(cleanupUpdaterListeners);
    const updaterHydrateRef = useRef(hydrateUpdaterState);
    const routeSectionRef = useRef<(section: string) => void>(() => undefined);
    const lastUpdaterToastRef = useRef<string | null>(null);
    const activePanel = panelForSection(activeSection);
    const initializeSessions = useSessionStore((state) => state.init);
    const [visitedPanels, setVisitedPanels] = useState<ReadonlySet<MainPanel>>(() => new Set<MainPanel>(["chat"]));
    updaterSetupRef.current = setupUpdaterListeners;
    updaterCleanupRef.current = cleanupUpdaterListeners;
    updaterHydrateRef.current = hydrateUpdaterState;

    useEffect(() => {
        initializeSessions();
    }, [initializeSessions]);

    useEffect(() => {
        setVisitedPanels((current) => {
            if (current.has(activePanel)) return current;
            const next = new Set(current);
            next.add(activePanel);
            return next;
        });
    }, [activePanel]);

    useEffect(() => {
        if (typeof window.requestIdleCallback !== "function") return;
        const idleId = window.requestIdleCallback(() => {
            setVisitedPanels((current) => {
                if (current.has("run")) return current;
                const next = new Set(current);
                next.add("run");
                return next;
            });
        }, { timeout: 1_200 });
        return () => window.cancelIdleCallback(idleId);
    }, []);
    const setLeftSidebarWidth = useCallback((width: number): void => {
        const next = clampLeftSidebarWidth(width);
        setLeftSidebarWidthState(next);
        try {
            window.localStorage?.setItem(LEFT_SIDEBAR_WIDTH_KEY, String(next));
        } catch {
            // Ignore unavailable localStorage in restricted renderer contexts.
        }
    }, []);
    const handleToggleRightRail = useCallback((): void => {
        const nextCollapsed = !rightRailCollapsed;
        rightRailManualPreferenceRef.current = nextCollapsed ? "collapsed" : "open";
        useSettingsStore.setState({ rightRailCollapsed: nextCollapsed });
    }, [rightRailCollapsed]);

    // settings-store: 注册 settings:changed / pi-config:changed 监听器 + 拉取初始 settings.
    // mount-only — init() idempotent, dispose() 卸载监听器 (HMR / StrictMode safe)
    useEffect(() => {
        useSettingsStore.getState().init();
        return () => useSettingsStore.getState().dispose();
    }, []);

    useEffect(() => {
        if (!workspaceError) return;
        emitWorkspaceNotice({ message: workspaceError, tone: "error" });
        clearWorkspaceError();
    }, [clearWorkspaceError, workspaceError]);

    useEffect(() => {
        updaterSetupRef.current();
        void updaterHydrateRef.current();
        return () => updaterCleanupRef.current();
    }, []);

    useEffect(() => {
        if (!updaterState) return;
        if (updaterState.phase === "available" && updaterState.latestVersion) {
            const signature = `available:${updaterState.latestVersion}`;
            if (lastUpdaterToastRef.current === signature) return;
            lastUpdaterToastRef.current = signature;
            addToast(t("app.updaterAvailable", { version: updaterState.latestVersion }), "info");
            return;
        }
        if (updaterState.phase === "downloaded" && updaterState.latestVersion) {
            const signature = `downloaded:${updaterState.latestVersion}`;
            if (lastUpdaterToastRef.current === signature) return;
            lastUpdaterToastRef.current = signature;
            addToast(t("app.updaterDownloaded", { version: updaterState.latestVersion }), "success");
        }
    }, [updaterState, t]);

    useEffect(() => {
        if (!currentWorkspace || !agentsInitialized || sessionsLoading) return;
        if (currentSession?.workspaceId === currentWorkspace.id) return;
        if (agents.some((agent) => agent.workspaceId === currentWorkspace.id)) return;
        if (pendingDefaultAgentWorkspaces.current.has(currentWorkspace.id)) return;

        pendingDefaultAgentWorkspaces.current.add(currentWorkspace.id);
        void createAgent(currentWorkspace.id, `${currentWorkspace.name} Agent`).finally(() => {
            pendingDefaultAgentWorkspaces.current.delete(currentWorkspace.id);
        });
    }, [agents, agentsInitialized, createAgent, currentSession?.workspaceId, currentWorkspace, sessionsLoading]);

    useEffect(() => {
        if (!currentWorkspace || !currentSession || !agentsInitialized || sessionsLoading) return;
        if (currentSession.workspaceId !== currentWorkspace.id || currentSession.readOnly) return;
        if (agents.some((agent) => agent.workspaceId === currentWorkspace.id && agent.sessionId === currentSession.id)) return;
        if (pendingSessionAgentSessions.current.has(currentSession.id)) return;

        pendingSessionAgentSessions.current.add(currentSession.id);
        void createAgent(
            currentWorkspace.id,
            `${currentSession.title || t("app.untitledSession")} Agent`,
            currentSession.id,
        ).finally(() => {
            pendingSessionAgentSessions.current.delete(currentSession.id);
        });
    }, [agents, agentsInitialized, createAgent, currentSession, currentWorkspace, sessionsLoading, t]);

    useEffect(() => {
        if (!currentWorkspace) return;
        // Read sessions from the store rather than the React-destructured
        // `sessions` array so this effect doesn't re-run on every session
        // mutation (the store already triggers re-renders elsewhere; this
        // effect only needs to react to workspace / currentSessionId changes).
        const sessionsFromStore = useSessionStore.getState().sessions;
        const selected = currentSessionId
            ? sessionsFromStore.find((session) => session.id === currentSessionId)
            : null;
        // Blank-slate "新对话": never auto-restore the previous session.
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

        // No valid selection: pick latest workspace session for normal chat, but
        // do not steal control while the user intentionally opened a new draft.
        if (activeSection === "new-task") return;

        const nextSession = sessionsFromStore
            .filter((session) => session.workspaceId === currentWorkspace.id && !session.archived)
            .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
        // Use the store action rather than direct setState so persistence /
        // metadata side-effects stay in one place.
        useSessionStore.getState().setDefaultSession(nextSession?.id ?? null);
        if (activeSection === "chat") {
            setActiveSection(nextSession ? "chat" : "new-task");
        }
    }, [activeSection, currentSessionId, currentWorkspace, workspaces]);

    useEffect(() => {
        ensurePermissionSubscriptions();
        ensurePlanSubscriptions();
        ensureQueueSubscription();
        ensureSubagentSubscriptions();
        ensureFleetSignalSubscriptions();
        ensureHerdrSubscriptions();
    }, []);

    useEffect(() => {
        void refreshRuntimeFeatureState();
    }, [refreshRuntimeFeatureState, settings.longHorizon]);

    useEffect(() => {
        const measure = (): void => {
            const body = document.querySelector<HTMLElement>('[data-mmcode-region="body"]');
            const bodyWidth = body?.getBoundingClientRect().width ?? window.innerWidth;
            const availableCenterWidth = bodyWidth - (leftCollapsed ? 0 : leftSidebarWidth);
            setWorkspaceHasRoomForRightRail(activePanel === "chat" && availableCenterWidth >= RIGHT_RAIL_AUTO_OPEN_MIN_WIDTH);
        };
        measure();
        window.addEventListener("resize", measure);
        const body = document.querySelector<HTMLElement>('[data-mmcode-region="body"]');
        const ResizeObserverCtor = typeof ResizeObserver !== "undefined" ? ResizeObserver : null;
        const observer = body && ResizeObserverCtor ? new ResizeObserverCtor(measure) : null;
        observer?.observe(body!);
        return () => {
            window.removeEventListener("resize", measure);
            observer?.disconnect();
        };
    }, [activePanel, leftCollapsed, leftSidebarWidth]);

    useEffect(() => {
        if (activePanel !== "chat") return;
        if (!workspaceHasRoomForRightRail) {
            if (rightRailManualPreferenceRef.current !== "open" && !rightRailCollapsed) {
                useSettingsStore.setState({ rightRailCollapsed: true });
            }
            return;
        }
        if (rightRailManualPreferenceRef.current !== "collapsed" && rightRailCollapsed) {
            useSettingsStore.setState({ rightRailCollapsed: false });
        }
    }, [activePanel, rightRailCollapsed, workspaceHasRoomForRightRail]);

    // v2.0: 自动右栏 — 首条消息到达时展开, 之后由用户控制
    const prevMessageCountRef = useRef(0);
    const currentWorkspaceAgent = useMemo(
        () => currentWorkspace ? resolveActiveAgent(agents, currentWorkspace.id) : null,
        [agents, currentWorkspace],
    );
    const activeChatAgent = useMemo(
        () => currentWorkspace
            ? resolveActiveAgent(agents, currentWorkspace.id, { agentId: currentAgentId, sessionId: currentSessionId })
            : null,
        [agents, currentAgentId, currentSessionId, currentWorkspace],
    );
    useEffect(() => {
        window.piAPI?.send?.("desktop-overlay:set-main-context", {
            chatSurfaceActive: activePanel === "chat",
            workspaceId: currentWorkspace?.id,
            agentId: activeChatAgent?.id ?? null,
        });
    }, [activeChatAgent?.id, activePanel, currentWorkspace?.id]);
    const hasPendingPermission = useMemo(
        () => pendingPermissions.some((request) => !currentWorkspace?.id || !request.workspaceId || request.workspaceId === currentWorkspace.id),
        [currentWorkspace?.id, pendingPermissions],
    );
    // Only the length — avoid subscribing App to full messagesByAgent map (stream thrash).
    const currentWorkspaceAgentId = currentWorkspaceAgent?.id ?? null;
    const currentAgentMessageCount = useAgentStore((s) =>
        currentWorkspaceAgentId ? s.messagesByAgent[currentWorkspaceAgentId]?.length ?? 0 : 0,
    );
    const currentSessionMessageCount = currentSession?.messages?.length ?? 0;
    useEffect(() => {
        const count = Math.max(currentSessionMessageCount, currentAgentMessageCount);
        const hadMessages = prevMessageCountRef.current > 0;
        prevMessageCountRef.current = count;
        if (count > 0 && !hadMessages) {
            if (workspaceHasRoomForRightRail && rightRailManualPreferenceRef.current !== "collapsed") {
                useSettingsStore.setState({ rightRailCollapsed: false });
            }
        }
    }, [currentAgentMessageCount, currentSessionMessageCount, workspaceHasRoomForRightRail]);

    // Leaving blank-slate: first send creates/binds a session via ChatView.
    // Workspace auto-select is blocked while activeSection === "new-task", so this
    // only fires for genuine draft → session transitions (not historical restore races).
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
    const piAgentStatus = piStatusLoading || !status
        ? "checking"
        : status.installed
            ? "online"
            : "offline";

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
        const refreshPiConfig = (): void => {
            void loadPiConfigRef.current();
        };

        refreshPiConfig();
        window.addEventListener("focus", refreshPiConfig);
        return () => window.removeEventListener("focus", refreshPiConfig);
    }, []);

    // 首启检测：fresh user 直接显示；非首启则等 workspace 初始恢复完成后再决定
    const showOnboardingRef = useRef(setShowOnboarding);
    showOnboardingRef.current = setShowOnboarding;
    useEffect(() => {
        if (isFirstLaunch()) {
            showOnboardingRef.current(true);
            return;
        }
        if (!workspacesLoaded) return;
        showOnboardingRef.current(!currentWorkspace && workspaces.length === 0);
    }, [workspacesLoaded, workspaces.length, currentWorkspace]);

    // v1.0.14: SkillsPanel 等子组件用 window event 触发切到 chat + 注入 prompt
    //   (绕开"通过 prop 链层层传递" — 简单解耦,跟已有 skills-panel:set-tab 事件一致风格)
    const [chatPrefill, setChatPrefill] = useState<string | null>(null);
    // v1.0.14: 审批面板的"关闭"开关 — 之前 onToggle={undefined} 是个死函数
    //   pendingApprovalCount > 0 时挂载, 用户点 X 调 onToggle 调 approvalStore 的 clearChanges
    //   让 store 变空 → pendingCount = 0 → portal 不再挂载
    const [approvalVisible, setApprovalVisible] = useState(false);
    const deferredApprovalRef = useRef<Map<string, DeferredEdit>>(new Map());
    useEffect(() => {
        // 当 pendingApprovalCount > 0 时自动显示
        if (pendingApprovalCount > 0) setApprovalVisible(true);
    }, [pendingApprovalCount]);
    // 权限请求 pending 时收起文件变更面板: 两个浮层都锚定在 composer 上方,
    // 若同时显示会互相遮挡, 点击“同意”可能误触审批面板的“撤销”按钮。
    useEffect(() => {
        if (hasPendingPermission) setApprovalVisible(false);
    }, [hasPendingPermission]);
    // 关闭 = 最小化 (dismiss): 只收起面板, 不处理任何变更。
    // 之前的实现会 clearChanges(), 把所有未处理项当作拒绝 — 语义错误。
    const closeApproval = useCallback(() => {
        setApprovalVisible(false);
    }, []);
    useEffect(() => {
        const onDeferred = window.piAPI?.onApprovalDeferred;
        const onReview = window.piAPI?.onApprovalReview;
        const onCleared = window.piAPI?.onApprovalCleared;
        if (!onDeferred || !onReview) return;
        const deferredApprovals = deferredApprovalRef.current;

        const unsubDeferred = onDeferred((payload) => {
            deferredApprovals.set(payload.changeId, payload);
        });
        const unsubReview = onReview((payload) => {
            const deferred = deferredApprovals.get(payload.changeId);
            useApprovalStore.getState().addChange({
                id: payload.changeId,
                toolCallId: payload.toolCallId,
                toolName: deferred?.op === "edit" ? "edit" : "write",
                filePath: payload.filePath,
                workspaceId: payload.workspaceId ?? deferred?.workspaceId,
                diff: payload.diff,
                newContent: payload.newContent,
                oldContent: payload.oldContent,
            });
            deferredApprovals.delete(payload.changeId);
        });
        const unsubCleared = onCleared?.((payload) => {
            useApprovalStore.getState().clearChangesByIds(payload.workspaceId, payload.changeIds);
            for (const changeId of payload.changeIds) deferredApprovals.delete(changeId);
        });

        return () => {
            deferredApprovals.clear();
            if (typeof unsubDeferred === "function") unsubDeferred();
            if (typeof unsubReview === "function") unsubReview();
            if (typeof unsubCleared === "function") unsubCleared();
        };
    }, []);
    useEffect(() => {
        const onPrefill = (e: Event): void => {
            const detail = (e as CustomEvent<{ text: string }>).detail;
            setActiveSection("chat");
            setChatPrefill(detail?.text ?? "");
        };
        const onSwitchSection = (e: Event): void => {
            const detail = (e as CustomEvent<{ section: string }>).detail;
            if (detail?.section) {
                routeSectionRef.current(detail.section);
            }
        };
        const onRunTerminalCommand = (e: Event): void => {
            const detail = (e as CustomEvent<{ command?: string; mode?: TerminalCommandMode }>).detail;
            const command = detail?.command?.trim();
            if (!command) return;
            setTerminalCommandTarget({ command, mode: detail?.mode ?? "run", nonce: Date.now() });
            setWorkbenchView("terminal");
            setActiveSection("workbench");
        };
        const onOpenFile = (e: Event): void => {
            const detail = (e as CustomEvent<{ path?: string; mode?: "edit" | "diff" }>).detail;
            const path = detail?.path?.trim();
            const workspacePath = useWorkspaceStore.getState().getCurrentWorkspace()?.path;
            if (!path || !workspacePath) return;
            setFileWorkspaceTarget({
                path: normalizeWorkspaceTarget(path, workspacePath),
                mode: detail?.mode,
                nonce: Date.now(),
            });
            setWorkbenchView("files");
            setActiveSection("workbench");
        };
        const onOpenGitDiff = (e: Event): void => {
            const detail = (e as CustomEvent<{ file?: string }>).detail;
            const file = detail?.file?.trim();
            const workspacePath = useWorkspaceStore.getState().getCurrentWorkspace()?.path;
            if (!file || !workspacePath) return;
            setFileWorkspaceTarget({
                path: normalizeWorkspaceTarget(file, workspacePath),
                mode: "diff",
                nonce: Date.now(),
            });
            setWorkbenchView("files");
            setActiveSection("workbench");
        };
        window.addEventListener("chatpanel:prefill", onPrefill);
        window.addEventListener("app:switch-section", onSwitchSection);
        window.addEventListener("terminal:run-command", onRunTerminalCommand);
        window.addEventListener("workspace:open-file", onOpenFile);
        window.addEventListener("workspace:open-git-diff", onOpenGitDiff);
        return () => {
            window.removeEventListener("chatpanel:prefill", onPrefill);
            window.removeEventListener("app:switch-section", onSwitchSection);
            window.removeEventListener("terminal:run-command", onRunTerminalCommand);
            window.removeEventListener("workspace:open-file", onOpenFile);
            window.removeEventListener("workspace:open-git-diff", onOpenGitDiff);
        };
    }, []);

    // v1.0.16: CommandPalette 3 个 callback 真接通
    //  - onSelectFile: 用 chatpanel:prefill 事件把 @path 灌进 ChatInput(走 mention 格式)
    //  - onSelectHistory: 切到 chat + 切到该 session
    //  - onRunCommand: case 分发到主区路由 / openSettings / selectDirectory
    const handleSelectFile = useCallback((path: string) => {
        setActiveSection("chat");
        window.dispatchEvent(
            new CustomEvent("chatpanel:prefill", { detail: { text: `@${path} ` } }),
        );
    }, []);
    const handleSelectHistory = useCallback((sessionId: string, messageId?: string) => {
        setActiveSection("chat");
        const session = useSessionStore.getState().sessions.find((item) => item.id === sessionId);
        const workspace = session
            ? useWorkspaceStore.getState().workspaces.find((item) => item.id === session.workspaceId)
            : undefined;
        if (workspace) {
            useWorkspaceStore.getState().setCurrentWorkspace(workspace.id);
            void selectWorkspaceForRoute(workspace.path);
        }
        useSessionStore.getState().setCurrentSession(sessionId);
        setSearchTarget(messageId ? { sessionId, messageId } : null);
    }, []);
    const routeSection = useCallback((section: string) => {
        if (section === "settings") {
            window.piAPI?.openSettingsWindow();
            return;
        }
        if (section === "tools" || section === "skills") {
            setActiveSection("extensions");
            return;
        }
        if (section === "tasks" || section === "memory") {
            setRunView(section);
            setActiveSection("run");
            return;
        }
        if (section === "files" || section === "git" || section === "terminal") {
            setWorkbenchView(section);
            setActiveSection("workbench");
            return;
        }
        if (section === "search") {
            setPaletteOpen(true);
            return;
        }
        if (section === "history") {
            setActiveSection("history");
            return;
        }
        if (section === "new-task") {
            // Order matters: enter draft mode BEFORE clearing currentSessionId.
            // Otherwise the workspace session-selection effect still sees activeSection
            // as "chat" with a null session and immediately re-selects the latest
            // session (making "新对话" look like a no-op / corrupting the previous chat).
            setActiveSection("new-task");
            useSessionStore.setState({ currentSessionId: null });
            if (currentWorkspace) {
                // 复用已有的 workspace 级默认 agent — 曾无条件 createAgent,
                // 每次点"新对话"都新增一个 agent, 列表持续膨胀且 resolveActiveAgent
                // 从多个候选中选取 (可能命中旧上下文)。与默认 agent 去重 effect 对齐。
                const hasWorkspaceAgent = useAgentStore.getState().agents.some(
                    (agent) => agent.workspaceId === currentWorkspace.id && !agent.sessionId,
                );
                if (!hasWorkspaceAgent) {
                    void useAgentStore.getState().createAgent(currentWorkspace.id, `${currentWorkspace.name} Agent`);
                }
            }
            requestChatInputFocus();
            return;
        }
        if (section.startsWith("session:")) {
            const sessionId = section.slice("session:".length);
            const session = useSessionStore.getState().sessions.find((item) => item.id === sessionId);
            const workspace = session
                ? useWorkspaceStore.getState().workspaces.find((item) => item.id === session.workspaceId)
                : undefined;
            if (workspace) {
                useWorkspaceStore.getState().setCurrentWorkspace(workspace.id);
                void selectWorkspaceForRoute(workspace.path);
            }
            useSessionStore.getState().setCurrentSession(sessionId);
            setActiveSection("chat");
            return;
        }
        if (isValidSectionId(section)) {
            setActiveSection(section);
        } else {
            logger.warn("[App] routeSection: unknown section, defaulting to chat:", section);
            setActiveSection("chat");
        }
    }, [currentWorkspace]);
    routeSectionRef.current = routeSection;

    useEffect(() => {
        if (hasPendingPermission && activePanel !== "chat") {
            routeSectionRef.current("chat");
        }
    }, [activePanel, hasPendingPermission]);

    useEffect(() => {
        if (hasPendingPermission && activePanel === "chat") {
            requestChatInputFocus();
        }
    }, [activePanel, hasPendingPermission]);

    useEffect(() => {
        const onStreamStart = (): void => {
            if (activePanel !== "chat") {
                routeSectionRef.current("chat");
            }
        };
        window.addEventListener("pi:stream-start", onStreamStart);
        return () => window.removeEventListener("pi:stream-start", onStreamStart);
    }, [activePanel]);

    const handleRunCommand = useCallback((cmdId: string): boolean | void => {
        switch (cmdId) {
            case "new_chat":
                routeSection("new-task");
                return;
            case "open_skills":
                routeSection("extensions");
                return;
            case "open_files":
                if (!currentWorkspace) {
                    emitCommandPaletteStatus({ message: t("app.workspaceRequired"), tone: "error" });
                    return false;
                }
                setFileWorkspaceTarget(null);
                routeSection("files");
                return;
            case "open_git":
                if (!currentWorkspace) {
                    emitCommandPaletteStatus({ message: t("app.workspaceRequired"), tone: "error" });
                    return false;
                }
                routeSection("git");
                return;
            case "open_sessions":
                routeSection("history");
                return;
            case "open_settings":
                routeSection("settings");
                return;
            case "switch_workspace":
                void (async () => {
                    if (!window.piAPI?.selectDirectory) {
                        emitCommandPaletteStatus({ message: t("app.directoryPickerUnavailable"), tone: "error" });
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
                            const message = useWorkspaceStore.getState().lastError ?? t("app.createWorkspaceFailed");
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
                        emitCommandPaletteStatus({ message: t("app.workspaceSwitched", { name }), tone: "success" });
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
                if (!currentWorkspace) {
                    emitCommandPaletteStatus({ message: t("app.workspaceRequired"), tone: "error" });
                    return false;
                }
                routeSection("terminal");
                return;
            default:
                logger.warn("[App] unknown command palette cmd:", cmdId);
        }
    }, [currentWorkspace, routeSection, t]);

    useEffect(() => {
        const onOpenSettingsTab = (event: Event): void => {
            const detail = (event as CustomEvent<{ tab?: SettingsWindowTab }>).detail;
            void window.piAPI?.openSettingsWindow(detail?.tab);
        };
        const onOpenHotkeys = (): void => setShowCheatsheet(true);
        const onOpenSessions = (): void => routeSection("history");
        const onNewTask = (): void => routeSection("new-task");

        window.addEventListener("slash-command:open-settings-tab", onOpenSettingsTab);
        window.addEventListener("slash-command:open-hotkeys", onOpenHotkeys);
        window.addEventListener("slash-command:open-sessions", onOpenSessions);
        window.addEventListener("slash-command:new-task", onNewTask);
        return () => {
            window.removeEventListener("slash-command:open-settings-tab", onOpenSettingsTab);
            window.removeEventListener("slash-command:open-hotkeys", onOpenHotkeys);
            window.removeEventListener("slash-command:open-sessions", onOpenSessions);
            window.removeEventListener("slash-command:new-task", onNewTask);
        };
        }, [routeSection]);

    // 全局快捷键
    const shortcutHandlers = useMemo(
        () => ({
            "open-command-palette": () => setPaletteOpen((v) => !v),
            "toggle-terminal": () => routeSection("terminal"),
            "open-settings": () => window.piAPI?.openSettingsWindow(),
            "new-chat": () => {
                // Match routeSection("new-task"): draft section first, then clear session.
                setActiveSection("new-task");
                useSessionStore.setState({ currentSessionId: null });
                requestChatInputFocus();
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
                }
            },
        }),
        [paletteOpen, routeSection, showCheatsheet, showSearchHistory],
    );
    useShortcuts(shortcutHandlers);

    // 解析当前 section → 决定中间内容
    // v1.0.17: "settings" 通过 openSettingsWindow() 打开独立窗口，不再在主内容区占位
    const panelFallback = (name: string) => (error: Error, reset: () => void) => (
        <div className="flex items-center justify-center h-full bg-[#f5f5f5] p-4">
            <div className="bg-white rounded-xl p-6 max-w-sm shadow text-center">
                <div className="text-3xl mb-2">⚠️</div>
                <h2 className="text-sm font-semibold text-[#1a1a1a] mb-1">{t("app.panelLoadFailed", { name })}</h2>
                <p className="text-xs text-[#666] mb-3">{error.message}</p>
                <button
                    type="button"
                    onClick={reset}
                    className="px-3 py-1.5 bg-[#1a1a1a] text-white rounded text-xs hover:bg-[#333] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
                >
                    {t("common.retry")}
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
            {activePanel === "chat" ? (
                <PermissionRequestStack
                    workspaceId={currentWorkspace?.id}
                    agentId={activeChatAgent?.id ?? null}
                />
            ) : null}
            <WorkspaceNoticeBanner />
            <MiniMaxCodeLayout
                title="Pi Agent"
                topBarSlot={
                    <TopTabBar
                        activeTab={
                            activeSection === "new-task" || activeSection === "history"
                                ? "chat"
                                : activeSection
                        }
                        onTabChange={routeSection}
                        onOpenSettings={() => void window.piAPI?.openSettingsWindow()}
                    />
                }
                statusBarSlot={isHerdrSection ? <HerdrStatusBar /> : null}
                leftCollapsed={leftCollapsed}
                rightCollapsed={isHerdrSection ? false : activePanel !== "chat" || rightRailCollapsed}
                leftWidth={isHerdrSection ? HERDR_LEFT_WIDTH[herdrLayoutMode] : leftSidebarWidth}
                rightFloatingOpen={activePanel === "chat" || isHerdrSection}
                rightFloatingTopOffset={isHerdrSection ? "54px" : "12px"}
                rightFloatingBottomOffset={
                    isHerdrSection
                        ? "12px"
                        : "calc(var(--pi-global-composer-height,103px) + 12px)"
                }
                rightFloatingChrome={false}
                onCollapseLeft={() => setLeftCollapsed((v) => !v)}
                onLeftWidthChange={isHerdrSection ? undefined : setLeftSidebarWidth}
                leftSlot={
                    isHerdrSection ? (
                        <HerdrTree />
                    ) : (
                        <MiniMaxCodeSidebar
                            currentSection={activeSection}
                            currentWorkspaceId={currentWorkspace?.id}
                            piAgentStatus={piAgentStatus}
                            onSectionChange={routeSection}
                            onOpenSearchHistory={() => setShowSearchHistory(true)}
                            groupMode={sidebarGroupMode}
                            onGroupModeChange={setSidebarGroupMode}
                        />
                    )
                }
                rightSlot={
                    isHerdrSection ? (
                        <div
                            className={`overflow-hidden rounded-[8px] border border-[var(--mm-border)] bg-[var(--mm-bg-main)] shadow-[0_18px_48px_rgba(15,23,42,0.13)] ${
                                HERDR_RIGHT_WIDTH[herdrLayoutMode]
                            }`}
                        >
                            <HerdrContextRail />
                        </div>
                    ) : (
                        <RightRail
                            workspacePath={currentWorkspace?.path}
                            workspaceId={currentWorkspace?.id}
                            tasks={taskProgress.tasks}
                        />
                    )
                }
                centerSlot={
                    // 右栏为浮层不占位：herdr section 中心内容加右内边距避开（原型静态右栏语义）。
                    // wrapper 必须是 flex 容器——panel-stack 靠 flex:1 撑高，block 容器会塌陷
                    <div className={`flex min-h-0 min-w-0 flex-1 flex-col ${isHerdrSection ? HERDR_CENTER_PADDING[herdrLayoutMode] : ""}`}>
                        <div className="pi-motion-panel-stack">
                        <MotionPanelLayer active={activePanel === "chat"} panelId="chat">
                            <ErrorBoundary fallback={panelFallback(t("app.panels.chat"))}>
                                <ChatView
                                    active={activePanel === "chat"}
                                    prefillText={chatPrefill}
                                    onPrefillConsumed={() => setChatPrefill(null)}
                                    focusMessageId={searchTarget?.sessionId === currentSessionId ? searchTarget.messageId : null}
                                    onFocusMessageHandled={() => setSearchTarget(null)}
                                    rightRailCollapsed={rightRailCollapsed}
                                    onToggleRightRail={handleToggleRightRail}
                                />
                            </ErrorBoundary>
                        </MotionPanelLayer>
                        {(activePanel === "agents" || visitedPanels.has("agents")) && (
                            <MotionPanelLayer
                                active={activePanel === "agents"}
                                panelId="agents"
                                enterOnMount={activePanel === "agents" && !visitedPanels.has("agents")}
                            >
                                <ErrorBoundary fallback={panelFallback(t("app.panels.agents"))}>
                                    <div className="flex min-h-0 flex-1 overflow-hidden">
                                        <HerdrControlSurface />
                                    </div>
                                </ErrorBoundary>
                            </MotionPanelLayer>
                        )}
                        {(activePanel === "mission" || visitedPanels.has("mission")) && (
                            <MotionPanelLayer
                                active={activePanel === "mission"}
                                panelId="mission"
                                enterOnMount={activePanel === "mission" && !visitedPanels.has("mission")}
                            >
                                <ErrorBoundary fallback={panelFallback(t("app.panels.mission"))}>
                                    <div className="flex min-h-0 flex-1 overflow-hidden">
                                        <MissionCockpit />
                                    </div>
                                </ErrorBoundary>
                            </MotionPanelLayer>
                        )}
                        {(activePanel === "skills" || visitedPanels.has("skills")) && (
                            <MotionPanelLayer
                                active={activePanel === "skills"}
                                panelId="skills"
                                enterOnMount={activePanel === "skills" && !visitedPanels.has("skills")}
                            >
                                <ErrorBoundary fallback={panelFallback(t("app.panels.skills"))}>
                                    <div className="flex min-h-0 flex-1 overflow-hidden">
                                        <SkillsPanel />
                                    </div>
                                </ErrorBoundary>
                            </MotionPanelLayer>
                        )}
                        {(activePanel === "run" || visitedPanels.has("run")) && (
                            <MotionPanelLayer
                                active={activePanel === "run"}
                                panelId="run"
                                enterOnMount={activePanel === "run" && !visitedPanels.has("run")}
                            >
                                <ErrorBoundary fallback={panelFallback(t("app.panels.run"))}>
                                    <RunPanel view={runView} onViewChange={setRunView} />
                                </ErrorBoundary>
                            </MotionPanelLayer>
                        )}
                        {(activePanel === "workbench" || visitedPanels.has("workbench")) && (
                            <MotionPanelLayer
                                active={activePanel === "workbench"}
                                panelId="workbench"
                                enterOnMount={activePanel === "workbench" && !visitedPanels.has("workbench")}
                            >
                                <ErrorBoundary fallback={panelFallback(t("app.panels.workbench"))}>
                                    <WorkbenchPanel
                                        workspacePath={currentWorkspace?.path}
                                        workspaceId={currentWorkspace?.id}
                                        view={workbenchView}
                                        onViewChange={setWorkbenchView}
                                        fileTarget={fileWorkspaceTarget}
                                        terminalCommand={terminalCommandTarget}
                                    />
                                </ErrorBoundary>
                            </MotionPanelLayer>
                        )}
                        {(activePanel === "history" || visitedPanels.has("history")) && (
                            <MotionPanelLayer
                                active={activePanel === "history"}
                                panelId="history"
                                enterOnMount={activePanel === "history" && !visitedPanels.has("history")}
                            >
                                <ErrorBoundary fallback={panelFallback(t("app.panels.history"))}>
                                    <SessionCenter onOpenChat={() => setActiveSection("chat")} />
                                </ErrorBoundary>
                            </MotionPanelLayer>
                        )}
                        </div>
                    </div>
                }
            />

            {/* Herdr 布局切换器：仅「智能体/任务编排」section 显示（D4） */}
            {isHerdrSection ? <HerdrLayoutSwitcher /> : null}

            {/* Modal/浮层 全部用 createPortal 挂到 body,绕开 layout overflow:hidden */}
            {portalTarget &&
                createPortal(
                    <>
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
                            onNavigate={(sessionId, messageId) => {
                                const session = useSessionStore.getState().sessions.find((item) => item.id === sessionId);
                                const workspace = session
                                    ? useWorkspaceStore.getState().workspaces.find((item) => item.id === session.workspaceId)
                                    : undefined;
                                setActiveSection("chat");
                                if (workspace) {
                                    useWorkspaceStore.getState().setCurrentWorkspace(workspace.id);
                                    void selectWorkspaceForRoute(workspace.path);
                                }
                                useSessionStore.getState().setCurrentSession(sessionId);
                                setSearchTarget({ sessionId, messageId });
                                setShowSearchHistory(false);
                            }}
                        />
                        {showOnboarding && (
                            <Onboarding onComplete={() => setShowOnboarding(false)} />
                        )}
                    </>,
                    portalTarget,
                )}

            {/* 审批浮窗(有点击行为时显示) — v1.0.14 关闭按钮真接 */}
            {approvalVisible &&
                pendingApprovalCount > 0 &&
                portalTarget &&
                createPortal(
                    <ApprovalPanel isOpen onToggle={closeApproval} workspaceId={currentWorkspace?.id} />,
                    portalTarget,
                )}

            {/* 面板最小化后的入口浮标: 未处理的变更仍在, 点击重新打开 */}
            {!approvalVisible &&
                pendingApprovalCount > 0 &&
                portalTarget &&
                createPortal(
                    <button
                        type="button"
                        onClick={() => setApprovalVisible(true)}
                        className="fixed right-3 z-[230] inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-3 text-xs font-medium text-[var(--mm-text-primary)] shadow-[0_8px_24px_rgba(15,23,42,0.14)] transition-colors hover:bg-[var(--mm-bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
                        style={{ bottom: "calc(var(--pi-global-composer-height, 103px) + 12px)" }}
                        aria-label={t("approvalPanel.dismissedBadge", { count: pendingApprovalFileCount })}
                        title={t("approvalPanel.dismissedBadge", { count: pendingApprovalFileCount })}
                    >
                        <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#f59e0b] px-1 text-[10px] font-bold text-white">
                            {pendingApprovalFileCount}
                        </span>
                        {t("approvalPanel.dismissedLabel")}
                    </button>,
                    portalTarget,
                )}
        </>
    );
}

export default App;
