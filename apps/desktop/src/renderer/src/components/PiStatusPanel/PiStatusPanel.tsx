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

import React, { useEffect, useRef, useState } from 'react';
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
        <span className={isError ? 'text-red-600' : 'text-[var(--mm-text-secondary)]'}>
          {stageLabels[progress.stage] || progress.stage}
        </span>
        {progress.percent != null && (
          <span className="text-[var(--mm-text-tertiary)]">{progress.percent}%</span>
        )}
      </div>
      <div className="w-full h-1.5 bg-[#ececea] rounded-full overflow-hidden">
        <div
          className={`h-full ${color} rounded-full transition-[width,background-color] duration-[var(--motion-panel)]`}
          style={{ width: progress.percent != null ? `${progress.percent}%` : isDone ? '100%' : '60%' }}
        />
      </div>
      <p className={`text-xs mt-1 ${isError ? 'text-red-600' : 'text-[var(--mm-text-tertiary)]'}`}>
        {progress.message}
      </p>
    </div>
  );
}

// ── 版本徽章 ────────────────────────────────────────────────────

function VersionBadge({ version, label }: { version: string | null; label: string }): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-[var(--mm-text-tertiary)]">{label}</span>
      <span className={`text-sm font-mono px-2 py-0.5 rounded-md border ${version ? 'border-[var(--mm-border)] bg-[var(--mm-bg-panel)] text-[var(--mm-text-primary)]' : 'border-[var(--mm-border)] bg-[var(--mm-bg-sidebar)] text-[var(--mm-text-tertiary)]'}`}>
        {version || '未安装'}
      </span>
    </div>
  );
}

// ── 主面板 ──────────────────────────────────────────────────────

export function PiStatusPanel(): React.JSX.Element {
  const [confirmUninstall, setConfirmUninstall] = useState(false);
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
    <div className="rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-4 text-[var(--mm-text-primary)]">
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] font-mono text-xs font-semibold text-[var(--mm-text-secondary)]">
            pi
          </span>
          <h3 className="text-sm font-medium text-[var(--mm-text-primary)]">Pi CLI</h3>
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
          className="text-[var(--mm-text-secondary)] hover:text-[var(--mm-text-primary)]"
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
          <div className="flex items-center gap-2 text-xs text-[var(--mm-text-secondary)]">
            <span className="font-mono text-[10px] uppercase text-[var(--mm-text-tertiary)]">cfg</span>
            <span>
              {status.defaultProvider || '未配置'}
              {status.defaultModel && ` / ${status.defaultModel}`}
            </span>
          </div>
        )}

        {/* 安装路径 */}
        {isInstalled && status?.executablePath && (
          <div className="truncate font-mono text-xs text-[var(--mm-text-tertiary)]" title={status.executablePath}>
            {status.executablePath}
          </div>
        )}
        {isInstalled && (
          <div className="flex items-center justify-between gap-2 text-xs text-[var(--mm-text-secondary)]">
            <span>Runtime</span>
            <span className="rounded-md border border-[#e6e6e1] bg-[var(--mm-bg-panel)] px-2 py-0.5 font-mono text-[11px]">
              {status?.runtimeSource === "managed" ? "managed" : status?.runtimeSource === "global" ? "global" : status?.installMethod || "unknown"}
            </span>
          </div>
        )}
        {status?.managedRuntimePath && (
          <div className="truncate font-mono text-[10px] text-[var(--mm-text-tertiary)]" title={status.managedRuntimePath}>
            managed: {status.managedRuntimePath}
          </div>
        )}
      </div>

      {/* 错误信息 */}
      {errorMessage && (
        <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700" role="alert">
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
            onClick={() => setConfirmUninstall(true)}
            title="卸载 Pi CLI"
          >
            卸载
          </Button>
        )}
      </div>

      {/* 未安装提示 */}
      {!isInstalled && !loading && !isOperating && (
        <p className="text-xs text-[var(--mm-text-tertiary)] mt-2">
          Pi CLI 是 Pi Desktop 的核心引擎。安装后即可使用 AI 编程助手功能。
        </p>
      )}

      {confirmUninstall && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35">
          <div
            className="w-[360px] rounded-2xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-5 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-label="确认卸载 Pi CLI"
          >
            <h3 className="text-base font-semibold text-[var(--mm-text-primary)]">卸载 Pi CLI</h3>
            <p className="mt-2 text-sm leading-6 text-[var(--mm-text-secondary)]">
              卸载后 Pi Desktop 将无法启动新的 Pi Agent 对话，直到重新安装 Pi CLI。
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmUninstall(false)}
                className="rounded-lg px-3 py-1.5 text-sm text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-sidebar)]"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmUninstall(false);
                  void uninstall();
                }}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700"
              >
                卸载
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PiStatusPanel;
