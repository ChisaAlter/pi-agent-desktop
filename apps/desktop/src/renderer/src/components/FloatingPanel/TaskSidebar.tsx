// TaskSidebar - 实时任务追踪侧边栏

import React, { useState } from 'react';
import { useTaskStore, type TaskStep, type TaskStatus } from '../../stores/task-store';

interface TaskSidebarProps {
  isVisible: boolean;
  onToggle: () => void;
}

// 状态图标组件
const StatusIcon: React.FC<{ status: TaskStep['status'] }> = ({ status }) => {
  switch (status) {
    case 'pending':
      return (
        <span className="w-4 h-4 rounded-full border-2 border-[#d4d4d4] inline-block flex-shrink-0" />
      );
    case 'running':
      return (
        <svg className="w-4 h-4 text-[#f59e0b] animate-spin flex-shrink-0" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      );
    case 'completed':
      return (
        <svg className="w-4 h-4 text-[#10b981] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
      );
    case 'failed':
      return (
        <svg className="w-4 h-4 text-[#ef4444] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
        </svg>
      );
    default:
      return null;
  }
};

// 整体任务状态图标
const TaskStatusBadge: React.FC<{ status: TaskStatus }> = ({ status }) => {
  const config: Record<TaskStatus, { label: string; bg: string; text: string }> = {
    pending:   { label: '等待中', bg: 'bg-[#f0f0f0]', text: 'text-[#666]' },
    running:   { label: '运行中', bg: 'bg-[#fef3c7]', text: 'text-[#f59e0b]' },
    completed: { label: '已完成', bg: 'bg-[#d1fae5]', text: 'text-[#10b981]' },
    failed:    { label: '失败',   bg: 'bg-[#fee2e2]', text: 'text-[#ef4444]' },
  };
  const c = config[status];
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  );
};

// 单个步骤行
const StepItem: React.FC<{ step: TaskStep; index: number }> = ({ step, index: _index }) => {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = !!step.detail || !!step.error;

  return (
    <div className="group">
      <div
        className={`flex items-start gap-2.5 py-2 px-1 rounded-md transition-colors ${
          hasDetail ? 'cursor-pointer hover:bg-[#f9f9f9]' : ''
        }`}
        onClick={() => hasDetail && setExpanded(!expanded)}
      >
        <StatusIcon status={step.status} />
        <div className="flex-1 min-w-0">
          <p className={`text-xs leading-relaxed ${
            step.status === 'failed' ? 'text-[#ef4444]' : 
            step.status === 'completed' ? 'text-[#666]' : 'text-[#1a1a1a]'
          }`}>
            {step.description}
          </p>
        </div>
        {hasDetail && (
          <svg
            className={`w-3 h-3 text-[#999] transition-transform flex-shrink-0 mt-0.5 ${
              expanded ? 'rotate-180' : ''
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </div>
      {expanded && (
        <div className="ml-6 mb-2 p-2 rounded-md bg-[#fafafa] border border-[#f0f0f0]">
          {step.detail && (
            <p className="text-[11px] text-[#666] whitespace-pre-wrap leading-relaxed">{step.detail}</p>
          )}
          {step.error && (
            <p className="text-[11px] text-[#ef4444] whitespace-pre-wrap leading-relaxed mt-1">{step.error}</p>
          )}
        </div>
      )}
    </div>
  );
};

export const TaskSidebar: React.FC<TaskSidebarProps> = ({ isVisible, onToggle }) => {
  const { tasks, currentTaskId } = useTaskStore();
  const currentTask = tasks.find((t) => t.id === currentTaskId) ?? null;

  if (!isVisible) {
    return null;
  }

  return (
    <div className="fixed right-4 top-4 bottom-4 w-[300px] bg-white rounded-xl shadow-lg border border-[#e5e5e5] z-50 flex flex-col animate-slide-in">
      {/* 面板头部 */}
      <div className="p-4 border-b border-[#e5e5e5] flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-[#1a1a1a]">任务面板</h3>
          {currentTask && <TaskStatusBadge status={currentTask.status} />}
        </div>
        <button
          onClick={onToggle}
          className="p-1.5 rounded-lg hover:bg-[#f0f0f0] transition-colors"
          title="关闭"
        >
          <svg className="w-4 h-4 text-[#666]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* 面板内容 */}
      <div className="flex-1 overflow-y-auto p-4">
        {currentTask ? (
          <div>
            {/* 任务标题 */}
            <h4 className="text-sm font-medium text-[#1a1a1a] mb-3">{currentTask.title}</h4>

            {/* 步骤列表 */}
            {currentTask.steps.length > 0 ? (
              <div className="space-y-0.5">
                {currentTask.steps.map((step, i) => (
                  <StepItem key={step.id} step={step} index={i} />
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-[#999]">
                <p className="text-xs">等待步骤...</p>
              </div>
            )}
          </div>
        ) : (
          /* 空状态 */
          <div className="flex flex-col items-center justify-center py-12 text-[#999]">
            <svg className="w-12 h-12 mb-4 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm">暂无运行中的任务</p>
            <p className="text-xs mt-2 opacity-50">发送消息后将显示进度</p>
          </div>
        )}
      </div>

      {/* 底部操作按钮 */}
      {currentTask && (currentTask.status === 'running' || currentTask.status === 'pending') && (
        <div className="p-3 border-t border-[#e5e5e5] flex items-center gap-2 flex-shrink-0">
          <button className="flex-1 px-3 py-1.5 rounded text-xs border border-[#e5e5e5] text-[#666] hover:bg-[#f0f0f0] transition-colors">
            暂停
          </button>
          <button className="flex-1 px-3 py-1.5 rounded text-xs border border-[#ef4444] text-[#ef4444] hover:bg-[#fef2f2] transition-colors">
            取消
          </button>
        </div>
      )}
    </div>
  );
};
