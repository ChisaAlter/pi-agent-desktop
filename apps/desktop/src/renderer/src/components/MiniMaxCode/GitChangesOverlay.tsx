import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isIpcError } from "@shared";
import { useI18n } from "../../i18n";
import { parseDiff, type DiffFile, type DiffLine } from "../DiffView/diff-parser";

export interface GitChangedFileRow {
  path: string;
  mark: string;
  className: string;
  additions?: number;
  deletions?: number;
}

interface GitChangesOverlayProps {
  open: boolean;
  files: GitChangedFileRow[];
  workspacePath?: string;
  /** Full unstaged unified diff from the rail snapshot (for per-file +/- and expand). */
  diffText?: string;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onRefresh?: () => void | Promise<void>;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function basename(path: string): string {
  const normalized = normalizePath(path);
  const parts = normalized.split("/");
  return parts[parts.length - 1] || path;
}

function dirname(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return "";
  return normalized.slice(0, index + 1);
}

function displayPathOf(file: DiffFile): string {
  return normalizePath(file.newPath || file.oldPath || "");
}

function DiffLineRow({ line }: { line: DiffLine }): React.JSX.Element {
  const bg =
    line.type === "add" ? "bg-[#dcfce7]" : line.type === "remove" ? "bg-[#fef2f2]" : "bg-[var(--mm-bg-panel)]";
  const color =
    line.type === "add"
      ? "text-[var(--color-success)]"
      : line.type === "remove"
        ? "text-[var(--color-error)]"
        : "text-[var(--mm-text-primary)]";
  const prefix = line.type === "add" ? "+" : line.type === "remove" ? "-" : " ";
  return (
    <div
      className={`grid grid-cols-[44px_44px_16px_minmax(0,1fr)] ${bg}`}
      style={{ fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace", fontSize: 12 }}
    >
      <span className="select-none border-r border-[var(--mm-border)] px-1 py-0.5 text-right text-[11px] text-[var(--mm-text-tertiary)]">
        {line.oldLine ?? ""}
      </span>
      <span className="select-none border-r border-[var(--mm-border)] px-1 py-0.5 text-right text-[11px] text-[var(--mm-text-tertiary)]">
        {line.newLine ?? ""}
      </span>
      <span className={`select-none px-0.5 py-0.5 text-center ${color}`}>{prefix}</span>
      <span className={`overflow-x-auto whitespace-pre px-2 py-0.5 ${color}`}>{line.content}</span>
    </div>
  );
}

function InlineFileDiff({ file }: { file: DiffFile }): React.JSX.Element {
  const { t } = useI18n();
  if (file.hunks.length === 0) {
    return (
      <div className="border-t border-[var(--right-rail-divider)] px-4 py-3 text-[12px] text-[var(--right-rail-muted)]">
        {file.isNew ? t("rightRail.changesPanel.newFile") : file.isDeleted ? t("rightRail.changesPanel.deletedFile") : t("rightRail.changesPanel.emptyDiff")}
      </div>
    );
  }
  return (
    <div className="max-h-[360px] overflow-auto border-t border-[var(--right-rail-divider)] bg-[var(--mm-bg-panel)]">
      {file.hunks.map((hunk, index) => (
        <div key={index}>
          <div
            className="border-y border-[var(--mm-border)] bg-[var(--mm-bg-hover)] px-3 py-1 text-[11px] text-[var(--mm-text-secondary)]"
            style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
          >
            {`@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@${hunk.header ? ` ${hunk.header}` : ""}`}
          </div>
          {hunk.lines.map((line, lineIndex) => (
            <DiffLineRow key={lineIndex} line={line} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function GitChangesOverlay({
  open,
  files,
  workspacePath,
  diffText = "",
  onClose,
  onRefresh,
}: GitChangesOverlayProps): React.JSX.Element | null {
  const { t } = useI18n();
  const panelRef = useRef<HTMLDivElement>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const [fileDiffCache, setFileDiffCache] = useState<Record<string, DiffFile | null>>({});
  const [loadingPath, setLoadingPath] = useState<string | null>(null);

  const parsedByPath = useMemo(() => {
    const map = new Map<string, DiffFile>();
    if (!diffText.trim()) return map;
    try {
      const parsed = parseDiff(diffText);
      for (const file of parsed.files) {
        const path = displayPathOf(file);
        if (path) map.set(path, file);
        const alt = path.replace(/^b\//, "");
        if (alt !== path) map.set(alt, file);
      }
    } catch {
      // keep empty map
    }
    return map;
  }, [diffText]);

  const rows = useMemo(() => {
    if (files.length > 0) {
      return files.map((file) => {
        const key = normalizePath(file.path);
        const parsed = parsedByPath.get(key);
        return {
          ...file,
          path: key,
          additions: parsed?.additions ?? file.additions ?? 0,
          deletions: parsed?.deletions ?? file.deletions ?? 0,
          parsed: parsed ?? null,
        };
      });
    }
    return [...parsedByPath.entries()].map(([path, parsed]) => ({
      path,
      mark: parsed.isNew ? "A" : parsed.isDeleted ? "D" : "M",
      className: parsed.isNew
        ? "text-[var(--color-success)]"
        : parsed.isDeleted
          ? "text-[#dc2626]"
          : "text-[var(--color-info)]",
      additions: parsed.additions,
      deletions: parsed.deletions,
      parsed,
    }));
  }, [files, parsedByPath]);

  useEffect(() => {
    if (!open) {
      setExpandedPath(null);
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    setFileDiffCache({});
  }, [diffText, files]);

  if (!open || !document.body) return null;

  const ensureFileDiff = async (path: string, parsed: DiffFile | null): Promise<void> => {
    if (parsed) {
      setFileDiffCache((current) => ({ ...current, [path]: parsed }));
      return;
    }
    if (!workspacePath || !window.piAPI?.gitDiff) {
      setFileDiffCache((current) => ({ ...current, [path]: null }));
      return;
    }
    if (path in fileDiffCache) return;
    setLoadingPath(path);
    try {
      const result = await window.piAPI.gitDiff(workspacePath, path);
      if (isIpcError(result) || !result.trim()) {
        setFileDiffCache((current) => ({ ...current, [path]: null }));
        return;
      }
      const file = parseDiff(result).files[0] ?? null;
      setFileDiffCache((current) => ({ ...current, [path]: file }));
    } catch {
      setFileDiffCache((current) => ({ ...current, [path]: null }));
    } finally {
      setLoadingPath(null);
    }
  };

  const toggleFile = (path: string, parsed: DiffFile | null): void => {
    if (expandedPath === path) {
      setExpandedPath(null);
      return;
    }
    setExpandedPath(path);
    void ensureFileDiff(path, parsed);
  };

  const handleRefresh = async (): Promise<void> => {
    if (!onRefresh) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={t("rightRail.changesPanel.title")}
      data-testid="git-changes-overlay"
      className="fixed bottom-3 right-3 top-[54px] z-[230] flex w-[min(560px,calc(100vw-24px))] flex-col overflow-hidden rounded-[10px] border border-[var(--right-rail-border)] bg-[var(--right-rail-bg)] text-[14px] leading-5 text-[var(--right-rail-text)] shadow-[0_18px_46px_rgba(0,0,0,0.16)] [font-family:var(--right-rail-font)]"
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--right-rail-divider)] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="rounded-full border border-[var(--right-rail-divider)] bg-[var(--mm-bg-panel)] px-2.5 py-1 text-[12px] text-[var(--right-rail-secondary)]">
            {t("rightRail.changesPanel.unstaged")}
          </span>
          <span className="truncate text-[12px] text-[var(--right-rail-muted)]">
            {t("rightRail.changesPanel.fileCount", { count: rows.length })}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onRefresh ? (
            <button
              type="button"
              onClick={() => void handleRefresh()}
              disabled={refreshing}
              className="rounded-[6px] px-2.5 py-1.5 text-[12px] text-[var(--right-rail-secondary)] hover:bg-[var(--right-rail-hover)] hover:text-[var(--right-rail-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] disabled:opacity-50"
            >
              {refreshing ? t("rightRail.changesPanel.refreshing") : t("rightRail.changesPanel.refresh")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label={t("rightRail.changesPanel.close")}
            className="flex h-8 w-8 items-center justify-center rounded-[6px] text-[var(--right-rail-muted)] hover:bg-[var(--right-rail-hover)] hover:text-[var(--right-rail-text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <p className="m-0 px-4 py-10 text-center text-[13px] text-[var(--right-rail-muted)]">
            {t("rightRail.changesPanel.empty")}
          </p>
        ) : (
          <ul className="m-0 list-none p-0" aria-label={t("rightRail.changesPanel.listAria")}>
            {rows.map((file) => {
              const expanded = expandedPath === file.path;
              const resolved = file.parsed ?? fileDiffCache[file.path] ?? null;
              const name = basename(file.path);
              const dir = dirname(file.path);
              return (
                <li key={`${file.mark}:${file.path}`} className="border-b border-[var(--right-rail-divider)] last:border-b-0">
                  <button
                    type="button"
                    onClick={() => toggleFile(file.path, file.parsed)}
                    aria-expanded={expanded}
                    className={`flex min-h-10 w-full min-w-0 items-center gap-2 px-3 py-2 text-left hover:bg-[var(--right-rail-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2563eb] ${
                      expanded ? "bg-[var(--mm-bg-hover)]" : ""
                    }`}
                    title={file.path}
                  >
                    <svg
                      className={`h-3 w-3 shrink-0 text-[var(--right-rail-muted)] transition-transform ${expanded ? "rotate-90" : ""}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      aria-hidden="true"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <span className={`w-4 shrink-0 text-center font-mono text-[12px] font-semibold ${file.className}`}>
                      {file.mark}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
                      <span className="text-[var(--right-rail-text)]">{name}</span>
                      {dir ? <span className="ml-2 text-[11px] text-[var(--right-rail-muted)]">{dir}</span> : null}
                    </span>
                    <span className="ml-auto flex shrink-0 items-center gap-2 font-mono text-[12px]">
                      <span className="text-[var(--color-success)]">+{file.additions ?? 0}</span>
                      <span className="text-[#dc2626]">-{file.deletions ?? 0}</span>
                      <svg className="h-3.5 w-3.5 text-[var(--right-rail-muted)]" fill="none" viewBox="0 0 16 16" stroke="currentColor" aria-hidden="true">
                        <path d="m4 6 4 4 4-4" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  </button>
                  {expanded ? (
                    loadingPath === file.path && !resolved ? (
                      <div className="border-t border-[var(--right-rail-divider)] px-4 py-3 text-[12px] text-[var(--right-rail-muted)]">
                        {t("rightRail.changesPanel.loadingDiff")}
                      </div>
                    ) : resolved ? (
                      <InlineFileDiff file={resolved} />
                    ) : (
                      <div className="border-t border-[var(--right-rail-divider)] px-4 py-3 text-[12px] text-[var(--right-rail-muted)]">
                        {file.mark === "?"
                          ? t("rightRail.changesPanel.untrackedHint")
                          : t("rightRail.changesPanel.emptyDiff")}
                      </div>
                    )
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  );
}
