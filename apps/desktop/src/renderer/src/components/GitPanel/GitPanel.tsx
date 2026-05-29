// Git Panel Component

import React from 'react';
import { useGit } from '../../hooks/useGit';

export function GitPanel(): React.JSX.Element {
  const { gitStatus, isLoading, error, refreshStatus, getBranchDisplay, getChangeCount, getStatusColor } = useGit();
  
  if (isLoading) {
    return (
      <div className="p-4">
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
          <span className="ml-2 text-gray-400">加载 Git 状态...</span>
        </div>
      </div>
    );
  }
  
  if (error) {
    return (
      <div className="p-4">
        <div className="bg-red-900/50 border border-red-700 rounded-lg p-3">
          <div className="text-red-400 text-sm">{error}</div>
          <button
            onClick={refreshStatus}
            className="mt-2 text-xs text-red-300 hover:text-white"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }
  
  if (!gitStatus) {
    return (
      <div className="p-4">
        <div className="text-gray-400 text-sm">未检测到 Git 仓库</div>
      </div>
    );
  }
  
  const changes = getChangeCount();
  
  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-white">Git 状态</h3>
        <button
          onClick={refreshStatus}
          className="p-1 hover:bg-gray-700 rounded transition-colors"
        >
          🔄
        </button>
      </div>
      
      {/* Branch */}
      <div className="flex items-center gap-2">
        <span className="text-gray-400">🌿</span>
        <span className={`font-mono text-sm ${getStatusColor()}`}>
          {getBranchDisplay()}
        </span>
        {gitStatus.ahead > 0 && (
          <span className="text-xs text-yellow-400">↑{gitStatus.ahead}</span>
        )}
        {gitStatus.behind > 0 && (
          <span className="text-xs text-yellow-400">↓{gitStatus.behind}</span>
        )}
      </div>
      
      {/* Changes Summary */}
      {changes > 0 && (
        <div className="bg-gray-700 rounded-lg p-3">
          <div className="text-sm text-gray-300 mb-2">
            {changes} 个文件已更改
          </div>
          
          {/* Modified */}
          {gitStatus.modified.length > 0 && (
            <div className="mb-2">
              <div className="text-xs text-yellow-400 mb-1">已修改：</div>
              {gitStatus.modified.map((file, index) => (
                <div key={index} className="text-xs text-gray-300 pl-2">
                  M {file}
                </div>
              ))}
            </div>
          )}
          
          {/* Added */}
          {gitStatus.added.length > 0 && (
            <div className="mb-2">
              <div className="text-xs text-green-400 mb-1">新增：</div>
              {gitStatus.added.map((file, index) => (
                <div key={index} className="text-xs text-gray-300 pl-2">
                  A {file}
                </div>
              ))}
            </div>
          )}
          
          {/* Deleted */}
          {gitStatus.deleted.length > 0 && (
            <div className="mb-2">
              <div className="text-xs text-red-400 mb-1">已删除：</div>
              {gitStatus.deleted.map((file, index) => (
                <div key={index} className="text-xs text-gray-300 pl-2">
                  D {file}
                </div>
              ))}
            </div>
          )}
          
          {/* Untracked */}
          {gitStatus.untracked.length > 0 && (
            <div>
              <div className="text-xs text-gray-400 mb-1">未跟踪：</div>
              {gitStatus.untracked.map((file, index) => (
                <div key={index} className="text-xs text-gray-300 pl-2">
                  ? {file}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      
      {/* No Changes */}
      {changes === 0 && (
        <div className="text-sm text-gray-400">
          工作区干净
        </div>
      )}
    </div>
  );
}