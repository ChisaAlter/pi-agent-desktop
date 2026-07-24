import React, { useCallback, useMemo, useState } from "react";
import { DiffViewer } from "../DiffView/DiffViewer";
import { useGit } from "../../hooks/useGit";

interface GitPanelProps {
    workspacePath: string;
    initialTarget?: { file: string; nonce: number } | null;
}

type ChangeKind = "modified" | "added" | "deleted" | "untracked";
type ChangeGroup = "unstaged" | "staged";
type OperationKind = "stage" | "unstage" | "discard" | "commit" | "refresh" | null;
type DiffState = "idle" | "loading" | "ready" | "error";

interface ChangeItem {
    file: string;
    kind: ChangeKind;
    group: ChangeGroup;
}

interface CommitSummary {
    message: string;
    files: string[];
}

function badge(kind: ChangeKind): { label: string; className: string } {
    return {
        modified: { label: "M", className: "bg-[#dbeafe] text-[var(--color-info)]" },
        added: { label: "A", className: "bg-[#dcfce7] text-[var(--color-success)]" },
        deleted: { label: "D", className: "bg-[#fee2e2] text-[var(--color-error)]" },
        untracked: { label: "?", className: "bg-[var(--mm-bg-sidebar)] text-[var(--mm-text-secondary)]" },
    }[kind];
}

function ChangeRow({
    item,
    active,
    disabled,
    onOpen,
    onPrimary,
    onDiscard,
}: {
    item: ChangeItem;
    active: boolean;
    disabled?: boolean;
    onOpen: (item: ChangeItem) => void;
    onPrimary: (item: ChangeItem) => void;
    onDiscard?: (item: ChangeItem) => void;
}): React.JSX.Element {
    const b = badge(item.kind);
    return (
        <li
            className={`group flex h-9 min-w-0 items-center gap-1 px-2 transition-colors hover:bg-[var(--mm-bg-sidebar)] ${
                active ? "bg-[#eef3ff]" : ""
            } ${disabled ? "opacity-55" : ""}`}
        >
            <button
                type="button"
                disabled={disabled}
                onClick={() => onOpen(item)}
                className="flex h-full min-w-0 flex-1 items-center gap-2 rounded px-1 text-left text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2563eb] disabled:cursor-not-allowed"
                title={item.file}
                aria-label={`打开 ${item.file} diff`}
            >
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] font-bold ${b.className}`}>
                    {b.label}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono">{item.file}</span>
            </button>
            <button
                type="button"
                disabled={disabled}
                onClick={() => onPrimary(item)}
                className="hidden h-7 shrink-0 rounded px-1.5 text-[11px] text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-hover)] focus:inline-flex group-hover:inline-flex focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] disabled:cursor-not-allowed"
                aria-label={`${item.group === "staged" ? "取消暂存" : "暂存"} ${item.file}`}
            >
                {item.group === "staged" ? "取消暂存" : "暂存"}
            </button>
            {onDiscard && (
                <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onDiscard(item)}
                    className="hidden h-7 shrink-0 rounded px-1.5 text-[11px] text-[var(--color-error)] hover:bg-[var(--mm-bg-hover)] focus:inline-flex group-hover:inline-flex focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:cursor-not-allowed"
                    aria-label={`丢弃 ${item.file}`}
                >
                    丢弃
                </button>
            )}
        </li>
    );
}

function makeChanges(files: string[], kind: ChangeKind, group: ChangeGroup): ChangeItem[] {
    return files.map((file) => ({ file, kind, group }));
}

function parseStagedChanges(diff: string): ChangeItem[] {
    const changes = new Map<string, ChangeKind>();
    let currentFile: string | null = null;
    let currentKind: ChangeKind = "modified";
    const commitCurrent = (): void => {
        if (currentFile) changes.set(currentFile, currentKind);
    };
    for (const line of diff.split(/\r?\n/)) {
        if (line.startsWith("diff --git ")) {
            commitCurrent();
            const match = line.match(/^diff --git a\/(.+?) b\//);
            currentFile = match?.[1] ?? null;
            currentKind = "modified";
        } else if (line.startsWith("new file mode ")) {
            currentKind = "added";
        } else if (line.startsWith("deleted file mode ")) {
            currentKind = "deleted";
        }
    }
    commitCurrent();
    return [...changes.entries()].map(([file, kind]) => ({ file, kind, group: "staged" as const }));
}

function filterDiffForFile(diff: string, filePath: string): string {
    const lines = diff.split(/\r?\n/);
    const chunks: string[][] = [];
    let current: string[] = [];
    for (const line of lines) {
        if (line.startsWith("diff --git ")) {
            if (current.length > 0) chunks.push(current);
            current = [line];
        } else if (current.length > 0) {
            current.push(line);
        }
    }
    if (current.length > 0) chunks.push(current);
    const match = chunks.find((chunk) => {
        const header = chunk[0] ?? "";
        return header.includes(` a/${filePath} b/${filePath}`)
            || chunk.some((line) => line === `--- a/${filePath}` || line === `+++ b/${filePath}`);
    });
    return match ? match.join("\n") : diff;
}

function operationLabel(kind: Exclude<OperationKind, null>): string {
    return {
        stage: "暂存",
        unstage: "取消暂存",
        discard: "丢弃",
        commit: "提交",
        refresh: "刷新",
    }[kind];
}

function nextChangeAfter(items: ChangeItem[], current: ChangeItem): ChangeItem | null {
    const remaining = items.filter((item) => !(item.file === current.file && item.group === current.group));
    if (remaining.length === 0) return null;
    const index = items.findIndex((item) => item.file === current.file && item.group === current.group);
    return remaining[Math.max(0, Math.min(index, remaining.length - 1))] ?? null;
}

function dispatchGitChanged(
    workspacePath: string,
    reason: "stage" | "unstage" | "discard" | "commit",
    files?: string[],
): void {
    window.dispatchEvent(
        new CustomEvent("workspace:git-changed", {
            detail: { workspacePath, files, reason },
        }),
    );
}

export function GitPanel({ workspacePath, initialTarget }: GitPanelProps): React.JSX.Element {
    const git = useGit(workspacePath);
    const {
        status,
        isLoading,
        error,
        refresh,
        loadDiff,
        loadStagedDiff,
        stageFiles,
        unstage: unstageFiles,
        undo,
        commit: commitChanges,
        branches,
        checkout,
        createBranch,
    } = git;
    const [selected, setSelected] = useState<ChangeItem | null>(null);
    const [diffContent, setDiffContent] = useState("");
    const [diffState, setDiffState] = useState<DiffState>("idle");
    const [diffError, setDiffError] = useState<string | null>(null);
    const [stagedDiff, setStagedDiff] = useState("");
    const [stagedDiffError, setStagedDiffError] = useState<string | null>(null);
    const [commitMessage, setCommitMessage] = useState("");
    const [busy, setBusy] = useState(false);
    const [operation, setOperation] = useState<OperationKind>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [commitSummary, setCommitSummary] = useState<CommitSummary | null>(null);
    const [copiedSummary, setCopiedSummary] = useState(false);
    const [discardCandidate, setDiscardCandidate] = useState<ChangeItem | null>(null);
    const [branchDropdownOpen, setBranchDropdownOpen] = useState(false);
    const [newBranchName, setNewBranchName] = useState("");
    const [branchBusy, setBranchBusy] = useState(false);

    const stagedChanges = useMemo(() => parseStagedChanges(stagedDiff), [stagedDiff]);
    const unstagedChanges = useMemo(() => {
        if (!status) return [];
        return [
            ...makeChanges(status.modified, "modified", "unstaged"),
            ...makeChanges(status.added, "added", "unstaged"),
            ...makeChanges(status.deleted, "deleted", "unstaged"),
            ...makeChanges(status.untracked, "untracked", "unstaged"),
        ];
    }, [status]);
    const allChanges = useMemo(() => [...stagedChanges, ...unstagedChanges], [stagedChanges, unstagedChanges]);
    const commitScopeText = stagedChanges.length > 0
        ? `只会提交 ${stagedChanges.length} 个暂存文件`
        : unstagedChanges.length > 0
            ? "先暂存文件后才能提交"
            : "没有可提交变更";

    const refreshAll = useCallback(async () => {
        await refresh();
        try {
            const nextStaged = await loadStagedDiff();
            setStagedDiff(nextStaged);
            setStagedDiffError(null);
        } catch (err) {
            setStagedDiff("");
            setStagedDiffError(err instanceof Error ? err.message : String(err));
        }
    }, [loadStagedDiff, refresh]);

    const runOperation = useCallback(async (
        kind: Exclude<OperationKind, null>,
        task: () => Promise<void>,
        successMessage?: string,
    ) => {
        setBusy(true);
        setOperation(kind);
        setNotice(null);
        if (kind !== "commit") setCommitSummary(null);
        try {
            await task();
            if (successMessage) setNotice(successMessage);
        } catch (err) {
            setNotice(`${operationLabel(kind)}失败: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setBusy(false);
            setOperation(null);
        }
    }, []);

    React.useEffect(() => {
        void refreshAll();
    }, [refreshAll]);

    React.useEffect(() => {
        const onFileSaved = (event: Event): void => {
            const detail = (event as CustomEvent<{ workspacePath?: string }>).detail;
            if (!detail?.workspacePath || detail.workspacePath === workspacePath) {
                void refreshAll();
            }
        };
        window.addEventListener("workspace:file-saved", onFileSaved);
        return () => window.removeEventListener("workspace:file-saved", onFileSaved);
    }, [refreshAll, workspacePath]);

    const openChange = useCallback(async (item: ChangeItem) => {
        setSelected(item);
        setDiscardCandidate(null);
        setNotice(null);
        setDiffState("loading");
        setDiffError(null);
        setDiffContent("");
        try {
            const diff = item.group === "staged"
                ? filterDiffForFile(await loadStagedDiff(), item.file)
                : await loadDiff(item.file);
            setDiffContent(diff);
            setDiffState("ready");
        } catch (err) {
            setDiffContent("");
            setDiffError(err instanceof Error ? err.message : String(err));
            setDiffState("error");
        }
    }, [loadDiff, loadStagedDiff]);

    React.useEffect(() => {
        const onGitChanged = (event: Event): void => {
            if (busy) return;
            const detail = (event as CustomEvent<{ workspacePath?: string; files?: string[] }>).detail;
            if (detail?.workspacePath !== workspacePath) return;
            void (async () => {
                await refreshAll();
                if (selected && !discardCandidate && (!detail.files || detail.files.includes(selected.file))) {
                    await openChange(selected);
                }
                setNotice("Git 状态已更新");
            })();
        };
        window.addEventListener("workspace:git-changed", onGitChanged);
        return () => window.removeEventListener("workspace:git-changed", onGitChanged);
    }, [busy, discardCandidate, openChange, refreshAll, selected, workspacePath]);

    React.useEffect(() => {
        if (!initialTarget?.file) return;
        void openChange({ file: initialTarget.file, kind: "modified", group: "unstaged" });
    }, [initialTarget?.file, initialTarget?.nonce, openChange]);

    const stage = useCallback(async (item: ChangeItem) => {
        await runOperation("stage", async () => {
            const next = nextChangeAfter(allChanges, item);
            await stageFiles([item.file]);
            await refreshAll();
            dispatchGitChanged(workspacePath, "stage", [item.file]);
            if (selected?.file === item.file && selected.group === item.group) {
                if (next) await openChange(next);
                else {
                    setSelected(null);
                    setDiscardCandidate(null);
                    setDiffContent("");
                    setDiffState("idle");
                    setDiffError(null);
                }
            }
        }, `已暂存 ${item.file}`);
    }, [allChanges, openChange, refreshAll, runOperation, selected, stageFiles, workspacePath]);

    const unstage = useCallback(async (item: ChangeItem) => {
        await runOperation("unstage", async () => {
            const next = nextChangeAfter(allChanges, item);
            await unstageFiles([item.file]);
            await refreshAll();
            dispatchGitChanged(workspacePath, "unstage", [item.file]);
            if (selected?.file === item.file && selected.group === item.group) {
                if (next) await openChange(next);
                else {
                    setSelected(null);
                    setDiscardCandidate(null);
                    setDiffContent("");
                    setDiffState("idle");
                    setDiffError(null);
                }
            }
        }, `已取消暂存 ${item.file}`);
    }, [allChanges, openChange, refreshAll, runOperation, selected, unstageFiles, workspacePath]);

    const requestDiscard = useCallback(async (item: ChangeItem) => {
        setSelected(item);
        setDiscardCandidate(item);
        setNotice(null);
        setDiffState("loading");
        setDiffError(null);
        setDiffContent("");
        try {
            setDiffContent(await loadDiff(item.file));
            setDiffState("ready");
        } catch (err) {
            setDiffContent("");
            setDiffError(err instanceof Error ? err.message : String(err));
            setDiffState("error");
        }
    }, [loadDiff]);

    const confirmDiscard = useCallback(async () => {
        if (!discardCandidate) return;
        const item = discardCandidate;
        await runOperation("discard", async () => {
            await undo(item.file);
            setSelected(null);
            setDiscardCandidate(null);
            setDiffContent("");
            setDiffState("idle");
            setDiffError(null);
            await refreshAll();
            dispatchGitChanged(workspacePath, "discard", [item.file]);
        }, `已丢弃 ${item.file}`);
    }, [discardCandidate, refreshAll, runOperation, undo, workspacePath]);

    const cancelDiscard = useCallback(() => {
        setDiscardCandidate(null);
        setNotice("已取消丢弃操作");
    }, []);

    const stageAll = useCallback(async () => {
        const files = unstagedChanges.map((item) => item.file);
        if (files.length === 0) return;
        await runOperation("stage", async () => {
            await stageFiles(files);
            await refreshAll();
            dispatchGitChanged(workspacePath, "stage", files);
        }, `已暂存 ${files.length} 个文件`);
    }, [refreshAll, runOperation, stageFiles, unstagedChanges, workspacePath]);

    const commit = useCallback(async () => {
        const message = commitMessage.trim();
        if (!message || stagedChanges.length === 0) return;
        const committedFiles = stagedChanges.map((item) => item.file);
        await runOperation("commit", async () => {
            await commitChanges(message);
            setCommitSummary({ message, files: committedFiles });
            setCommitMessage("");
            setDiffContent("");
            setDiffState("idle");
            setDiffError(null);
            setSelected(null);
            setDiscardCandidate(null);
            await refreshAll();
            dispatchGitChanged(workspacePath, "commit", committedFiles);
        }, `提交完成: ${message}`);
    }, [commitChanges, commitMessage, refreshAll, runOperation, stagedChanges, workspacePath]);

    const copyCommitSummary = useCallback(async () => {
        if (!commitSummary) return;
        const body = [
            commitSummary.message,
            "",
            ...commitSummary.files.map((file) => `- ${file}`),
        ].join("\n");
        try {
            await navigator.clipboard?.writeText(body);
        } catch (err) {
            setCopiedSummary(false);
            setNotice(`复制提交摘要失败: ${err instanceof Error ? err.message : String(err)}`);
            return;
        }
        setNotice(null);
        setCopiedSummary(true);
        window.setTimeout(() => setCopiedSummary(false), 1400);
    }, [commitSummary]);

    const localBranches = useMemo(() => branches.filter((b) => !b.isRemote), [branches]);

    const handleCheckout = useCallback(async (branchName: string) => {
        setBranchDropdownOpen(false);
        setBranchBusy(true);
        setNotice(null);
        try {
            await checkout(branchName);
            setNotice(`已切换到分支 ${branchName}`);
        } catch (err) {
            setNotice(`切换分支失败: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setBranchBusy(false);
        }
    }, [checkout]);

    const handleCreateBranch = useCallback(async () => {
        const name = newBranchName.trim();
        if (!name) return;
        setBranchDropdownOpen(false);
        setBranchBusy(true);
        setNotice(null);
        try {
            await createBranch(name);
            setNewBranchName("");
            setNotice(`已创建并切换到分支 ${name}`);
        } catch (err) {
            setNotice(`创建分支失败: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setBranchBusy(false);
        }
    }, [createBranch, newBranchName]);

    if (isLoading && !status) {
        return <div className="flex h-full items-center justify-center text-sm text-[var(--mm-text-secondary)]">加载 Git 状态...</div>;
    }

    if (error || !status) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                <div className="text-sm font-medium">Git 暂不可用</div>
                <div className="max-w-md text-xs leading-5 text-[var(--mm-text-secondary)]">{error ?? "当前工作区不是 Git 仓库。"}</div>
                <button type="button" onClick={() => void refreshAll()} className="rounded-md bg-[#1f1f1f] px-3 py-1.5 text-xs text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]">重试</button>
            </div>
        );
    }

    const hasChanges = allChanges.length > 0;
    const noticeIsError = notice?.includes("失败") ?? false;

    return (
        <div className="flex h-full min-h-0 bg-[var(--mm-bg-main)] text-[var(--mm-text-primary)]" role="region" aria-label="Git 面板">
            <aside className="flex h-full w-[330px] shrink-0 flex-col border-r border-[var(--mm-border)] bg-[var(--mm-bg-panel)]">
                <div className="border-b border-[var(--mm-border)] px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <h1 className="m-0 text-sm font-semibold">Source Control</h1>
                                <div className="relative">
                                    <button
                                        type="button"
                                        disabled={branchBusy}
                                        onClick={() => setBranchDropdownOpen((v) => !v)}
                                        className="flex items-center gap-1 rounded-md bg-[var(--mm-bg-sidebar)] px-2 py-0.5 font-mono text-[11px] text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] disabled:opacity-45"
                                        aria-label="切换分支"
                                        aria-expanded={branchDropdownOpen}
                                    >
                                        <span className="truncate max-w-[120px]">{status.branch}</span>
                                        <span className="text-[9px]">{branchDropdownOpen ? "▴" : "▾"}</span>
                                    </button>
                                    {branchDropdownOpen && (
                                        <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded-md border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] shadow-lg" role="listbox" aria-label="分支列表">
                                            <div className="max-h-48 overflow-auto py-1">
                                                {localBranches.length === 0 ? (
                                                    <div className="px-3 py-2 text-xs text-[var(--mm-text-tertiary)]">无本地分支</div>
                                                ) : localBranches.map((b) => (
                                                    <button
                                                        key={b.name}
                                                        type="button"
                                                        onClick={() => void handleCheckout(b.name)}
                                                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-[var(--mm-bg-sidebar)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2563eb] ${b.isCurrent ? "font-medium text-[var(--mm-text-primary)]" : "text-[var(--mm-text-secondary)]"}`}
                                                        role="option"
                                                        aria-selected={b.isCurrent}
                                                    >
                                                        <span className="w-3 shrink-0">{b.isCurrent ? "●" : ""}</span>
                                                        <span className="min-w-0 flex-1 truncate">{b.name}</span>
                                                    </button>
                                                ))}
                                            </div>
                                            <div className="border-t border-[var(--mm-border)] p-2">
                                                <input
                                                    type="text"
                                                    value={newBranchName}
                                                    onChange={(e) => setNewBranchName(e.target.value)}
                                                    onKeyDown={(e) => { if (e.key === "Enter") void handleCreateBranch(); }}
                                                    placeholder="新分支名..."
                                                    className="w-full rounded border border-[var(--mm-border)] bg-[var(--mm-bg-main)] px-2 py-1 text-xs text-[var(--mm-text-primary)] focus:outline-none focus:border-[#999] focus-visible:ring-2 focus-visible:ring-[#2563eb]"
                                                    aria-label="新分支名"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => void handleCreateBranch()}
                                                    disabled={!newBranchName.trim() || branchBusy}
                                                    className="mt-1.5 w-full rounded bg-[#1f1f1f] px-2 py-1 text-xs text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] disabled:opacity-35"
                                                >
                                                    创建并切换
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                            <p className="m-0 mt-1 text-[11px] text-[var(--mm-text-tertiary)]">
                                {stagedChanges.length} staged / {unstagedChanges.length} changes · ahead {status.ahead} / behind {status.behind}
                            </p>
                        </div>
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => void runOperation("refresh", refreshAll)}
                            className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-[var(--mm-bg-sidebar)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] disabled:cursor-not-allowed disabled:opacity-45"
                            title="刷新"
                            aria-label="刷新 Git 状态"
                        >
                            {operation === "refresh" ? "…" : "↻"}
                        </button>
                    </div>
                    {notice && (
                        <p className={`m-0 mt-2 rounded-md px-2 py-1.5 text-[11px] ${noticeIsError ? "bg-[#fef2f2] text-[var(--color-error)]" : "bg-[var(--mm-bg-sidebar)] text-[var(--mm-text-secondary)]"}`} role={noticeIsError ? "alert" : "status"}>
                            {notice}
                        </p>
                    )}
                    {stagedDiffError && (
                        <div className="mt-2 rounded-md border border-[#fecaca] bg-[#fef2f2] px-2 py-2 text-[11px] text-[var(--color-error)]" role="alert">
                            <div className="font-medium">读取 staged diff 失败</div>
                            <div className="mt-1 break-all font-mono">{stagedDiffError}</div>
                            <button
                                type="button"
                                onClick={() => void refreshAll()}
                                className="mt-2 rounded bg-[#b91c1c] px-2 py-1 text-white hover:bg-[#991b1b] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-red-500"
                            >
                                重试
                            </button>
                        </div>
                    )}
                    {commitSummary && (
                        <div className="mt-2 rounded-md border border-[#dcfce7] bg-[#f0fdf4] px-2 py-2 text-[11px] text-[var(--color-success)]">
                            <div className="flex items-center justify-between gap-2">
                                <span className="min-w-0 truncate">已提交 {commitSummary.files.length} 个文件</span>
                                <button
                                    type="button"
                                    onClick={() => void copyCommitSummary()}
                                    className="shrink-0 rounded px-1.5 py-0.5 text-[var(--color-success)] hover:bg-[#dcfce7] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
                                >
                                    {copiedSummary ? "已复制" : "复制摘要"}
                                </button>
                            </div>
                            <div className="mt-1 truncate font-mono" title={commitSummary.message}>
                                {commitSummary.message}
                            </div>
                        </div>
                    )}
                </div>

                <div className="min-h-0 flex-1 overflow-auto">
                    {!hasChanges ? (
                        <div className="m-4 rounded-lg border border-dashed border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-4 py-8 text-center text-sm text-[var(--mm-text-secondary)]">
                            工作区干净
                        </div>
                    ) : (
                        <div className="p-3">
                            <section className="mb-4">
                                <div className="mb-2 flex items-center justify-between text-xs">
                                    <h2 className="m-0 font-medium">Staged</h2>
                                    <span className="text-[var(--mm-text-tertiary)]">{stagedChanges.length}</span>
                                </div>
                                <ul className="m-0 overflow-hidden rounded-lg border border-[var(--mm-border)] p-0">
                                    {stagedChanges.length === 0 ? (
                                        <li className="px-3 py-3 text-xs text-[var(--mm-text-tertiary)]">暂无暂存变更</li>
                                    ) : stagedChanges.map((item) => (
                                        <ChangeRow key={`staged:${item.file}`} item={item} active={selected?.file === item.file && selected.group === item.group} disabled={busy} onOpen={openChange} onPrimary={unstage} />
                                    ))}
                                </ul>
                            </section>
                            <section>
                                <div className="mb-2 flex items-center justify-between text-xs">
                                    <h2 className="m-0 font-medium">Changes</h2>
                                    <button
                                        type="button"
                                        disabled={busy || unstagedChanges.length === 0}
                                        onClick={() => void stageAll()}
                                        className="rounded px-1.5 py-1 text-[11px] hover:bg-[var(--mm-bg-sidebar)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                        {operation === "stage" ? "暂存中" : "全部暂存"}
                                    </button>
                                </div>
                                <ul className="m-0 overflow-hidden rounded-lg border border-[var(--mm-border)] p-0">
                                    {unstagedChanges.map((item) => (
                                        <ChangeRow key={`unstaged:${item.file}`} item={item} active={selected?.file === item.file && selected.group === item.group} disabled={busy} onOpen={openChange} onPrimary={stage} onDiscard={requestDiscard} />
                                    ))}
                                </ul>
                            </section>
                        </div>
                    )}
                </div>

                <div className="border-t border-[var(--mm-border)] p-3">
                    <textarea
                        value={commitMessage}
                        onChange={(event) => setCommitMessage(event.target.value)}
                        placeholder="提交信息"
                        aria-label="提交信息"
                        className="h-20 w-full resize-none rounded-md border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-3 py-2 text-sm outline-none focus:border-[#999] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
                    />
                    <button
                        type="button"
                        aria-label="提交"
                        onClick={() => void commit()}
                        disabled={busy || !commitMessage.trim() || stagedChanges.length === 0}
                        className="mt-2 h-9 w-full rounded-md bg-[#1f1f1f] text-sm text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] disabled:cursor-not-allowed disabled:opacity-35"
                    >
                        {operation === "commit" ? "提交中..." : stagedChanges.length > 0 ? `提交 ${stagedChanges.length} 个暂存文件` : "提交暂存文件"}
                    </button>
                    <p className={`m-0 mt-2 rounded-md px-2 py-1.5 text-[11px] leading-4 ${stagedChanges.length > 0 ? "bg-[#eef3ff] text-[var(--color-info)]" : "bg-[var(--mm-bg-sidebar)] text-[var(--mm-text-tertiary)]"}`}>
                        {commitScopeText}
                    </p>
                </div>
            </aside>

            <main className="flex min-w-0 flex-1 flex-col">
                <div className="flex h-12 items-center justify-between border-b border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-4">
                    <div className="min-w-0">
                        <div className="truncate font-mono text-sm">{discardCandidate?.file ?? selected?.file ?? "选择变更查看 diff"}</div>
                        <div className="text-[11px] text-[var(--mm-text-tertiary)]">{discardCandidate ? "discard preview" : selected?.group === "staged" ? "staged diff" : selected ? "working tree diff" : `${unstagedChanges.length + stagedChanges.length} 项变更`}</div>
                    </div>
                    {discardCandidate && (
                        <div className="flex shrink-0 items-center gap-2">
                            <button
                                type="button"
                                onClick={cancelDiscard}
                                disabled={busy}
                                className="rounded-md border border-[var(--mm-border)] px-2 py-1 text-xs hover:bg-[var(--mm-bg-sidebar)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] disabled:opacity-40"
                            >
                                取消
                            </button>
                            <button
                                type="button"
                                onClick={() => void confirmDiscard()}
                                disabled={busy}
                                className="rounded-md bg-[#b91c1c] px-2 py-1 text-xs text-white hover:bg-[#991b1b] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-red-500 disabled:opacity-40"
                            >
                                {operation === "discard" ? "丢弃中..." : "确认丢弃"}
                            </button>
                        </div>
                    )}
                </div>
                <div className="min-h-0 flex-1 overflow-auto p-4">
                    {discardCandidate ? (
                        <div className="flex min-h-full flex-col">
                            <div className="mb-3 rounded-md border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-xs leading-5 text-[var(--color-error)]" role="alert">
                                即将丢弃 {discardCandidate.file} 的本地变更。请先检查下面的 diff；确认后文件会还原，未提交内容不可恢复。
                            </div>
                            {diffState === "loading" ? (
                                <div className="rounded-lg border border-dashed border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-4 py-8 text-center text-sm text-[var(--mm-text-secondary)]" role="status">
                                    正在读取 diff...
                                </div>
                            ) : diffState === "error" ? (
                                <div className="rounded-lg border border-[#fecaca] bg-[#fef2f2] px-4 py-4 text-sm text-[var(--color-error)]" role="alert">
                                    <div className="font-medium">读取 diff 失败</div>
                                    <div className="mt-1 break-all font-mono text-xs">{diffError}</div>
                                    <button
                                        type="button"
                                        onClick={() => void requestDiscard(discardCandidate)}
                                        className="mt-3 rounded-md bg-[#b91c1c] px-3 py-1.5 text-xs text-white hover:bg-[#991b1b] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-red-500"
                                    >
                                        重试
                                    </button>
                                </div>
                            ) : diffContent ? (
                                <DiffViewer diff={diffContent} maxHeight="calc(100vh - 230px)" />
                            ) : (
                                <div className="rounded-lg border border-dashed border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-4 py-8 text-center text-sm text-[var(--mm-text-secondary)]">
                                    没有可显示的 diff。
                                </div>
                            )}
                        </div>
                    ) : diffState === "loading" ? (
                        <div className="flex h-full items-center justify-center text-sm text-[var(--mm-text-secondary)]" role="status">
                            正在读取 diff...
                        </div>
                    ) : diffState === "error" ? (
                        <div className="flex h-full items-center justify-center p-6">
                            <div className="max-w-md rounded-lg border border-[#fecaca] bg-[#fef2f2] px-4 py-4 text-center text-sm text-[var(--color-error)]" role="alert">
                                <div className="font-medium">读取 diff 失败</div>
                                <div className="mt-1 break-all font-mono text-xs">{diffError}</div>
                                {selected && (
                                    <button
                                        type="button"
                                        onClick={() => void openChange(selected)}
                                        className="mt-3 rounded-md bg-[#b91c1c] px-3 py-1.5 text-xs text-white hover:bg-[#991b1b] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-red-500"
                                    >
                                        重试
                                    </button>
                                )}
                            </div>
                        </div>
                    ) : diffContent ? (
                        <DiffViewer diff={diffContent} maxHeight="calc(100vh - 170px)" />
                    ) : (
                        <div className="flex h-full items-center justify-center text-sm text-[var(--mm-text-secondary)]">
                            从左侧选择一个文件查看变更。
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
