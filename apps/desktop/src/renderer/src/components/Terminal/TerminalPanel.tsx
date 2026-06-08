// TerminalPanel (M4 Task M4-3)
// 多 tab 终端面板, 集成 xterm.js + node-pty

import React, { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface Tab {
    id: string;
    terminalId?: string;
    title: string;
    terminal: Terminal;
    fitAddon: FitAddon;
    containerRef: React.RefObject<HTMLDivElement | null>;
    cwd: string;
    initialized: boolean;
    unsubs: Array<() => void>;
}

interface TerminalResource {
    terminalId: string;
    unsubs: Array<() => void>;
}

interface TerminalPanelProps {
    workspacePath?: string;
    agentId?: string;
    isOpen: boolean;
    onClose: () => void;
}

export function TerminalPanel({ workspacePath, agentId, isOpen, onClose }: TerminalPanelProps): React.ReactElement | null {
    const [tabs, setTabs] = useState<Tab[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const resourcesRef = useRef(new Map<string, TerminalResource>());
    const closedTabIdsRef = useRef(new Set<string>());

    const createTab = () => {
        if (!window.piAPI) return;
        const id = `term_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const containerRef = React.createRef<HTMLDivElement>();

        const term = new Terminal({
            cursorBlink: true,
            fontFamily: 'Menlo, "Cascadia Code", Consolas, monospace',
            fontSize: 13,
            theme: { background: "#ffffff" },
        });
        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);

        const newTab: Tab = {
            id,
            title: `Terminal ${tabs.length + 1}`,
            terminal: term,
            fitAddon,
            containerRef,
            cwd: workspacePath ?? "",
            initialized: false,
            unsubs: [],
        };
        setTabs((prev) => [...prev, newTab]);
        setActiveId(id);
    };

    const closeTab = (id: string) => {
        closedTabIdsRef.current.add(id);
        const tab = tabs.find((t) => t.id === id);
        const resource = resourcesRef.current.get(id);
        resourcesRef.current.delete(id);
        if (tab) {
            for (const unsub of resource?.unsubs ?? tab.unsubs) unsub();
            tab.terminal.dispose();
            void window.piAPI?.closeTerminal(resource?.terminalId ?? tab.terminalId ?? id);
        }
        setTabs((prev) => prev.filter((t) => t.id !== id));
        if (activeId === id) {
            const remaining = tabs.filter((t) => t.id !== id);
            setActiveId(remaining.length > 0 ? remaining[0].id : null);
        }
    };

    const activeTab = tabs.find((t) => t.id === activeId);

    useEffect(() => {
        for (const tab of tabs) {
            const element = tab.containerRef.current;
            if (tab.initialized || !element || !window.piAPI) continue;

            tab.terminal.open(element);
            tab.fitAddon.fit();
            setTabs((prev) =>
                prev.map((item) =>
                    item.id === tab.id ? { ...item, initialized: true } : item,
                ),
            );

            void (async () => {
                const { id: actualId } = await window.piAPI.createTerminal({
                    id: tab.id,
                    cwd: workspacePath,
                    agentId,
                    cols: tab.terminal.cols,
                    rows: tab.terminal.rows,
                });

                if (closedTabIdsRef.current.has(tab.id)) {
                    void window.piAPI?.closeTerminal(actualId);
                    return;
                }

                const dataDisposable = tab.terminal.onData((data: string) => {
                    void window.piAPI.terminalInput(actualId, data);
                });
                const unsubOut = window.piAPI.onTerminalOutput(actualId, (data: string) => {
                    tab.terminal.write(data);
                });
                const unsubExit = window.piAPI.onTerminalExit(actualId, (code: number | null) => {
                    tab.terminal.write(`\r\n\x1b[33m[Process exited with code ${code}]\x1b[0m\r\n`);
                });
                const unsubs = [
                    () => dataDisposable?.dispose?.(),
                    unsubOut,
                    unsubExit,
                ];
                resourcesRef.current.set(tab.id, { terminalId: actualId, unsubs });

                if (closedTabIdsRef.current.has(tab.id)) {
                    for (const unsub of unsubs) unsub();
                    resourcesRef.current.delete(tab.id);
                    void window.piAPI?.closeTerminal(actualId);
                    return;
                }

                setTabs((prev) =>
                    prev.map((item) =>
                        item.id === tab.id ? { ...item, terminalId: actualId, unsubs } : item,
                    ),
                );
            })();
        }
    }, [agentId, tabs, workspacePath]);

    // Resize active tab when panel resizes
    useEffect(() => {
        if (!activeTab) return;
        const resize = () => {
            try {
                activeTab.fitAddon.fit();
                void window.piAPI?.terminalResize(activeTab.id, activeTab.terminal.cols, activeTab.terminal.rows);
            } catch {
                // ignore
            }
        };
        const obs = new ResizeObserver(resize);
        if (activeTab.containerRef.current) obs.observe(activeTab.containerRef.current);
        return () => obs.disconnect();
    }, [activeTab]);

    if (!isOpen) return null;

    return (
        <div className="border-t border-[#e5e5e5] bg-white flex flex-col h-64">
            {/* Tab bar */}
            <div className="flex items-center px-2 py-1 border-b border-[#e5e5e5] bg-[#fafafa]">
                <div className="flex items-center gap-1 flex-1 overflow-x-auto">
                    {tabs.map((t) => (
                        <div
                            key={t.id}
                            className={`flex items-center gap-2 px-3 py-1 text-xs rounded transition-colors ${
                                activeId === t.id
                                    ? "bg-white text-[#1a1a1a] border border-[#e5e5e5]"
                                    : "text-[#666] hover:bg-[#f0f0f0]"
                            }`}
                        >
                            <button
                                type="button"
                                onClick={() => setActiveId(t.id)}
                                className="flex min-w-0 items-center gap-2"
                            >
                                <span className="font-mono">▣</span>
                                <span>{t.title}</span>
                            </button>
                            <button
                                type="button"
                                aria-label={`关闭终端 ${t.title}`}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    closeTab(t.id);
                                }}
                                className="text-[#999] hover:text-red-500 ml-1"
                            >
                                ✕
                            </button>
                        </div>
                    ))}
                </div>
                <button
                    onClick={() => void createTab()}
                    className="text-xs px-2 py-1 text-[#666] hover:bg-[#e5e5e5] rounded"
                >
                    +
                </button>
                <button
                    onClick={onClose}
                    className="text-xs px-2 py-1 text-[#666] hover:bg-[#e5e5e5] rounded ml-1"
                >
                    ✕
                </button>
            </div>

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
                        <p className="text-sm text-[#1a1a1a] mb-1 font-medium">
                            暂无终端
                        </p>
                        <p className="text-xs text-[#999] mb-3">
                            按 <kbd className="px-1.5 py-0.5 bg-[#f0f0f0] rounded text-[10px] font-mono">Ctrl + `</kbd> 或点下面按钮新建
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
