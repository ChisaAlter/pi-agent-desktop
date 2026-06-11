import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isIpcError, type FileEntry, type FileTreeNode, type GitStatus, type TextFileContent } from "@shared";
import { DiffViewer } from "../DiffView/DiffViewer";

interface FileWorkspaceProps {
  workspacePath: string;
  initialTarget?: { path: string; mode?: "edit" | "diff"; nonce: number } | null;
}

type LoadState = "idle" | "loading" | "ready" | "error";
type ViewMode = "preview" | "edit" | "diff" | "conflict";
type GitMark = { label: "M" | "A" | "D" | "?"; className: string; text: string };
type SaveConflict = {
  disk: TextFileContent;
  draft: string;
  diff: string;
};

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function formatBytes(size?: number): string {
  if (size === undefined) return "-";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 102.4) / 10} KB`;
  return `${Math.round(size / 1024 / 102.4) / 10} MB`;
}

function flattenTree(node: FileTreeNode | null): FileTreeNode[] {
  if (!node) return [];
  const result: FileTreeNode[] = [];
  const walk = (item: FileTreeNode): void => {
    result.push(item);
    item.children?.forEach(walk);
  };
  walk(node);
  return result;
}

function lineRows(content: string): string[] {
  if (content.length === 0) return [""];
  return content.replace(/\r\n/g, "\n").split("\n");
}

function escapeDiffLine(line: string): string {
  return line.replace(/\r/g, "");
}

function makeConflictDiff(fileName: string, diskContent: string, draftContent: string): string {
  const oldLines = lineRows(diskContent).map(escapeDiffLine);
  const newLines = lineRows(draftContent).map(escapeDiffLine);
  const oldCount = Math.max(1, oldLines.length);
  const newCount = Math.max(1, newLines.length);
  const body = [
    ...oldLines.map((line) => `-${line}`),
    ...newLines.map((line) => `+${line}`),
  ].join("\n");
  return [
    `diff --git a/${fileName} b/${fileName}`,
    `--- a/${fileName}`,
    `+++ b/${fileName}`,
    `@@ -1,${oldCount} +1,${newCount} @@`,
    body,
  ].join("\n");
}

function modeLabel(mode: ViewMode): string {
  return {
    preview: "只读预览",
    edit: "编辑",
    diff: "Diff",
    conflict: "冲突",
  }[mode];
}

function modeDescription(mode: ViewMode): string {
  return {
    preview: "只读",
    edit: "可编辑",
    diff: "差异视图",
    conflict: "冲突视图",
  }[mode];
}

function nonEditableReason(content: TextFileContent | null): string | null {
  if (!content) return null;
  if (content.binary) return "二进制文件不可直接编辑";
  if (content.truncated) return "文件过大且已截断，暂不允许保存";
  return null;
}

function shellActionFailure(result: unknown): string | null {
  if (isIpcError(result)) return result.fallback;
  if (typeof result === "string" && result.trim()) return result;
  return null;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}

function relativeToWorkspace(path: string, workspacePath: string): string {
  const normalizedPath = normalizePath(path);
  const normalizedWorkspace = normalizePath(workspacePath).replace(/\/+$/, "");
  if (normalizedPath === normalizedWorkspace) return "";
  if (normalizedPath.startsWith(`${normalizedWorkspace}/`)) {
    return normalizedPath.slice(normalizedWorkspace.length + 1);
  }
  return normalizedPath;
}

function makeGitMarks(status: GitStatus | null): Map<string, GitMark> {
  const marks = new Map<string, GitMark>();
  const add = (files: string[], mark: GitMark): void => {
    files.forEach((file) => marks.set(normalizePath(file), mark));
  };
  if (!status) return marks;
  add(status.modified, { label: "M", className: "bg-[#dbeafe] text-[#1d4ed8]", text: "Modified" });
  add(status.added, { label: "A", className: "bg-[#dcfce7] text-[#166534]", text: "Added" });
  add(status.deleted, { label: "D", className: "bg-[#fee2e2] text-[#991b1b]", text: "Deleted" });
  add(status.untracked, { label: "?", className: "bg-[#f4f4f1] text-[#666]", text: "Untracked" });
  return marks;
}

function FileTreeRow({
  node,
  depth,
  selectedPath,
  expanded,
  gitMarks,
  workspacePath,
  onSelect,
  onToggle,
}: {
  node: FileTreeNode;
  depth: number;
  selectedPath?: string;
  expanded: Set<string>;
  gitMarks: Map<string, GitMark>;
  workspacePath: string;
  onSelect: (node: FileTreeNode) => void;
  onToggle: (node: FileTreeNode) => void;
}): React.JSX.Element {
  const isDirectory = node.type === "directory";
  const isExpanded = isDirectory && expanded.has(node.path);
  const hasChildren = (node.children?.length ?? 0) > 0;
  const gitMark = !isDirectory ? gitMarks.get(normalizePath(relativeToWorkspace(node.path, workspacePath))) : undefined;
  return (
    <li>
      <button
        type="button"
        onClick={() => {
          if (isDirectory) onToggle(node);
          onSelect(node);
        }}
        className={`flex h-8 w-full min-w-0 items-center gap-2 px-2 text-left text-xs transition-colors hover:bg-[#f4f4f1] ${
          selectedPath === node.path ? "bg-[#eef3ff] text-[#1d4ed8]" : "text-[var(--mm-text-primary)]"
        }`}
        style={{ paddingLeft: 8 + depth * 14 }}
        title={node.path}
        aria-expanded={isDirectory ? isExpanded : undefined}
      >
        <span className="w-3 shrink-0 text-[10px] text-[var(--mm-text-tertiary)]">
          {isDirectory && hasChildren ? (isExpanded ? "▾" : "▸") : ""}
        </span>
        <span className="shrink-0 font-mono text-[11px] text-[var(--mm-text-tertiary)]">
          {isDirectory ? "dir" : node.extension || "file"}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono">{node.name}</span>
        {gitMark && (
          <span
            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] font-bold ${gitMark.className}`}
            title={gitMark.text}
          >
            {gitMark.label}
          </span>
        )}
        {node.truncated && <span className="shrink-0 text-[10px] text-[#b45309]">截断</span>}
      </button>
      {isDirectory && isExpanded && node.children && node.children.length > 0 && (
        <ul className="m-0 list-none p-0">
          {node.children.map((child) => (
            <FileTreeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              expanded={expanded}
              gitMarks={gitMarks}
              workspacePath={workspacePath}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function SearchResultRow({
  file,
  gitMark,
  onOpen,
}: {
  file: FileEntry;
  gitMark?: GitMark;
  onOpen: (file: FileEntry) => Promise<void>;
}): React.JSX.Element {
  return (
    <li>
      <button
        type="button"
        onClick={() => void onOpen(file)}
        className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs hover:bg-[#f4f4f1]"
        title={file.path}
      >
        <span className="shrink-0 font-mono text-[11px] text-[var(--mm-text-tertiary)]">
          {file.isDirectory ? "dir" : basename(file.name).split(".").pop() ?? "file"}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono">{file.name}</span>
        {gitMark && (
          <span
            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] font-bold ${gitMark.className}`}
            title={gitMark.text}
          >
            {gitMark.label}
          </span>
        )}
      </button>
    </li>
  );
}

export function FileWorkspace({ workspacePath, initialTarget }: FileWorkspaceProps): React.JSX.Element {
  const [tree, setTree] = useState<FileTreeNode | null>(null);
  const [treeState, setTreeState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState<TextFileContent | null>(null);
  const [contentState, setContentState] = useState<LoadState>("idle");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<FileEntry[]>([]);
  const [searchState, setSearchState] = useState<LoadState>("idle");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchReloadKey, setSearchReloadKey] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saveState, setSaveState] = useState<LoadState>("idle");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveConflict, setSaveConflict] = useState<SaveConflict | null>(null);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("preview");
  const [diffState, setDiffState] = useState<LoadState>("idle");
  const [diffContent, setDiffContent] = useState("");
  const treeLoadSeq = useRef(0);
  const gitStatusSeq = useRef(0);
  const fileReadSeq = useRef(0);
  const diffReadSeq = useRef(0);

  const loadTree = useCallback(async () => {
    if (!window.piAPI?.filesGetTree) return;
    const requestId = treeLoadSeq.current + 1;
    treeLoadSeq.current = requestId;
    setTreeState("loading");
    setError(null);
    try {
      const result = await window.piAPI.filesGetTree(workspacePath, { maxDepth: 5, maxEntries: 1600 });
      if (requestId !== treeLoadSeq.current) return;
      if (isIpcError(result)) {
        setTreeState("error");
        setError(result.fallback);
        return;
      }
      setTree(result);
      setExpanded(new Set(flattenTree(result).filter((node) => node.type === "directory").map((node) => node.path)));
      setTreeState("ready");
    } catch (err) {
      if (requestId !== treeLoadSeq.current) return;
      setTreeState("error");
      setError(`加载文件树失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [workspacePath]);

  const loadGitStatus = useCallback(async () => {
    if (!window.piAPI?.getGitStatus) return;
    const requestId = gitStatusSeq.current + 1;
    gitStatusSeq.current = requestId;
    try {
      const result = await window.piAPI.getGitStatus(workspacePath);
      if (requestId !== gitStatusSeq.current) return;
      setGitStatus(isIpcError(result) ? null : result);
    } catch {
      if (requestId !== gitStatusSeq.current) return;
      setGitStatus(null);
    }
  }, [workspacePath]);

  useEffect(() => {
    treeLoadSeq.current += 1;
    gitStatusSeq.current += 1;
    fileReadSeq.current += 1;
    diffReadSeq.current += 1;
    setSelectedPath(null);
    setContent(null);
    setDraft("");
    setSaveConflict(null);
    setActionMessage(null);
    setActionError(null);
    setQuery("");
    setSearchResults([]);
    setSearchState("idle");
    setSearchError(null);
    setExpanded(new Set());
    void loadTree();
    void loadGitStatus();
  }, [loadGitStatus, loadTree]);

  useEffect(() => {
    if (!query.trim() || !window.piAPI?.filesSearch) {
      setSearchResults([]);
      setSearchState("idle");
      setSearchError(null);
      return;
    }
    let disposed = false;
    setSearchState("loading");
    setSearchError(null);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const result = await window.piAPI.filesSearch(workspacePath, query.trim(), { limit: 80 });
          if (disposed) return;
          if (isIpcError(result)) {
            setSearchResults([]);
            setSearchError(result.fallback);
            setSearchState("error");
            return;
          }
          setSearchResults(result);
          setSearchState("ready");
        } catch (err) {
          if (disposed) return;
          setSearchResults([]);
          setSearchError(err instanceof Error ? err.message : String(err));
          setSearchState("error");
        }
      })();
    }, 180);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [query, searchReloadKey, workspacePath]);

  const allFiles = useMemo(() => flattenTree(tree).filter((node) => node.type === "file"), [tree]);
  const selectedNode = useMemo(
    () => flattenTree(tree).find((node) => node.path === selectedPath) ?? null,
    [selectedPath, tree],
  );
  const previewLines = useMemo(() => lineRows(draft), [draft]);
  const gitMarks = useMemo(() => makeGitMarks(gitStatus), [gitStatus]);
  const selectedRelativePath = selectedPath ? relativeToWorkspace(selectedPath, workspacePath) : "";
  const selectedGitMark = selectedRelativePath ? gitMarks.get(normalizePath(selectedRelativePath)) : undefined;
  const gitMarkForPath = useCallback(
    (path: string) => gitMarks.get(normalizePath(relativeToWorkspace(path, workspacePath))),
    [gitMarks, workspacePath],
  );

  const isDirty = content != null && !content.binary && draft !== content.content;
  const canEdit = content != null && !content.binary && !content.truncated;
  const readonlyReason = nonEditableReason(content);
  const statusLine = useMemo(() => {
    if (!selectedPath) return `${allFiles.length} 个文件可浏览`;
    if (contentState === "loading") return "正在读取文件";
    if (contentState === "error") return error ?? "读取失败";
    if (saveConflict) return "保存冲突";
    if (viewMode === "diff") return diffState === "loading" ? "正在读取 diff" : "Git diff 视图";
    if (saveState === "error" && saveError) return "保存失败";
    if (isDirty) return "有未保存修改";
    return readonlyReason ?? modeLabel(viewMode);
  }, [allFiles.length, contentState, diffState, error, isDirty, readonlyReason, saveConflict, saveError, saveState, selectedPath, viewMode]);
  const selectedFileSize = content?.size ?? selectedNode?.size;
  const statusItems = useMemo(() => {
    if (!selectedPath) {
      return [
        { label: `${allFiles.length} files`, tone: "neutral" as const },
        { label: treeState === "loading" ? "loading tree" : treeState === "error" ? "tree error" : "ready", tone: treeState === "error" ? "danger" as const : "neutral" as const },
      ];
    }
    return [
      { label: modeDescription(viewMode), tone: viewMode === "edit" ? "active" as const : "neutral" as const },
      { label: contentState === "loading" ? "loading" : contentState === "error" ? "read error" : formatBytes(selectedFileSize), tone: contentState === "error" ? "danger" as const : "neutral" as const },
      { label: selectedGitMark ? `git ${selectedGitMark.label}` : "git clean", tone: selectedGitMark ? "active" as const : "neutral" as const },
      {
        label: saveConflict ? "conflict" : saveState === "loading" ? "saving" : saveState === "error" ? "save failed" : isDirty ? "dirty" : "saved",
        tone: saveState === "error" ? "danger" as const : isDirty ? "warning" as const : "neutral" as const,
      },
    ];
  }, [allFiles.length, contentState, isDirty, saveConflict, saveState, selectedFileSize, selectedGitMark, selectedPath, treeState, viewMode]);

  const openFile = useCallback(async (path: string, opts?: { force?: boolean }) => {
    if (!window.piAPI?.filesReadTextFile) return;
    if (!opts?.force && isDirty) {
      const shouldDiscard = window.confirm("当前文件有未保存修改，切换文件将丢弃这些修改。继续？");
      if (!shouldDiscard) return;
    }
    const requestId = fileReadSeq.current + 1;
    fileReadSeq.current = requestId;
    diffReadSeq.current += 1;
    setSelectedPath(path);
    setSaveMessage(null);
    setSaveError(null);
    setSaveConflict(null);
    setViewMode("preview");
    setDiffContent("");
    setDiffState("idle");
    setContentState("loading");
    try {
      const result = await window.piAPI.filesReadTextFile(path, workspacePath);
      if (requestId !== fileReadSeq.current) return;
      if (isIpcError(result)) {
        setContent(null);
        setDraft("");
        setError(result.fallback);
        setContentState("error");
        return;
      }
      setError(null);
      setActionError(null);
      setContent(result);
      setDraft(result.content);
      setViewMode("preview");
      setContentState("ready");
    } catch (err) {
      if (requestId !== fileReadSeq.current) return;
      setContent(null);
      setDraft("");
      setError(`读取文件失败: ${err instanceof Error ? err.message : String(err)}`);
      setContentState("error");
    }
  }, [isDirty, workspacePath]);

  const discardDraft = (): void => {
    if (!content) return;
    setDraft(content.content);
    setSaveState("idle");
    setSaveError(null);
    setSaveMessage("已丢弃未保存修改");
    window.setTimeout(() => setSaveMessage(null), 1600);
  };

  const saveDraft = async (): Promise<void> => {
    if (!content || !selectedPath || !window.piAPI?.filesWriteTextFile || !canEdit || viewMode !== "edit") return;
    setSaveState("loading");
    setSaveMessage(null);
    setSaveError(null);
    setSaveConflict(null);
    let result: Awaited<ReturnType<NonNullable<typeof window.piAPI.filesWriteTextFile>>>;
    try {
      result = await window.piAPI.filesWriteTextFile(selectedPath, draft, workspacePath, { expectedMtimeMs: content.mtimeMs });
    } catch (err) {
      const message = `保存失败: ${err instanceof Error ? err.message : String(err)}`;
      setError(message);
      setSaveMessage(message);
      setSaveError(message);
      setSaveState("error");
      return;
    }
    if (isIpcError(result)) {
      setError(result.fallback);
      setSaveMessage(result.fallback);
      setSaveError(result.fallback);
      setSaveState("error");
      if (result.code === "ipcErrors.files.writeConflict" && window.piAPI.filesReadTextFile) {
        const diskResult = await window.piAPI.filesReadTextFile(selectedPath, workspacePath);
        if (!isIpcError(diskResult) && !diskResult.binary && !diskResult.truncated) {
          setSaveConflict({
            disk: diskResult,
            draft,
            diff: makeConflictDiff(basename(selectedPath), diskResult.content, draft),
          });
          setViewMode("conflict");
        }
      }
      return;
    }
    const nextContent = {
      ...content,
      content: draft,
      size: result.size,
      mtimeMs: result.mtimeMs,
      truncated: false,
      binary: false,
    };
    setContent(nextContent);
    setSaveState("ready");
    setSaveError(null);
    setSaveConflict(null);
    setSaveMessage("已保存");
    window.setTimeout(() => setSaveMessage(null), 1600);
    window.dispatchEvent(
      new CustomEvent("workspace:file-saved", {
        detail: { path: selectedPath, workspacePath, size: result.size, savedAt: result.savedAt },
      }),
    );
    window.dispatchEvent(
      new CustomEvent("workspace:git-changed", {
        detail: { workspacePath, files: [selectedRelativePath], reason: "file-save" },
      }),
    );
    void loadTree();
    void loadGitStatus();
  };

  const openSelectedDiff = useCallback(async (): Promise<void> => {
    if (!selectedPath || !selectedRelativePath || !window.piAPI?.gitDiff) return;
    const requestId = diffReadSeq.current + 1;
    diffReadSeq.current = requestId;
    setViewMode("diff");
    setDiffState("loading");
    setDiffContent("");
    try {
      const diff = await window.piAPI.gitDiff(workspacePath, selectedRelativePath);
      if (requestId !== diffReadSeq.current) return;
      if (isIpcError(diff)) {
        setDiffContent("");
        setError(diff.fallback);
        setDiffState("error");
        return;
      }
      setDiffContent(diff);
      setDiffState("ready");
    } catch (err) {
      if (requestId !== diffReadSeq.current) return;
      setDiffContent("");
      setError(err instanceof Error ? err.message : String(err));
      setDiffState("error");
    }
  }, [selectedPath, selectedRelativePath, workspacePath]);

  useEffect(() => {
    const onGitChanged = (event: Event): void => {
      const detail = (event as CustomEvent<{ workspacePath?: string; files?: string[] }>).detail;
      if (!detail?.workspacePath || detail.workspacePath === workspacePath) {
        void loadGitStatus();
        if (
          viewMode === "diff"
          && selectedRelativePath
          && (!detail?.files || detail.files.includes(selectedRelativePath))
        ) {
          void openSelectedDiff();
        }
      }
    };
    window.addEventListener("workspace:git-changed", onGitChanged);
    return () => window.removeEventListener("workspace:git-changed", onGitChanged);
  }, [loadGitStatus, openSelectedDiff, selectedRelativePath, viewMode, workspacePath]);

  useEffect(() => {
    if (!initialTarget?.path) return;
    void (async () => {
      await openFile(initialTarget.path, { force: true });
      if (initialTarget.mode === "diff") {
        const relativePath = relativeToWorkspace(initialTarget.path, workspacePath);
        if (!relativePath || !window.piAPI?.gitDiff) return;
        setViewMode("diff");
        setDiffState("loading");
        setDiffContent("");
        const requestId = diffReadSeq.current + 1;
        diffReadSeq.current = requestId;
        try {
          const diff = await window.piAPI.gitDiff(workspacePath, relativePath);
          if (requestId !== diffReadSeq.current) return;
          if (isIpcError(diff)) {
            setDiffContent("");
            setError(diff.fallback);
            setDiffState("error");
            return;
          }
          setDiffContent(diff);
          setDiffState("ready");
        } catch (err) {
          if (requestId !== diffReadSeq.current) return;
          setDiffContent("");
          setError(err instanceof Error ? err.message : String(err));
          setDiffState("error");
        }
      }
    })();
  }, [initialTarget?.nonce, initialTarget?.path, initialTarget?.mode, openFile, workspacePath]);

  const handleSelectNode = (node: FileTreeNode): void => {
    if (node.type === "file") void openFile(node.path);
    else setSelectedPath(node.path);
  };

  const openSearchResult = async (file: FileEntry): Promise<void> => {
    if (!file.isDirectory) {
      await openFile(file.path);
      return;
    }
    if (isDirty) {
      const shouldDiscard = window.confirm("当前文件有未保存修改，切换目录将丢弃这些修改。继续？");
      if (!shouldDiscard) return;
    }
    setSelectedPath(file.path);
    setContent(null);
    setDraft("");
    setSaveMessage(null);
    setSaveError(null);
    setSaveConflict(null);
    setViewMode("preview");
    setDiffContent("");
    setDiffState("idle");
    setContentState("idle");
    setActionError(null);
    setActionMessage("已选中目录");
    setExpanded((current) => new Set([...current, file.path]));
    window.setTimeout(() => setActionMessage(null), 1600);
  };

  const handleEditorKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      if (isDirty && viewMode === "edit") void saveDraft();
    }
  };

  const toggleDirectory = (node: FileTreeNode): void => {
    if (node.type !== "directory") return;
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(node.path)) next.delete(node.path);
      else next.add(node.path);
      return next;
    });
  };

  const copySelectedPath = async (): Promise<void> => {
    if (!selectedPath) return;
    try {
      await navigator.clipboard?.writeText(selectedPath);
      setCopied(true);
      setActionError(null);
      setActionMessage("已复制绝对路径");
      window.setTimeout(() => setCopied(false), 1400);
      window.setTimeout(() => setActionMessage(null), 1600);
    } catch (err) {
      setCopied(false);
      setActionMessage(null);
      setActionError(`复制路径失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const copySelectedRelativePath = async (): Promise<void> => {
    if (!selectedPath) return;
    const relativePath = relativeToWorkspace(selectedPath, workspacePath) || selectedPath;
    try {
      await navigator.clipboard?.writeText(relativePath);
      setActionError(null);
      setActionMessage("已复制相对路径");
      window.setTimeout(() => setActionMessage(null), 1600);
    } catch (err) {
      setActionMessage(null);
      setActionError(`复制相对路径失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const openSelectedPath = async (): Promise<void> => {
    if (!selectedPath || !window.piAPI?.openPath) return;
    try {
      const result = await window.piAPI.openPath(selectedPath);
      const failure = shellActionFailure(result);
      if (failure) {
        setActionMessage(null);
        setActionError(failure);
        return;
      }
    } catch (err) {
      setActionMessage(null);
      setActionError(`系统打开失败: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    setActionError(null);
    setActionMessage("已请求系统打开");
    window.setTimeout(() => setActionMessage(null), 1600);
  };

  const revealSelectedPath = async (): Promise<void> => {
    if (!selectedPath || !window.piAPI?.revealPath) return;
    try {
      const result = await window.piAPI.revealPath(selectedPath);
      const failure = shellActionFailure(result);
      if (failure) {
        setActionMessage(null);
        setActionError(failure);
        return;
      }
    } catch (err) {
      setActionMessage(null);
      setActionError(`系统定位失败: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    setActionError(null);
    setActionMessage("已请求系统定位");
    window.setTimeout(() => setActionMessage(null), 1600);
  };

  const copySaveError = async (): Promise<void> => {
    if (!saveError) return;
    try {
      await navigator.clipboard?.writeText(saveError);
    } catch (err) {
      setActionMessage(null);
      setActionError(`复制错误信息失败: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    setActionError(null);
    setSaveMessage("已复制错误信息");
    window.setTimeout(() => {
      setSaveMessage(saveError);
    }, 1400);
  };

  const copyDraft = async (): Promise<void> => {
    try {
      await navigator.clipboard?.writeText(draft);
    } catch (err) {
      setActionMessage(null);
      setActionError(`复制草稿失败: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    setActionError(null);
    setSaveMessage("已复制当前草稿");
    window.setTimeout(() => {
      if (saveError) setSaveMessage(saveError);
      else setSaveMessage(null);
    }, 1400);
  };

  const reloadSelectedFile = async (): Promise<void> => {
    if (!selectedPath) return;
    await openFile(selectedPath, { force: true });
    setSaveMessage("已重新读取磁盘文件");
    window.setTimeout(() => setSaveMessage(null), 1600);
  };

  const useDiskVersion = (): void => {
    if (!saveConflict) return;
    setContent(saveConflict.disk);
    setDraft(saveConflict.disk.content);
    setSaveConflict(null);
    setSaveError(null);
    setSaveState("idle");
    setSaveMessage("已采用磁盘版本");
    setViewMode("preview");
    window.setTimeout(() => setSaveMessage(null), 1600);
  };

  const continueEditingDraft = (): void => {
    if (!saveConflict) return;
    setDraft(saveConflict.draft);
    setViewMode("edit");
  };

  const showConflictDiff = (): void => {
    if (!saveConflict) return;
    setViewMode("conflict");
  };

  const sendToChat = (): void => {
    if (!selectedPath) return;
    window.dispatchEvent(
      new CustomEvent("chatpanel:prefill", { detail: { text: `@${selectedPath} ` } }),
    );
    window.dispatchEvent(
      new CustomEvent("app:switch-section", { detail: { section: "chat" } }),
    );
  };

  return (
    <div className="flex h-full min-h-0 bg-[var(--mm-bg-main)] text-[var(--mm-text-primary)]" role="region" aria-label="文件工作区">
      <aside className="flex h-full w-[300px] shrink-0 flex-col border-r border-[#e5e5df] bg-white">
        <div className="border-b border-[#ecece7] px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h1 className="m-0 text-sm font-semibold">Files</h1>
              <p className="m-0 mt-1 truncate font-mono text-[11px] text-[var(--mm-text-tertiary)]" title={workspacePath}>
                {workspacePath}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadTree()}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--mm-text-secondary)] hover:bg-[#f4f4f1]"
              aria-label="刷新文件树"
              title="刷新"
            >
              ↻
            </button>
          </div>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="mt-3 h-8 w-full rounded-md border border-[#deded8] bg-[#fbfbfa] px-2 text-xs outline-none focus:border-[#999]"
            placeholder="搜索文件"
            aria-label="搜索文件"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {query.trim() ? (
            <ul className="m-0 list-none p-2">
              {searchState === "loading" && (
                <li className="px-2 py-6 text-center text-xs text-[var(--mm-text-secondary)]">正在搜索文件...</li>
              )}
              {searchState === "error" && (
                <li className="rounded-md border border-[#fecaca] bg-[#fef2f2] px-3 py-3 text-xs text-[#b91c1c]" role="alert">
                  <div className="font-medium">文件搜索失败</div>
                  <div className="mt-1 break-all font-mono text-[11px]">{searchError}</div>
                  <button
                    type="button"
                    onClick={() => setSearchReloadKey((key) => key + 1)}
                    className="mt-2 rounded-md bg-[#b91c1c] px-2 py-1 text-[11px] text-white hover:bg-[#991b1b]"
                  >
                    重试
                  </button>
                </li>
              )}
              {searchState !== "loading" && searchState !== "error" && searchResults.map((file) => (
                <SearchResultRow key={file.path} file={file} gitMark={gitMarkForPath(file.path)} onOpen={openSearchResult} />
              ))}
              {searchState !== "loading" && searchState !== "error" && searchResults.length === 0 && (
                <li className="px-2 py-6 text-center text-xs text-[var(--mm-text-secondary)]">没有匹配文件</li>
              )}
            </ul>
          ) : treeState === "loading" ? (
            <div className="px-4 py-6 text-xs text-[var(--mm-text-secondary)]">正在读取文件树...</div>
          ) : treeState === "error" ? (
            <div className="m-3 rounded-md border border-[#fecaca] bg-[#fef2f2] px-3 py-3 text-xs text-[#b91c1c]" role="alert">
              <div className="font-medium">文件树加载失败</div>
              <div className="mt-1 break-all font-mono text-[11px]">{error}</div>
              <button
                type="button"
                onClick={() => void loadTree()}
                className="mt-2 rounded-md bg-[#b91c1c] px-2 py-1 text-[11px] text-white hover:bg-[#991b1b]"
              >
                重试
              </button>
            </div>
          ) : tree ? (
            allFiles.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-[var(--mm-text-secondary)]">目录为空</div>
            ) : (
            <ul className="m-0 list-none p-2">
              <FileTreeRow
                node={tree}
                depth={0}
                selectedPath={selectedPath ?? undefined}
                expanded={expanded}
                onSelect={handleSelectNode}
                onToggle={toggleDirectory}
                gitMarks={gitMarks}
                workspacePath={workspacePath}
              />
            </ul>
            )
          ) : null}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 items-center justify-between gap-3 border-b border-[#e5e5df] bg-white px-4">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <div className="truncate font-mono text-sm">{selectedNode?.name ?? content?.name ?? "选择一个文件开始预览"}</div>
              {isDirty && <span className="shrink-0 rounded bg-[#fff7ed] px-1.5 py-0.5 text-[10px] font-medium text-[#c2410c]">未保存</span>}
              {saveState === "error" && <span className="shrink-0 rounded bg-[#fef2f2] px-1.5 py-0.5 text-[10px] font-medium text-[#b91c1c]">{saveConflict ? "保存冲突" : "保存失败"}</span>}
              {selectedPath && <span className="shrink-0 rounded bg-[#f4f4f1] px-1.5 py-0.5 text-[10px] text-[var(--mm-text-secondary)]">{modeLabel(viewMode)}</span>}
              {selectedGitMark && <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${selectedGitMark.className}`}>{selectedGitMark.label}</span>}
            </div>
            <div className="truncate text-[11px] text-[var(--mm-text-tertiary)]">
              {selectedPath ?? statusLine}
            </div>
          </div>
          {selectedPath && (
            <div className="flex shrink-0 items-center gap-1">
              {canEdit && viewMode !== "diff" && viewMode !== "conflict" && (
                <>
                  {viewMode === "preview" ? (
                    <button type="button" onClick={() => setViewMode("edit")} className="rounded-md bg-[#1f1f1f] px-2 py-1 text-xs text-white hover:bg-[#333]">编辑</button>
                  ) : (
                    <>
                      <button type="button" onClick={() => setViewMode("preview")} disabled={isDirty} className="rounded-md px-2 py-1 text-xs hover:bg-[#f4f4f1] disabled:opacity-40">只读</button>
                      <button type="button" onClick={discardDraft} disabled={!isDirty} className="rounded-md px-2 py-1 text-xs hover:bg-[#f4f4f1] disabled:opacity-40">丢弃修改</button>
                      <button type="button" onClick={() => void saveDraft()} disabled={!isDirty || saveState === "loading"} className="rounded-md bg-[#1f1f1f] px-2 py-1 text-xs text-white hover:bg-[#333] disabled:opacity-40">
                        {saveState === "loading" ? "保存中" : "保存"}
                      </button>
                    </>
                  )}
                </>
              )}
              {selectedGitMark && (
                <button type="button" onClick={() => void openSelectedDiff()} className="rounded-md px-2 py-1 text-xs hover:bg-[#f4f4f1]">查看 Diff</button>
              )}
              {viewMode === "diff" && (
                <button type="button" onClick={() => setViewMode("preview")} className="rounded-md px-2 py-1 text-xs hover:bg-[#f4f4f1]">返回预览</button>
              )}
              {viewMode === "conflict" && saveConflict && (
                <button type="button" onClick={continueEditingDraft} className="rounded-md px-2 py-1 text-xs hover:bg-[#f4f4f1]">继续编辑</button>
              )}
              {saveConflict && viewMode !== "conflict" && (
                <button type="button" onClick={showConflictDiff} className="rounded-md px-2 py-1 text-xs text-[#b91c1c] hover:bg-[#fef2f2]">查看冲突</button>
              )}
              <button type="button" onClick={() => void openSelectedPath()} className="rounded-md px-2 py-1 text-xs hover:bg-[#f4f4f1]">打开</button>
              <button type="button" onClick={() => void revealSelectedPath()} className="rounded-md px-2 py-1 text-xs hover:bg-[#f4f4f1]">定位</button>
              <button type="button" onClick={() => void copySelectedPath()} className="rounded-md px-2 py-1 text-xs hover:bg-[#f4f4f1]">{copied ? "已复制" : "复制路径"}</button>
              <button type="button" onClick={() => void copySelectedRelativePath()} className="rounded-md px-2 py-1 text-xs hover:bg-[#f4f4f1]">复制相对路径</button>
              <button type="button" onClick={sendToChat} className="rounded-md bg-[#1f1f1f] px-2 py-1 text-xs text-white hover:bg-[#333]">引用到聊天</button>
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-[#fbfbfa]">
          {!selectedPath ? (
            <div className="flex h-full items-center justify-center text-sm text-[var(--mm-text-secondary)]">
              从左侧文件树或搜索结果中选择文件。
            </div>
          ) : viewMode === "diff" ? (
            <div className="p-4">
              {diffState === "loading" ? (
                <div className="text-sm text-[var(--mm-text-secondary)]">正在读取 diff...</div>
              ) : diffState === "error" ? (
                <div className="text-sm text-[#b91c1c]">{error}</div>
              ) : diffContent ? (
                <DiffViewer diff={diffContent} maxHeight="calc(100vh - 160px)" />
              ) : (
                <div className="rounded-lg border border-dashed border-[#deded8] bg-white px-4 py-8 text-center text-sm text-[var(--mm-text-secondary)]">
                  当前文件没有可显示的工作区 diff。
                </div>
              )}
            </div>
          ) : saveConflict && viewMode === "conflict" ? (
            <div className="flex min-h-full flex-col p-4">
              <div className="mb-3 rounded-md border border-[#fed7aa] bg-[#fff7ed] px-3 py-2 text-xs text-[#9a3412]" role="alert">
                磁盘文件已在外部发生变化。下面显示“磁盘版本”到“当前草稿”的差异，草稿仍保留在编辑器中。
              </div>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <button type="button" onClick={continueEditingDraft} className="rounded-md border border-[#e8e8e3] bg-white px-2 py-1 text-xs hover:bg-[#f4f4f1]">
                  继续编辑草稿
                </button>
                <button type="button" onClick={useDiskVersion} className="rounded-md border border-[#e8e8e3] bg-white px-2 py-1 text-xs hover:bg-[#f4f4f1]">
                  采用磁盘版本
                </button>
                <button type="button" onClick={() => void copyDraft()} className="rounded-md border border-[#e8e8e3] bg-white px-2 py-1 text-xs hover:bg-[#f4f4f1]">
                  复制草稿
                </button>
              </div>
              <DiffViewer diff={saveConflict.diff} maxHeight="calc(100vh - 230px)" />
            </div>
          ) : contentState === "loading" ? (
            <div className="p-5 text-sm text-[var(--mm-text-secondary)]">正在读取文件...</div>
          ) : contentState === "error" ? (
            <div className="p-5 text-sm text-[#b91c1c]">{error}</div>
          ) : content?.binary ? (
            <div className="m-5 rounded-lg border border-[#ecece7] bg-white p-4 text-sm text-[var(--mm-text-secondary)]">
              二进制文件暂不预览，可使用“打开”或“定位”查看。
            </div>
          ) : content?.truncated ? (
            <div className="m-5 rounded-lg border border-[#ecece7] bg-white p-4 text-sm text-[var(--mm-text-secondary)]">
              文件过大，当前只显示前 512KB。为避免误保存，截断文件暂不可编辑。
            </div>
          ) : content && viewMode === "preview" ? (
            <div className="grid min-h-full grid-cols-[58px_minmax(0,1fr)] overflow-auto font-mono text-[12px] leading-5 text-[#1f2937]">
              <div className="select-none border-r border-[#ecece7] bg-[#f7f7f4] py-3 text-right text-[11px] text-[var(--mm-text-tertiary)]">
                {previewLines.map((_, index) => (
                  <div key={index} className="h-5 px-3">{index + 1}</div>
                ))}
              </div>
              <pre className="m-0 min-h-full whitespace-pre-wrap break-words px-3 py-3 font-mono text-[12px] leading-5" aria-label="文件只读预览">
                {draft}
              </pre>
            </div>
          ) : content ? (
            <div className="grid min-h-full grid-cols-[58px_minmax(0,1fr)] overflow-auto font-mono text-[12px] leading-5 text-[#1f2937]">
              <div className="select-none border-r border-[#ecece7] bg-[#f7f7f4] py-3 text-right text-[11px] text-[var(--mm-text-tertiary)]">
                {previewLines.map((_, index) => (
                  <div key={index} className="h-5 px-3">{index + 1}</div>
                ))}
              </div>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleEditorKeyDown}
                spellCheck={false}
                aria-label="编辑文件内容"
                className="min-h-full w-full resize-none border-0 bg-transparent px-3 py-3 font-mono text-[12px] leading-5 outline-none"
              />
            </div>
          ) : null}
        </div>
        <div className="flex h-8 shrink-0 items-center justify-between gap-3 border-t border-[#e5e5df] bg-white px-3 text-[11px] text-[var(--mm-text-tertiary)]" aria-label="文件状态栏">
          <div className="min-w-0 truncate font-mono">
            {selectedPath ? relativeToWorkspace(selectedPath, workspacePath) || selectedPath : statusLine}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {statusItems.map((item) => (
              <span
                key={item.label}
                className={`rounded px-1.5 py-0.5 ${
                  item.tone === "danger"
                    ? "bg-[#fef2f2] text-[#b91c1c]"
                    : item.tone === "warning"
                      ? "bg-[#fff7ed] text-[#c2410c]"
                      : item.tone === "active"
                        ? "bg-[#eef3ff] text-[#1d4ed8]"
                        : "bg-[#f7f7f4] text-[var(--mm-text-secondary)]"
                }`}
              >
                {item.label}
              </span>
            ))}
            {actionMessage && <span className="rounded bg-[#ecfdf5] px-1.5 py-0.5 text-[#166534]">{actionMessage}</span>}
            {actionError && <span className="rounded bg-[#fef2f2] px-1.5 py-0.5 text-[#b91c1c]">{actionError}</span>}
          </div>
        </div>
      </main>

      <aside className="hidden h-full w-[240px] shrink-0 border-l border-[#e5e5df] bg-white p-4 text-xs lg:block">
        <h2 className="m-0 mb-3 text-sm font-semibold">文件信息</h2>
        <dl className="space-y-3">
          <div>
            <dt className="text-[var(--mm-text-tertiary)]">名称</dt>
            <dd className="m-0 mt-1 truncate font-mono">{content?.name ?? (selectedPath ? basename(selectedPath) : "-")}</dd>
          </div>
          <div>
            <dt className="text-[var(--mm-text-tertiary)]">大小</dt>
            <dd className="m-0 mt-1 font-mono">{formatBytes(content?.size ?? selectedNode?.size)}</dd>
          </div>
          <div>
            <dt className="text-[var(--mm-text-tertiary)]">状态</dt>
            <dd className="m-0 mt-1">{selectedPath ? statusLine : "-"}</dd>
          </div>
          {readonlyReason && (
            <div>
              <dt className="text-[var(--mm-text-tertiary)]">限制</dt>
              <dd className="m-0 mt-1 text-[#92400e]">{readonlyReason}</dd>
            </div>
          )}
          <div>
            <dt className="text-[var(--mm-text-tertiary)]">模式</dt>
            <dd className="m-0 mt-1">{selectedPath ? modeLabel(viewMode) : "-"}</dd>
          </div>
          <div>
            <dt className="text-[var(--mm-text-tertiary)]">Git</dt>
            <dd className="m-0 mt-1">{selectedGitMark ? `${selectedGitMark.text} (${selectedGitMark.label})` : selectedPath ? "未变更" : "-"}</dd>
          </div>
          {saveMessage && (
            <div>
              <dt className="text-[var(--mm-text-tertiary)]">保存状态</dt>
              <dd className={`m-0 mt-1 ${saveState === "error" ? "text-[#b91c1c]" : "text-[#166534]"}`}>{saveMessage}</dd>
            </div>
          )}
          {(actionMessage || actionError) && (
            <div>
              <dt className="text-[var(--mm-text-tertiary)]">最近操作</dt>
              <dd className={`m-0 mt-1 ${actionError ? "text-[#b91c1c]" : "text-[#166534]"}`}>
                {actionError ?? actionMessage}
              </dd>
            </div>
          )}
          {saveError && (
            <div>
              <dt className="text-[var(--mm-text-tertiary)]">{saveConflict ? "冲突处理" : "恢复"}</dt>
              <dd className="m-0 mt-2 flex flex-wrap gap-1">
                <button type="button" onClick={() => void saveDraft()} disabled={saveState === "loading" || !isDirty} className="rounded-md border border-[#1f1f1f] bg-[#1f1f1f] px-2 py-1 text-white disabled:opacity-40">
                  重试保存
                </button>
                {saveConflict && (
                  <>
                    <button type="button" onClick={useDiskVersion} className="rounded-md border border-[#e8e8e3] px-2 py-1">
                      采用磁盘版本
                    </button>
                    <button type="button" onClick={continueEditingDraft} className="rounded-md border border-[#e8e8e3] px-2 py-1">
                      继续编辑
                    </button>
                    <button type="button" onClick={showConflictDiff} className="rounded-md border border-[#e8e8e3] px-2 py-1">
                      查看冲突
                    </button>
                  </>
                )}
                <button type="button" onClick={() => void copySaveError()} className="rounded-md border border-[#e8e8e3] px-2 py-1">
                  复制错误
                </button>
                <button type="button" onClick={() => void copyDraft()} className="rounded-md border border-[#e8e8e3] px-2 py-1">
                  复制草稿
                </button>
                <button type="button" onClick={() => void reloadSelectedFile()} className="rounded-md border border-[#e8e8e3] px-2 py-1">
                  重新读取文件
                </button>
              </dd>
            </div>
          )}
          <div>
            <dt className="text-[var(--mm-text-tertiary)]">操作</dt>
            <dd className="m-0 mt-2 flex flex-wrap gap-1">
              <button type="button" disabled={!selectedPath} onClick={() => void copySelectedPath()} className="rounded-md border border-[#e8e8e3] px-2 py-1 disabled:opacity-40">
                {copied ? "已复制" : "复制路径"}
              </button>
              <button type="button" disabled={!selectedPath} onClick={() => void copySelectedRelativePath()} className="rounded-md border border-[#e8e8e3] px-2 py-1 disabled:opacity-40">
                复制相对路径
              </button>
              <button type="button" disabled={!selectedPath} onClick={sendToChat} className="rounded-md border border-[#1f1f1f] bg-[#1f1f1f] px-2 py-1 text-white disabled:opacity-40">
                引用
              </button>
            </dd>
          </div>
        </dl>
      </aside>
    </div>
  );
}
