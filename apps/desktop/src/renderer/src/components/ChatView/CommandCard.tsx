// Command Card Component

import React, { useState } from 'react';
import { ToolCall } from '../../stores/session-store';

interface CommandCardProps {
  toolCall: ToolCall;
  commandCount?: number;
}

export function CommandCard({ toolCall, commandCount = 1 }: CommandCardProps): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const getStatusColor = () => {
    switch (toolCall.status) {
      case 'running': return 'text-pi-warning';
      case 'completed': return 'text-pi-success';
      case 'error': return 'text-pi-error';
      default: return 'text-pi-text-tertiary';
    }
  };
  
  const getStatusIcon = () => {
    switch (toolCall.status) {
      case 'running': return (
        <div className="w-4 h-4 border-2 border-pi-warning border-t-transparent rounded-full animate-spin" />
      );
      case 'completed': return (
        <div className="w-4 h-4 rounded-full bg-pi-success flex items-center justify-center">
          <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      );
      case 'error': return (
        <div className="w-4 h-4 rounded-full bg-pi-error flex items-center justify-center">
          <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
      );
      default: return (
        <div className="w-4 h-4 rounded-full border-2 border-pi-border" />
      );
    }
  };
  
  const getToolIcon = () => {
    switch (toolCall.name) {
      case 'read': return (
        <svg className="w-4 h-4 text-pi-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      );
      case 'write': return (
        <svg className="w-4 h-4 text-pi-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
      );
      case 'edit': return (
        <svg className="w-4 h-4 text-pi-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      );
      case 'bash': return (
        <svg className="w-4 h-4 text-pi-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      );
      default: return (
        <svg className="w-4 h-4 text-pi-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      );
    }
  };
  
  return (
    <div className="bg-pi-bg rounded-lg border border-pi-border overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-pi-panel transition-colors duration-150"
      >
        <div className="flex items-center gap-2">
          {getStatusIcon()}
          <div className="flex items-center gap-2">
            {getToolIcon()}
            <span className="text-sm font-medium text-pi-text-primary">
              {toolCall.name === 'bash' ? '运行命令' : 
               toolCall.name === 'read' ? '读取文件' :
               toolCall.name === 'write' ? '写入文件' :
               toolCall.name === 'edit' ? '编辑文件' : toolCall.name}
            </span>
          </div>
          {commandCount > 1 && (
            <span className="text-xs text-pi-text-secondary bg-pi-panel px-2 py-0.5 rounded-full">
              已运行 {commandCount} 条命令
            </span>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          {toolCall.startTime && (
            <span className="text-xs text-pi-text-tertiary">
              {new Date(toolCall.startTime).toLocaleTimeString()}
            </span>
          )}
          <svg
            className={`w-3 h-3 text-pi-text-tertiary transition-transform duration-150 ${
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
        <div className="border-t border-pi-border p-3">
          {/* Input */}
          {toolCall.input && (
            <div className="mb-3">
              <div className="text-xs text-pi-text-secondary mb-1 font-medium">输入：</div>
              <pre className="bg-pi-panel p-2 rounded text-xs overflow-x-auto border border-pi-border">
                {typeof toolCall.input === 'string' 
                  ? toolCall.input 
                  : JSON.stringify(toolCall.input, null, 2)
                }
              </pre>
            </div>
          )}
          
          {/* Output */}
          {toolCall.output && (
            <div>
              <div className="text-xs text-pi-text-secondary mb-1 font-medium">输出：</div>
              <pre className="bg-pi-panel p-2 rounded text-xs overflow-x-auto max-h-40 overflow-y-auto border border-pi-border">
                {typeof toolCall.output === 'string'
                  ? toolCall.output
                  : JSON.stringify(toolCall.output, null, 2)
                }
              </pre>
            </div>
          )}
          
          {/* Duration */}
          {toolCall.startTime && toolCall.endTime && (
            <div className="mt-2 text-xs text-pi-text-tertiary">
              耗时：{Math.round((new Date(toolCall.endTime).getTime() - new Date(toolCall.startTime).getTime()) / 1000)}秒
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