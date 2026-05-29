// Tool Call Card Component

import React, { useState } from 'react';
import { ToolCall } from '../../stores/session-store';

interface ToolCallCardProps {
  toolCall: ToolCall;
}

export function ToolCallCard({ toolCall }: ToolCallCardProps): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const getStatusColor = () => {
    switch (toolCall.status) {
      case 'running': return 'text-yellow-400';
      case 'completed': return 'text-green-400';
      case 'error': return 'text-red-400';
      default: return 'text-gray-400';
    }
  };
  
  const getStatusIcon = () => {
    switch (toolCall.status) {
      case 'running': return '⏳';
      case 'completed': return '✓';
      case 'error': return '✗';
      default: return '○';
    }
  };
  
  const getToolIcon = () => {
    switch (toolCall.name) {
      case 'read': return '📖';
      case 'write': return '✏️';
      case 'edit': return '🔧';
      case 'bash': return '💻';
      default: return '🔧';
    }
  };
  
  return (
    <div className="bg-gray-800 rounded-lg border border-gray-600 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-700 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span>{getToolIcon()}</span>
          <span className="text-sm font-medium text-gray-200">{toolCall.name}</span>
          <span className={`text-xs ${getStatusColor()}`}>
            {getStatusIcon()} {toolCall.status}
          </span>
        </div>
        
        <div className="flex items-center gap-2">
          {toolCall.startTime && (
            <span className="text-xs text-gray-400">
              {new Date(toolCall.startTime).toLocaleTimeString()}
            </span>
          )}
          <span className="text-gray-400">
            {isExpanded ? '▼' : '▶'}
          </span>
        </div>
      </button>
      
      {/* Content */}
      {isExpanded && (
        <div className="border-t border-gray-600 p-3">
          {/* Input */}
          {toolCall.input && (
            <div className="mb-3">
              <div className="text-xs text-gray-400 mb-1">Input:</div>
              <pre className="bg-gray-900 p-2 rounded text-xs overflow-x-auto">
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
              <div className="text-xs text-gray-400 mb-1">Output:</div>
              <pre className="bg-gray-900 p-2 rounded text-xs overflow-x-auto max-h-40 overflow-y-auto">
                {typeof toolCall.output === 'string'
                  ? toolCall.output
                  : JSON.stringify(toolCall.output, null, 2)
                }
              </pre>
            </div>
          )}
          
          {/* Duration */}
          {toolCall.startTime && toolCall.endTime && (
            <div className="mt-2 text-xs text-gray-400">
              Duration: {Math.round((new Date(toolCall.endTime).getTime() - new Date(toolCall.startTime).getTime()) / 1000)}s
            </div>
          )}
        </div>
      )}
    </div>
  );
}