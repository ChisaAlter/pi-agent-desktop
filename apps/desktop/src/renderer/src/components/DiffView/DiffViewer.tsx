// DiffViewer 组件 - 用于显示代码变更的 diff 视图

import React, { useState, useMemo } from 'react';
import { parseDiff, extractDiffFromOutput, type DiffFile, type DiffLine } from './diff-parser';
import { FileChangeItem } from './FileChangeItem';

interface DiffViewerProps {
  diff: string;
  maxHeight?: string;
}

function DiffLineRow({ line }: { line: DiffLine }): React.JSX.Element {
  const getLineBg = () => {
    switch (line.type) {
      case 'add': return 'bg-[#dcfce7]';
      case 'remove': return 'bg-[#fef2f2]';
      default: return 'bg-white';
    }
  };

  const getLineTextColor = () => {
    switch (line.type) {
      case 'add': return 'text-[#166534]';
      case 'remove': return 'text-[#991b1b]';
      default: return 'text-[#1a1a1a]';
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
      <td className="w-[50px] px-2 py-0 text-right select-none text-[#999999] text-xs border-r border-[#e5e5e5] whitespace-nowrap"
          style={{ fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace", fontSize: '11px' }}>
        {line.oldLine ?? ''}
      </td>
      {/* 新文件行号 */}
      <td className="w-[50px] px-2 py-0 text-right select-none text-[#999999] text-xs border-r border-[#e5e5e5] whitespace-nowrap"
          style={{ fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace", fontSize: '11px' }}>
        {line.newLine ?? ''}
      </td>
      {/* 前缀 (+/-/空) */}
      <td className="w-[20px] px-1 py-0 text-center select-none text-xs"
          style={{ fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace", fontSize: '11px' }}>
        <span className={getLineTextColor()}>{getPrefix()}</span>
      </td>
      {/* 代码内容 */}
      <td className="px-2 py-0 whitespace-pre overflow-x-auto"
          style={{ fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace", fontSize: '11px' }}>
        <span className={getLineTextColor()}>{line.content}</span>
      </td>
    </tr>
  );
}

function HunkHeader({ header }: { header: string }): React.JSX.Element {
  return (
    <tr className="bg-[#f0f0f0]">
      <td colSpan={4} className="px-3 py-1 text-xs text-[#666666] border-y border-[#e5e5e5]"
          style={{ fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace" }}>
        {header || '...'}
      </td>
    </tr>
  );
}

function FileDiffView({ file }: { file: DiffFile }): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className="border border-[#e5e5e5] rounded-lg overflow-hidden bg-white">
      {/* 文件头 */}
      <div className="bg-[#f5f5f5] border-b border-[#e5e5e5]">
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
                  {hunk.lines.map((line, lineIndex) => (
                    <DiffLineRow key={`${hunkIndex}-${lineIndex}`} line={line} />
                  ))}
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
        <span className="text-xs text-[#666666]">
          {parsedDiff.files.length} 个文件变更
        </span>
        <span className="text-xs text-[#166534] font-medium">
          +{totalAdditions}
        </span>
        <span className="text-xs text-[#991b1b] font-medium">
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
