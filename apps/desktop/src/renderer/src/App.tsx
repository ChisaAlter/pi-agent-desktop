// Pi Desktop v1.0 - 整合 App (M7) — MiniMax Code 风格 (1:1 还原目标 UI)
// 三栏布局: MiniMaxCodeLayout (左 220px MiniMaxCodeSidebar / 中 flex-1 Welcome+Input / 右 280px TaskProgress)
// 旧架构 usePiDriver / usePiStream 老事件类型 → 新 usePiStream 用 @shared/events PiEvent
// v1.0.4: 包了 I18nProvider 顶层, 顶部标题栏 / 状态栏 / 占位文案走 t()
// v1.1: 接入 MiniMaxCode 三栏 layout, 移除非必需的旧 UI hook(保留 modal 触发能力)
// v1.2: Modal/浮层用 createPortal 挂到 body(避免 layout overflow:hidden 裁剪)
// v1.3: 右栏接 useTaskStore, 任务列表实时反映 store; 首启播种 demo 任务

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { SettingsPanel } from "./components/Settings/SettingsPanel";
import { CommandPalette } from "./components/CommandPalette/CommandPalette";
import { ShortcutsCheatsheet } from "./components/ShortcutsCheatsheet/ShortcutsCheatsheet";
import { SkillsPanel } from "./components/SkillsPanel/SkillsPanel";
import { TerminalPanel } from "./components/Terminal/TerminalPanel";
import { ApprovalPanel } from "./components/ApprovalPanel/ApprovalPanel";
import { PiStatusPanel } from "./components/PiStatusPanel/PiStatusPanel";
import { Onboarding } from "./components/Onboarding/Onboarding";
import { AutomationPanel } from "./components/Automation";
import {
    MiniMaxCodeLayout,
    MiniMaxCodeSidebar,
    WelcomeScreen,
    TaskProgressPanel,
    type WelcomeQuickAction,
    type TaskProgressItem,
} from "./components/MiniMaxCode";
import { useWorkspaceStore } from "./stores/workspace-store";
import { useSettingsStore } from "./stores/settings-store";
import { usePiStatusStore } from "./stores/pi-status-store";
import { useApprovalStore } from "./stores/approval-store";
import { useTaskStore } from "./stores/task-store";
import { useSkillsStore } from "./stores/skills-store";
import { isFirstLaunch } from "./utils/first-launch";
import { useShortcuts } from "./shortcuts";
import { I18nProvider, useI18n } from "./i18n";

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
    const { t } = useI18n();

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
    const activePanel: "chat" | "skills" | "automation" | "settings" =
        activeSection === "skills"
            ? "skills"
            : activeSection === "automation"
              ? "automation"
              : activeSection === "settings"
                ? "settings"
                : "chat";

    // 快捷动作:切到 skills section + 触发 tab=market + 预设搜索词
    // SkillsPanel 监听 'skills-panel:set-tab' 事件,marketQuery 在 store 里改
    const setMarketQuery = useSkillsStore((s) => s.setMarketQuery);
    const routeToSkillSearch = (query: string): void => {
        setActiveSection("skills");
        setMarketQuery(query);
        if (typeof window !== "undefined") {
            window.dispatchEvent(
                new CustomEvent<"market" | "mine">("skills-panel:set-tab", {
                    detail: "market",
                }),
            );
        }
    };

    // 任务列表:从 useTaskStore 派生。
    //  - progress: 完成 step 数 / 总 step 数
    //  - timestamp: 已完成用 completedAt,否则用 startedAt
    //  - 反序(最新在顶)符合进度列表的视觉习惯
    const rawTasks = useTaskStore((s) => s.tasks);
    const setCurrentTask = useTaskStore((s) => s.setCurrentTask);
    const seedDemoTasks = useTaskStore((s) => s.addTask);
    const addStep = useTaskStore((s) => s.addStep);
    const tasks: TaskProgressItem[] = useMemo(
        () =>
            [...rawTasks]
                .sort(
                    (a, b) =>
                        (b.completedAt?.getTime() ?? b.startedAt.getTime()) -
                        (a.completedAt?.getTime() ?? a.startedAt.getTime()),
                )
                .map((t) => {
                    const totalSteps = t.steps.length;
                    const doneSteps = t.steps.filter(
                        (s) => s.status === "completed",
                    ).length;
                    const progress =
                        totalSteps > 0
                            ? Math.round((doneSteps / totalSteps) * 100)
                            : undefined;
                    return {
                        id: t.id,
                        name: t.title,
                        status: t.status,
                        progress,
                        timestamp:
                            (t.completedAt ?? t.startedAt).getTime(),
                    };
                }),
        [rawTasks],
    );

    // 首启播种 demo 任务(空 store 时跑一次,idempotent)
    const seedRef = useRef(false);
    useEffect(() => {
        if (seedRef.current) return;
        if (rawTasks.length > 0) {
            seedRef.current = true;
            return;
        }
        const t1 = seedDemoTasks("了解项目");
        addStep(t1.id, "扫描目录树");
        addStep(t1.id, "汇总文件统计");
        const t2 = seedDemoTasks("对项目的看法");
        addStep(t2.id, "分析代码风格");
        addStep(t2.id, "列出改进点");
        const t3 = seedDemoTasks("生成 README 草稿");
        addStep(t3.id, "收集 README 章节");
        seedRef.current = true;
    }, [rawTasks.length, seedDemoTasks, addStep]);

    // modal/浮层 portal 目标(SSR-safe)
    const portalTarget = typeof document !== "undefined" ? document.body : null;

    return (
        <>
            <MiniMaxCodeLayout
                leftSlot={
                    <MiniMaxCodeSidebar
                        currentSection={activeSection}
                        onSectionChange={(s: string) => {
                            // Sidebar section 路由表:
                            //  - new-task          → 切到 chat(WelcomeScreen,光标会自动落在 input)
                            //  - scheduled-tasks   → 切到 automation(原 AutomationPanel 即定时任务)
                            //  - mobile-control    → 打开 CommandPalette(没真接入手机操控,先给个搜索入口)
                            //  - settings          → 打开设置面板
                            //  - history-*         → 切到 chat + 把对应历史任务标记为 current
                            //  - skills/automation → 已有 view, 直接切
                            if (s === "settings") {
                                openSettings();
                                return;
                            }
                            if (s === "mobile-control") {
                                setPaletteOpen(true);
                                return;
                            }
                            if (s === "history-opinion" || s === "history-about") {
                                const title =
                                    s === "history-opinion"
                                        ? "对项目的看法"
                                        : "了解项目";
                                const found = useTaskStore
                                    .getState()
                                    .tasks.find((t) => t.title === title);
                                if (found) useTaskStore.getState().setCurrentTask(found.id);
                                setActiveSection("chat");
                                return;
                            }
                            if (s === "scheduled-tasks") {
                                setActiveSection("automation");
                                return;
                            }
                            // new-task / skills / automation / chat 默认 fallback
                            setActiveSection(s);
                        }}
                    />
                }
                centerSlot={
                    <>
                        {activePanel === "chat" && (
                            <WelcomeScreen
                                workspaceName={currentWorkspace?.name ?? "pi-desktop"}
                                modelName={settings.model}
                                onQuickAction={(action: WelcomeQuickAction) => {
                                    // 快捷动作:5 个按钮全路由到 skills 市场
                                    // tab=market,query 预填匹配关键词(模糊搜索会兜底)
                                    const QUERY_MAP: Record<WelcomeQuickAction, string> = {
                                        team: "team",
                                        slides: "slides pptx presentation",
                                        pdf: "pdf",
                                        doc: "doc document",
                                        sheet: "sheet xlsx spreadsheet",
                                    };
                                    routeToSkillSearch(QUERY_MAP[action]);
                                }}
                                onSend={(text: string) => {
                                    if (window.piAPI && currentWorkspace) {
                                        void window.piAPI.sendPrompt(currentWorkspace.id, text);
                                    }
                                }}
                            />
                        )}
                        {activePanel === "skills" && (
                            <div className="flex-1 overflow-hidden">
                                <SkillsPanel />
                            </div>
                        )}
                        {activePanel === "automation" && (
                            <div className="flex-1 overflow-hidden">
                                <AutomationPanel />
                            </div>
                        )}
                        {activePanel === "settings" && (
                            <div className="flex-1 flex items-center justify-center text-[#999] text-sm">
                                {t("app.placeholder.settings")}
                            </div>
                        )}
                    </>
                }
                rightSlot={
                    <TaskProgressPanel
                        tasks={tasks}
                        onTaskClick={(id: string) => {
                            setCurrentTask(id);
                        }}
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
                        isOpen={showTerminal}
                        workspacePath={currentWorkspace.path}
                        onClose={() => setShowTerminal(false)}
                    />
                </div>
            )}

            {/* 审批浮窗(有点击行为时显示) */}
            {pendingApprovalCount > 0 &&
                portalTarget &&
                createPortal(
                    <ApprovalPanel isOpen onToggle={() => undefined} />,
                    portalTarget,
                )}
        </>
    );
}

export default App;
