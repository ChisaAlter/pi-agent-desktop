/**
 * PiStatusPanel — Pi CLI 状态管理面板
 *
 * 功能：
 *  - 显示 Pi CLI 安装状态（已安装/未安装）
 *  - 显示本地版本 vs 最新版本
 *  - 安装 / 更新 / 卸载操作
 *  - 实时进度显示
 *
 * v1.0.x (button-style task):
 *  - 4 个主操作按钮 (安装/更新/已是最新/取消) 统一用 common/Button
 *  - 卸载按钮用 outline variant
 *  - 状态点用 --color-success / --color-text-tertiary token
 *  - 安装中/更新中按钮 isLoading=true
 */

import React, { useEffect, useRef } from 'react';
import { usePiStatusStore } from '../../stores/pi-status-store';
import { useTranslateIpcError } from '../../i18n';
import type { IpcError } from '@shared';
import type { PiInstallProgress } from '../../types';
import { Button } from '../common/Button';

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

  // 组件挂载时初始化 (mount-only, ref 模式避开 store action deps 警告)
  const setupListenersRef = useRef(setupListeners);
  setupListenersRef.current = setupListeners;
  const checkStatusRef = useRef(checkStatus);
  checkStatusRef.current = checkStatus;
  const cleanupListenersRef = useRef(cleanupListeners);
  cleanupListenersRef.current = cleanupListeners;
  useEffect(() => {
    setupListenersRef.current();
    checkStatusRef.current();
    return () => cleanupListenersRef.current();
  }, []);

  // v1.0.8: IpcError 走 i18n, string 兜底直接显示
  const translateIpcError = useTranslateIpcError();
  const errorMessage: string | null = error == null
    ? null
    : typeof error === 'string'
      ? error
      : translateIpcError(error as IpcError);

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
            <span
              className="w-2 h-2 rounded-full bg-[var(--color-success)]"
              title="已安装"
            />
          )}
          {!isInstalled && !loading && (
            <span
              className="w-2 h-2 rounded-full bg-[var(--color-text-tertiary)]"
              title="未安装"
            />
          )}
        </div>

        {/* 刷新按钮 */}
        <Button
          variant="subtle"
          size="xs"
          onClick={refreshStatus}
          disabled={loading || isOperating}
          title="刷新状态"
          className="text-gray-500 hover:text-gray-300"
        >
          {loading ? '⟳ 检测中...' : '⟳ 刷新'}
        </Button>
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
      {errorMessage && (
        <div className="mb-3 p-2 bg-red-900/20 border border-red-800/30 rounded text-xs text-red-400" role="alert">
          {errorMessage}
        </div>
      )}

      {/* 进度条 */}
      {isOperating && <ProgressBar progress={progress} />}

      {/* 操作按钮 — 4 个主操作 + 卸载 (outline) */}
      <div className="flex gap-2 mt-3">
        {!isInstalled && (
          <Button
            variant="primary"
            size="sm"
            onClick={install}
            isLoading={isOperating}
            className="flex-1"
          >
            {isOperating ? '安装中...' : '安装 Pi CLI'}
          </Button>
        )}

        {isInstalled && updateAvailable && (
          <Button
            variant="primary"
            size="sm"
            onClick={update}
            isLoading={isOperating}
            className="flex-1"
          >
            {isOperating ? '更新中...' : `更新到 ${status?.latestVersion ?? ''}`}
          </Button>
        )}

        {isInstalled && !updateAvailable && !isOperating && (
          <Button
            variant="secondary"
            size="sm"
            onClick={refreshStatus}
            className="flex-1"
          >
            已是最新版本
          </Button>
        )}

        {isOperating && (
          <Button
            variant="danger"
            size="sm"
            onClick={cancelOperation}
            className="flex-1"
          >
            取消
          </Button>
        )}

        {isInstalled && !isOperating && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (window.confirm('确定要卸载 Pi CLI 吗？')) {
                uninstall();
              }
            }}
            title="卸载 Pi CLI"
          >
            卸载
          </Button>
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
