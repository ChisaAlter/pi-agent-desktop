// CommandPalette (M2 Task M2-5)
// Ctrl+K 调起的模态: 文件搜索 / 历史搜索 / 内置命令 三模式
// 可用度-D: 文件搜索失败 → 友好错误 + 重试按钮 (a11y: role="alert")
// v1.0.4: 用户可见文案 + 命令 label 走 t()

import React, { useEffect, useState, useRef, useCallback } from "react";
import { fuzzyScore } from "../../utils/fuzzy-match";
import { useSessionStore } from "../../stores/session-store";
import { useI18n } from "../../i18n";
import type { FileEntry } from "@shared";

export type CommandMode = "file" | "history" | "cmd";

interface CommandPaletteProps {
    isOpen: boolean;
    onClose: () => void;
    workspacePath: string;
    onSelectFile?: (path: string) => void;
    onSelectHistory?: (sessionId: string) => void;
    onRunCommand?: (cmdId: string) => void;
}

interface CommandDef {
    id: string;
    labelKey: string;
    hint: string;
}

const COMMANDS: readonly CommandDef[] = Object.freeze([
    { id: "new_chat", labelKey: "commandPalette.commands.new_chat", hint: "Ctrl+N" },
    { id: "open_skills", labelKey: "commandPalette.commands.open_skills", hint: "Ctrl+Shift+S" },
    { id: "open_settings", labelKey: "commandPalette.commands.open_settings", hint: "Ctrl+," },
    { id: "switch_workspace", labelKey: "commandPalette.commands.switch_workspace", hint: "Ctrl+P" },
    { id: "toggle_terminal", labelKey: "commandPalette.commands.toggle_terminal", hint: "Ctrl+`" },
]);

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
    const [files, setFiles] = useState<FileEntry[]>([]);
    const [filesLoading, setFilesLoading] = useState(false);
    const [filesError, setFilesError] = useState<string | null>(null);
    const [filesReloadKey, setFilesReloadKey] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);
    const { t } = useI18n();

    useEffect(() => {
        if (isOpen) {
            setQuery("");
            setMode("file");
            setActiveIdx(0);
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [isOpen]);

    // 文件搜索：loading / 错误 / 重试 (可用度-D)
    useEffect(() => {
        if (mode !== "file" || !window.piAPI?.filesList || !isOpen) return;
        let cancelled = false;
        setFilesLoading(true);
        setFilesError(null);
        window.piAPI
            .filesList(workspacePath)
            .then((list) => {
                if (cancelled) return;
                setFiles(list);
                setFilesLoading(false);
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                setFilesError(err instanceof Error ? err.message : String(err));
                setFilesLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [mode, workspacePath, isOpen, filesReloadKey]);

    useEffect(() => {
        setActiveIdx(0);
    }, [mode, query]);

    const retryFileSearch = useCallback(() => {
        setFilesReloadKey((k) => k + 1);
    }, []);

    if (!isOpen) return null;

    // 根据 mode 决定 results
    let results: Array<{ id: string; primary: string; secondary?: string; onSelect: () => void }> = [];

    if (mode === "file") {
        results = files
            .map((f) => ({ f, s: fuzzyScore(f.path, query) }))
            .filter((x) => x.s > 0)
            .sort((a, b) => b.s - a.s)
            .slice(0, 20)
            .map((x) => ({
                id: x.f.path,
                primary: x.f.path,
                onSelect: () => onSelectFile?.(x.f.path),
            }));
    } else if (mode === "cmd") {
        results = COMMANDS
            .map((c) => ({ c, s: fuzzyScore(t(c.labelKey), query) }))
            .filter((x) => x.s > 0)
            .sort((a, b) => b.s - a.s)
            .map((x) => ({
                id: x.c.id,
                primary: t(x.c.labelKey),
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
                    secondary: t("commandPalette.historyLine", {
                        title: s.title,
                        role: m.role === "user" ? t("messageBubble.userAuthor") : t("messageBubble.piAuthor"),
                    }),
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

    const handleClose = () => onClose();

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
            handleClose();
        } else if (e.key === "Escape") {
            e.preventDefault();
            handleClose();
        } else if ((e.ctrlKey || e.metaKey) && e.key === "k") {
            e.preventDefault();
            handleClose();
        } else if (e.key === "Tab") {
            e.preventDefault();
            const modes: CommandMode[] = ["file", "history", "cmd"];
            const idx = modes.indexOf(mode);
            setMode(modes[(idx + 1) % modes.length]);
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-start justify-center pt-32 bg-black/30 backdrop-blur-sm"
            onClick={handleClose}
        >
            <div
                ref={dialogRef}
                className="bg-white rounded-2xl shadow-2xl w-[640px] max-h-[500px] flex flex-col overflow-hidden"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label={t("commandPalette.aria.root")}
            >
                {/* Mode tabs */}
                <div
                    className="flex items-center gap-1 px-3 pt-3 border-b border-[#e5e5e5]"
                    role="tablist"
                    aria-label={t("commandPalette.aria.mode")}
                >
                    {(["file", "history", "cmd"] as const).map((m) => {
                        const isActive = mode === m;
                        return (
                            <button
                                key={m}
                                type="button"
                                role="tab"
                                aria-selected={isActive}
                                aria-controls={`command-panel-tabpanel-${m}`}
                                id={`command-panel-tab-${m}`}
                                onClick={() => setMode(m)}
                                className={`px-3 py-1.5 text-sm rounded-t-md transition-colors ${
                                    isActive
                                        ? "bg-[#1a1a1a] text-white"
                                        : "text-[#666] hover:bg-[#f5f5f5]"
                                }`}
                            >
                                {t(`commandPalette.modes.${m === "cmd" ? "command" : m}`)}
                            </button>
                        );
                    })}
                </div>

                {/* Search input */}
                <div className="p-3">
                    <label htmlFor="command-palette-search" className="sr-only">
                        {t("common.search")}
                    </label>
                    <input
                        id="command-palette-search"
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={onKeyDown}
                        placeholder={
                            mode === "file"
                                ? t("commandPalette.placeholders.file")
                                : mode === "history"
                                ? t("commandPalette.placeholders.history")
                                : t("commandPalette.placeholders.command")
                        }
                        className="w-full px-3 py-2 bg-[#f5f5f5] border border-[#e5e5e5] rounded-lg text-sm focus:outline-none focus:border-[#1a1a1a]"
                        aria-label={t("commandPalette.aria.search")}
                        autoComplete="off"
                        role="combobox"
                        aria-expanded={results.length > 0}
                        aria-controls="command-palette-listbox"
                        aria-activedescendant={
                            // 用 listbox 内的序号做 activedescendant 目标, 避免 file path 含
                            // '\' / ':' 等字符导致 ID 无效 (axe aria-valid-attr-value 违规)
                            results[activeIdx] ? `command-palette-option-${activeIdx}` : undefined
                        }
                    />
                </div>

                {/* Results — 错误 / 加载 / 空 / 列表 4 种状态 (可用度-D) */}
                <div className="flex-1 overflow-auto px-1 pb-2 min-h-[200px]">
                    {/* 文件搜索错误 — 友好重试 */}
                    {mode === "file" && filesError && !filesLoading ? (
                        <div
                            className="m-3 p-3 bg-[#fef2f2] border border-[#fecaca] rounded-lg"
                            role="alert"
                        >
                            <p className="text-sm text-[#ef4444] font-medium mb-1">
                                {t("commandPalette.states.fileSearchFailed")}
                            </p>
                            <p className="text-xs text-[#666] mb-2 break-all font-mono">
                                {filesError}
                            </p>
                            <button
                                onClick={retryFileSearch}
                                className="px-3 py-1.5 bg-[#ef4444] text-white text-xs rounded hover:bg-[#dc2626] transition-colors"
                            >
                                {t("common.retry")}
                            </button>
                        </div>
                    ) : mode === "file" && filesLoading ? (
                        <div className="px-4 py-8 text-center text-sm text-[#999]" role="status">
                            {t("common.loading")}
                        </div>
                    ) : results.length === 0 ? (
                        <div className="px-4 py-8 text-center text-sm text-[#999]">
                            {query
                                ? t("commandPalette.states.noFileResults")
                                : mode === "history"
                                ? t("commandPalette.states.noHistory")
                                : mode === "file"
                                ? t("commandPalette.states.noFileQuery")
                                : t("commandPalette.states.noCommandQuery")}
                        </div>
                    ) : (
                        <ul
                            id="command-palette-listbox"
                            role="listbox"
                            aria-label={t("commandPalette.aria.results")}
                            className="space-y-0.5"
                        >
                            {results.map((r, i) => {
                                const isSelected = i === activeIdx;
                                return (
                                    <li
                                        key={r.id}
                                        id={`command-palette-option-${i}`}
                                        role="option"
                                        aria-selected={isSelected}
                                        className="list-none"
                                    >
                                        <button
                                            type="button"
                                            onClick={() => {
                                                r.onSelect();
                                                handleClose();
                                            }}
                                            className={`w-full text-left px-3 py-2 rounded-md text-sm flex items-center gap-2 transition-colors ${
                                                isSelected
                                                    ? "bg-[#f0f0f0]"
                                                    : "hover:bg-[#f5f5f5]"
                                            }`}
                                        >
                                            <span className="flex-1 truncate text-[#1a1a1a]">
                                                {mode === "file" && <span className="text-[#999] mr-2" aria-hidden="true">📄</span>}
                                                {r.primary}
                                            </span>
                                            {r.secondary && (
                                                <span className="text-xs text-[#999] font-mono">{r.secondary}</span>
                                            )}
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>

                {/* Footer hint */}
                <div
                    className="px-3 py-2 border-t border-[#e5e5e5] text-xs text-[#999] flex items-center gap-3"
                    aria-hidden="true"
                >
                    <span>
                        <kbd className="px-1 py-0.5 bg-[#f5f5f5] rounded">↑↓</kbd> {t("commandPalette.hints.navigate")}
                    </span>
                    <span>
                        <kbd className="px-1 py-0.5 bg-[#f5f5f5] rounded">↵</kbd> {t("commandPalette.hints.confirm")}
                    </span>
                    <span>
                        <kbd className="px-1 py-0.5 bg-[#f5f5f5] rounded">Tab</kbd> {t("commandPalette.hints.switchMode")}
                    </span>
                    <span>
                        <kbd className="px-1 py-0.5 bg-[#f5f5f5] rounded">Esc</kbd> {t("commandPalette.hints.close")}
                    </span>
                </div>
            </div>
        </div>
    );
}
