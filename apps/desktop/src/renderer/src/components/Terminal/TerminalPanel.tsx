// TerminalPanel (M4 Task M4-3)
// 多 tab 终端面板, 集成 xterm.js + node-pty

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { isIpcError } from "@shared";
import type { TerminalCommandMode } from "../../utils/terminal-command";
import { useSettingsStore } from "../../stores/settings-store";
import { getEditorFontSize } from "../../utils/theme";
import "@xterm/xterm/css/xterm.css";

const MAX_OUTPUT_BUFFER = 20000;
const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");

interface Tab {
    id: string;
    title: string;
    terminal: Terminal;
    fitAddon: FitAddon;
    containerRef: React.RefObject<HTMLDivElement | null>;
    cwd: string;
    output: string;
}

interface TerminalPanelProps {
    workspacePath?: string;
    isOpen: boolean;
    onClose: () => void;
    initialCommand?: { command: string; mode?: TerminalCommandMode; nonce: number } | null;
    displayMode?: "overlay" | "embedded";
}

export function TerminalPanel({
    workspacePath,
    isOpen,
    onClose,
    initialCommand,
    displayMode = "overlay",
}: TerminalPanelProps): React.ReactElement | null {
    const { t } = useTranslation();
    const [tabs, setTabs] = useState<Tab[]>([]);
    const tabsRef = useRef<Tab[]>([]);
    const pendingOutputRef = useRef(new Map<string, string>());
    const outputFrameRef = useRef<number | null>(null);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [copiedOutput, setCopiedOutput] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);
    const [inputError, setInputError] = useState<string | null>(null);
    const [copyError, setCopyError] = useState<string | null>(null);
    const settingsFontSize = useSettingsStore((state) => state.settings.fontSize);
    const terminalFontSize = getEditorFontSize(settingsFontSize);

    const flushPendingOutput = useCallback((): void => {
        outputFrameRef.current = null;
        if (pendingOutputRef.current.size === 0) return;
        const pending = new Map(pendingOutputRef.current);
        pendingOutputRef.current.clear();
        setTabs((prev) => prev.map((tab) => {
            const output = pending.get(tab.id);
            return output === undefined
                ? tab
                : { ...tab, output: `${tab.output}${output}`.slice(-MAX_OUTPUT_BUFFER) };
        }));
    }, []);

    const queueOutputUpdate = useCallback((id: string, data: string): void => {
        pendingOutputRef.current.set(id, `${pendingOutputRef.current.get(id) ?? ""}${data}`);
        if (outputFrameRef.current !== null) return;
        outputFrameRef.current = window.requestAnimationFrame(flushPendingOutput);
    }, [flushPendingOutput]);

    const createTab = async (): Promise<string | null> => {
        if (!window.piAPI) return null;
        setCreateError(null);
        const id = `term_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const containerRef = React.createRef<HTMLDivElement>();

        const term = new Terminal({
            cursorBlink: true,
            fontFamily: 'Menlo, "Cascadia Code", Consolas, monospace',
            fontSize: terminalFontSize,
            theme: { background: "#ffffff" },
        });
        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);

        const result = await window.piAPI.createTerminal({
            id,
            cwd: workspacePath,
            cols: term.cols,
            rows: term.rows,
        });
        if (isIpcError(result)) {
            term.dispose();
            setCreateError(result.fallback);
            return null;
        }
        const { id: actualId, cwd: actualCwd } = result;

        term.onData((data: string) => {
            void window.piAPI.terminalInput(actualId, data)
                .then((result) => {
                    if (isIpcError(result)) setInputError(result.fallback);
                    else setInputError(null);
                })
                .catch((error: unknown) => {
                    setInputError(`发送终端输入失败: ${error instanceof Error ? error.message : String(error)}`);
                });
        });

        const unsubOut = window.piAPI.onTerminalOutput(actualId, (data: string) => {
            term.write(data);
            queueOutputUpdate(actualId, data);
        });
        const unsubExit = window.piAPI.onTerminalExit(actualId, (code: number | null) => {
            const message = `\r\n\x1b[33m[Process exited with code ${code}]\x1b[0m\r\n`;
            term.write(message);
            queueOutputUpdate(actualId, message);
        });

        // Stash unsubs for cleanup in closeTab (xterm has no onDispose event)
        (term as unknown as { _unsubs: Array<() => void> })._unsubs = [unsubOut, unsubExit];

        // Cleanup happens in closeTab (term.dispose() + IPC close)

        const newTab: Tab = {
            id: actualId,
            title: `Terminal ${tabs.length + 1}`,
            terminal: term,
            fitAddon,
            containerRef,
            cwd: actualCwd || workspacePath || "",
            output: "",
        };
        setTabs((prev) => [...prev, newTab]);
        setActiveId(actualId);
        return actualId;
    };

    const closeTab = (id: string) => {
        pendingOutputRef.current.delete(id);
        const tab = tabs.find((t) => t.id === id);
        if (tab) {
            (tab.terminal as unknown as { _unsubs?: Array<() => void> })._unsubs?.forEach((unsub) => unsub());
            tab.terminal.dispose();
            void window.piAPI?.closeTerminal(id);
        }
        setTabs((prev) => prev.filter((t) => t.id !== id));
        if (activeId === id) {
            const remaining = tabs.filter((t) => t.id !== id);
            setActiveId(remaining.length > 0 ? remaining[0].id : null);
        }
    };

    useEffect(() => {
        tabsRef.current = tabs;
    }, [tabs]);

    useEffect(() => {
        if (!isOpen) return;
        for (const tab of tabsRef.current) {
            tab.terminal.options.fontSize = terminalFontSize;
            try {
                tab.fitAddon.fit();
                void window.piAPI?.terminalResize(tab.id, tab.terminal.cols, tab.terminal.rows);
            } catch {
                // xterm can throw while a hidden tab has not been opened yet; it will fit on activation.
            }
        }
    }, [isOpen, terminalFontSize]);

    useEffect(() => {
        const pendingOutput = pendingOutputRef.current;
        return () => {
            for (const tab of tabsRef.current) {
                (tab.terminal as unknown as { _unsubs?: Array<() => void> })._unsubs?.forEach((unsub) => unsub());
                tab.terminal.dispose();
                void window.piAPI?.closeTerminal(tab.id);
            }
            if (outputFrameRef.current !== null) {
                window.cancelAnimationFrame(outputFrameRef.current);
                outputFrameRef.current = null;
            }
            pendingOutput.clear();
            tabsRef.current = [];
        };
    }, []);

    const activeTab = tabs.find((t) => t.id === activeId);

    const clearActiveTerminal = (): void => {
        if (!activeTab) return;
        pendingOutputRef.current.delete(activeTab.id);
        activeTab.terminal.clear();
        setTabs((prev) => prev.map((tab) => tab.id === activeTab.id ? { ...tab, output: "" } : tab));
        setCopiedOutput(false);
        setCopyError(null);
    };

    const copyActiveOutput = async (): Promise<void> => {
        if (!activeTab?.output) return;
        try {
            await navigator.clipboard.writeText(stripAnsi(activeTab.output));
        } catch (error) {
            setCopiedOutput(false);
            setCopyError(`复制终端输出失败: ${error instanceof Error ? error.message : String(error)}`);
            return;
        }
        setCopyError(null);
        setCopiedOutput(true);
        setTimeout(() => setCopiedOutput(false), 1400);
    };

    const sendCommand = async (command: string, mode: TerminalCommandMode = "run"): Promise<void> => {
        const trimmed = command.trim();
        if (!trimmed || !window.piAPI) return;
        setInputError(null);
        const targetId = activeId ?? await createTab();
        if (!targetId) {
            setCreateError((current) => current ?? "终端不可用，命令未发送。");
            return;
        }
        setActiveId(targetId);
        try {
            const result = await window.piAPI.terminalInput(targetId, mode === "draft" ? trimmed : `${trimmed}\n`);
            if (isIpcError(result)) {
                setInputError(result.fallback);
            }
        } catch (error) {
            setInputError(`发送终端输入失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    };

    // Resize active tab when panel resizes
    useEffect(() => {
        if (!isOpen || !activeTab) return;
        const opened = (activeTab.terminal as unknown as { _opened?: boolean })._opened;
        if (!opened && activeTab.containerRef.current) {
            activeTab.terminal.open(activeTab.containerRef.current);
            (activeTab.terminal as unknown as { _opened?: boolean })._opened = true;
        }
        const resize = () => {
            try {
                activeTab.fitAddon.fit();
                void window.piAPI?.terminalResize(activeTab.id, activeTab.terminal.cols, activeTab.terminal.rows)
                    .then((result) => {
                        if (isIpcError(result)) setInputError(result.fallback);
                    })
                    .catch((error: unknown) => {
                        setInputError(`调整终端尺寸失败: ${error instanceof Error ? error.message : String(error)}`);
                    });
            } catch (error) {
                setInputError(`调整终端尺寸失败: ${error instanceof Error ? error.message : String(error)}`);
            }
        };
        const obs = new ResizeObserver(resize);
        if (activeTab.containerRef.current) obs.observe(activeTab.containerRef.current);
        return () => obs.disconnect();
    }, [activeTab, isOpen]);

    useEffect(() => {
        if (!isOpen || !initialCommand?.command) return;
        void sendCommand(initialCommand.command, initialCommand.mode ?? "run");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialCommand?.nonce, isOpen]);

    if (!isOpen) return null;

    return (
        <div
            className={`${displayMode === "embedded" ? "h-full" : "h-64 border-t border-[var(--mm-border)]"} flex flex-col bg-[var(--mm-bg-panel)]`}
            data-testid="terminal-panel"
        >
            {/* Tab bar */}
            <div className="flex items-center gap-2 px-2 py-1 border-b border-[var(--mm-border)] bg-[var(--mm-bg-panel)]">
                <div className="flex items-center gap-1 flex-1 overflow-x-auto">
                    {tabs.map((t) => (
                        <div
                            key={t.id}
                            className={`flex items-center gap-2 px-3 py-1 text-xs rounded transition-colors ${
                                activeId === t.id
                                    ? "bg-[var(--mm-bg-panel)] text-[var(--mm-text-primary)] border border-[var(--mm-border)]"
                                    : "text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-hover)]"
                            }`}
                        >
                            <button
                                type="button"
                                onClick={() => setActiveId(t.id)}
                                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                title={`${t.title} - ${t.cwd || "workspace"}`}
                            >
                                <span className="font-mono">▣</span>
                                <span className="truncate">{t.title}</span>
                            </button>
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    closeTab(t.id);
                                }}
                                className="text-[var(--mm-text-tertiary)] hover:text-red-500 ml-1"
                                aria-label={`关闭终端 ${t.title}`}
                                title={`关闭 ${t.title}`}
                            >
                                ✕
                            </button>
                        </div>
                    ))}
                </div>
                {activeTab && (
                    <div className="hidden min-w-0 max-w-[32%] items-center gap-1 rounded border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-2 py-1 text-[10px] text-[var(--mm-text-tertiary)] md:flex">
                        <span className="shrink-0 text-[#aaa]">cwd</span>
                        <span className="truncate font-mono" title={activeTab.cwd || "workspace"}>
                            {activeTab.cwd || "workspace"}
                        </span>
                    </div>
                )}
                <button
                    type="button"
                    onClick={() => void copyActiveOutput()}
                    disabled={!activeTab?.output}
                    className="rounded px-2 py-1 text-xs text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-hover)] disabled:cursor-not-allowed disabled:text-[var(--mm-text-tertiary)] disabled:hover:bg-transparent"
                    title={activeTab?.output ? "复制当前终端最近输出" : "当前终端暂无输出"}
                >
                    {copiedOutput ? "已复制" : "复制输出"}
                </button>
                <button
                    type="button"
                    onClick={clearActiveTerminal}
                    disabled={!activeTab}
                    className="rounded px-2 py-1 text-xs text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-hover)] disabled:cursor-not-allowed disabled:text-[var(--mm-text-tertiary)] disabled:hover:bg-transparent"
                    title="清空当前终端屏幕和输出缓存"
                >
                    清屏
                </button>
                <button
                    type="button"
                    onClick={() => void createTab()}
                    className="text-xs px-2 py-1 text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-hover)] rounded"
                    title="新建终端"
                >
                    +
                </button>
                {displayMode === "overlay" ? (
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-xs px-2 py-1 text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-hover)] rounded ml-1"
                        title="收起终端"
                    >
                        ✕
                    </button>
                ) : null}
            </div>
            <div className="border-b border-[var(--mm-border)] px-3 py-1 text-xs leading-5 text-[var(--mm-text-secondary)]" role="note">
                {t("terminal.trustBoundary", { defaultValue: "终端由你直接控制，拥有本机完整权限；Agent 工具权限不会限制此终端" })}
            </div>
            {initialCommand?.mode === "draft" && (
                <div className="border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
                    高风险命令已填入终端但未执行，请确认后手动按 Enter。
                </div>
            )}
            {createError && (
                <div className="border-b border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700" role="alert">
                    {createError}
                </div>
            )}
            {inputError && (
                <div className="border-b border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700" role="alert">
                    {inputError}
                </div>
            )}
            {copyError && (
                <div className="border-b border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700" role="alert">
                    {copyError}
                </div>
            )}

            {/* Active terminal */}
            <div className="flex-1 relative">
                {tabs.map((t) => (
                    <div
                        key={t.id}
                        ref={t.containerRef}
                        className="absolute inset-0 p-1"
                        style={{ display: t.id === activeId ? "block" : "none" }}
                    />
                ))}
                {tabs.length === 0 && (
                    <div
                        className="flex flex-col items-center justify-center h-full text-center px-4"
                        role="status"
                    >
                        <svg className="w-10 h-10 mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <p className="text-sm text-[var(--mm-text-primary)] mb-1 font-medium">
                            暂无终端
                        </p>
                        <p className="text-xs text-[var(--mm-text-tertiary)] mb-3">
                            按 <kbd className="px-1.5 py-0.5 bg-[var(--mm-bg-hover)] rounded text-[10px] font-mono">Ctrl + `</kbd> 或点下面按钮新建
                        </p>
                        <button
                            onClick={() => void createTab()}
                            className="px-4 py-2 bg-[#1a1a1a] text-white rounded hover:bg-[#333] transition-colors text-sm"
                        >
                            + 新建终端
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

function stripAnsi(value: string): string {
    return value.replace(ANSI_ESCAPE_PATTERN, "");
}
