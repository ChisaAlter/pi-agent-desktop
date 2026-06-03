// Pi Desktop v1.0 - 整合 App (M7) — MiniMax Code 风格 (1:1 还原目标 UI)
// 三栏布局: MiniMaxCodeLayout (左 220px MiniMaxCodeSidebar / 中 flex-1 Welcome+Input / 右 280px TaskProgress)
// 旧架构 usePiDriver / usePiStream 老事件类型 → 新 usePiStream 用 @shared/events PiEvent
// v1.0.4: 包了 I18nProvider 顶层, 顶部标题栏 / 状态栏 / 占位文案走 t()
// v1.1: 接入 MiniMaxCode 三栏 layout, 移除非必需的旧 UI hook(保留 modal 触发能力)
// v1.2: Modal/浮层用 createPortal 挂到 body(避免 layout overflow:hidden 裁剪)

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
    const { loadPiConfig, openSettings } = useSettingsStore();
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

    // 任务列表(本轮空数组,后续接 useTaskStore)
    const tasks: TaskProgressItem[] = [];

    // modal/浮层 portal 目标(SSR-safe)
    const portalTarget = typeof document !== "undefined" ? document.body : null;

    return (
        <>
            <MiniMaxCodeLayout
                leftSlot={
                    <MiniMaxCodeSidebar
                        currentSection={activeSection}
                        onSectionChange={(s: string) => {
                            setActiveSection(s);
                            if (s === "settings") openSettings();
                        }}
                    />
                }
                centerSlot={
                    <>
                        {activePanel === "chat" && (
                            <WelcomeScreen
                                workspaceName={currentWorkspace?.name ?? "pi-desktop"}
                                onQuickAction={(action: WelcomeQuickAction) => {
                                    // 快捷动作:本轮先 console.log,后续接真实功能
                                    console.log("[mmcode] quick action:", action);
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
                            console.log("[mmcode] task click:", id);
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
