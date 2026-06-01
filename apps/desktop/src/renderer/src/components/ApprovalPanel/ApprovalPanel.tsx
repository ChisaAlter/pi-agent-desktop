// ApprovalPanel - 文件变更审批面板
//
// 显示待审批的文件变更列表，支持全部接受/拒绝/自动审批

import React from 'react';
import { useApprovalStore } from '../../stores/approval-store';
import { ChangeApprovalCard } from './ChangeApprovalCard';

interface ApprovalPanelProps {
  isOpen: boolean;
  onToggle: () => void;
}

export function ApprovalPanel({ isOpen, onToggle }: ApprovalPanelProps): React.JSX.Element {
  const { changes, autoApprove, approveChange, rejectChange, approveAll, rejectAll, toggleAutoApprove, clearChanges } = useApprovalStore();

  const pendingCount = changes.filter((c) => c.status === 'pending').length;
  const totalChanges = changes.length;

  if (!isOpen) return <></>;

  return (
    <div className="w-[420px] flex-shrink-0 bg-[#ffffff] border-l border-[#e5e5e5] flex flex-col h-full">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#e5e5e5] bg-[#fafafa]">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-[#666666]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          <h2 className="text-sm font-medium text-[#1a1a1a]">文件变更审批</h2>
          {pendingCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold text-white bg-[#f59e0b]">
              {pendingCount}
            </span>
          )}
        </div>
        <button
          onClick={onToggle}
          className="p-1 rounded hover:bg-[#e5e5e5] transition-colors text-[#999999]"
          title="关闭面板"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* 变更计数 */}
      {totalChanges > 0 && (
        <div className="px-4 py-2 border-b border-[#e5e5e5] text-xs text-[#666666]">
          {pendingCount > 0 ? (
            <span><strong className="text-[#f59e0b]">{pendingCount}</strong> 个文件待审批</span>
          ) : (
            <span>所有变更已处理 ({totalChanges} 个文件)</span>
          )}
        </div>
      )}

      {/* 变更列表 */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {totalChanges === 0 ? (
          /* 空状态 */
          <div className="flex flex-col items-center justify-center h-full text-center">
            <svg className="w-12 h-12 text-[#e5e5e5] mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <p className="text-sm text-[#999999]">暂无待审批的变更</p>
            <p className="text-xs text-[#cccccc] mt-1">AI 修改文件时将在此处显示</p>
          </div>
        ) : (
          changes.map((change) => (
            <ChangeApprovalCard
              key={change.id}
              change={change}
              onApprove={approveChange}
              onReject={rejectChange}
            />
          ))
        )}
      </div>

      {/* 底部操作栏 */}
      {totalChanges > 0 && (
        <div className="px-3 py-3 border-t border-[#e5e5e5] bg-[#fafafa]">
          <div className="flex items-center justify-between gap-2">
            {/* 左侧: 全部操作 */}
            <div className="flex items-center gap-2">
              {pendingCount > 0 && (
                <>
                  <button
                    onClick={approveAll}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium text-white bg-[#10b981] hover:bg-[#059669] transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    全部接受
                  </button>
                  <button
                    onClick={rejectAll}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium text-white bg-[#ef4444] hover:bg-[#dc2626] transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    全部拒绝
                  </button>
                </>
              )}
              <button
                onClick={clearChanges}
                className="px-2.5 py-1.5 rounded text-xs text-[#666666] hover:bg-[#e5e5e5] transition-colors"
              >
                清除
              </button>
            </div>

            {/* 右侧: 自动审批开关 */}
            <button
              onClick={toggleAutoApprove}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs transition-colors ${
                autoApprove
                  ? 'bg-[#dcfce7] text-[#166534]'
                  : 'bg-white border border-[#e5e5e5] text-[#666666] hover:bg-[#f0f0f0]'
              }`}
              title={autoApprove ? '自动审批已开启' : '自动审批已关闭'}
            >
              <div className={`w-3 h-3 rounded-full ${autoApprove ? 'bg-[#10b981]' : 'bg-[#cccccc]'}`} />
              自动审批
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
