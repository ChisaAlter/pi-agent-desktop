// 可拖动调整大小的面板组件

import React, { useState, useCallback, useEffect } from 'react';

interface ResizablePanelProps {
  children: React.ReactNode;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  side: 'left' | 'right';
  className?: string;
}

export function ResizablePanel({ 
  children, 
  defaultWidth, 
  minWidth, 
  maxWidth, 
  side,
  className = '' 
}: ResizablePanelProps): React.JSX.Element {
  const [width, setWidth] = useState(defaultWidth);
  const [isDragging, setIsDragging] = useState(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    
    let newWidth: number;
    if (side === 'left') {
      newWidth = e.clientX;
    } else {
      newWidth = window.innerWidth - e.clientX;
    }
    
    // 限制在最小和最大宽度之间
    newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
    setWidth(newWidth);
  }, [isDragging, side, minWidth, maxWidth]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  return (
    <div 
      className={`relative flex-shrink-0 ${className}`}
      style={{ width: `${width}px` }}
    >
      {children}
      
      {/* 拖动手柄 */}
      <div
        className={`absolute top-0 bottom-0 w-1 cursor-col-resize hover:bg-[#1a1a1a] transition-colors ${
          side === 'left' ? 'right-0' : 'left-0'
        } ${isDragging ? 'bg-[#1a1a1a]' : 'bg-transparent'}`}
        onMouseDown={handleMouseDown}
      />
    </div>
  );
}
