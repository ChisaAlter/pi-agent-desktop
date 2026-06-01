// Workspace List Component

import React from 'react';
import { useWorkspaceStore } from '../../stores/workspace-store';

interface WorkspaceListProps {
  isCollapsed: boolean;
}

export function WorkspaceList({ isCollapsed }: WorkspaceListProps): React.JSX.Element {
  const { workspaces, currentWorkspaceId, setCurrentWorkspace, addWorkspace } = useWorkspaceStore();
  
  const handleAddWorkspace = () => {
    // In a real app, this would open a file dialog
    const name = prompt('Enter workspace name:');
    const path = prompt('Enter workspace path:');
    if (name && path) {
      addWorkspace(name, path);
    }
  };
  
  return (
    <div className="space-y-1">
      {workspaces.map((workspace) => (
        <div
          key={workspace.id}
          onClick={() => setCurrentWorkspace(workspace.id)}
          className={`p-2 rounded-lg cursor-pointer transition-colors ${
            workspace.id === currentWorkspaceId
              ? 'bg-[#f0f0f0] text-[#1a1a1a]'
              : 'hover:bg-[#f0f0f0] text-[#1a1a1a]'
          }`}
        >
          {isCollapsed ? (
            <div className="w-8 h-8 bg-[#f0f0f0] rounded-lg flex items-center justify-center">
              <span className="text-sm font-medium">
                {workspace.name.charAt(0)}
              </span>
            </div>
          ) : (
            <div>
              <div className="font-medium">{workspace.name}</div>
              <div className="text-xs text-[#999999] truncate">{workspace.path}</div>
              {workspace.gitStatus && (
                <div className="flex items-center gap-1 mt-1">
                  <span className="text-xs">🌿</span>
                  <span className="text-xs">{workspace.gitStatus.branch}</span>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
      
      {!isCollapsed && (
        <button
          onClick={handleAddWorkspace}
          className="w-full p-2 text-[#999999] hover:text-[#1a1a1a] hover:bg-[#f0f0f0] rounded-lg transition-colors text-sm"
        >
          + New Workspace
        </button>
      )}
    </div>
  );
}