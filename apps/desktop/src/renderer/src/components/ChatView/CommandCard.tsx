// Command Card Component
// v1.0.9: 时间 + 耗时走 utils/format
// v1.0.15: 删 commandCount prop — 之前 MessageBubble 没传,chip 永远不显示

import React, { useState } from 'react';
import { ToolCall } from '../../stores/session-store';
import { DiffViewer, extractDiffFromOutput } from '../DiffView';
import { formatTime, formatDuration } from '../../utils/format';

interface CommandCardProps {
  toolCall: ToolCall;
}

export function CommandCard({ toolCall }: CommandCardProps): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const getStatusColor = () => {
    switch (toolCall.status) {
      case 'running': return 'text-[#f59e0b]';
      case 'completed': return 'text-[#10b981]';
      case 'error': return 'text-[#ef4444]';
      default: return 'text-[#999999]';
    }
  };
  
  const getStatusIcon = () => {
    switch (toolCall.status) {
      case 'running': return (
        <div className="h-3.5 w-3.5 rounded-full border-2 border-[#b8b8b8] border-t-transparent animate-spin" />
      );
      case 'completed': return (
        <div className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#16a34a]">
          <svg className="h-2.5 w-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      );
      case 'error': return (
        <div className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#ef4444]">
          <svg className="h-2.5 w-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
      );
      default: return (
        <div className="h-3.5 w-3.5 rounded-full border border-[#d8d8d8]" />
      );
    }
  };
  
  const getToolIcon = () => {
    switch (toolCall.name) {
      case 'read': return (
        <svg className="w-4 h-4 text-[#666666]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      );
      case 'write': return (
        <svg className="w-4 h-4 text-[#666666]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
      );
      case 'edit': return (
        <svg className="w-4 h-4 text-[#666666]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      );
      case 'bash': return (
        <svg className="w-4 h-4 text-[#666666]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      );
      default: return (
        <svg className="w-4 h-4 text-[#666666]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      );
    }
  };
  
  // 提前把 input 序列化: TS strict 下 unknown 在 JSX child 位置需要 narrow
  const inputStr: string | null =
    toolCall.input === null || toolCall.input === undefined
      ? null
      : typeof toolCall.input === "string"
        ? toolCall.input
        : JSON.stringify(toolCall.input, null, 2);
  const outputStr: string | null =
    toolCall.output === null || toolCall.output === undefined
      ? null
      : typeof toolCall.output === "string"
        ? toolCall.output
        : JSON.stringify(toolCall.output, null, 2);

  return (
    <div className="border-l border-[#e5e5e2] pl-3">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between py-1 text-left transition-colors duration-150 hover:text-[#333]"
      >
        <div className="flex items-center gap-2">
          {getStatusIcon()}
          <div className="flex items-center gap-2">
            {getToolIcon()}
            <span className="text-sm text-[#777]">
              {toolCall.name === 'bash' ? '运行命令' : 
               toolCall.name === 'read' ? '读取文件' :
               toolCall.name === 'write' ? '写入文件' :
               toolCall.name === 'edit' ? '编辑文件' : toolCall.name}
            </span>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {toolCall.startTime && (
            <span className="text-xs text-[#aaa]">
              {formatTime(toolCall.startTime)}
            </span>
          )}
          <svg
            className={`h-3 w-3 text-[#aaa] transition-transform duration-150 ${
              isExpanded ? 'rotate-90' : ''
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </button>
      
      {/* Content */}
      {isExpanded && (
        <div className="py-2">
          {/* Input */}
          {inputStr !== null ? (
            <div className="mb-3">
              <div className="mb-1 text-xs font-medium text-[#777]">输入：</div>
              <pre className="overflow-x-auto rounded-lg border border-[#ededeb] bg-[#fbfbfa] p-2 text-xs">
                {inputStr}
              </pre>
            </div>
          ) : null}
          
          {/* Output */}
          {outputStr !== null ? (
            <div>
              <div className="mb-1 text-xs font-medium text-[#777]">输出：</div>
              {(toolCall.name === 'edit' || toolCall.name === 'write') &&
               typeof toolCall.output === 'string' &&
               extractDiffFromOutput(toolCall.output) ? (
                <div className="mt-1">
                  <DiffViewer diff={toolCall.output} maxHeight="400px" />
                </div>
              ) : (
                <pre className="max-h-40 overflow-x-auto overflow-y-auto rounded-lg border border-[#ededeb] bg-[#fbfbfa] p-2 text-xs">
                  {outputStr}
                </pre>
              )}
            </div>
          ) : null}
          
          {/* Duration */}
          {toolCall.startTime && toolCall.endTime && (
            <div className="mt-2 text-xs text-[#aaa]">
              耗时：{formatDuration(toolCall.startTime, toolCall.endTime)}
            </div>
          )}
          
          {/* Status Message */}
          <div className="mt-2 flex items-center gap-2">
            {getStatusIcon()}
            <span className={`text-xs ${getStatusColor()}`}>
              {toolCall.status === 'completed' ? '执行完成' :
               toolCall.status === 'running' ? '正在执行...' :
               toolCall.status === 'error' ? '执行失败' : '等待执行'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
