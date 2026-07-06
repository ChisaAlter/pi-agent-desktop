// DiffViewer 组件 - 用于显示代码变更的 diff 视图

import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { parseDiff, extractDiffFromOutput, type DiffFile, type DiffLine, type DiffHunk } from './diff-parser';
import { FileChangeItem } from './FileChangeItem';

interface DiffViewerProps {
  diff: string;
  maxHeight?: string;
}

function DiffLineRow({ line }: { line: DiffLine }): React.JSX.Element {
  const monoStyle = { fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace", fontSize: "var(--font-size-mono-small)" };

  const getLineBg = () => {
    switch (line.type) {
      case 'add': return 'bg-[#dcfce7]';
      case 'remove': return 'bg-[#fef2f2]';
      default: return 'bg-[var(--mm-bg-panel)]';
    }
  };

  const getLineTextColor = () => {
    switch (line.type) {
      case 'add': return 'text-[var(--color-success)]';
      case 'remove': return 'text-[var(--color-error)]';
      default: return 'text-[var(--mm-text-primary)]';
    }
  };

  const getPrefix = () => {
    switch (line.type) {
      case 'add': return '+';
      case 'remove': return '-';
      default: return ' ';
    }
  };

  return (
    <tr className={`${getLineBg()} hover:brightness-95 transition-all`}>
      {/* 旧文件行号 */}
      <td className="w-[50px] px-2 py-0 text-right select-none text-[var(--mm-text-tertiary)] text-xs border-r border-[var(--mm-border)] whitespace-nowrap"
          style={monoStyle}>
        {line.oldLine ?? ''}
      </td>
      {/* 新文件行号 */}
      <td className="w-[50px] px-2 py-0 text-right select-none text-[var(--mm-text-tertiary)] text-xs border-r border-[var(--mm-border)] whitespace-nowrap"
          style={monoStyle}>
        {line.newLine ?? ''}
      </td>
      {/* 前缀 (+/-/空) */}
      <td className="w-[20px] px-1 py-0 text-center select-none text-xs"
          style={monoStyle}>
        <span className={getLineTextColor()}>{getPrefix()}</span>
      </td>
      {/* 代码内容 */}
      <td className="px-2 py-0 whitespace-pre overflow-x-auto"
          style={monoStyle}>
        <span className={getLineTextColor()}>{line.content}</span>
      </td>
    </tr>
  );
}

function HunkHeader({ header }: { header: string }): React.JSX.Element {
  return (
    <tr className="bg-[var(--mm-bg-hover)]">
      <td colSpan={4} className="px-3 py-1 text-xs text-[var(--mm-text-secondary)] border-y border-[var(--mm-border)]"
          style={{ fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace" }}>
        {header || '...'}
      </td>
    </tr>
  );
}

const CONTEXT_EXPAND = 3;

function splitHunkLines(lines: DiffLine[]): Array<{ type: 'lines'; lines: DiffLine[] } | { type: 'fold'; count: number; oldStart: number | null; newStart: number | null; oldEnd: number | null; newEnd: number | null }> {
  const result: Array<{ type: 'lines'; lines: DiffLine[] } | { type: 'fold'; count: number; oldStart: number | null; newStart: number | null; oldEnd: number | null; newEnd: number | null }> = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].type !== 'context') {
      result.push({ type: 'lines', lines: [lines[i]] });
      i++;
      continue;
    }
    let j = i;
    while (j < lines.length && lines[j].type === 'context') j++;
    const contextCount = j - i;
    if (contextCount <= CONTEXT_EXPAND * 2 + 1) {
      result.push({ type: 'lines', lines: lines.slice(i, j) });
    } else {
      const head = lines.slice(i, i + CONTEXT_EXPAND);
      const tail = lines.slice(j - CONTEXT_EXPAND, j);
      const folded = j - CONTEXT_EXPAND - (i + CONTEXT_EXPAND);
      result.push({ type: 'lines', lines: head });
      result.push({ type: 'fold', count: folded, oldStart: head[head.length - 1].oldLine, newStart: head[head.length - 1].newLine, oldEnd: tail[0]?.oldLine ?? null, newEnd: tail[0]?.newLine ?? null });
      result.push({ type: 'lines', lines: tail });
    }
    i = j;
  }
  return result;
}

function FoldRow({ count, oldStart, newStart, oldEnd, newEnd }: { count: number; oldStart: number | null; newStart: number | null; oldEnd: number | null; newEnd: number | null }): React.JSX.Element | null {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  if (expanded) {
    return null;
  }
  const label = t("diffView.expand", { count });
  return (
    <tr className="bg-[var(--mm-bg-sidebar)] hover:bg-[var(--mm-bg-hover)] cursor-pointer transition-colors"
        onClick={() => setExpanded(true)}>
      <td colSpan={4} className="px-3 py-1 text-center text-[11px] text-[var(--mm-text-tertiary)] select-none"
          style={{ fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace", fontSize: "var(--font-size-mono-small)" }}
          title={label}
          aria-label={label}>
        ⋯ {oldStart ?? '?'}→{oldEnd ?? '?'} · {newStart ?? '?'}→{newEnd ?? '?'} · {label} ⋯
      </td>
    </tr>
  );
}

function HunkContent({ hunk }: { hunk: DiffHunk }): React.JSX.Element[] {
  const segments = splitHunkLines(hunk.lines);
  const rows: React.JSX.Element[] = [];
  let lineIndex = 0;
  for (const segment of segments) {
    if (segment.type === 'lines') {
      for (const line of segment.lines) {
        rows.push(<DiffLineRow key={`line-${lineIndex++}`} line={line} />);
      }
    } else {
      rows.push(<FoldRow key={`fold-${lineIndex++}`} count={segment.count} oldStart={segment.oldStart} newStart={segment.newStart} oldEnd={segment.oldEnd} newEnd={segment.newEnd} />);
    }
  }
  return rows;
}

function FileDiffView({ file }: { file: DiffFile }): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className="border border-[var(--mm-border)] rounded-lg overflow-hidden bg-[var(--mm-bg-panel)]">
      {/* 文件头 */}
      <div className="bg-[var(--mm-bg-sidebar)] border-b border-[var(--mm-border)]">
        <FileChangeItem
          file={file}
          isExpanded={isExpanded}
          onToggle={() => setIsExpanded(!isExpanded)}
        />
      </div>

      {/* Diff 内容 */}
      {isExpanded && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <tbody>
              {file.hunks.map((hunk, hunkIndex) => (
                <React.Fragment key={hunkIndex}>
                  {hunk.header && <HunkHeader header={`@@ ${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@ ${hunk.header}`} />}
                  {HunkContent({ hunk })}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function DiffViewer({ diff, maxHeight = '500px' }: DiffViewerProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const parsedDiff = useMemo(() => {
    // 先尝试从 output 中提取 diff
    const extracted = extractDiffFromOutput(diff);
    if (!extracted) return null;
    return parseDiff(extracted);
  }, [diff]);

  if (!parsedDiff || parsedDiff.files.length === 0) {
    return null;
  }

  const totalAdditions = parsedDiff.files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = parsedDiff.files.reduce((sum, f) => sum + f.deletions, 0);

  return (
    <div className="diff-viewer">
      {/* 总览 */}
      <div className="flex items-center gap-3 mb-2 px-1">
        <span className="text-xs text-[var(--mm-text-secondary)]">
          {t("diffView.filesChanged", { count: parsedDiff.files.length })}
        </span>
        <span className="text-xs text-[var(--color-success)] font-medium">
          +{totalAdditions}
        </span>
        <span className="text-xs text-[var(--color-error)] font-medium">
          -{totalDeletions}
        </span>
      </div>

      {/* 文件列表 */}
      <div className="flex flex-col gap-2" style={{ maxHeight, overflowY: 'auto' }}>
        {parsedDiff.files.map((file, index) => (
          <FileDiffView key={index} file={file} />
        ))}
      </div>
    </div>
  );
}
