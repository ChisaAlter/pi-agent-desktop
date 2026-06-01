// CommandPalette (M2 Task M2-5)
// Ctrl+K 调起的模态: 文件搜索 / 历史搜索 / 内置命令 三模式

import React, { useEffect, useState, useRef } from "react";
import { fuzzyScore } from "../../utils/fuzzy-match";
import { useSessionStore } from "../../stores/session-store";

export type CommandMode = "file" | "history" | "cmd";

interface CommandPaletteProps {
    isOpen: boolean;
    onClose: () => void;
    workspacePath: string;
    onSelectFile?: (path: string) => void;
    onSelectHistory?: (sessionId: string) => void;
    onRunCommand?: (cmdId: string) => void;
}

const COMMANDS = [
    { id: "new_chat", label: "新建对话", hint: "Ctrl+N" },
    { id: "open_skills", label: "打开 Skills", hint: "Ctrl+Shift+S" },
    { id: "open_settings", label: "打开设置", hint: "Ctrl+," },
    { id: "switch_workspace", label: "切换 workspace", hint: "Ctrl+P" },
    { id: "toggle_terminal", label: "切换终端", hint: "Ctrl+`" },
];

export function CommandPalette({
    isOpen,
    onClose,
    workspacePath,
    onSelectFile,
    onSelectHistory,
    onRunCommand,
}: CommandPaletteProps): React.ReactElement | null {
    const [query, setQuery] = useState("");
    const [mode, setMode] = useState<CommandMode>("file");
    const [activeIdx, setActiveIdx] = useState(0);
    const [files, setFiles] = useState<string[]>([]);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen) {
            setQuery("");
            setMode("file");
            setActiveIdx(0);
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [isOpen]);

    useEffect(() => {
        if (mode === "file" && window.piAPI?.filesList) {
            window.piAPI.filesList(workspacePath).then(setFiles);
        }
    }, [mode, workspacePath, isOpen]);

    useEffect(() => {
        setActiveIdx(0);
    }, [mode, query]);

    if (!isOpen) return null;

    // 根据 mode 决定 results
    let results: Array<{ id: string; primary: string; secondary?: string; onSelect: () => void }> = [];

    if (mode === "file") {
        results = files
            .map((f) => ({ f, s: fuzzyScore(f, query) }))
            .filter((x) => x.s > 0)
            .sort((a, b) => b.s - a.s)
            .slice(0, 20)
            .map((x) => ({
                id: x.f,
                primary: x.f,
                onSelect: () => onSelectFile?.(x.f),
            }));
    } else if (mode === "cmd") {
        results = COMMANDS
            .map((c) => ({ c, s: fuzzyScore(c.label, query) }))
            .filter((x) => x.s > 0)
            .sort((a, b) => b.s - a.s)
            .map((x) => ({
                id: x.c.id,
                primary: x.c.label,
                secondary: x.c.hint,
                onSelect: () => onRunCommand?.(x.c.id),
            }));
    } else if (mode === "history") {
        // 历史搜索 (M2-6): 跨 session 搜消息内容
        const sessions = useSessionStore.getState().sessions;
        const q = query.toLowerCase();
        const all: Array<{ id: string; primary: string; secondary?: string; onSelect: () => void }> = [];
        for (const s of sessions) {
            for (const m of s.messages) {
                if (q && !m.content.toLowerCase().includes(q)) continue;
                all.push({
                    id: `${s.id}_${m.id}`,
                    primary: m.content.length > 80 ? m.content.slice(0, 80) + "..." : m.content,
                    secondary: `${s.title} · ${m.role === "user" ? "你" : "Pi"}`,
                    onSelect: () => onSelectHistory?.(s.id),
                });
                if (all.length >= 30) break;
            }
            if (all.length >= 30) break;
        }
        // 按 score 排序
        results = all
            .map((r) => ({ r, s: fuzzyScore(r.primary, query) }))
            .sort((a, b) => b.s - a.s)
            .slice(0, 20)
            .map((x) => x.r);
    }

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIdx((i) => Math.min(i + 1, results.length - 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIdx((i) => Math.max(i - 1, 0));
        } else if (e.key === "Enter" && results[activeIdx]) {
            e.preventDefault();
            results[activeIdx].onSelect();
            onClose();
        } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
        } else if ((e.ctrlKey || e.metaKey) && e.key === "k") {
            e.preventDefault();
            onClose();
        } else if (e.key === "Tab") {
            // Tab 切换 mode
            e.preventDefault();
            const modes: CommandMode[] = ["file", "history", "cmd"];
            const idx = modes.indexOf(mode);
            setMode(modes[(idx + 1) % modes.length]);
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-start justify-center pt-32 bg-black/30 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="bg-white rounded-2xl shadow-2xl w-[640px] max-h-[500px] flex flex-col overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Mode tabs */}
                <div className="flex items-center gap-1 px-3 pt-3 border-b border-[#e5e5e5]">
                    {(["file", "history", "cmd"] as const).map((m) => (
                        <button
                            key={m}
                            onClick={() => setMode(m)}
                            className={`px-3 py-1.5 text-sm rounded-t-md transition-colors ${
                                mode === m
                                    ? "bg-[#1a1a1a] text-white"
                                    : "text-[#666] hover:bg-[#f5f5f5]"
                            }`}
                        >
                            {m === "file" ? "文件" : m === "history" ? "历史" : "命令"}
                        </button>
                    ))}
                </div>

                {/* Search input */}
                <div className="p-3">
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={onKeyDown}
                        placeholder={
                            mode === "file"
                                ? "搜索文件..."
                                : mode === "history"
                                ? "搜索历史..."
                                : "搜索命令..."
                        }
                        className="w-full px-3 py-2 bg-[#f5f5f5] border border-[#e5e5e5] rounded-lg text-sm focus:outline-none focus:border-[#1a1a1a]"
                    />
                </div>

                {/* Results */}
                <div className="flex-1 overflow-auto px-1 pb-2 min-h-[200px]">
                    {results.length === 0 ? (
                        <div className="px-4 py-8 text-center text-sm text-[#999]">
                            {query
                                ? "无匹配"
                                : mode === "history"
                                ? "无历史对话 (开始一个新对话试试)"
                                : mode === "file"
                                ? "输入文件名搜索"
                                : "输入命令名搜索"}
                        </div>
                    ) : (
                        results.map((r, i) => (
                            <button
                                key={r.id}
                                onClick={() => {
                                    r.onSelect();
                                    onClose();
                                }}
                                className={`w-full text-left px-3 py-2 rounded-md text-sm flex items-center gap-2 transition-colors ${
                                    i === activeIdx
                                        ? "bg-[#f0f0f0]"
                                        : "hover:bg-[#f5f5f5]"
                                }`}
                            >
                                <span className="flex-1 truncate text-[#1a1a1a]">
                                    {mode === "file" && <span className="text-[#999] mr-2">📄</span>}
                                    {r.primary}
                                </span>
                                {r.secondary && (
                                    <span className="text-xs text-[#999] font-mono">{r.secondary}</span>
                                )}
                            </button>
                        ))
                    )}
                </div>

                {/* Footer hint */}
                <div className="px-3 py-2 border-t border-[#e5e5e5] text-xs text-[#999] flex items-center gap-3">
                    <span>
                        <kbd className="px-1 py-0.5 bg-[#f5f5f5] rounded">↑↓</kbd> 选择
                    </span>
                    <span>
                        <kbd className="px-1 py-0.5 bg-[#f5f5f5] rounded">↵</kbd> 确认
                    </span>
                    <span>
                        <kbd className="px-1 py-0.5 bg-[#f5f5f5] rounded">Tab</kbd> 切模式
                    </span>
                    <span>
                        <kbd className="px-1 py-0.5 bg-[#f5f5f5] rounded">Esc</kbd> 关闭
                    </span>
                </div>
            </div>
        </div>
    );
}
