/**
 * PiStatusPanel — Pi CLI 状态管理面板
 *
 * 功能：
 *  - 显示 Pi CLI 安装状态（已安装/未安装）
 *  - 显示本地版本 vs 最新版本
 *  - 安装 / 更新 / 卸载操作
 *  - 实时进度显示
 */

import React, { useEffect } from 'react';
import { usePiStatusStore } from '../../stores/pi-status-store';
import type { PiInstallProgress } from '../../types';

// ── 进度条组件 ──────────────────────────────────────────────────

function ProgressBar({ progress }: { progress: PiInstallProgress | null }): React.JSX.Element | null {
  if (!progress) return null;

  const stageColors: Record<string, string> = {
    downloading: 'bg-blue-500',
    installing: 'bg-yellow-500',
    verifying: 'bg-purple-500',
    done: 'bg-green-500',
    error: 'bg-red-500',
  };

  const stageLabels: Record<string, string> = {
    downloading: '下载中',
    installing: '安装中',
    verifying: '验证中',
    done: '完成',
    error: '错误',
  };

  const color = stageColors[progress.stage] || 'bg-gray-500';
  const isDone = progress.stage === 'done';
  const isError = progress.stage === 'error';

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between text-xs mb-1">
        <span className={isError ? 'text-red-400' : 'text-gray-400'}>
          {stageLabels[progress.stage] || progress.stage}
        </span>
        {progress.percent != null && (
          <span className="text-gray-500">{progress.percent}%</span>
        )}
      </div>
      <div className="w-full h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full ${color} rounded-full transition-all duration-300 ${!isDone && !isError ? 'animate-pulse' : ''}`}
          style={{ width: progress.percent != null ? `${progress.percent}%` : isDone ? '100%' : '60%' }}
        />
      </div>
      <p className={`text-xs mt-1 ${isError ? 'text-red-400' : 'text-gray-500'}`}>
        {progress.message}
      </p>
    </div>
  );
}

// ── 版本徽章 ────────────────────────────────────────────────────

function VersionBadge({ version, label }: { version: string | null; label: string }): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500">{label}</span>
      <span className={`text-sm font-mono px-2 py-0.5 rounded ${version ? 'bg-gray-700 text-gray-200' : 'bg-gray-800 text-gray-500'}`}>
        {version || '未安装'}
      </span>
    </div>
  );
}

// ── 主面板 ──────────────────────────────────────────────────────

export function PiStatusPanel(): React.JSX.Element {
  const {
    status,
    loading,
    error,
    progress,
    isOperating,
    checkStatus,
    refreshStatus,
    install,
    update,
    uninstall,
    cancelOperation,
    setupListeners,
    cleanupListeners,
  } = usePiStatusStore();

  // 组件挂载时初始化
  useEffect(() => {
    setupListeners();
    checkStatus();
    return () => cleanupListeners();
  }, []);

  const isInstalled = status?.installed ?? false;
  const updateAvailable = status?.updateAvailable ?? false;

  return (
    <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-4">
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">🤖</span>
          <h3 className="text-sm font-medium text-gray-200">Pi CLI</h3>
          {isInstalled && (
            <span className="w-2 h-2 rounded-full bg-green-500" title="已安装" />
          )}
          {!isInstalled && !loading && (
            <span className="w-2 h-2 rounded-full bg-gray-500" title="未安装" />
          )}
        </div>

        {/* 刷新按钮 */}
        <button
          onClick={refreshStatus}
          disabled={loading || isOperating}
          className="text-xs text-gray-500 hover:text-gray-300 disabled:opacity-50 transition-colors"
          title="刷新状态"
        >
          {loading ? '⟳ 检测中...' : '⟳ 刷新'}
        </button>
      </div>

      {/* 版本信息 */}
      <div className="space-y-2 mb-3">
        <div className="flex items-center justify-between">
          <VersionBadge version={status?.localVersion ?? null} label="本地" />
          <VersionBadge version={status?.latestVersion ?? null} label="最新" />
        </div>

        {/* 配置信息 */}
        {isInstalled && status?.configExists && (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span>⚙️</span>
            <span>
              {status.defaultProvider || '未配置'}
              {status.defaultModel && ` / ${status.defaultModel}`}
            </span>
          </div>
        )}

        {/* 安装路径 */}
        {isInstalled && status?.executablePath && (
          <div className="text-xs text-gray-600 truncate" title={status.executablePath}>
            📁 {status.executablePath}
          </div>
        )}
      </div>

      {/* 错误信息 */}
      {error && (
        <div className="mb-3 p-2 bg-red-900/20 border border-red-800/30 rounded text-xs text-red-400">
          {error}
        </div>
      )}

      {/* 进度条 */}
      {isOperating && <ProgressBar progress={progress} />}

      {/* 操作按钮 */}
      <div className="flex gap-2 mt-3">
        {!isInstalled && !isOperating && (
          <button
            onClick={install}
            className="flex-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded transition-colors"
          >
            安装 Pi CLI
          </button>
        )}

        {isInstalled && updateAvailable && !isOperating && (
          <button
            onClick={update}
            className="flex-1 px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white text-xs font-medium rounded transition-colors"
          >
            更新到 {status?.latestVersion}
          </button>
        )}

        {isInstalled && !updateAvailable && !isOperating && (
          <button
            onClick={refreshStatus}
            className="flex-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs font-medium rounded transition-colors"
          >
            已是最新版本
          </button>
        )}

        {isOperating && (
          <button
            onClick={cancelOperation}
            className="flex-1 px-3 py-1.5 bg-red-700 hover:bg-red-600 text-white text-xs font-medium rounded transition-colors"
          >
            取消
          </button>
        )}

        {isInstalled && !isOperating && (
          <button
            onClick={() => {
              if (window.confirm('确定要卸载 Pi CLI 吗？')) {
                uninstall();
              }
            }}
            className="px-3 py-1.5 bg-gray-800 hover:bg-red-900/50 text-gray-500 hover:text-red-400 text-xs rounded transition-colors border border-gray-700 hover:border-red-800/50"
            title="卸载 Pi CLI"
          >
            卸载
          </button>
        )}
      </div>

      {/* 未安装提示 */}
      {!isInstalled && !loading && !isOperating && (
        <p className="text-xs text-gray-600 mt-2">
          Pi CLI 是 Pi Desktop 的核心引擎。安装后即可使用 AI 编程助手功能。
        </p>
      )}
    </div>
  );
}

export default PiStatusPanel;
