import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isIpcError, type FileEntry, type FileTreeNode, type GitStatus, type TextFileContent } from "@shared";
import { DiffViewer } from "../DiffView/DiffViewer";
import { MonacoEditor, getLanguageFromFilename } from "../Editor/MonacoEditor";
import { useSettingsStore } from "../../stores/settings-store";
import { useI18n } from "../../i18n";
import {
  type LoadState, type ViewMode, type GitMark, type SaveConflict,
  basename, formatBytes, flattenTree, makeConflictDiff, lineRows,
  shellActionFailure,
  normalizePath, relativeToWorkspace, resolveWorkspacePath, makeGitMarks,
} from "./file-workspace-utils";
import { useLatestRequest } from "./hooks/useLatestRequest";
import { useDebouncedSave } from "./hooks/useDebouncedSave";

interface FileWorkspaceProps {
  workspacePath: string;
  workspaceId?: string;
  initialTarget?: { path: string; mode?: "edit" | "diff"; nonce: number } | null;
}

const AUTO_SAVE_DELAY_MS = 700;

function FileTreeRow({
  node,
  depth,
  selectedPath,
  expanded,
  gitMarks,
  workspacePath,
  truncatedLabel,
  onSelect,
  onToggle,
}: {
  node: FileTreeNode;
  depth: number;
  selectedPath?: string;
  expanded: Set<string>;
  gitMarks: Map<string, GitMark>;
  workspacePath: string;
  truncatedLabel: string;
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
        className={`flex h-8 w-full min-w-0 items-center gap-2 px-2 text-left text-xs transition-colors hover:bg-[var(--mm-bg-sidebar)] ${
          selectedPath === node.path ? "bg-[#eef3ff] text-[var(--color-info)]" : "text-[var(--mm-text-primary)]"
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
        {node.truncated && <span className="shrink-0 text-[10px] text-[#b45309]">{truncatedLabel}</span>}
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
              truncatedLabel={truncatedLabel}
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
        className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs hover:bg-[var(--mm-bg-sidebar)]"
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

export function FileWorkspace({ workspacePath, workspaceId, initialTarget }: FileWorkspaceProps): React.JSX.Element {
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
  // TODO: consolidate state into useReducer slices (Phase 2 SubTask 27.3 deferred).
  const treeLoadReq = useLatestRequest();
  const gitStatusReq = useLatestRequest();
  const fileReadReq = useLatestRequest();
  const diffReadReq = useLatestRequest();
  const lastAutoSaveAttemptRef = useRef<{ path: string | null; draft: string } | null>(null);
  const isDirtyRef = useRef(false);
  const autoSave = useSettingsStore((state) => state.settings.autoSave);
  const showLineNumbers = useSettingsStore((state) => state.settings.showLineNumbers);
  const wordWrap = useSettingsStore((state) => state.settings.wordWrap);
  const { t } = useI18n();
  const modeLabelText = useCallback((mode: ViewMode) => t(`fileWorkspace.mode.${mode}.label`), [t]);
  const modeDescriptionText = useCallback((mode: ViewMode) => t(`fileWorkspace.mode.${mode}.description`), [t]);

  // Sync currently-viewed file to main process (workbench context)
  useEffect(() => {
    if (workspaceId && window.piAPI?.setWorkbenchContext) {
      window.piAPI.setWorkbenchContext(workspaceId, selectedPath);
    }
  }, [selectedPath, workspaceId]);

  const loadTree = useCallback(async () => {
    if (!window.piAPI?.filesGetTree) return;
    const requestId = treeLoadReq.begin();
    setTreeState("loading");
    setError(null);
    try {
      const result = await window.piAPI.filesGetTree(workspacePath, { maxDepth: 5, maxEntries: 1600 });
      if (!treeLoadReq.isLatest(requestId)) return;
      if (isIpcError(result)) {
        setTreeState("error");
        setError(result.fallback);
        return;
      }
      setTree(result);
      setExpanded(new Set(flattenTree(result).filter((node) => node.type === "directory").map((node) => node.path)));
      setTreeState("ready");
    } catch (err) {
      if (!treeLoadReq.isLatest(requestId)) return;
      setTreeState("error");
      setError(t("fileWorkspace.tree.loadFailed", { message: err instanceof Error ? err.message : String(err) }));
    }
  }, [t, treeLoadReq, workspacePath]);

  const loadGitStatus = useCallback(async () => {
    if (!window.piAPI?.getGitStatus) return;
    const requestId = gitStatusReq.begin();
    try {
      const result = await window.piAPI.getGitStatus(workspacePath);
      if (!gitStatusReq.isLatest(requestId)) return;
      setGitStatus(isIpcError(result) ? null : result);
    } catch {
      if (!gitStatusReq.isLatest(requestId)) return;
      setGitStatus(null);
    }
  }, [gitStatusReq, workspacePath]);

  useEffect(() => {
    treeLoadReq.cancel();
    gitStatusReq.cancel();
    fileReadReq.cancel();
    diffReadReq.cancel();
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
  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);
  const canEdit = content != null && !content.binary && !content.truncated;
  const readonlyReason = content?.binary
    ? t("fileWorkspace.readonly.binary")
    : content?.truncated
      ? t("fileWorkspace.readonly.truncated")
      : null;
  const statusLine = useMemo(() => {
    if (!selectedPath) return t("fileWorkspace.status.browse", { count: allFiles.length });
    if (contentState === "loading") return t("fileWorkspace.status.reading");
    if (contentState === "error") return error ?? t("fileWorkspace.status.readFailed");
    if (saveConflict) return t("fileWorkspace.status.conflict");
    if (viewMode === "diff") return diffState === "loading" ? t("fileWorkspace.status.diffLoading") : t("fileWorkspace.status.diffView");
    if (saveState === "error" && saveError) return t("fileWorkspace.status.saveFailed");
    if (isDirty) return t("fileWorkspace.status.dirty");
    return readonlyReason ?? modeLabelText(viewMode);
  }, [allFiles.length, contentState, diffState, error, isDirty, modeLabelText, readonlyReason, saveConflict, saveError, saveState, selectedPath, t, viewMode]);
  const selectedFileSize = content?.size ?? selectedNode?.size;
  const statusItems = useMemo(() => {
    if (!selectedPath) {
      return [
        { label: `${allFiles.length} files`, tone: "neutral" as const },
        { label: treeState === "loading" ? t("fileWorkspace.status.loadingTree") : treeState === "error" ? t("fileWorkspace.status.treeError") : t("fileWorkspace.status.ready"), tone: treeState === "error" ? "danger" as const : "neutral" as const },
      ];
    }
    return [
      { label: modeDescriptionText(viewMode), tone: viewMode === "edit" ? "active" as const : "neutral" as const },
      { label: contentState === "loading" ? t("fileWorkspace.status.loading") : contentState === "error" ? t("fileWorkspace.status.readError") : formatBytes(selectedFileSize), tone: contentState === "error" ? "danger" as const : "neutral" as const },
      { label: selectedGitMark ? `git ${selectedGitMark.label}` : t("fileWorkspace.status.gitClean"), tone: selectedGitMark ? "active" as const : "neutral" as const },
      {
        label: saveConflict ? t("fileWorkspace.status.conflict") : saveState === "loading" ? t("fileWorkspace.status.saving") : saveState === "error" ? t("fileWorkspace.status.saveFailed") : isDirty ? t("fileWorkspace.status.dirty") : t("fileWorkspace.status.saved"),
        tone: saveState === "error" ? "danger" as const : isDirty ? "warning" as const : "neutral" as const,
      },
    ];
  }, [allFiles.length, contentState, isDirty, modeDescriptionText, saveConflict, saveState, selectedFileSize, selectedGitMark, selectedPath, t, treeState, viewMode]);

  const openFile = useCallback(async (path: string, opts?: { force?: boolean }) => {
    if (!window.piAPI?.filesReadTextFile) return;
    if (!opts?.force && isDirtyRef.current) {
      const shouldDiscard = window.confirm(t("fileWorkspace.messages.discardConfirmFile"));
      if (!shouldDiscard) return;
    }
    const requestId = fileReadReq.begin();
    diffReadReq.cancel();
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
      if (!fileReadReq.isLatest(requestId)) return;
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
      lastAutoSaveAttemptRef.current = null;
      setViewMode("preview");
      setContentState("ready");
    } catch (err) {
      if (!fileReadReq.isLatest(requestId)) return;
      setContent(null);
      setDraft("");
      setError(t("fileWorkspace.messages.readFileFailed", { message: err instanceof Error ? err.message : String(err) }));
      setContentState("error");
    }
  }, [diffReadReq, fileReadReq, t, workspacePath]);

  const discardDraft = (): void => {
    if (!content) return;
    setDraft(content.content);
    lastAutoSaveAttemptRef.current = null;
    setSaveState("idle");
    setSaveError(null);
    setSaveMessage(t("fileWorkspace.messages.discarded"));
    window.setTimeout(() => setSaveMessage(null), 1600);
  };

  const saveDraft = useCallback(async (): Promise<void> => {
    if (!content || !selectedPath || !window.piAPI?.filesWriteTextFile || !canEdit || viewMode !== "edit") return;
    setSaveState("loading");
    setSaveMessage(null);
    setSaveError(null);
    setSaveConflict(null);
    let result: Awaited<ReturnType<NonNullable<typeof window.piAPI.filesWriteTextFile>>>;
    try {
      result = await window.piAPI.filesWriteTextFile(selectedPath, draft, workspacePath, { expectedMtimeMs: content.mtimeMs });
    } catch (err) {
      const message = t("fileWorkspace.messages.saveFailed", { message: err instanceof Error ? err.message : String(err) });
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
    lastAutoSaveAttemptRef.current = null;
    setSaveState("ready");
    setSaveError(null);
    setSaveConflict(null);
    setSaveMessage(t("fileWorkspace.messages.saved"));
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
  }, [canEdit, content, draft, loadGitStatus, loadTree, selectedPath, selectedRelativePath, t, viewMode, workspacePath]);

  const handleAutoSave = useCallback((path: string, content: string) => {
    const lastAttempt = lastAutoSaveAttemptRef.current;
    if (lastAttempt?.path === path && lastAttempt.draft === content) return;
    lastAutoSaveAttemptRef.current = { path, draft: content };
    void saveDraft();
  }, [saveDraft]);

  const autoSaveFilePath = (autoSave && isDirty && canEdit && viewMode === "edit" && saveState !== "loading" && !saveConflict) ? selectedPath : null;
  useDebouncedSave(autoSaveFilePath, draft, handleAutoSave, AUTO_SAVE_DELAY_MS);

  const openSelectedDiff = useCallback(async (): Promise<void> => {
    if (!selectedPath || !selectedRelativePath || !window.piAPI?.gitDiff) return;
    const requestId = diffReadReq.begin();
    setViewMode("diff");
    setDiffState("loading");
    setDiffContent("");
    try {
      const diff = await window.piAPI.gitDiff(workspacePath, selectedRelativePath);
      if (!diffReadReq.isLatest(requestId)) return;
      if (isIpcError(diff)) {
        setDiffContent("");
        setError(diff.fallback);
        setDiffState("error");
        return;
      }
      setDiffContent(diff);
      setDiffState("ready");
    } catch (err) {
      if (!diffReadReq.isLatest(requestId)) return;
      setDiffContent("");
      setError(err instanceof Error ? err.message : String(err));
      setDiffState("error");
    }
  }, [diffReadReq, selectedPath, selectedRelativePath, workspacePath]);

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
        const requestId = diffReadReq.begin();
        try {
          const diff = await window.piAPI.gitDiff(workspacePath, relativePath);
          if (!diffReadReq.isLatest(requestId)) return;
          if (isIpcError(diff)) {
            setDiffContent("");
            setError(diff.fallback);
            setDiffState("error");
            return;
          }
          setDiffContent(diff);
          setDiffState("ready");
        } catch (err) {
          if (!diffReadReq.isLatest(requestId)) return;
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
    const resolvedPath = resolveWorkspacePath(file.path, workspacePath);
    if (!file.isDirectory) {
      await openFile(resolvedPath);
      return;
    }
    if (isDirty) {
      const shouldDiscard = window.confirm(t("fileWorkspace.messages.discardConfirmDirectory"));
      if (!shouldDiscard) return;
    }
    setSelectedPath(resolvedPath);
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
    setActionMessage(t("fileWorkspace.messages.selectedDirectory"));
    setExpanded((current) => new Set([...current, resolvedPath]));
    window.setTimeout(() => setActionMessage(null), 1600);
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
      setActionMessage(t("fileWorkspace.messages.copiedAbsolute"));
      window.setTimeout(() => setCopied(false), 1400);
      window.setTimeout(() => setActionMessage(null), 1600);
    } catch (err) {
      setCopied(false);
      setActionMessage(null);
      setActionError(t("fileWorkspace.messages.copyPathFailed", { message: err instanceof Error ? err.message : String(err) }));
    }
  };

  const copySelectedRelativePath = async (): Promise<void> => {
    if (!selectedPath) return;
    const relativePath = relativeToWorkspace(selectedPath, workspacePath) || selectedPath;
    try {
      await navigator.clipboard?.writeText(relativePath);
      setActionError(null);
      setActionMessage(t("fileWorkspace.messages.copiedRelative"));
      window.setTimeout(() => setActionMessage(null), 1600);
    } catch (err) {
      setActionMessage(null);
      setActionError(t("fileWorkspace.messages.copyRelativeFailed", { message: err instanceof Error ? err.message : String(err) }));
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
      setActionError(t("fileWorkspace.messages.openFailed", { message: err instanceof Error ? err.message : String(err) }));
      return;
    }
    setActionError(null);
    setActionMessage(t("fileWorkspace.messages.openRequested"));
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
      setActionError(t("fileWorkspace.messages.revealFailed", { message: err instanceof Error ? err.message : String(err) }));
      return;
    }
    setActionError(null);
    setActionMessage(t("fileWorkspace.messages.revealRequested"));
    window.setTimeout(() => setActionMessage(null), 1600);
  };

  const copySaveError = async (): Promise<void> => {
    if (!saveError) return;
    try {
      await navigator.clipboard?.writeText(saveError);
    } catch (err) {
      setActionMessage(null);
      setActionError(t("fileWorkspace.messages.copyErrorFailed", { message: err instanceof Error ? err.message : String(err) }));
      return;
    }
    setActionError(null);
    setSaveMessage(t("fileWorkspace.messages.copiedError"));
    window.setTimeout(() => {
      setSaveMessage(saveError);
    }, 1400);
  };

  const copyDraft = async (): Promise<void> => {
    try {
      await navigator.clipboard?.writeText(draft);
    } catch (err) {
      setActionMessage(null);
      setActionError(t("fileWorkspace.messages.copyDraftFailed", { message: err instanceof Error ? err.message : String(err) }));
      return;
    }
    setActionError(null);
    setSaveMessage(t("fileWorkspace.messages.copiedDraft"));
    window.setTimeout(() => {
      if (saveError) setSaveMessage(saveError);
      else setSaveMessage(null);
    }, 1400);
  };

  const reloadSelectedFile = async (): Promise<void> => {
    if (!selectedPath) return;
    await openFile(selectedPath, { force: true });
    setSaveMessage(t("fileWorkspace.messages.reloaded"));
    window.setTimeout(() => setSaveMessage(null), 1600);
  };

  const useDiskVersion = (): void => {
    if (!saveConflict) return;
    setContent(saveConflict.disk);
    setDraft(saveConflict.disk.content);
    setSaveConflict(null);
    setSaveError(null);
    setSaveState("idle");
    setSaveMessage(t("fileWorkspace.messages.usedDiskVersion"));
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
    <div className="flex h-full min-h-0 bg-[var(--mm-bg-main)] text-[var(--mm-text-primary)]" role="region" aria-label={t("fileWorkspace.region")}>
      <aside className="flex h-full w-[300px] shrink-0 flex-col border-r border-[var(--mm-border)] bg-[var(--mm-bg-panel)]">
        <div className="border-b border-[var(--mm-border)] px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h1 className="m-0 text-sm font-semibold">{t("fileWorkspace.title")}</h1>
              <p className="m-0 mt-1 truncate font-mono text-[11px] text-[var(--mm-text-tertiary)]" title={workspacePath}>
                {workspacePath}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadTree()}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-sidebar)]"
              aria-label={t("fileWorkspace.refreshTree")}
              title={t("fileWorkspace.refresh")}
            >
              ↻
            </button>
          </div>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="mt-3 h-8 w-full rounded-md border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-2 text-xs outline-none focus:border-[#999]"
            placeholder={t("fileWorkspace.searchFiles")}
            aria-label={t("fileWorkspace.searchFiles")}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {query.trim() ? (
            <ul className="m-0 list-none p-2">
              {searchState === "loading" && (
                <li className="px-2 py-6 text-center text-xs text-[var(--mm-text-secondary)]">{t("fileWorkspace.search.loading")}</li>
              )}
              {searchState === "error" && (
                <li className="rounded-md border border-[#fecaca] bg-[#fef2f2] px-3 py-3 text-xs text-[var(--color-error)]" role="alert">
                  <div className="font-medium">{t("fileWorkspace.search.errorTitle")}</div>
                  <div className="mt-1 break-all font-mono text-[11px]">{searchError}</div>
                  <button
                    type="button"
                    onClick={() => setSearchReloadKey((key) => key + 1)}
                    className="mt-2 rounded-md bg-[#b91c1c] px-2 py-1 text-[11px] text-white hover:bg-[#991b1b]"
                  >
                    {t("common.retry")}
                  </button>
                </li>
              )}
              {searchState !== "loading" && searchState !== "error" && searchResults.map((file) => (
                <SearchResultRow key={file.path} file={file} gitMark={gitMarkForPath(file.path)} onOpen={openSearchResult} />
              ))}
              {searchState !== "loading" && searchState !== "error" && searchResults.length === 0 && (
                <li className="px-2 py-6 text-center text-xs text-[var(--mm-text-secondary)]">{t("fileWorkspace.search.empty")}</li>
              )}
            </ul>
          ) : treeState === "loading" ? (
            <div className="px-4 py-6 text-xs text-[var(--mm-text-secondary)]">{t("fileWorkspace.tree.loading")}</div>
          ) : treeState === "error" ? (
            <div className="m-3 rounded-md border border-[#fecaca] bg-[#fef2f2] px-3 py-3 text-xs text-[var(--color-error)]" role="alert">
              <div className="font-medium">{t("fileWorkspace.tree.errorTitle")}</div>
              <div className="mt-1 break-all font-mono text-[11px]">{error}</div>
              <button
                type="button"
                onClick={() => void loadTree()}
                className="mt-2 rounded-md bg-[#b91c1c] px-2 py-1 text-[11px] text-white hover:bg-[#991b1b]"
              >
                {t("common.retry")}
              </button>
            </div>
          ) : tree ? (
            allFiles.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-[var(--mm-text-secondary)]">{t("fileWorkspace.emptyDirectory")}</div>
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
                truncatedLabel={t("fileWorkspace.truncated")}
              />
            </ul>
            )
          ) : null}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 items-center justify-between gap-3 border-b border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-4">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <div className="truncate font-mono text-sm">{selectedNode?.name ?? content?.name ?? t("fileWorkspace.selectPrompt")}</div>
              {isDirty && <span className="shrink-0 rounded bg-[#fff7ed] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-warn)]">{t("fileWorkspace.status.dirty")}</span>}
              {saveState === "error" && <span className="shrink-0 rounded bg-[#fef2f2] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-error)]">{saveConflict ? t("fileWorkspace.status.conflict") : t("fileWorkspace.status.saveFailed")}</span>}
              {selectedPath && <span className="shrink-0 rounded bg-[var(--mm-bg-sidebar)] px-1.5 py-0.5 text-[10px] text-[var(--mm-text-secondary)]">{modeLabelText(viewMode)}</span>}
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
                    <button type="button" onClick={() => setViewMode("edit")} className="rounded-md bg-[#1f1f1f] px-2 py-1 text-xs text-white hover:bg-[#333]">{t("fileWorkspace.actions.edit")}</button>
                  ) : (
                    <>
                      <button type="button" onClick={() => setViewMode("preview")} disabled={isDirty} className="rounded-md px-2 py-1 text-xs hover:bg-[var(--mm-bg-sidebar)] disabled:opacity-40">{t("fileWorkspace.actions.readOnly")}</button>
                      <button type="button" onClick={discardDraft} disabled={!isDirty} className="rounded-md px-2 py-1 text-xs hover:bg-[var(--mm-bg-sidebar)] disabled:opacity-40">{t("fileWorkspace.actions.discard")}</button>
                      <button type="button" onClick={() => void saveDraft()} disabled={!isDirty || saveState === "loading"} className="rounded-md bg-[#1f1f1f] px-2 py-1 text-xs text-white hover:bg-[#333] disabled:opacity-40">
                        {saveState === "loading" ? t("fileWorkspace.actions.saving") : t("fileWorkspace.actions.save")}
                      </button>
                    </>
                  )}
                </>
              )}
              {selectedGitMark && (
                <button type="button" onClick={() => void openSelectedDiff()} className="rounded-md px-2 py-1 text-xs hover:bg-[var(--mm-bg-sidebar)]">{t("fileWorkspace.actions.viewDiff")}</button>
              )}
              {viewMode === "diff" && (
                <button type="button" onClick={() => setViewMode("preview")} className="rounded-md px-2 py-1 text-xs hover:bg-[var(--mm-bg-sidebar)]">{t("fileWorkspace.actions.backToPreview")}</button>
              )}
              {viewMode === "conflict" && saveConflict && (
                <button type="button" onClick={continueEditingDraft} className="rounded-md px-2 py-1 text-xs hover:bg-[var(--mm-bg-sidebar)]">{t("fileWorkspace.actions.continueEditing")}</button>
              )}
              {saveConflict && viewMode !== "conflict" && (
                <button type="button" onClick={showConflictDiff} className="rounded-md px-2 py-1 text-xs text-[var(--color-error)] hover:bg-[var(--mm-bg-hover)]">{t("fileWorkspace.actions.viewConflict")}</button>
              )}
              <button type="button" onClick={() => void openSelectedPath()} className="rounded-md px-2 py-1 text-xs hover:bg-[var(--mm-bg-sidebar)]">{t("fileWorkspace.actions.open")}</button>
              <button type="button" onClick={() => void revealSelectedPath()} className="rounded-md px-2 py-1 text-xs hover:bg-[var(--mm-bg-sidebar)]">{t("fileWorkspace.actions.reveal")}</button>
              <button type="button" onClick={() => void copySelectedPath()} className="rounded-md px-2 py-1 text-xs hover:bg-[var(--mm-bg-sidebar)]">{copied ? t("fileWorkspace.actions.copied") : t("fileWorkspace.actions.copyPath")}</button>
              <button type="button" onClick={() => void copySelectedRelativePath()} className="rounded-md px-2 py-1 text-xs hover:bg-[var(--mm-bg-sidebar)]">{t("fileWorkspace.actions.copyRelativePath")}</button>
              <button type="button" onClick={sendToChat} className="rounded-md bg-[#1f1f1f] px-2 py-1 text-xs text-white hover:bg-[#333]">{t("fileWorkspace.actions.quoteToChat")}</button>
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-[var(--mm-bg-panel)]">
          {!selectedPath ? (
            <div className="flex h-full items-center justify-center text-sm text-[var(--mm-text-secondary)]">
              {t("fileWorkspace.selectFile")}
            </div>
          ) : viewMode === "diff" ? (
            <div className="p-4">
              {diffState === "loading" ? (
                <div className="text-sm text-[var(--mm-text-secondary)]">{t("fileWorkspace.status.diffLoading")}...</div>
              ) : diffState === "error" ? (
                <div className="text-sm text-[var(--color-error)]">{error}</div>
              ) : diffContent ? (
                <DiffViewer diff={diffContent} maxHeight="calc(100vh - 160px)" />
              ) : (
                <div className="rounded-lg border border-dashed border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-4 py-8 text-center text-sm text-[var(--mm-text-secondary)]">
                  {t("fileWorkspace.emptyStates.noDiff")}
                </div>
              )}
            </div>
          ) : saveConflict && viewMode === "conflict" ? (
            // TODO: extract SaveConflictDialog component (Phase 2 SubTask 27.4 deferred).
            <div className="flex min-h-full flex-col p-4">
              <div className="mb-3 rounded-md border border-[#fed7aa] bg-[#fff7ed] px-3 py-2 text-xs text-[#9a3412]" role="alert">
                {t("fileWorkspace.conflict.warning")}
              </div>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <button type="button" onClick={continueEditingDraft} className="rounded-md border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-2 py-1 text-xs hover:bg-[var(--mm-bg-sidebar)]">
                  {t("fileWorkspace.conflict.continueDraft")}
                </button>
                <button type="button" onClick={useDiskVersion} className="rounded-md border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-2 py-1 text-xs hover:bg-[var(--mm-bg-sidebar)]">
                  {t("fileWorkspace.actions.useDiskVersion")}
                </button>
                <button type="button" onClick={() => void copyDraft()} className="rounded-md border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-2 py-1 text-xs hover:bg-[var(--mm-bg-sidebar)]">
                  {t("fileWorkspace.actions.copyDraft")}
                </button>
              </div>
              <DiffViewer diff={saveConflict.diff} maxHeight="calc(100vh - 230px)" />
            </div>
          ) : contentState === "loading" ? (
            <div className="p-5 text-sm text-[var(--mm-text-secondary)]">{t("fileWorkspace.status.reading")}...</div>
          ) : contentState === "error" ? (
            <div className="p-5 text-sm text-[var(--color-error)]">{error}</div>
          ) : content?.binary ? (
            <div className="m-5 rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-4 text-sm text-[var(--mm-text-secondary)]">
              {t("fileWorkspace.emptyStates.binary")}
            </div>
          ) : content?.truncated ? (
            <div className="m-5 rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-4 text-sm text-[var(--mm-text-secondary)]">
              {t("fileWorkspace.emptyStates.truncated")}
            </div>
          ) : content && viewMode === "preview" ? (
            <div className={`${showLineNumbers ? "grid grid-cols-[58px_minmax(0,1fr)]" : ""} min-h-full overflow-auto font-mono text-[12px] leading-5 text-[var(--mm-text-primary)]`}>
              {showLineNumbers && (
                <div className="select-none border-r border-[var(--mm-border)] bg-[var(--mm-bg-sidebar)] py-3 text-right text-[11px] text-[var(--mm-text-tertiary)]" aria-label={t("fileWorkspace.lineNumbersAria")}>
                  {previewLines.map((_, index) => (
                    <div key={index} className="h-5 px-3">{index + 1}</div>
                  ))}
                </div>
              )}
              <pre className={`m-0 min-h-full px-3 py-3 font-mono text-[12px] leading-5 ${wordWrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"}`} aria-label={t("fileWorkspace.previewAria")}>
                {draft}
              </pre>
            </div>
          ) : content ? (
            <div className="min-h-full">
              <MonacoEditor
                value={draft}
                language={selectedNode?.name ? getLanguageFromFilename(selectedNode.name) : undefined}
                readOnly={viewMode !== "edit"}
                onChange={(value) => setDraft(value)}
                onSave={() => {
                  if (isDirty && viewMode === "edit") void saveDraft();
                }}
                className="min-h-[400px]"
                height="max(400px, calc(100vh - 128px))"
              />
            </div>
          ) : null}
        </div>
        <div className="flex h-8 shrink-0 items-center justify-between gap-3 border-t border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-3 text-[11px] text-[var(--mm-text-tertiary)]" aria-label={t("fileWorkspace.statusBarAria")}>
          <div className="min-w-0 truncate font-mono">
            {selectedPath ? relativeToWorkspace(selectedPath, workspacePath) || selectedPath : statusLine}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {statusItems.map((item) => (
              <span
                key={item.label}
                className={`rounded px-1.5 py-0.5 ${
                  item.tone === "danger"
                    ? "bg-[#fef2f2] text-[var(--color-error)]"
                    : item.tone === "warning"
                      ? "bg-[#fff7ed] text-[var(--color-warn)]"
                      : item.tone === "active"
                        ? "bg-[#eef3ff] text-[var(--color-info)]"
                        : "bg-[var(--mm-bg-sidebar)] text-[var(--mm-text-secondary)]"
                }`}
              >
                {item.label}
              </span>
            ))}
            {actionMessage && <span className="rounded bg-[#ecfdf5] px-1.5 py-0.5 text-[var(--color-success)]">{actionMessage}</span>}
            {actionError && <span className="rounded bg-[#fef2f2] px-1.5 py-0.5 text-[var(--color-error)]">{actionError}</span>}
          </div>
        </div>
      </main>

      <aside className="hidden h-full w-[240px] shrink-0 border-l border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-4 text-xs lg:block">
        <h2 className="m-0 mb-3 text-sm font-semibold">{t("fileWorkspace.details.heading")}</h2>
        <dl className="space-y-3">
          <div>
            <dt className="text-[var(--mm-text-tertiary)]">{t("fileWorkspace.details.name")}</dt>
            <dd className="m-0 mt-1 truncate font-mono">{content?.name ?? (selectedPath ? basename(selectedPath) : "-")}</dd>
          </div>
          <div>
            <dt className="text-[var(--mm-text-tertiary)]">{t("fileWorkspace.details.size")}</dt>
            <dd className="m-0 mt-1 font-mono">{formatBytes(content?.size ?? selectedNode?.size)}</dd>
          </div>
          <div>
            <dt className="text-[var(--mm-text-tertiary)]">{t("fileWorkspace.details.status")}</dt>
            <dd className="m-0 mt-1">{selectedPath ? statusLine : "-"}</dd>
          </div>
          {readonlyReason && (
            <div>
              <dt className="text-[var(--mm-text-tertiary)]">{t("fileWorkspace.details.limit")}</dt>
              <dd className="m-0 mt-1 text-[#92400e]">{readonlyReason}</dd>
            </div>
          )}
          <div>
            <dt className="text-[var(--mm-text-tertiary)]">{t("fileWorkspace.details.mode")}</dt>
            <dd className="m-0 mt-1">{selectedPath ? modeLabelText(viewMode) : "-"}</dd>
          </div>
          <div>
            <dt className="text-[var(--mm-text-tertiary)]">Git</dt>
            <dd className="m-0 mt-1">{selectedGitMark ? `${selectedGitMark.text} (${selectedGitMark.label})` : selectedPath ? t("fileWorkspace.details.gitUnchanged") : "-"}</dd>
          </div>
          {saveMessage && (
            <div>
              <dt className="text-[var(--mm-text-tertiary)]">{t("fileWorkspace.details.saveStatus")}</dt>
              <dd className={`m-0 mt-1 ${saveState === "error" ? "text-[var(--color-error)]" : "text-[var(--color-success)]"}`}>{saveMessage}</dd>
            </div>
          )}
          {(actionMessage || actionError) && (
            <div>
              <dt className="text-[var(--mm-text-tertiary)]">{t("fileWorkspace.details.recentAction")}</dt>
              <dd className={`m-0 mt-1 ${actionError ? "text-[var(--color-error)]" : "text-[var(--color-success)]"}`}>
                {actionError ?? actionMessage}
              </dd>
            </div>
          )}
          {saveError && (
            <div>
              <dt className="text-[var(--mm-text-tertiary)]">{saveConflict ? t("fileWorkspace.details.conflictHandling") : t("fileWorkspace.details.recovery")}</dt>
              <dd className="m-0 mt-2 flex flex-wrap gap-1">
                <button type="button" onClick={() => void saveDraft()} disabled={saveState === "loading" || !isDirty} className="rounded-md border border-[#1f1f1f] bg-[#1f1f1f] px-2 py-1 text-white disabled:opacity-40">
                  {t("fileWorkspace.actions.retrySave")}
                </button>
                {saveConflict && (
                  <>
                    <button type="button" onClick={useDiskVersion} className="rounded-md border border-[var(--mm-border)] px-2 py-1">
                      {t("fileWorkspace.actions.useDiskVersion")}
                    </button>
                    <button type="button" onClick={continueEditingDraft} className="rounded-md border border-[var(--mm-border)] px-2 py-1">
                      {t("fileWorkspace.actions.continueEditing")}
                    </button>
                    <button type="button" onClick={showConflictDiff} className="rounded-md border border-[var(--mm-border)] px-2 py-1">
                      {t("fileWorkspace.actions.viewConflict")}
                    </button>
                  </>
                )}
                <button type="button" onClick={() => void copySaveError()} className="rounded-md border border-[var(--mm-border)] px-2 py-1">
                  {t("fileWorkspace.actions.copyError")}
                </button>
                <button type="button" onClick={() => void copyDraft()} className="rounded-md border border-[var(--mm-border)] px-2 py-1">
                  {t("fileWorkspace.actions.copyDraft")}
                </button>
                <button type="button" onClick={() => void reloadSelectedFile()} className="rounded-md border border-[var(--mm-border)] px-2 py-1">
                  {t("fileWorkspace.actions.reloadFile")}
                </button>
              </dd>
            </div>
          )}
          <div>
            <dt className="text-[var(--mm-text-tertiary)]">{t("fileWorkspace.details.actions")}</dt>
            <dd className="m-0 mt-2 flex flex-wrap gap-1">
              <button type="button" disabled={!selectedPath} onClick={() => void copySelectedPath()} className="rounded-md border border-[var(--mm-border)] px-2 py-1 disabled:opacity-40">
                {copied ? t("fileWorkspace.actions.copied") : t("fileWorkspace.actions.copyPath")}
              </button>
              <button type="button" disabled={!selectedPath} onClick={() => void copySelectedRelativePath()} className="rounded-md border border-[var(--mm-border)] px-2 py-1 disabled:opacity-40">
                {t("fileWorkspace.actions.copyRelativePath")}
              </button>
              <button type="button" disabled={!selectedPath} onClick={sendToChat} className="rounded-md border border-[#1f1f1f] bg-[#1f1f1f] px-2 py-1 text-white disabled:opacity-40">
                {t("fileWorkspace.actions.quote")}
              </button>
            </dd>
          </div>
        </dl>
      </aside>
    </div>
  );
}
