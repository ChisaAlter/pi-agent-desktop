// 单个文件变更摘要组件

import React from 'react';
import type { DiffFile } from './diff-parser';

interface FileChangeItemProps {
  file: DiffFile;
  isExpanded: boolean;
  onToggle: () => void;
}

export function FileChangeItem({ file, isExpanded, onToggle }: FileChangeItemProps): React.JSX.Element {
  const displayPath = file.newPath || file.oldPath;

  // 获取文件图标颜色
  const getFileIconColor = () => {
    if (file.isNew) return 'text-[#10b981]';
    if (file.isDeleted) return 'text-[#ef4444]';
    return 'text-[#666666]';
  };

  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between px-3 py-2 hover:bg-[#f0f0f0] transition-colors duration-150 cursor-pointer"
    >
      <div className="flex items-center gap-2 min-w-0">
        {/* 展开/折叠箭头 */}
        <svg
          className={`w-3 h-3 text-[#999999] transition-transform duration-150 flex-shrink-0 ${
            isExpanded ? 'rotate-90' : ''
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>

        {/* 文件图标 */}
        <svg
          className={`w-4 h-4 flex-shrink-0 ${getFileIconColor()}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>

        {/* 文件路径 */}
        <span className="text-sm text-[#1a1a1a] truncate font-mono" style={{ fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace" }}>
          {displayPath}
        </span>

        {/* 新建/删除标记 */}
        {file.isNew && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#dcfce7] text-[#166534] flex-shrink-0">
            新建
          </span>
        )}
        {file.isDeleted && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#fef2f2] text-[#991b1b] flex-shrink-0">
            删除
          </span>
        )}
      </div>

      {/* 变更统计 */}
      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
        {file.additions > 0 && (
          <span className="text-xs font-medium text-[#166534]">
            +{file.additions}
          </span>
        )}
        {file.deletions > 0 && (
          <span className="text-xs font-medium text-[#991b1b]">
            -{file.deletions}
          </span>
        )}
      </div>
    </button>
  );
}
