// ChatInput — v1.1
// v1.0.13: 附件/权限/模型下拉真接通
// v1.1: @ 文件引用弹窗 + 图片粘贴 + 暗色主题 (所有颜色走 CSS 变量)

import React, { useState, useRef, useCallback, useEffect } from "react";
import { useSettingsStore } from "../../stores/settings-store";
import { useAttachmentsStore } from "../../stores/attachments-store";
import { useI18n } from "../../i18n";
import { Popover } from "../common/Popover";
import { useMentions } from "../../hooks/useMentions";
import { usePermissionStore } from "../../stores/permission-store";
import { usePlanStore } from "../../stores/plan-store";
import { useWorkspaceStore } from "../../stores/workspace-store";
import { logger } from "../../utils/logger";
import { PermissionRequestStack } from "./PermissionRequestStack";
import { isIpcError, type PermissionMode } from "@shared";

interface ChatInputProps {
  isConnected: boolean;
  isProcessing: boolean;
  runContext?: "plan_execution" | null;
  onSend: (message: string) => Promise<void>;
  onStop: () => void;
  workspaceId?: string;
  workspacePath?: string;
  prefill?: string;
  prefillKey?: number;
  onPrefillConsumed?: () => void;
  focusKey?: number;
}

const PERMISSION_OPTIONS: Array<{ value: PermissionMode; label: string; desc: string }> = [
  { value: "ask", label: "主动询问", desc: "写入和命令默认询问" },
  { value: "smart", label: "智能授权", desc: "只读自动放行，写入询问" },
  { value: "always", label: "始终授权", desc: "尽量自动允许，保留审计" },
];

function normalizePermissionMode(value: unknown): PermissionMode {
  if (value === "ask" || value === "read") return "ask";
  if (value === "always" || value === "full") return "always";
  return "smart";
}

function basename(p: string): string {
  const m = p.match(/[^\\/]+$/);
  return m ? m[0] : p;
}

function errorMessage(value: unknown, fallback: string): string {
  if (isIpcError(value)) return value.fallback;
  if (value instanceof Error) return value.message;
  if (typeof value === "string" && value.trim()) return value;
  return fallback;
}

function mergePrefillDraft(current: string, incoming: string): string {
  const text = incoming.trim();
  if (!text) return current;
  const existing = current.trimEnd();
  if (!existing) return incoming;
  if (existing.includes(text)) return current;
  return `${existing} ${text}${incoming.endsWith(" ") ? " " : ""}`;
}

function PermissionModeIcon({ mode }: { mode: PermissionMode }): React.JSX.Element {
  if (mode === "ask") {
    return (
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M12 6v6l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
  }
  if (mode === "smart") {
    return (
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M9 12l2 2 4-5m5 3a8 8 0 11-16 0 8 8 0 0116 0z" />
      </svg>
    );
  }
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  );
}

function ToggleSwitch({ checked }: { checked: boolean }): React.JSX.Element {
  return (
    <span
      className={`relative inline-flex h-[18px] w-[31px] shrink-0 rounded-full p-0.5 transition-colors ${
        checked ? "bg-[#1795f6]" : "bg-[#e9e9e5]"
      }`}
      aria-hidden
    >
      <span
        className={`h-3.5 w-3.5 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.14)] transition-transform ${
          checked ? "translate-x-[13px]" : "translate-x-0"
        }`}
      />
    </span>
  );
}

export function ChatInput({
  isConnected,
  isProcessing,
  runContext = null,
  onSend,
  onStop,
  workspaceId,
  workspacePath,
  prefill,
  prefillKey,
  onPrefillConsumed,
  focusKey,
}: ChatInputProps): React.JSX.Element {
  const [inputValue, setInputValue] = useState("");
  const [cursorPos, setCursorPos] = useState(0);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sendingRef = useRef(false);
  const { settings, updateSettings, piModels } = useSettingsStore();
  const permissionStore = usePermissionStore();
  const planStore = usePlanStore();
  const { workspaces, getCurrentWorkspace, setCurrentWorkspace, addWorkspace, createWorkspace } = useWorkspaceStore();
  const { add: addAttachment, remove: removeAttachment, clear: clearAttachments, list: listAttachments } = useAttachmentsStore();
  const { t } = useI18n();

  const {
    activeMention,
    candidates,
    highlightIndex,
    setHighlightIndex,
    selectCandidate,
    close: closeMentions,
  } = useMentions(inputValue, cursorPos, workspacePath);

  const attachments = workspaceId ? listAttachments(workspaceId) : [];

  // 图片粘贴
  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>): void => {
      if (!workspaceId) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (!file) continue;
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            addAttachment(workspaceId, {
              id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              kind: "image",
              name: file.name || `pasted-image-${Date.now()}.png`,
              value: dataUrl,
              mimeType: item.type,
              size: file.size,
            });
          };
          reader.readAsDataURL(file);
        }
      }
    },
    [workspaceId, addAttachment],
  );

  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      const maxHeight = 200;
      textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    }
  }, []);

  useEffect(() => {
    adjustTextareaHeight();
  }, [inputValue, adjustTextareaHeight]);

  const onConsumedRef = useRef(onPrefillConsumed);
  onConsumedRef.current = onPrefillConsumed;
  useEffect(() => {
    if (typeof prefill === "string" && prefill.length > 0) {
      setInputValue((current) => mergePrefillDraft(current, prefill));
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        const ta = textareaRef.current;
        if (ta) {
          const len = ta.value.length;
          ta.setSelectionRange(len, len);
        }
      });
      onConsumedRef.current?.();
    }
  }, [prefill, prefillKey]);

  useEffect(() => {
    if (focusKey === undefined) return;
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [focusKey]);

  const handleSend = async (): Promise<void> => {
    if (sendingRef.current || !inputValue.trim() || !isConnected) return;
    sendingRef.current = true;
    setIsSending(true);
    setSendError(null);
    const imageAttachments = attachments.filter((attachment) => attachment.kind === "image");
    let imagePrefix = "";
    if (imageAttachments.length > 0) {
      if (!settings.visionProvider || !settings.visionModel) {
        setAttachmentError("请先在设置中选择识图模型");
        sendingRef.current = false;
        setIsSending(false);
        return;
      }
      if (!window.piAPI?.describeImages) {
        setAttachmentError("识图服务不可用 (preload 未注入)");
        sendingRef.current = false;
        setIsSending(false);
        return;
      }
      try {
        const result = await window.piAPI.describeImages(imageAttachments.map((attachment) => ({
          name: attachment.name,
          dataUrl: attachment.value,
          mimeType: attachment.mimeType,
        })));
        imagePrefix = [
          "图片识别结果:",
          result.text.trim(),
          "",
          "用户消息:",
        ].join("\n");
      } catch (err) {
        setAttachmentError(`识图失败: ${errorMessage(err, "未知错误")}`);
        sendingRef.current = false;
        setIsSending(false);
        return;
      }
    }
    const fileAttachments = attachments.filter((attachment) => attachment.kind === "file");
    const attachmentPrefix = fileAttachments.length > 0
      ? [
          "附加文件:",
          ...fileAttachments.map((attachment) => `@${attachment.value}`),
          "",
          "用户消息:",
        ].join("\n")
      : "";
    const prefixes = [attachmentPrefix, imagePrefix].filter(Boolean);
    const outbound = prefixes.length > 0
      ? `${prefixes.join("\n")}\n${inputValue.trim()}`
      : inputValue.trim();
    try {
      await onSend(outbound);
    } catch (err) {
      setSendError(`发送失败: ${errorMessage(err, "未知错误")}`);
      sendingRef.current = false;
      setIsSending(false);
      return;
    }
    setInputValue("");
    setAttachmentError(null);
    if (workspaceId) clearAttachments(workspaceId);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    sendingRef.current = false;
    setIsSending(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (activeMention && candidates.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightIndex((i) => Math.min(i + 1, candidates.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const selected = candidates[highlightIndex];
        if (selected) {
          const newText = selectCandidate(selected);
          setInputValue(newText);
          requestAnimationFrame(() => {
            if (textareaRef.current) {
              const pos = newText.length;
              textareaRef.current.setSelectionRange(pos, pos);
              setCursorPos(pos);
            }
          });
          closeMentions();
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeMentions();
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (e.repeat) return;
      void handleSend();
    }
  };

  const handleSelect = useCallback((): void => {
    const ta = textareaRef.current;
    if (ta) {
      setCursorPos(ta.selectionStart);
    }
  }, []);

  const handlePickFiles = useCallback(async (): Promise<void> => {
    if (!window.piAPI?.selectFiles) {
      setAttachmentError("文件选择不可用 (preload 未注入)");
      return;
    }
    if (!workspaceId) {
      setAttachmentError("请先选择 workspace");
      return;
    }
    setAttachmentError(null);
    try {
      const paths = await window.piAPI.selectFiles({ multiSelections: true });
      if (isIpcError(paths)) {
        setAttachmentError(paths.fallback);
        return;
      }
      if (!Array.isArray(paths) || paths.length === 0) return;
      for (const p of paths) {
        addAttachment(workspaceId, {
          id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          kind: "file",
          name: basename(p),
          value: p,
        });
      }
    } catch (err) {
      setAttachmentError(`打开文件选择器失败: ${errorMessage(err, "未知错误")}`);
    }
  }, [workspaceId, addAttachment]);

  const currentPermission = normalizePermissionMode(settings.permissionLevel ?? permissionStore.mode);
  const currentModel = settings.model;
  const currentWorkspace =
    (workspaceId ? workspaces.find((w) => w.id === workspaceId) : null) ?? getCurrentWorkspace();
  const recentWorkspaces = [...workspaces]
    .sort((a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime())
    .slice(0, 6);

  useEffect(() => {
    if (permissionStore.mode !== currentPermission) {
      permissionStore.setMode(currentPermission);
    }
  }, [currentPermission, permissionStore]);

  const handlePermissionSelect = useCallback(
    (value: PermissionMode) => {
      permissionStore.setMode(value);
      updateSettings({ permissionLevel: value });
    },
    [permissionStore, updateSettings],
  );
  const handleModelSelect = useCallback(
    (model: { id: string; name: string; provider: string }) => {
      updateSettings({ model: model.id, provider: model.provider });
    },
    [updateSettings],
  );
  const handlePlanToggle = useCallback(() => {
    planStore.setEnabled(workspaceId, !planStore.enabled);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [planStore, workspaceId]);
  const handleSwitchWorkspace = useCallback(
    async (id: string): Promise<void> => {
      const ws = workspaces.find((w) => w.id === id);
      if (!ws) return;
      try {
        const result = await window.piAPI?.selectWorkspace?.(ws.path);
        if (isIpcError(result)) {
          setAttachmentError(result.fallback);
          return;
        }
        setCurrentWorkspace(id);
        setAttachmentError(null);
      } catch (e) {
        logger.error("[ChatInput] selectWorkspace failed:", e);
        setAttachmentError(`切换 workspace 失败: ${errorMessage(e, "未知错误")}`);
      }
    },
    [setCurrentWorkspace, workspaces],
  );
  const handleSelectNewWorkspace = useCallback(async (): Promise<void> => {
    if (!window.piAPI?.selectDirectory) {
      setAttachmentError("目录选择不可用 (preload 未注入)");
      return;
    }
    try {
      const selectedPath = await window.piAPI.selectDirectory();
      if (isIpcError(selectedPath)) {
        setAttachmentError(selectedPath.fallback);
        return;
      }
      const path = selectedPath;
      if (!path) return;

      const name = basename(path);
      const persisted = await window.piAPI?.listWorkspaces?.();
      if (isIpcError(persisted)) {
        setAttachmentError(persisted.fallback);
        return;
      }
      const persistedMatch = Array.isArray(persisted)
        ? persisted.find((w) => w.path === path)
        : undefined;
      if (persistedMatch) {
        const ws = addWorkspace(persistedMatch.name, persistedMatch.path, persistedMatch.id);
        setCurrentWorkspace(ws.id);
        const result = await window.piAPI?.selectWorkspace?.(ws.path);
        if (isIpcError(result)) {
          setAttachmentError(result.fallback);
          return;
        }
        setAttachmentError(null);
        return;
      }

      const existing = workspaces.find((w) => w.path === path);
      if (existing) {
        await handleSwitchWorkspace(existing.id);
        return;
      }

      const ws = await createWorkspace(name, path);
      if (!ws) {
        setAttachmentError(useWorkspaceStore.getState().lastError ?? "创建 workspace 失败");
        return;
      }
      const result = await window.piAPI.selectWorkspace?.(path);
      if (isIpcError(result)) {
        setAttachmentError(result.fallback);
        return;
      }
      setAttachmentError(null);
    } catch (e) {
      logger.error("[ChatInput] create workspace failed:", e);
      setAttachmentError(`创建 workspace 失败: ${errorMessage(e, "未知错误")}`);
    }
  }, [addWorkspace, createWorkspace, handleSwitchWorkspace, setCurrentWorkspace, workspaces]);

  const canSend = inputValue.trim().length > 0 && isConnected && !isSending;
  const currentPermissionLabel = PERMISSION_OPTIONS.find((p) => p.value === currentPermission)?.label ?? "智能授权";
  const inputPlaceholder = !isConnected
    ? t("chatInput.placeholder.noConnection")
    : isProcessing
      ? runContext === "plan_execution"
        ? "正在执行计划，输入内容会作为补充指令发送"
        : "任务运行中，输入内容会作为追加指令发送"
      : t("chatInput.placeholder.ready");
  const runningLabel = runContext === "plan_execution"
    ? "正在执行计划 · 新输入会作为补充指令进入当前执行"
    : "任务运行中 · 新输入会作为追加指令进入当前会话";
  const stopLabel = runContext === "plan_execution" ? "暂停执行" : "停止";
  const stopAriaLabel = runContext === "plan_execution" ? "暂停执行" : t("chatView.stopGeneration");

  return (
    <div className="bg-transparent px-8 pt-2 pb-3">
      <PermissionRequestStack />
      <div
        data-testid="chat-input-shell"
        className="mx-auto max-w-[770px] overflow-visible rounded-[18px] border border-[#e8e8e4] bg-white shadow-[0_18px_44px_rgba(20,20,18,0.08),0_2px_10px_rgba(20,20,18,0.05)] transition-all focus-within:border-[#deded9] focus-within:shadow-[0_18px_44px_rgba(20,20,18,0.08),0_0_0_3px_rgba(36,36,35,0.035)]"
      >
        {isProcessing && (
          <div className="flex items-center justify-between gap-3 rounded-t-[18px] bg-[#fafafa] px-4 py-2 text-xs">
            <div className="flex min-w-0 items-center gap-2 text-[var(--mm-text-secondary)]">
              <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--mm-bg-active)]" aria-hidden />
              <span className="truncate">{runningLabel}</span>
            </div>
            <button
              type="button"
              onClick={onStop}
              className="shrink-0 rounded-md border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] px-2 py-1 text-xs text-[var(--mm-text-primary)] hover:bg-[var(--mm-bg-hover)]"
              aria-label={stopAriaLabel}
            >
              {stopLabel}
            </button>
          </div>
        )}
        {/* 附件 chips */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-4 pt-3" role="list" aria-label="已选附件">
            {attachments.map((a) => (
              <span
                key={a.id}
                role="listitem"
                className="inline-flex items-center gap-1 px-2 py-1 bg-[var(--color-hover)] border border-[var(--color-border)] rounded text-xs text-[var(--mm-text-primary)]"
                title={a.kind === "image" ? a.name : a.value}
              >
                {a.kind === "image" && a.value ? (
                  <img src={a.value} alt={a.name} className="w-6 h-6 rounded object-cover flex-shrink-0" />
                ) : (
                  <svg className="w-3 h-3 text-[var(--mm-text-secondary)] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                )}
                <span className="max-w-[200px] truncate">{a.name}</span>
                <button
                  type="button"
                  onClick={() => workspaceId && removeAttachment(workspaceId, a.id)}
                  className="ml-0.5 text-[var(--mm-text-tertiary)] hover:text-[var(--mm-text-primary)] transition-colors"
                  aria-label={`移除附件 ${a.name}`}
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        )}

        {/* 输入框 + 发送按钮 + @mention 弹窗 */}
        <div className="relative flex gap-3 px-[18px] pt-[17px] pb-2">
          <div className="flex-1 relative">
            {planStore.enabled && (
              <div className="mb-2 flex">
                <span
                  className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[#dce9dd] bg-[#eef8ef] px-2.5 text-xs font-semibold text-[#3c7b46]"
                  aria-label="计划模式已启用"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
                  </svg>
                  计划模式
                </span>
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                setCursorPos(e.target.selectionStart);
                if (attachmentError) setAttachmentError(null);
                if (sendError) setSendError(null);
              }}
              onPaste={handlePaste}
              onSelect={handleSelect}
              onKeyDown={handleKeyDown}
              placeholder={inputPlaceholder}
              className="min-h-[62px] w-full resize-none border-0 bg-transparent px-0 py-0 text-sm leading-relaxed text-[var(--mm-text-primary)] placeholder:text-[#a6a6a0] focus:outline-none focus-visible:!outline-none focus-visible:!shadow-none disabled:opacity-50"
              rows={1}
              disabled={!isConnected}
              aria-label={t("chatInput.send")}
            />
            {/* @mention 候选弹窗 */}
            {activeMention && candidates.length > 0 && (
              <div
                role="listbox"
                aria-label="文件候选"
                className="absolute left-0 bottom-full mb-1 w-72 max-h-56 overflow-y-auto bg-[var(--mm-bg-sidebar)] border border-[var(--color-border)] rounded-lg shadow-lg z-50 py-1"
              >
                {candidates.map((c, i) => (
                  <button
                    key={c.path}
                    type="button"
                    role="option"
                    aria-selected={i === highlightIndex}
                    className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 ${
                      i === highlightIndex
                        ? "bg-[var(--mm-bg-active)] text-[var(--mm-text-on-active)]"
                        : "text-[var(--mm-text-primary)] hover:bg-[var(--mm-bg-hover)]"
                    }`}
                    onClick={() => {
                      const newText = selectCandidate(c);
                      setInputValue(newText);
                      requestAnimationFrame(() => {
                        if (textareaRef.current) {
                          const pos = newText.length;
                          textareaRef.current.setSelectionRange(pos, pos);
                          setCursorPos(pos);
                        }
                      });
                      closeMentions();
                    }}
                    onMouseEnter={() => setHighlightIndex(i)}
                  >
                    <svg className="w-3.5 h-3.5 flex-shrink-0 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <span className="truncate font-mono text-xs">{c.path}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!canSend}
            className={`flex h-9 w-9 flex-shrink-0 items-center justify-center self-end rounded-lg transition-all ${
              isProcessing
                ? "border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] text-[var(--mm-text-primary)] hover:bg-[var(--mm-bg-hover)] disabled:cursor-not-allowed disabled:border-[var(--mm-border-subtle)] disabled:text-[var(--mm-text-tertiary)]"
                : "bg-[var(--mm-bg-active)] text-[var(--mm-text-on-active)] hover:opacity-90 disabled:cursor-not-allowed disabled:bg-[var(--mm-bg-selected)] disabled:text-[var(--mm-text-tertiary)]"
            }`}
            aria-label={isProcessing ? "发送追加指令" : t("chatInput.send")}
            title={isProcessing ? "发送追加指令" : t("chatInput.send")}
          >
            {isProcessing ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 12h14m0 0-5-5m5 5-5 5" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            )}
          </button>
        </div>

        {attachmentError && (
          <div className="px-4 pb-2">
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
              {attachmentError}
            </div>
          </div>
        )}
        {sendError && (
          <div className="px-4 pb-2">
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
              {sendError}
            </div>
          </div>
        )}

        {/* 控制栏 */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-[11px] pt-0">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <Popover
              align="start"
              contentClassName="w-[222px] rounded-[13px] border-[#e8e8e4] bg-white p-[7px] shadow-[0_18px_38px_rgba(20,20,18,0.12),0_2px_8px_rgba(20,20,18,0.05)]"
              trigger={
                <button
                  type="button"
                  className="flex h-[30px] w-[30px] items-center justify-center rounded-[10px] border border-[#e8e8e4] bg-[#f7f7f4] text-xl leading-none text-[#777771] transition-colors hover:bg-[#f2f2ef] focus-visible:!outline-none focus-visible:!shadow-none"
                  aria-label="添加附件和工具"
                  data-testid="chat-input-plus-trigger"
                >
                  +
                </button>
              }
            >
              {(close) => (
                <div className="space-y-0.5">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      close();
                      void handlePickFiles();
                    }}
                    disabled={!workspaceId}
                    className="flex min-h-8 w-full items-center justify-between gap-3 rounded-[9px] px-2 text-left text-sm text-[#1f1f1d] hover:bg-[#f6f6f3] disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label="添加文件或图片"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <svg className="h-3.5 w-3.5 shrink-0 text-[#70706a]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="m21 12-8.5 8.5a5 5 0 0 1-7-7L14 5a3 3 0 1 1 4 4L8.5 18.5a1.5 1.5 0 1 1-2-2L15 8" />
                      </svg>
                      添加文件或图片
                    </span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="flex min-h-8 w-full items-center justify-between gap-3 rounded-[9px] px-2 text-left text-sm text-[#1f1f1d] hover:bg-[#f6f6f3]"
                    aria-label="技能"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <svg className="h-3.5 w-3.5 shrink-0 text-[#70706a]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M6 3h9l3 3v15H6zM14 3v5h5M9 13h6M9 17h4" />
                      </svg>
                      技能
                    </span>
                    <span className="text-[#aaa]" aria-hidden>›</span>
                  </button>
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={planStore.enabled}
                    onClick={() => {
                      handlePlanToggle();
                      close();
                    }}
                    className="flex min-h-8 w-full items-center justify-between gap-3 rounded-[9px] px-2 text-left text-sm text-[#1f1f1d] hover:bg-[#f6f6f3]"
                    aria-label="计划模式"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <svg className="h-3.5 w-3.5 shrink-0 text-[#70706a]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
                      </svg>
                      计划模式
                    </span>
                    <ToggleSwitch checked={planStore.enabled} />
                  </button>
                </div>
              )}
            </Popover>

            <Popover
              align="start"
              contentClassName="min-w-[220px]"
              trigger={
                <div
                  className="flex h-[30px] max-w-[210px] cursor-pointer items-center gap-1.5 rounded-[10px] border border-transparent px-2 text-xs text-[#62625c] transition-all hover:border-[#e8e8e4] hover:bg-[#f7f7f4] focus-visible:!outline-none focus-visible:!shadow-none"
                  role="button"
                  tabIndex={0}
                  aria-label={currentWorkspace ? `当前工作目录: ${currentWorkspace.name}` : "选择工作目录"}
                  data-testid="chat-input-workspace-trigger"
                >
                  <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
                  </svg>
                  <span className="truncate">{currentWorkspace?.name ?? "选择工作目录"}</span>
                  <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              }
            >
              {(close) => (
                <div className="py-1">
                  {recentWorkspaces.length > 0 && (
                    <>
                      <div className="px-3 py-1.5 text-[10px] text-[var(--mm-text-tertiary)]">最近</div>
                      {recentWorkspaces.map((ws) => (
                        <button
                          key={ws.id}
                          type="button"
                          role="menuitemradio"
                          aria-checked={ws.id === currentWorkspace?.id}
                          onClick={() => {
                            void handleSwitchWorkspace(ws.id);
                            close();
                          }}
                          className="flex h-8 w-full items-center gap-2 px-3 text-left text-sm text-[var(--mm-text-primary)] hover:bg-[var(--mm-bg-hover)]"
                          title={ws.path}
                        >
                          <svg className="h-3.5 w-3.5 shrink-0 text-[var(--mm-text-tertiary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
                          </svg>
                          <span className="min-w-0 flex-1 truncate">{ws.name}</span>
                          {ws.id === currentWorkspace?.id && (
                            <svg className="h-3.5 w-3.5 shrink-0 text-[var(--mm-text-primary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                      ))}
                      <div className="my-1 border-t border-[var(--mm-border-subtle)]" />
                    </>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      void handleSelectNewWorkspace();
                      close();
                    }}
                    className="flex h-8 w-full items-center gap-2 px-3 text-left text-sm text-[var(--mm-text-primary)] hover:bg-[var(--mm-bg-hover)]"
                  >
                    <svg className="h-3.5 w-3.5 shrink-0 text-[var(--mm-text-tertiary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M12 5v14m-7-7h14" />
                    </svg>
                    <span className="truncate">选择新项目</span>
                  </button>
                </div>
              )}
            </Popover>

            {/* 权限下拉 */}
            <Popover
              align="start"
              contentClassName="min-w-[158px]"
              trigger={
                <div
                  className="flex h-[30px] cursor-pointer items-center gap-1.5 rounded-[10px] border border-transparent px-2 text-xs text-[#62625c] transition-all hover:border-[#e8e8e4] hover:bg-[#f7f7f4] focus-visible:!outline-none focus-visible:!shadow-none"
                  role="button"
                  tabIndex={0}
                  aria-label={`权限: ${currentPermissionLabel}`}
                  data-testid="chat-input-permission-trigger"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <span>{currentPermissionLabel}</span>
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              }
            >
              {(close) => (
                <div className="py-1">
                  {PERMISSION_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      role="menuitemradio"
                      aria-checked={currentPermission === opt.value}
                      onClick={() => {
                        handlePermissionSelect(opt.value);
                        close();
                      }}
                      className="flex h-8 w-full items-center gap-2 px-3 text-left text-sm text-[var(--mm-text-primary)] hover:bg-[var(--mm-bg-hover)]"
                    >
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-[var(--mm-text-tertiary)]" aria-hidden>
                        <PermissionModeIcon mode={opt.value} />
                      </span>
                      <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                      {currentPermission === opt.value && (
                        <svg className="h-3.5 w-3.5 text-[var(--mm-text-primary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </Popover>

          </div>

          <div className="flex min-w-0 items-center gap-2">
            {/* 快捷键提示 */}
            <div className="hidden items-center gap-1.5 text-xs text-[var(--mm-text-tertiary)]" aria-hidden="true">
              <kbd className="px-1.5 py-0.5 bg-[var(--color-hover)] border border-[var(--color-border)] rounded text-[10px] font-mono text-[var(--mm-text-secondary)]">Enter</kbd>
              <span>{t("chatInput.shortcuts.send")}</span>
              <span className="mx-1 text-[var(--color-border)]">/</span>
              <kbd className="px-1.5 py-0.5 bg-[var(--color-hover)] border border-[var(--color-border)] rounded text-[10px] font-mono text-[var(--mm-text-secondary)]">Shift</kbd>
              <span>+</span>
              <kbd className="px-1.5 py-0.5 bg-[var(--color-hover)] border border-[var(--color-border)] rounded text-[10px] font-mono text-[var(--mm-text-secondary)]">Enter</kbd>
              <span>{t("chatInput.shortcuts.newline")}</span>
            </div>

            {/* 模型下拉 */}
            <Popover
              align="end"
              contentClassName="min-w-[220px]"
              trigger={
                <div
                  className="flex h-[30px] max-w-[180px] cursor-pointer items-center gap-1.5 rounded-[10px] border border-transparent px-2 text-xs text-[#62625c] transition-all hover:border-[#e8e8e4] hover:bg-[#f7f7f4] focus-visible:!outline-none focus-visible:!shadow-none"
                  role="button"
                  tabIndex={0}
                  aria-label={currentModel ? `当前模型: ${currentModel}` : "未选择模型"}
                  data-testid="chat-input-model-trigger"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  <span className="truncate">{currentModel || "未选择"}</span>
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              }
            >
              {(close) => (
                <div className="py-1">
                  <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-[var(--mm-text-tertiary)]">选择模型</div>
                  {piModels && piModels.length > 0 ? (
                    piModels.map((m) => (
                      <button
                        key={`${m.provider}:${m.id}`}
                        type="button"
                        role="menuitemradio"
                        aria-checked={settings.model === m.id}
                        onClick={() => {
                          handleModelSelect({ id: m.id, name: m.name, provider: m.provider });
                          close();
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-[var(--mm-bg-hover)] flex items-start gap-2"
                      >
                        <span
                          className={`mt-0.5 inline-block w-3 h-3 rounded-full border-2 flex-shrink-0 ${
                            settings.model === m.id ? "border-[var(--mm-bg-active)] bg-[var(--mm-bg-active)]" : "border-[var(--color-border)]"
                          }`}
                          aria-hidden
                        />
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm text-[var(--mm-text-primary)]">{m.name}</span>
                          <span className="block text-xs text-[var(--mm-text-tertiary)]">{m.providerName}</span>
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className="px-3 py-3 text-xs text-[var(--mm-text-tertiary)]">
                      暂无可用模型 (Pi CLI 未配置)
                    </div>
                  )}
                </div>
              )}
            </Popover>
          </div>
        </div>
      </div>
    </div>
  );
}

