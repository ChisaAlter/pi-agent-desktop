// ChangeApprovalCard - 单个文件变更的审批卡片
//
// 显示文件路径、工具类型、diff 预览、以及接受/拒绝按钮

import React, { useMemo } from 'react';
import { DiffViewer } from '../DiffView';
import type { PendingChange } from '../../stores/approval-store';

interface ChangeApprovalCardProps {
  change: PendingChange;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}

/** 从完整路径提取面包屑样式的文件路径 */
function BreadcrumbPath({ filePath }: { filePath: string }): React.JSX.Element {
  const parts = filePath.split(/[/\\]/).filter(Boolean);
  const fileName = parts.pop() || filePath;
  const dirParts = parts.slice(-2); // 最多显示两级目录

  return (
    <div className="flex items-center gap-1 text-xs min-w-0 overflow-hidden">
      {dirParts.map((part, i) => (
        <React.Fragment key={i}>
          <span className="text-[#999999] truncate">{part}</span>
          <span className="text-[#cccccc] flex-shrink-0">/</span>
        </React.Fragment>
      ))}
      <span className="text-[#1a1a1a] font-medium truncate font-mono" style={{ fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace" }}>
        {fileName}
      </span>
    </div>
  );
}

/** 工具类型标签 */
function ToolBadge({ toolName }: { toolName: 'write' | 'edit' }): React.JSX.Element {
  if (toolName === 'write') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#dbeafe] text-[#1d4ed8]">
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        新建/覆盖
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#fef3c7] text-[#92400e]">
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
      </svg>
      编辑
    </span>
  );
}

/** 状态标签 */
function StatusBadge({ status }: { status: 'pending' | 'approved' | 'rejected' }): React.JSX.Element | null {
  if (status === 'pending') return null;

  if (status === 'approved') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#dcfce7] text-[#166534]">
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        已接受
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#fef2f2] text-[#991b1b]">
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
      已拒绝
    </span>
  );
}

export function ChangeApprovalCard({ change, onApprove, onReject }: ChangeApprovalCardProps): React.JSX.Element {
  const diffText = useMemo(() => {
    if (change.diff) return change.diff;
    return null;
  }, [change.diff]);

  const isDecided = change.status !== 'pending';

  // 状态指示边框颜色
  const borderColor = (() => {
    switch (change.status) {
      case 'approved': return 'border-l-4 border-l-[#10b981]';
      case 'rejected': return 'border-l-4 border-l-[#ef4444]';
      default: return 'border-l-4 border-l-[#f59e0b]';
    }
  })();

  return (
    <div className={`bg-white border border-[#e5e5e5] rounded-lg overflow-hidden ${borderColor}`}>
      {/* 头部: 文件路径 + 工具类型 + 状态 */}
      <div className="px-3 py-2.5 bg-[#fafafa] border-b border-[#e5e5e5]">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <BreadcrumbPath filePath={change.filePath} />
          <div className="flex items-center gap-2 flex-shrink-0">
            <ToolBadge toolName={change.toolName} />
            <StatusBadge status={change.status} />
          </div>
        </div>

        {/* Edit 操作的变更摘要 */}
        {change.toolName === 'edit' && change.oldString && change.newString && (
          <div className="mt-1.5 text-xs text-[#666666]">
            <span className="line-through text-[#ef4444]">
              {change.oldString.length > 60 ? change.oldString.slice(0, 60) + '...' : change.oldString}
            </span>
            <span className="mx-1 text-[#999]">→</span>
            <span className="text-[#10b981]">
              {change.newString.length > 60 ? change.newString.slice(0, 60) + '...' : change.newString}
            </span>
          </div>
        )}
      </div>

      {/* Diff 预览 */}
      {diffText && (
        <div className="max-h-[300px] overflow-auto">
          <DiffViewer diff={diffText} maxHeight="280px" />
        </div>
      )}

      {/* 操作按钮 */}
      {!isDecided && (
        <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-[#e5e5e5] bg-[#fafafa]">
          <button
            onClick={() => onReject(change.id)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-white bg-[#ef4444] hover:bg-[#dc2626] transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            拒绝
          </button>
          <button
            onClick={() => onApprove(change.id)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-white bg-[#10b981] hover:bg-[#059669] transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            接受
          </button>
        </div>
      )}
    </div>
  );
}
