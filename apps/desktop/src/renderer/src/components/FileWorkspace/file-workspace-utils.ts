import { isIpcError, type FileTreeNode, type GitStatus, type TextFileContent } from "@shared";

export type LoadState = "idle" | "loading" | "ready" | "error";
export type ViewMode = "preview" | "edit" | "diff" | "conflict";
export type GitMark = { label: "M" | "A" | "D" | "?"; className: string; text: string };
export type SaveConflict = {
  disk: TextFileContent;
  draft: string;
  diff: string;
};

export function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

export function formatBytes(size?: number): string {
  if (size === undefined) return "-";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 102.4) / 10} KB`;
  return `${Math.round(size / 1024 / 102.4) / 10} MB`;
}

export function flattenTree(node: FileTreeNode | null): FileTreeNode[] {
  if (!node) return [];
  const result: FileTreeNode[] = [];
  const walk = (item: FileTreeNode): void => {
    result.push(item);
    item.children?.forEach(walk);
  };
  walk(node);
  return result;
}

export function lineRows(content: string): string[] {
  if (content.length === 0) return [""];
  return content.replace(/\r\n/g, "\n").split("\n");
}

export function escapeDiffLine(line: string): string {
  return line.replace(/\r/g, "");
}

export function makeConflictDiff(fileName: string, diskContent: string, draftContent: string): string {
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

export function modeLabel(mode: ViewMode): string {
  return {
    preview: "只读预览",
    edit: "编辑",
    diff: "Diff",
    conflict: "冲突",
  }[mode];
}

export function modeDescription(mode: ViewMode): string {
  return {
    preview: "只读",
    edit: "可编辑",
    diff: "差异视图",
    conflict: "冲突视图",
  }[mode];
}

export function nonEditableReason(content: TextFileContent | null): string | null {
  if (!content) return null;
  if (content.binary) return "二进制文件不可直接编辑";
  if (content.truncated) return "文件过大且已截断，暂不允许保存";
  return null;
}

export function shellActionFailure(result: unknown): string | null {
  if (isIpcError(result)) return result.fallback;
  if (typeof result === "string" && result.trim()) return result;
  return null;
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}

export function resolveWorkspacePath(path: string, workspacePath: string): string {
  const normalized = normalizePath(path);
  if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith("//")) return normalized;
  const base = normalizePath(workspacePath).replace(/\/+$/, "");
  return `${base}/${normalized.replace(/^\/+/, "")}`;
}

export function relativeToWorkspace(path: string, workspacePath: string): string {
  const normalizedPath = normalizePath(path);
  const normalizedWorkspace = normalizePath(workspacePath).replace(/\/+$/, "");
  if (normalizedPath === normalizedWorkspace) return "";
  if (normalizedPath.startsWith(`${normalizedWorkspace}/`)) {
    return normalizedPath.slice(normalizedWorkspace.length + 1);
  }
  return normalizedPath;
}

export function makeGitMarks(status: GitStatus | null): Map<string, GitMark> {
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
