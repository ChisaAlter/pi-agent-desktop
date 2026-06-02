// Pi Desktop v1.0 - 整合 App (M7)
// 三栏布局: IconBar (左 48px) + Sidebar (左 220px) + 主区 (chat/skills/terminal) + 右浮窗 (git/approval/gateway)
// M1-M5 所有组件 + M6 归档后重新整合的 17+ 个 UI 组件
// 旧架构 usePiDriver / usePiStream 老事件类型 → 新 usePiStream 用 @shared/events PiEvent

import React, { useEffect, useMemo, useState } from "react";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { IconBar } from "./components/IconBar/IconBar";
import { ProjectPanel } from "./components/ProjectPanel/ProjectPanel";
import { ResizablePanel } from "./components/ResizablePanel";
import { ChatView } from "./components/ChatView/ChatView";
import { SettingsPanel } from "./components/Settings/SettingsPanel";
import { CommandPalette } from "./components/CommandPalette/CommandPalette";
import { ShortcutsCheatsheet } from "./components/ShortcutsCheatsheet/ShortcutsCheatsheet";
import { SkillsPanel } from "./components/SkillsPanel/SkillsPanel";
import { TerminalPanel } from "./components/Terminal/TerminalPanel";
import { ApprovalPanel } from "./components/ApprovalPanel/ApprovalPanel";
import { PiStatusPanel } from "./components/PiStatusPanel/PiStatusPanel";
import { TaskSidebar } from "./components/FloatingPanel/TaskSidebar";
import { Onboarding } from "./components/Onboarding/Onboarding";
import { useWorkspaceStore } from "./stores/workspace-store";
import { useSettingsStore } from "./stores/settings-store";
import { usePiStatusStore } from "./stores/pi-status-store";
import { useApprovalStore } from "./stores/approval-store";
import { isFirstLaunch } from "./utils/first-launch";
import { useShortcuts } from "./shortcuts";

type Panel = "chat" | "search" | "plugins" | "automation" | "settings";
type RightPanel = "git" | "approval" | null;

function App(): React.ReactElement {
    const [activePanel, setActivePanel] = useState<Panel>("chat");
    const [showTaskSidebar, setShowTaskSidebar] = useState(true);
    const [showTerminal, setShowTerminal] = useState(false);
    const [rightPanel, setRightPanel] = useState<RightPanel>(null);
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [showCheatsheet, setShowCheatsheet] = useState(false);
    const [showOnboarding, setShowOnboarding] = useState(false);

    const { getCurrentWorkspace, workspaces } = useWorkspaceStore();
    const { loadPiConfig, openSettings } = useSettingsStore();
    const { status, refreshStatus } = usePiStatusStore();
    const pendingApprovalCount = useApprovalStore((s) => s.changes.filter((c) => c.status === "pending").length);
    const currentWorkspace = getCurrentWorkspace();

    // 启动时拉 Pi 状态
    useEffect(() => {
        void refreshStatus();
        const t = setInterval(() => void refreshStatus(), 30000);
        return () => clearInterval(t);
    }, [refreshStatus]);

    useEffect(() => {
        void loadPiConfig();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 首启检测：localStorage 没标完成 OR 当前没 workspace → 展示引导
    useEffect(() => {
        // 等 workspace 加载完（listWorkspaces 是异步）
        if (isFirstLaunch() || (!currentWorkspace && workspaces.length === 0)) {
            setShowOnboarding(true);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [workspaces.length]);

    // 全局快捷键: 全部走中央 registry (shortcuts/registry.ts)
    // useShortcuts 在模块级单例挂一个 keydown 监听, 不会重复触发
    const shortcutHandlers = useMemo(
        () => ({
            "open-command-palette": () => setPaletteOpen((v) => !v),
            "toggle-terminal": () => setShowTerminal((v) => !v),
            "open-settings": () => openSettings(),
            "new-chat": () => setActivePanel("chat"),
            "toggle-sidebar": () => setShowTaskSidebar((v) => !v),
            "show-shortcuts-question": () => setShowCheatsheet((v) => !v),
            "close-overlay": () => {
                // Esc 优先关 cheatsheet → palette → 侧栏, 都不需要就关 terminal
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

    return (
        <ErrorBoundary>
            <div className="flex h-screen bg-[#f5f5f5] text-[#1a1a1a]" role="application" aria-label="Pi 桌面应用">
                {/* 左侧图标栏 - 48px 固定宽度 */}
                <IconBar activePanel={activePanel} onPanelChange={setActivePanel} />

                {/* 左侧主面板 - 可拖动调整宽度 */}
                <ResizablePanel defaultWidth={220} minWidth={180} maxWidth={400} side="left">
                    <ProjectPanel
                        activePanel={activePanel}
                        onSendToPi={(msg: string) => {
                            if (window.piAPI && currentWorkspace) {
                                void window.piAPI.sendPrompt(currentWorkspace.id, msg);
                            }
                        }}
                    />
                </ResizablePanel>

                {/* 主聊天区域 */}
                <main className="flex-1 flex flex-col min-w-0">
                    {/* 顶部标题栏 */}
                    <header className="h-12 bg-white border-b border-[#e5e5e5] flex items-center justify-between px-4 flex-shrink-0" role="banner" aria-label="顶部操作栏">
                        <div className="flex items-center gap-2">
                            <h1 className="text-sm font-medium">
                                {activePanel === "chat" && "聊天"}
                                {activePanel === "search" && "搜索"}
                                {activePanel === "plugins" && "插件"}
                                {activePanel === "automation" && "自动化"}
                                {activePanel === "settings" && "设置"}
                            </h1>
                            <span className="text-xs text-[#999]">
                                {currentWorkspace?.name || "默认工作区"}
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setPaletteOpen(true)}
                                className="px-3 py-1.5 bg-white border border-[#e5e5e5] rounded text-xs text-[#666] hover:bg-[#f0f0f0]"
                                title="Ctrl+K"
                                aria-label="打开命令面板 (Ctrl+K)"
                                aria-keyshortcuts="Control+K"
                            >
                                <span aria-hidden="true">🔍</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setRightPanel(rightPanel === "approval" ? null : "approval")}
                                className={`relative px-3 py-1.5 rounded text-xs transition-all flex items-center gap-1.5 ${
                                    rightPanel === "approval"
                                        ? "bg-[#1a1a1a] text-white"
                                        : "bg-white border border-[#e5e5e5] text-[#666] hover:bg-[#f0f0f0]"
                                }`}
                                title="文件变更审批"
                                aria-label={`文件变更审批${pendingApprovalCount > 0 ? `, ${pendingApprovalCount} 个待审批` : ''}`}
                                aria-pressed={rightPanel === "approval"}
                            >
                                审批
                                {pendingApprovalCount > 0 && (
                                    <span
                                        className="absolute -top-1 -right-1 min-w-[16px] h-4 flex items-center justify-center rounded-full text-[9px] font-bold text-white bg-[#ef4444] px-1"
                                        aria-hidden="true"
                                    >
                                        {pendingApprovalCount}
                                    </span>
                                )}
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowTerminal((v) => !v)}
                                className={`px-3 py-1.5 rounded text-xs transition-all ${
                                    showTerminal
                                        ? "bg-[#1a1a1a] text-white"
                                        : "bg-white border border-[#e5e5e5] text-[#666] hover:bg-[#f0f0f0]"
                                }`}
                                title="终端 (Ctrl+`)"
                                aria-label="切换终端"
                                aria-pressed={showTerminal}
                            >
                                <span aria-hidden="true">💻</span> 终端
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowTaskSidebar((v) => !v)}
                                className={`px-3 py-1.5 rounded text-xs transition-all ${
                                    showTaskSidebar
                                        ? "bg-[#1a1a1a] text-white"
                                        : "bg-white border border-[#e5e5e5] text-[#666] hover:bg-[#f0f0f0]"
                                }`}
                                aria-label="切换任务面板"
                                aria-pressed={showTaskSidebar}
                            >
                                任务面板
                            </button>
                            <button
                                type="button"
                                onClick={openSettings}
                                className="px-3 py-1.5 bg-white border border-[#e5e5e5] rounded text-xs text-[#666] hover:bg-[#f0f0f0]"
                                aria-label="打开设置"
                            >
                                设置
                            </button>
                        </div>
                    </header>

                    {/* 主内容 */}
                    <div className="flex-1 overflow-hidden flex flex-col">
                        {activePanel === "chat" ? (
                            <>
                                <div className="flex-1 overflow-hidden">
                                    <ChatView />
                                </div>
                                {/* 终端面板 (可折叠) */}
                                {showTerminal && (
                                    <TerminalPanel
                                        isOpen={showTerminal}
                                        workspacePath={currentWorkspace?.path}
                                        onClose={() => setShowTerminal(false)}
                                    />
                                )}
                            </>
                        ) : activePanel === "plugins" ? (
                            <div className="flex-1 overflow-hidden">
                                <SkillsPanel />
                            </div>
                        ) : (
                            <div className="flex-1 flex items-center justify-center text-[#999] text-sm">
                                {activePanel === "search" && "🔍 全局搜索 (Ctrl+K)"}
                                {activePanel === "automation" && "🤖 自动化 (v1.1)"}
                                {activePanel === "settings" && "⚙️ 设置 (点右上角'设置'按钮)"}
                            </div>
                        )}
                    </div>

                    {/* 状态栏 */}
                    <footer className="h-7 bg-white border-t border-[#e5e5e5] flex items-center justify-between px-4 text-xs text-[#999] flex-shrink-0" role="contentinfo" aria-label="状态栏">
                        <div className="flex items-center gap-3">
                            <span className="flex items-center gap-1.5">
                                <span className={`w-1.5 h-1.5 rounded-full ${status?.installed ? "bg-[#10b981]" : "bg-[#ef4444]"}`} />
                                <span>{status?.installed ? "已连接" : "未连接"}</span>
                            </span>
                            <span>{currentWorkspace?.path ?? ""}</span>
                        </div>
                        <span>Pi Desktop v0.1.0</span>
                    </footer>
                </main>

                {/* 右侧浮窗 */}
                {rightPanel === "approval" && (
                    <ApprovalPanel
                        isOpen={rightPanel === "approval"}
                        onToggle={() => setRightPanel(null)}
                    />
                )}

                {/* 右侧任务侧边栏 */}
                <TaskSidebar
                    isVisible={showTaskSidebar}
                    onToggle={() => setShowTaskSidebar(false)}
                />

                {/* 设置弹窗 */}
                <SettingsPanel />

                {/* Command Palette 模态 */}
                <CommandPalette
                    isOpen={paletteOpen}
                    onClose={() => setPaletteOpen(false)}
                    workspacePath={currentWorkspace?.path ?? ""}
                />

                {/* 快捷键速查 (按 ? 唤起) */}
                <ShortcutsCheatsheet
                    isOpen={showCheatsheet}
                    onClose={() => setShowCheatsheet(false)}
                />

                {/* Pi 状态浮窗 (只在有问题时显示) */}
                {!status?.installed && <PiStatusPanel />}

                {/* 首启引导 */}
                {showOnboarding && (
                    <Onboarding onComplete={() => setShowOnboarding(false)} />
                )}
            </div>
        </ErrorBoundary>
    );
}

export default App;
