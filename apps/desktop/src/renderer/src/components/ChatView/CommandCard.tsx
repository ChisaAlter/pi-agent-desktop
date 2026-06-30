// Command Card Component
// v1.0.9: 时间 + 耗时走 utils/format
// v1.0.15: 删 commandCount prop — 之前 MessageBubble 没传,chip 永远不显示

import React, { useState } from 'react';
import type { ToolCall } from '../../stores/session-store';
import { DiffViewer, extractDiffFromOutput } from '../DiffView';
import { formatTime, formatDuration } from '../../utils/format';
import { classifyTerminalCommand } from '../../utils/terminal-command';

interface CommandCardProps {
  toolCall: ToolCall;
}

export function CommandCard({ toolCall }: CommandCardProps): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState<"input" | "output" | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const toolName = typeof toolCall.name === "string" && toolCall.name.length > 0
    ? toolCall.name
    : "tool";
  
  const getStatusColor = () => {
    switch (toolCall.status) {
      case 'running': return 'text-[#f59e0b]';
      case 'completed': return 'text-[#10b981]';
      case 'error': return 'text-[var(--color-error)]';
      default: return 'text-[var(--mm-text-tertiary)]';
    }
  };
  
  const getStatusIcon = () => {
    switch (toolCall.status) {
      case 'running': return (
        <div className="h-3.5 w-3.5 rounded-full border-2 border-[#b8b8b8] border-t-transparent animate-spin" />
      );
      case 'completed': return (
        <div className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[var(--color-success)]">
          <svg className="h-2.5 w-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      );
      case 'error': return (
        <div className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[var(--color-error)]">
          <svg className="h-2.5 w-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
      );
      default: return (
        <div className="h-3.5 w-3.5 rounded-full border border-[var(--mm-border)]" />
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
  const commandText = getCommandText(toolCall.input ?? toolCall.args);
  const commandMode = commandText ? classifyTerminalCommand(commandText) : "run";
  const outputPaths = outputStr ? extractOutputPaths(outputStr) : [];

  const copyText = async (kind: "input" | "output", text: string | null): Promise<void> => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      setCopied(null);
      setCopyError(`复制失败: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    setCopyError(null);
    setCopied(kind);
    setTimeout(() => setCopied(null), 1400);
  };

  const openOutputPath = (path: string): void => {
    window.dispatchEvent(new CustomEvent("workspace:open-file", { detail: { path } }));
  };
  const runInTerminal = (): void => {
    if (!commandText) return;
    window.dispatchEvent(new CustomEvent("terminal:run-command", {
      detail: { command: commandText, mode: commandMode },
    }));
  };

  return (
    <div className="border-l border-[var(--mm-border)] pl-3">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between py-1 text-left text-[#a0a0a0] transition-colors duration-150 hover:text-[var(--mm-text-tertiary)]"
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {getStatusIcon()}
          <span className="min-w-0 truncate text-xs">
              {toolName === 'bash' ? '运行命令' :
               toolName === 'read' ? '读取文件' :
               toolName === 'write' ? '写入文件' :
               toolName === 'edit' ? '编辑文件' : toolName}
          </span>
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
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {commandText && (
              <>
                <button
                  type="button"
                  onClick={runInTerminal}
                  className="rounded-md border border-[#d8d8d2] bg-[var(--mm-bg-panel)] px-2 py-1 text-[11px] text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-panel)]"
                  title={commandMode === "draft" ? "高风险命令只填入终端，不自动执行" : "在终端中执行此命令"}
                >
                  {commandMode === "draft" ? "填入终端" : "在终端运行"}
                </button>
                <button
                  type="button"
                  onClick={() => void copyText("input", commandText)}
                  className="rounded-md border border-[var(--mm-border)] px-2 py-1 text-[11px] text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-panel)] hover:text-[#222]"
                >
                  {copied === "input" ? "已复制命令" : "复制命令"}
                </button>
              </>
            )}
            {commandMode === "draft" && (
              <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
                需手动确认执行
              </span>
            )}
            {outputStr && (
              <button
                type="button"
                onClick={() => void copyText("output", outputStr)}
                className="rounded-md border border-[var(--mm-border)] px-2 py-1 text-[11px] text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-panel)] hover:text-[#222]"
              >
                {copied === "output" ? "已复制输出" : "复制输出"}
              </button>
            )}
            {outputPaths.slice(0, 3).map((path) => (
              <button
                key={path}
                type="button"
                onClick={() => openOutputPath(path)}
                className="max-w-[220px] truncate rounded-md border border-[var(--mm-border)] px-2 py-1 text-[11px] text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-panel)] hover:text-[#222]"
                title={`在文件工作区打开 ${path}`}
              >
                打开 {basename(path)}
              </button>
            ))}
            {copyError && (
              <span className="self-center text-[11px] text-[var(--color-error)]" role="alert">
                {copyError}
              </span>
            )}
          </div>
          {/* Input */}
          {inputStr !== null ? (
            <div className="mb-3">
              <div className="mb-1 text-xs font-medium text-[var(--mm-text-tertiary)]">输入：</div>
              <pre className="overflow-x-auto rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-2 text-xs">
                {inputStr}
              </pre>
            </div>
          ) : null}
          
          {/* Output */}
          {outputStr !== null ? (
            <div>
              <div className="mb-1 text-xs font-medium text-[var(--mm-text-tertiary)]">输出：</div>
              {(toolName === 'edit' || toolName === 'write') &&
               typeof toolCall.output === 'string' &&
               extractDiffFromOutput(toolCall.output) ? (
                <div className="mt-1">
                  <DiffViewer diff={toolCall.output} maxHeight="400px" />
                </div>
              ) : (
                <pre className="max-h-40 overflow-x-auto overflow-y-auto rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-2 text-xs">
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

function getCommandText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const command = record.command ?? record.cmd ?? record.script;
  return typeof command === "string" && command.trim() ? command.trim() : null;
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function extractOutputPaths(output: string): string[] {
  const results = new Set<string>();
  const pattern = /(?:[A-Za-z]:[\\/][^\s"'`<>]+|(?:[\w.-]+[\\/])+[\w.@()[\]-]+\.[A-Za-z0-9_+-]{1,12})/g;
  for (const match of output.matchAll(pattern)) {
    const path = match[0].replace(/[),.;:]+$/, "");
    if (!/\.(ts|tsx|js|jsx|json|md|txt|html|css|scss|yml|yaml|toml|py|rs|go|java|cs|cpp|c|h|png|jpg|jpeg|webp|svg|pdf)$/i.test(path)) {
      continue;
    }
    results.add(path);
  }
  return [...results];
}
