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
import { PermissionRequestStack } from "./PermissionRequestStack";
import type { PermissionMode } from "@shared";

interface ChatInputProps {
  isConnected: boolean;
  isProcessing: boolean;
  onSend: (message: string) => Promise<void>;
  onStop: () => void;
  workspaceId?: string;
  workspacePath?: string;
  prefill?: string;
  prefillKey?: number;
  onPrefillConsumed?: () => void;
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

export function ChatInput({
  isConnected,
  isProcessing,
  onSend,
  onStop,
  workspaceId,
  workspacePath,
  prefill,
  prefillKey,
  onPrefillConsumed,
}: ChatInputProps): React.JSX.Element {
  const [inputValue, setInputValue] = useState("");
  const [cursorPos, setCursorPos] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { settings, updateSettings, piModels } = useSettingsStore();
  const permissionStore = usePermissionStore();
  const planStore = usePlanStore();
  const { add: addAttachment, remove: removeAttachment, list: listAttachments } = useAttachmentsStore();
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
      setInputValue(prefill);
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

  const handleSend = async (): Promise<void> => {
    if (!inputValue.trim() || isProcessing) return;
    await onSend(inputValue.trim());
    setInputValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
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
      window.alert("selectFiles 不可用 (preload 未注入)");
      return;
    }
    if (!workspaceId) {
      window.alert("请先选择 workspace");
      return;
    }
    const paths = await window.piAPI.selectFiles({ multiSelections: true });
    if (!Array.isArray(paths) || paths.length === 0) return;
    for (const p of paths) {
      addAttachment(workspaceId, {
        id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        kind: "file",
        name: basename(p),
        value: p,
      });
    }
  }, [workspaceId, addAttachment]);

  const currentPermission = normalizePermissionMode(settings.permissionLevel ?? permissionStore.mode);
  const currentModel = settings.model;
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

  const canSend = inputValue.trim().length > 0 && isConnected;
  const currentPermissionLabel = PERMISSION_OPTIONS.find((p) => p.value === currentPermission)?.label ?? "智能授权";

  return (
    <div className="bg-transparent px-8 pt-2 pb-2">
      <PermissionRequestStack />
      <div className="mx-auto max-w-[770px] overflow-hidden rounded-[18px] border border-[#e6e6e3] bg-white shadow-[0_18px_50px_rgba(0,0,0,0.08)]">
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
        <div className="relative flex gap-3 px-4 pt-4 pb-2">
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                setCursorPos(e.target.selectionStart);
              }}
              onPaste={handlePaste}
              onSelect={handleSelect}
              onKeyDown={handleKeyDown}
              placeholder={isConnected ? t("chatInput.placeholder.ready") : t("chatInput.placeholder.noConnection")}
              className="min-h-[52px] w-full resize-none border-0 bg-transparent px-0 py-0 text-sm leading-relaxed text-[#1f1f1f] placeholder:text-[#a1a1a1] focus:outline-none disabled:opacity-50"
              rows={1}
              disabled={isProcessing || !isConnected}
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
            onClick={isProcessing ? onStop : () => void handleSend()}
            disabled={!isProcessing && !canSend}
            className={`flex h-9 w-9 flex-shrink-0 items-center justify-center self-end rounded-xl transition-all ${
              isProcessing
                ? "bg-[#1f1f1f] text-white hover:bg-[#111]"
                : "bg-[#a8a8a8] text-white hover:bg-[#8f8f8f] disabled:cursor-not-allowed disabled:opacity-50"
            }`}
            aria-label={isProcessing ? t("chatView.stopGeneration") : t("chatInput.send")}
            title={isProcessing ? t("chatView.stopGeneration") : t("chatInput.send")}
          >
            {isProcessing ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            )}
          </button>
        </div>

        {/* 控制栏 */}
        <div className="flex items-center justify-between border-t border-[#f0f0ee] bg-[#fbfbfa] px-4 py-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handlePickFiles()}
              disabled={!workspaceId}
              className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs text-[#777] transition-all hover:bg-[#f0f0ef] disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={t("chatInput.addAttachment")}
              title={workspaceId ? t("chatInput.addAttachment") : "请先选择 workspace"}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              {t("chatInput.attachment")}
            </button>

            {/* 权限下拉 */}
            <Popover
              align="start"
              contentClassName="min-w-[158px]"
              trigger={
                <div
                  className="flex h-7 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs text-[#666] transition-all hover:bg-[#f0f0ef]"
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
                      className="flex h-8 w-full items-center gap-2 px-3 text-left text-sm text-[#333] hover:bg-[#f4f4f3]"
                    >
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-[#777]" aria-hidden>
                        <PermissionModeIcon mode={opt.value} />
                      </span>
                      <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                      {currentPermission === opt.value && (
                        <svg className="h-3.5 w-3.5 text-[#333]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </Popover>

            <button
              type="button"
              onClick={() => planStore.setEnabled(workspaceId, !planStore.enabled)}
              className={`flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs transition-all ${
                planStore.enabled
                  ? "bg-[#262626] text-white"
                  : "text-[#777] hover:bg-[#f0f0ef]"
              }`}
              aria-pressed={planStore.enabled}
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
              </svg>
              计划模式
            </button>
          </div>

          <div className="flex items-center gap-3">
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
                  className="flex h-7 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs text-[#666] transition-all hover:bg-[#f0f0ef]"
                  role="button"
                  tabIndex={0}
                  aria-label={currentModel ? `当前模型: ${currentModel}` : "未选择模型"}
                  data-testid="chat-input-model-trigger"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  <span>{currentModel || "未选择"}</span>
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
