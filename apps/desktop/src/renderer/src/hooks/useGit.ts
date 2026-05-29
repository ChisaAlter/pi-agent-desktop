// useGit Hook - Git status utilities

import { useState, useEffect, useCallback } from 'react';
import { useWorkspaceStore, GitStatus } from '../stores/workspace-store';

interface UseGitReturn {
  gitStatus: GitStatus | null;
  isLoading: boolean;
  error: string | null;
  refreshStatus: () => Promise<void>;
  getBranchDisplay: () => string;
  getChangeCount: () => number;
  getStatusColor: () => string;
}

export function useGit(): UseGitReturn {
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { currentWorkspaceId, updateGitStatus, getCurrentWorkspace } = useWorkspaceStore();

  const refreshStatus = useCallback(async () => {
    const workspace = getCurrentWorkspace();
    if (!workspace) return;

    setIsLoading(true);
    setError(null);

    try {
      if (window.piAPI) {
        const status = await window.piAPI.getGitStatus(workspace.path);
        if (status) {
          const gitStatusData: GitStatus = {
            branch: status.branch,
            modified: status.modified,
            added: status.added,
            deleted: status.deleted,
            untracked: status.untracked,
            ahead: status.ahead,
            behind: status.behind
          };
          setGitStatus(gitStatusData);
          if (currentWorkspaceId) {
            updateGitStatus(currentWorkspaceId, gitStatusData);
          }
        } else {
          setGitStatus(null);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取 Git 状态失败');
    } finally {
      setIsLoading(false);
    }
  }, [currentWorkspaceId, getCurrentWorkspace, updateGitStatus]);

  useEffect(() => {
    refreshStatus();

    // Refresh every 30 seconds
    const interval = setInterval(refreshStatus, 30000);

    return () => clearInterval(interval);
  }, [refreshStatus]);

  const getBranchDisplay = useCallback(() => {
    if (!gitStatus) return '无 Git 仓库';
    return gitStatus.branch;
  }, [gitStatus]);

  const getChangeCount = useCallback(() => {
    if (!gitStatus) return 0;
    return (
      gitStatus.modified.length +
      gitStatus.added.length +
      gitStatus.deleted.length +
      gitStatus.untracked.length
    );
  }, [gitStatus]);

  const getStatusColor = useCallback(() => {
    if (!gitStatus) return 'text-gray-400';
    const changes = getChangeCount();
    if (changes === 0) return 'text-green-400';
    if (changes < 5) return 'text-yellow-400';
    return 'text-red-400';
  }, [gitStatus, getChangeCount]);

  return {
    gitStatus,
    isLoading,
    error,
    refreshStatus,
    getBranchDisplay,
    getChangeCount,
    getStatusColor
  };
}