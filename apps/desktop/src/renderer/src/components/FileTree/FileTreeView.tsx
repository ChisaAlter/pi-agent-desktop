// FileTreeView — displays the project file tree with caching
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { FileTreeNodeComponent, type FileTreeNodeData } from './FileTreeNode';

interface FileTreeViewProps {
  workspacePath: string | null;
  onFileSelect?: (path: string) => void;
  onSendToPi?: (message: string) => void;
}

// Simple in-memory cache keyed by workspace path
const treeCache = new Map<string, { data: FileTreeNodeData; timestamp: number }>();
const CACHE_TTL = 30_000; // 30 seconds

export const FileTreeView: React.FC<FileTreeViewProps> = ({
  workspacePath,
  onFileSelect,
  onSendToPi,
}) => {
  const [tree, setTree] = useState<FileTreeNodeData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const loadTree = useCallback(async (force = false) => {
    if (!workspacePath) return;

    // Check cache
    const cached = treeCache.get(workspacePath);
    if (!force && cached && Date.now() - cached.timestamp < CACHE_TTL) {
      setTree(cached.data);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await window.piAPI.getFileTree(workspacePath, 3);
      if (!mountedRef.current) return;
      treeCache.set(workspacePath, { data: result as FileTreeNodeData, timestamp: Date.now() });
      setTree(result as FileTreeNodeData);
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof Error ? e.message : 'Failed to load file tree');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [workspacePath]);

  useEffect(() => {
    mountedRef.current = true;
    loadTree();
    return () => { mountedRef.current = false; };
  }, [loadTree]);

  const handleSelect = (path: string) => {
    setSelectedPath(path);
    onFileSelect?.(path);
  };

  const handleSendToPi = (path: string) => {
    if (onSendToPi) {
      onSendToPi(`请解释这个文件: ${path}`);
    }
  };

  if (!workspacePath) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[#999] px-4">
        <svg className="w-10 h-10 mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
        <p className="text-xs">请先选择工作区</p>
      </div>
    );
  }

  if (loading && !tree) {
    return (
      <div className="flex items-center justify-center h-24 text-[#999] text-xs">
        <svg className="animate-spin w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        加载文件树...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-3 text-xs text-red-500">
        {error}
        <button onClick={() => loadTree(true)} className="ml-2 underline text-[#3178c6]">
          重试
        </button>
      </div>
    );
  }

  if (!tree) return null;

  return (
    <div className="overflow-y-auto text-[13px] font-mono">
      {/* Refresh button */}
      <div className="flex items-center justify-between px-3 py-1.5 text-[10px] text-[#999] uppercase tracking-wider">
        <span>文件</span>
        <button
          onClick={() => { treeCache.delete(workspacePath); loadTree(true); }}
          className="p-0.5 rounded hover:bg-[#f0f0f0] transition-colors"
          title="刷新文件树"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>
      {tree.children?.map((child) => (
        <FileTreeNodeComponent
          key={child.path}
          node={child}
          depth={0}
          selectedPath={selectedPath}
          onSelect={handleSelect}
          onSendToPi={handleSendToPi}
        />
      ))}
    </div>
  );
};
