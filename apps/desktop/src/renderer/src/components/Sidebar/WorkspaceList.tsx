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
              ? 'bg-blue-600 text-white'
              : 'hover:bg-gray-700 text-gray-300'
          }`}
        >
          {isCollapsed ? (
            <div className="w-8 h-8 bg-gray-600 rounded-lg flex items-center justify-center">
              <span className="text-sm font-medium">
                {workspace.name.charAt(0)}
              </span>
            </div>
          ) : (
            <div>
              <div className="font-medium">{workspace.name}</div>
              <div className="text-xs opacity-70 truncate">{workspace.path}</div>
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
          className="w-full p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors text-sm"
        >
          + New Workspace
        </button>
      )}
    </div>
  );
}