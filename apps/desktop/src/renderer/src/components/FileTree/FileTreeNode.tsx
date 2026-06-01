// FileTreeNode — single file/directory node in the file tree
import React, { useState } from 'react';

export interface FileTreeNodeData {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeNodeData[];
  extension?: string;
  size?: number;
}

interface FileTreeNodeProps {
  node: FileTreeNodeData;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onSendToPi: (path: string) => void;
}

// Extension → color mapping
const EXT_COLORS: Record<string, string> = {
  '.ts': '#3178c6',
  '.tsx': '#3178c6',
  '.js': '#f7df1e',
  '.jsx': '#f7df1e',
  '.json': '#5b9a4b',
  '.md': '#888888',
  '.css': '#e879a8',
  '.scss': '#e879a8',
  '.py': '#3776ab',
  '.rs': '#f04e23',
  '.go': '#00add8',
  '.java': '#ed8b00',
  '.html': '#e34c26',
  '.vue': '#42b883',
  '.svelte': '#ff3e00',
  '.yaml': '#cb171e',
  '.yml': '#cb171e',
  '.toml': '#9c4121',
  '.xml': '#f06529',
  '.sh': '#4eaa25',
  '.bash': '#4eaa25',
  '.svg': '#ffb13b',
  '.png': '#a855f7',
  '.jpg': '#a855f7',
  '.gif': '#a855f7',
};

function getIcon(node: FileTreeNodeData): { svg: React.ReactNode; color: string } {
  if (node.type === 'directory') {
    return {
      color: '#666666',
      svg: (
        <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
          <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
        </svg>
      ),
    };
  }

  const ext = node.extension || '';
  const color = EXT_COLORS[ext] || '#888888';

  return {
    color,
    svg: (
      <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
    ),
  };
}

export const FileTreeNodeComponent: React.FC<FileTreeNodeProps> = ({
  node,
  depth,
  selectedPath,
  onSelect,
  onSendToPi,
}) => {
  const [expanded, setExpanded] = useState(depth === 0);
  const isDir = node.type === 'directory';
  const isSelected = selectedPath === node.path;
  const { svg: icon, color } = getIcon(node);

  const handleClick = () => {
    if (isDir) {
      setExpanded(!expanded);
    } else {
      onSelect(node.path);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    onSendToPi(node.path);
  };

  return (
    <div>
      <div
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        className={`flex items-center gap-1.5 py-[3px] px-2 cursor-pointer text-[13px] select-none group transition-colors ${
          isSelected
            ? 'bg-[#e8f0fe] text-[#1a1a1a]'
            : 'text-[#444] hover:bg-[#f0f0f0]'
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        title={node.path}
      >
        {/* Arrow for directories */}
        {isDir ? (
          <svg
            className={`w-3 h-3 flex-shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        ) : (
          <span className="w-3 flex-shrink-0" />
        )}

        {/* Icon */}
        <span style={{ color }} className="flex-shrink-0">
          {icon}
        </span>

        {/* Name */}
        <span className="truncate">{node.name}</span>
      </div>

      {/* Children */}
      {isDir && expanded && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTreeNodeComponent
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
              onSendToPi={onSendToPi}
            />
          ))}
        </div>
      )}
    </div>
  );
};
