// CommandPalette (M2 Task M2-5)
// Ctrl+K 调起的模态: 文件搜索 / 历史搜索 / 内置命令 三模式
// 可用度-D: 文件搜索失败 → 友好错误 + 重试按钮 (a11y: role="alert")
// v1.0.4: 用户可见文案 + 命令 label 走 t()

import React, { useEffect, useState, useRef, useCallback } from "react";
import { fuzzyScore } from "../../utils/fuzzy-match";
import { useSessionStore } from "../../stores/session-store";
import { useI18n } from "../../i18n";
import { isIpcError, type FileEntry, type GitStatus, type ProjectInfo } from "@shared";
import { classifyTerminalCommand } from "../../utils/terminal-command";
import { projectScriptCommand } from "../../utils/project-scripts";

export type CommandMode = "file" | "history" | "cmd";

interface CommandPaletteProps {
    isOpen: boolean;
    onClose: () => void;
    workspacePath: string;
    workspaceId?: string;
    onSelectFile?: (path: string) => void;
    onSelectHistory?: (sessionId: string) => void;
    onRunCommand?: (cmdId: string) => void;
}

interface CommandDef {
    id: string;
    labelKey: string;
    hint: string;
}

interface ProjectScriptCommand {
    id: string;
    name: string;
    command: string;
    rawScript: string;
}

interface GitContextCommand {
    id: string;
    labelKey: string;
    file: string;
    status: "M" | "A" | "D" | "?";
    kind: "open-file" | "open-diff" | "stage-file";
}

type PaletteCommandStatus = {
    message: string;
    tone: "success" | "error";
};

type CommandResult = {
    id: string;
    primary: string;
    secondary?: string;
    keepOpen?: boolean;
    onSelect: () => void | Promise<void>;
};

const COMMANDS: readonly CommandDef[] = Object.freeze([
    { id: "new_chat", labelKey: "commandPalette.commands.new_chat", hint: "Ctrl+N" },
    { id: "open_files", labelKey: "commandPalette.commands.open_files", hint: "文件" },
    { id: "open_git", labelKey: "commandPalette.commands.open_git", hint: "Git" },
    { id: "open_sessions", labelKey: "commandPalette.commands.open_sessions", hint: "History" },
    { id: "open_skills", labelKey: "commandPalette.commands.open_skills", hint: "Ctrl+Shift+S" },
    { id: "open_settings", labelKey: "commandPalette.commands.open_settings", hint: "Ctrl+," },
    { id: "switch_workspace", labelKey: "commandPalette.commands.switch_workspace", hint: "Ctrl+P" },
    { id: "toggle_terminal", labelKey: "commandPalette.commands.toggle_terminal", hint: "Ctrl+`" },
]);

const COMMAND_RESULT_LIMIT = 24;
const CONTEXT_RESULT_LIMIT = 8;

function FileIcon(): React.JSX.Element {
    return (
        <svg className="h-4 w-4 shrink-0 text-[var(--mm-text-tertiary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14 3v5h5" />
        </svg>
    );
}

function gitChangedFiles(status: GitStatus | null): Array<{ file: string; status: GitContextCommand["status"] }> {
    if (!status) return [];
    return [
        ...status.modified.map((file) => ({ file, status: "M" as const })),
        ...status.added.map((file) => ({ file, status: "A" as const })),
        ...status.deleted.map((file) => ({ file, status: "D" as const })),
        ...status.untracked.map((file) => ({ file, status: "?" as const })),
    ].slice(0, 8);
}

export function CommandPalette({
    isOpen,
    onClose,
    workspacePath,
    workspaceId,
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
    const [project, setProject] = useState<ProjectInfo | null>(null);
    const [projectError, setProjectError] = useState<string | null>(null);
    const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
    const [actionStatus, setActionStatus] = useState<PaletteCommandStatus | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);
    const { t } = useI18n();

    const loadGitStatus = useCallback(async (): Promise<void> => {
        if (!window.piAPI?.getGitStatus || !workspacePath) return;
        try {
            const result = await Promise.resolve(window.piAPI.getGitStatus(workspacePath));
            setGitStatus(isIpcError(result) ? null : result);
        } catch {
            setGitStatus(null);
        }
    }, [workspacePath]);

    useEffect(() => {
        if (isOpen) {
            setQuery("");
            setMode("file");
            setActiveIdx(0);
            setActionStatus(null);
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        const onCommandStatus = (event: Event): void => {
            const detail = (event as CustomEvent<PaletteCommandStatus>).detail;
            if (!detail?.message) return;
            setActionStatus(detail);
        };
        window.addEventListener("command-palette:status", onCommandStatus);
        return () => window.removeEventListener("command-palette:status", onCommandStatus);
    }, [isOpen]);

    // 文件搜索：loading / 错误 / 重试 (可用度-D)
    useEffect(() => {
        if (mode !== "file" || !window.piAPI?.filesList || !isOpen) return;
        let cancelled = false;
        setFilesLoading(true);
        setFilesError(null);
        window.piAPI
            .filesList(workspacePath)
            .then((result) => {
                if (cancelled) return;
                if (isIpcError(result)) {
                    setFiles([]);
                    setFilesError(result.fallback);
                    setFilesLoading(false);
                    return;
                }
                setFiles(result);
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
        if (mode !== "cmd" || !window.piAPI?.detectProject || !isOpen || !workspacePath) return;
        let cancelled = false;
        setProjectError(null);
        window.piAPI
            .detectProject(workspacePath)
            .then((result) => {
                if (cancelled) return;
                if (isIpcError(result)) {
                    setProject(null);
                    setProjectError(result.fallback);
                    return;
                }
                setProject(result);
                setProjectError(null);
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                setProject(null);
                setProjectError(err instanceof Error ? err.message : String(err));
            });
        return () => {
            cancelled = true;
        };
    }, [mode, workspacePath, isOpen]);

    useEffect(() => {
        if (mode !== "cmd" || !window.piAPI?.getGitStatus || !isOpen || !workspacePath) return;
        let cancelled = false;
        void loadGitStatus().finally(() => {
            if (cancelled) return;
        });
        return () => {
            cancelled = true;
        };
    }, [loadGitStatus, mode, workspacePath, isOpen]);

    useEffect(() => {
        setActiveIdx(0);
    }, [mode, query]);

    const retryFileSearch = useCallback(() => {
        setFilesReloadKey((k) => k + 1);
    }, []);

    if (!isOpen) return null;

    // 根据 mode 决定 results
    let results: CommandResult[] = [];

    const projectCommands: ProjectScriptCommand[] = project?.scripts
        ? Object.keys(project.scripts).slice(0, 12).map((name) => ({
            id: `project-script:${name}`,
            name,
            command: projectScriptCommand(project.packageManager, name),
            rawScript: String(project.scripts?.[name] ?? ""),
        }))
        : [];
    const gitContextCommands: GitContextCommand[] = gitChangedFiles(gitStatus)
        .flatMap(({ file, status }) => [
            {
                id: `git-open-change:${file}`,
                labelKey: "commandPalette.commands.git_open_change",
                file,
                status,
                kind: "open-file" as const,
            },
            {
                id: `git-open-diff:${file}`,
                labelKey: "commandPalette.commands.git_open_diff",
                file,
                status,
                kind: "open-diff" as const,
            },
            {
                id: `git-stage-file:${file}`,
                labelKey: "commandPalette.commands.git_stage_file",
                file,
                status,
                kind: "stage-file" as const,
            },
        ]);

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
        const builtInResults = COMMANDS
            .map((c) => ({ c, s: fuzzyScore(t(c.labelKey), query) }))
            .filter((x) => x.s > 0)
            .sort((a, b) => b.s - a.s)
            .map((x) => ({
                id: x.c.id,
                primary: t(x.c.labelKey),
                secondary: x.c.hint,
                keepOpen: x.c.id === "switch_workspace",
                onSelect: () => onRunCommand?.(x.c.id),
            }));
        const projectResults = projectCommands
            .map((c) => ({
                c,
                s: Math.max(
                    fuzzyScore(c.name, query),
                    fuzzyScore(c.command, query),
                    fuzzyScore(`run ${c.name}`, query),
                ),
            }))
            .filter((x) => x.s > 0)
            .sort((a, b) => b.s - a.s)
            .map((x) => ({
                id: x.c.id,
                primary: `${t("commandPalette.projectScriptPrefix")} ${x.c.name}`,
                secondary: x.c.command,
                keepOpen: true,
                onSelect: () => {
                    const mode = classifyTerminalCommand(`${x.c.command}\n${x.c.rawScript}`);
                    setActionStatus({
                        message: t(
                            mode === "draft"
                                ? "commandPalette.states.projectScriptDrafted"
                                : "commandPalette.states.projectScriptSent",
                            { name: x.c.name },
                        ),
                        tone: "success",
                    });
                    window.dispatchEvent(new CustomEvent("terminal:run-command", {
                        detail: { command: x.c.command, mode },
                    }));
                },
            }));
        const gitContextResults = gitContextCommands
            .map((c) => ({
                c,
                label: t(c.labelKey, { file: c.file }),
                s: Math.max(
                    fuzzyScore(t(c.labelKey, { file: c.file }), query),
                    fuzzyScore(c.file, query),
                    fuzzyScore(
                        c.kind === "open-diff"
                            ? "diff git changes"
                            : c.kind === "stage-file"
                                ? `stage git add ${c.file}`
                                : "open changed file",
                        query,
                    ),
                ),
            }))
            .filter((x) => x.s > 0)
            .sort((a, b) => b.s - a.s)
            .map((x) => ({
                id: x.c.id,
                primary: x.label,
                secondary: `${x.c.status} ${x.c.file}`,
                keepOpen: x.c.kind === "stage-file",
                onSelect: async () => {
                    if (x.c.kind === "open-diff") {
                        setActionStatus({ message: t("commandPalette.states.gitDiffOpened", { file: x.c.file }), tone: "success" });
                        window.dispatchEvent(new CustomEvent("workspace:open-git-diff", { detail: { file: x.c.file } }));
                        return;
                    }
                    if (x.c.kind === "stage-file") {
                        if (!window.piAPI?.gitAdd) return;
                        try {
                            const result = await window.piAPI.gitAdd(workspacePath, [x.c.file]);
                            if (isIpcError(result)) {
                                setActionStatus({ message: result.fallback, tone: "error" });
                                return;
                            }
                            setActionStatus({ message: t("commandPalette.states.gitStageSuccess", { file: x.c.file }), tone: "success" });
                            window.dispatchEvent(
                                new CustomEvent("workspace:git-changed", {
                                    detail: { workspacePath, files: [x.c.file], reason: "stage" },
                                }),
                            );
                            await loadGitStatus();
                        } catch (err) {
                            setActionStatus({ message: err instanceof Error ? err.message : String(err), tone: "error" });
                        }
                        return;
                    }
                    setActionStatus({ message: t("commandPalette.states.gitChangeOpened", { file: x.c.file }), tone: "success" });
                    window.dispatchEvent(
                        new CustomEvent("workspace:open-file", {
                            detail: { path: `${workspacePath.replace(/[\\/]+$/, "")}\\${x.c.file.replace(/^[\\/]+/, "")}` },
                        }),
                    );
                },
            }));
        results = [
            ...builtInResults,
            ...gitContextResults.slice(0, CONTEXT_RESULT_LIMIT),
            ...projectResults.slice(0, CONTEXT_RESULT_LIMIT),
        ].slice(0, COMMAND_RESULT_LIMIT);
    } else if (mode === "history") {
        // 历史搜索 (M2-6): 跨 session 搜消息内容
        const sessions = useSessionStore
            .getState()
            .sessions
            .filter((session) => !workspaceId || session.workspaceId === workspaceId);
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
            const result = results[activeIdx];
            void result.onSelect();
            if (!result.keepOpen) handleClose();
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
                className="bg-[var(--mm-bg-panel)] rounded-2xl shadow-2xl w-[640px] max-h-[500px] flex flex-col overflow-hidden"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label={t("commandPalette.aria.root")}
            >
                {/* Mode tabs */}
                <div
                    className="flex items-center gap-1 px-3 pt-3 border-b border-[var(--mm-border)]"
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
                                        : "text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-sidebar)]"
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
                        className="w-full px-3 py-2 bg-[var(--mm-bg-sidebar)] border border-[var(--mm-border)] rounded-lg text-sm focus:outline-none focus:border-[#1a1a1a]"
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
                    {mode === "cmd" && actionStatus && (
                        <div
                            className={`mx-3 mb-2 rounded-lg border p-2.5 text-xs ${
                                actionStatus.tone === "error"
                                    ? "border-[#fecaca] bg-[#fef2f2] text-[var(--color-error)]"
                                    : "border-[#bbf7d0] bg-[#f0fdf4] text-[var(--color-success)]"
                            }`}
                            role={actionStatus.tone === "error" ? "alert" : "status"}
                        >
                            {actionStatus.message}
                        </div>
                    )}
                    {mode === "cmd" && projectError && (
                        <div className="mx-3 mb-2 rounded-lg border border-[#f1e4c8] bg-[#fffaf0] p-2.5" role="status">
                            <p className="m-0 text-xs font-medium text-[#92400e]">
                                {t("commandPalette.states.projectCommandsUnavailable")}
                            </p>
                            <p className="m-0 mt-1 break-all font-mono text-[11px] text-[#8a6a3f]">
                                {projectError}
                            </p>
                        </div>
                    )}
                    {/* 文件搜索错误 — 友好重试 */}
                    {mode === "file" && filesError && !filesLoading ? (
                        <div
                            className="m-3 p-3 bg-[#fef2f2] border border-[#fecaca] rounded-lg"
                            role="alert"
                        >
                            <p className="text-sm text-[var(--color-error)] font-medium mb-1">
                                {t("commandPalette.states.fileSearchFailed")}
                            </p>
                            <p className="text-xs text-[var(--mm-text-secondary)] mb-2 break-all font-mono">
                                {filesError}
                            </p>
                            <button
                                onClick={retryFileSearch}
                                className="px-3 py-1.5 bg-[var(--color-error)] text-white text-xs rounded hover:bg-[var(--color-error)] transition-colors"
                            >
                                {t("common.retry")}
                            </button>
                        </div>
                    ) : mode === "file" && filesLoading ? (
                        <div className="px-4 py-8 text-center text-sm text-[var(--mm-text-tertiary)]" role="status">
                            {t("common.loading")}
                        </div>
                    ) : results.length === 0 ? (
                        <div className="px-4 py-8 text-center text-sm text-[var(--mm-text-tertiary)]">
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
                                            type="button" aria-label={r.primary} title={r.primary}
                                            onClick={() => {
                                                void r.onSelect();
                                                if (!r.keepOpen) handleClose();
                                            }}
                                            className={`w-full text-left px-3 py-2 rounded-md text-sm flex items-center gap-2 transition-colors ${
                                                isSelected
                                                    ? "bg-[var(--mm-bg-hover)]"
                                                    : "hover:bg-[var(--mm-bg-sidebar)]"
                                            }`}
                                        >
                                            {mode === "file" && <FileIcon />}
                                            <span className="flex-1 truncate text-[var(--mm-text-primary)]">
                                                {r.primary}
                                            </span>
                                            {r.secondary && (
                                                <span className="text-xs text-[var(--mm-text-tertiary)] font-mono">{r.secondary}</span>
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
                    className="px-3 py-2 border-t border-[var(--mm-border)] text-xs text-[var(--mm-text-tertiary)] flex items-center gap-3"
                    aria-hidden="true"
                >
                    <span>
                        <kbd className="px-1 py-0.5 bg-[var(--mm-bg-sidebar)] rounded">↑↓</kbd> {t("commandPalette.hints.navigate")}
                    </span>
                    <span>
                        <kbd className="px-1 py-0.5 bg-[var(--mm-bg-sidebar)] rounded">↵</kbd> {t("commandPalette.hints.confirm")}
                    </span>
                    <span>
                        <kbd className="px-1 py-0.5 bg-[var(--mm-bg-sidebar)] rounded">Tab</kbd> {t("commandPalette.hints.switchMode")}
                    </span>
                    <span>
                        <kbd className="px-1 py-0.5 bg-[var(--mm-bg-sidebar)] rounded">Esc</kbd> {t("commandPalette.hints.close")}
                    </span>
                </div>
            </div>
        </div>
    );
}
