// 右侧悬浮面板 - 浮动圆角面板，不挤压中间空间

import React from 'react';

interface FloatingPanelProps {
  isVisible: boolean;
  onToggle: () => void;
}

export const FloatingPanel: React.FC<FloatingPanelProps> = ({ isVisible, onToggle }) => {
  if (!isVisible) {
    return null;
  }

  return (
    <div className="fixed right-4 top-4 bottom-4 w-[280px] bg-white rounded-xl shadow-lg border border-[#e5e5e5] z-50 flex flex-col animate-slide-in">
      {/* 面板头部 */}
      <div className="p-4 border-b border-[#e5e5e5] flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[#1a1a1a]">任务进度</h3>
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
        {/* 空状态 */}
        <div className="flex flex-col items-center justify-center py-12 text-[#999]">
          <svg className="w-12 h-12 mb-4 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm">暂无运行中的任务</p>
          <p className="text-xs mt-2 opacity-50">发送消息后将显示进度</p>
        </div>
      </div>
    </div>
  );
};
