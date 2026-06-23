// ChatInput — v1.1
// v1.0.13: 附件/权限/模型下拉真接通
// v1.1: @ 文件引用弹窗 + 图片粘贴 + 暗色主题 (所有颜色走 CSS 变量)

import React, { useState, useRef, useCallback, useEffect } from "react";
import { useSettingsStore } from "../../stores/settings-store";
import { useAttachmentsStore } from "../../stores/attachments-store";
import { useI18n } from "../../i18n";
import { Popover } from "../common/Popover";
import { useMentions } from "../../hooks/useMentions";
import { useSlashCommands } from "../../hooks/useSlashCommands";
import { useAgentModeStore } from "../../stores/agent-mode-store";
import { usePermissionStore } from "../../stores/permission-store";
import { useWorkspaceStore } from "../../stores/workspace-store";
import { logger } from "../../utils/logger";
import { PermissionRequestStack } from "./PermissionRequestStack";
import { isIpcError, type AgentMode, type PermissionMode } from "@shared";

interface ChatInputProps {
  isConnected: boolean;
  isProcessing: boolean;
  runContext?: "plan_execution" | null;
  onSend: (message: string) => Promise<void>;
  onStop: () => void;
  workspaceId?: string;
  workspacePath?: string;
  agentId?: string | null;
  prefill?: string;
  prefillKey?: number;
  onPrefillConsumed?: () => void;
  focusKey?: number;
  referenceFrame?: boolean;
}

const PERMISSION_OPTIONS: Array<{ value: PermissionMode; label: string; desc: string }> = [
  { value: "ask", label: "主动询问", desc: "写入和命令默认询问" },
  { value: "smart", label: "智能授权", desc: "只读自动放行，写入询问" },
  { value: "always", label: "始终授权", desc: "尽量自动允许，保留审计" },
];

const AGENT_MODE_OPTIONS: Array<{ value: AgentMode; label: string; desc: string }> = [
  { value: "build", label: "Build", desc: "正常实现模式，可按权限读写和执行工具" },
  { value: "plan", label: "Plan", desc: "只制定计划，仅允许写入 .pi/plans/*.md" },
  { value: "compose", label: "Compose", desc: "按 MiMo 风格编排工作流和技能" },
  { value: "max", label: "Max", desc: "实验增强：多候选生成并由 judge 选优" },
];

const THINKING_OPTIONS = [
  { value: "none", label: "关闭" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
] as const;

type ThinkingLevel = typeof THINKING_OPTIONS[number]["value"];

const COMPOSER_MIN_HEIGHT = 95;
const COMPOSER_MAX_HEIGHT = 240;

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

function parseSlashCommandDraft(value: string): { command: string; args: string } | null {
  const text = value.trimStart();
  if (!text.startsWith("/")) return null;
  const match = text.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  return {
    command: match[1],
    args: match[2]?.trim() ?? "",
  };
}

function dispatchSlashDesktopAction(action: string | undefined): void {
  switch (action) {
    case "open-settings":
      window.dispatchEvent(new CustomEvent("slash-command:open-settings-tab", { detail: { tab: "appearance" } }));
      return;
    case "open-models":
      window.dispatchEvent(new CustomEvent("slash-command:open-settings-tab", { detail: { tab: "model" } }));
      return;
    case "open-sessions":
      window.dispatchEvent(new CustomEvent("slash-command:open-sessions"));
      return;
    case "open-hotkeys":
      window.dispatchEvent(new CustomEvent("slash-command:open-hotkeys"));
      return;
    case "new-session":
      window.dispatchEvent(new CustomEvent("slash-command:new-task"));
      return;
    case "quit":
      void window.piAPI?.windowClose?.();
      return;
    default:
      return;
  }
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
  runContext = null,
  onSend,
  onStop,
  workspaceId,
  workspacePath,
  agentId,
  prefill,
  prefillKey,
  onPrefillConsumed,
  focusKey,
  referenceFrame = false,
}: ChatInputProps): React.JSX.Element {
  const [inputValue, setInputValue] = useState("");
  const [cursorPos, setCursorPos] = useState(0);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [composerHeight, setComposerHeight] = useState(COMPOSER_MIN_HEIGHT);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const slashListboxRef = useRef<HTMLDivElement>(null);
  const slashOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const sendingRef = useRef(false);
  const resizeStateRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const syncCursorPosition = useCallback((textarea: HTMLTextAreaElement) => {
    setCursorPos(textarea.selectionStart ?? textarea.value.length);
  }, []);
  const { settings, updateSettings, piModels } = useSettingsStore();
  const permissionStore = usePermissionStore();
  const longHorizon = settings.longHorizon;
  const longHorizonEnabled = longHorizon?.enabled ?? true;
  const defaultAgentMode = longHorizonEnabled ? (longHorizon?.defaultMode ?? "build") : "build";
  const maxModeVisible = longHorizonEnabled && (longHorizon?.maxMode.enabled ?? true);
  const agentModeOptions = longHorizonEnabled
    ? AGENT_MODE_OPTIONS.filter((mode) => mode.value !== "max" || maxModeVisible)
    : AGENT_MODE_OPTIONS.filter((mode) => mode.value === "build");
  const currentAgentMode = useAgentModeStore((state) => {
    const mode = state.getMode(workspaceId, defaultAgentMode);
    return agentModeOptions.some((option) => option.value === mode) ? mode : "build";
  });
  const setAgentMode = useAgentModeStore((state) => state.setMode);
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

  const {
    activeCommand,
    candidates: slashCandidates,
    highlightIndex: slashHighlightIndex,
    setHighlightIndex: setSlashHighlightIndex,
    selectCandidate: selectSlashCandidate,
    close: closeSlashCommands,
  } = useSlashCommands(inputValue, cursorPos, workspaceId, agentId, currentAgentMode);

  const attachments = workspaceId ? listAttachments(workspaceId) : [];

  useEffect(() => {
    if (!activeCommand || slashCandidates.length === 0) return;
    const option = slashOptionRefs.current[slashHighlightIndex];
    option?.scrollIntoView?.({ block: "nearest" });
  }, [activeCommand, slashCandidates.length, slashHighlightIndex]);

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

  useEffect(() => {
    const focusComposer = (): void => {
      requestAnimationFrame(() => textareaRef.current?.focus());
    };
    window.addEventListener("chat-input:focus", focusComposer);
    return () => window.removeEventListener("chat-input:focus", focusComposer);
  }, []);

  const handleSend = async (): Promise<void> => {
    if (sendingRef.current || !inputValue.trim() || !isConnected) return;
    const slashDraft = parseSlashCommandDraft(inputValue);
    if (slashDraft && attachments.length > 0) {
      setAttachmentError("Slash 命令不能和附件一起发送");
      return;
    }
    sendingRef.current = true;
    setIsSending(true);
    setSendError(null);
    if (slashDraft && window.piAPI?.runBuiltinSlashCommand) {
      try {
        const result = await window.piAPI.runBuiltinSlashCommand({
          workspaceId: workspaceId ?? "",
          ...(agentId ? { agentId } : {}),
          command: slashDraft.command,
          args: slashDraft.args,
        });
        if (isIpcError(result)) {
          setSendError(result.fallback);
          sendingRef.current = false;
          setIsSending(false);
          return;
        }
        if (result.handled) {
          dispatchSlashDesktopAction(result.action);
          if (result.tone === "error" && result.message) {
            setSendError(result.message);
          }
          if (!result.keepInput) {
            setInputValue("");
            setAttachmentError(null);
            if (textareaRef.current) textareaRef.current.style.height = "auto";
          }
          sendingRef.current = false;
          setIsSending(false);
          return;
        }
      } catch (err) {
        setSendError(`发送失败: ${errorMessage(err, "未知错误")}`);
        sendingRef.current = false;
        setIsSending(false);
        return;
      }
    }
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

    if (!activeMention && activeCommand && slashCandidates.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashHighlightIndex((i) => Math.min(i + 1, slashCandidates.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashHighlightIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const selected = slashCandidates[slashHighlightIndex];
        if (selected) {
          const newText = selectSlashCandidate(selected);
          setInputValue(newText);
          requestAnimationFrame(() => {
            if (textareaRef.current) {
              const pos = newText.length;
              textareaRef.current.setSelectionRange(pos, pos);
              setCursorPos(pos);
            }
          });
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeSlashCommands();
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
      syncCursorPosition(ta);
    }
  }, [syncCursorPosition]);

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
  const handleThinkingSelect = useCallback(
    (level: ThinkingLevel) => {
      updateSettings({ thinkingLevel: level });
      if (agentId && window.piAPI?.agentsSetThinking) {
        void window.piAPI.agentsSetThinking(agentId, level).catch(() => undefined);
      }
    },
    [agentId, updateSettings],
  );
  const handleAgentModeSelect = useCallback((mode: AgentMode) => {
    if (workspaceId) setAgentMode(workspaceId, mode);
  }, [setAgentMode, workspaceId]);

  const commitComposerHeight = useCallback((height: number) => {
    const next = Math.max(COMPOSER_MIN_HEIGHT, Math.min(COMPOSER_MAX_HEIGHT, Math.round(height)));
    setComposerHeight(next);
    document.documentElement.style.setProperty("--pi-global-composer-height", `${next + 8}px`);
    window.dispatchEvent(new CustomEvent("pi:composer-height-change", { detail: { height: next } }));
  }, []);

  const handleResizePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizeStateRef.current = {
      startY: event.clientY,
      startHeight: composerHeight,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [composerHeight]);

  useEffect(() => {
    if (!referenceFrame) return;
    commitComposerHeight(composerHeight);
  }, [commitComposerHeight, composerHeight, referenceFrame]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent): void => {
      const state = resizeStateRef.current;
      if (!state) return;
      commitComposerHeight(state.startHeight + (state.startY - event.clientY));
    };
    const handlePointerUp = (): void => {
      resizeStateRef.current = null;
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [commitComposerHeight]);
  const openSlashCommands = useCallback(() => {
    setInputValue((current) => {
      const next = current.trimStart().startsWith("/")
        ? current
        : current.length === 0
          ? "/"
          : `${current}${current.endsWith(" ") ? "" : " "}/`;
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(next.length, next.length);
        setCursorPos(next.length);
      });
      return next;
    });
  }, []);
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
  const currentModelLabel = [settings.provider, currentModel].filter(Boolean).join(" / ") || "未配置模型";
  const currentThinking = THINKING_OPTIONS.some((option) => option.value === settings.thinkingLevel)
    ? settings.thinkingLevel as ThinkingLevel
    : "medium";
  const currentThinkingLabel = THINKING_OPTIONS.find((option) => option.value === currentThinking)?.label ?? "中";
  const inputPlaceholder = !isConnected
    ? t("chatInput.placeholder.noConnection")
    : referenceFrame
      ? "输入消息，使用 / 调用命令、@ 引用文件..."
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
    <div className={`${referenceFrame ? "pointer-events-auto w-full px-2 pb-2" : "w-full px-3 pb-6"} bg-transparent pt-1`}>
      <PermissionRequestStack workspaceId={workspaceId} agentId={agentId} />
      <div
        data-testid="chat-input-shell"
        className={`${referenceFrame ? "mx-0 flex w-full max-w-none flex-col" : "mx-auto max-w-[770px]"} relative overflow-visible rounded-[7px] border border-[var(--mm-border)] bg-[var(--mm-bg-composer)] shadow-none transition-all focus-within:border-[var(--mm-border-strong)]`}
        style={referenceFrame ? { height: `${composerHeight}px` } : undefined}
      >
        {referenceFrame ? (
          <div
            role="separator"
            aria-label="调整输入框高度"
            aria-orientation="horizontal"
            tabIndex={0}
            onPointerDown={handleResizePointerDown}
            className="absolute left-2 right-2 top-0 z-10 flex h-2 cursor-ns-resize items-start justify-center"
          >
            <span className="mt-[2px] h-[2px] w-9 rounded-full bg-[var(--mm-border-strong)]" aria-hidden />
          </div>
        ) : null}
        {isProcessing && (
          <div className="absolute bottom-full left-0 right-0 z-20 mb-1 flex items-center justify-between gap-2 rounded-[7px] border border-[var(--mm-border)] bg-[var(--mm-bg-sidebar)] px-3 py-1.5 text-[11px] shadow-[0_8px_24px_rgba(15,23,42,0.12)]">
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
        <div
          className={`relative z-0 flex gap-2 px-3 ${referenceFrame ? "min-h-0 flex-1 pb-0 pt-3" : "pb-1.5 pt-3"}`}
          data-testid={referenceFrame ? "chat-input-reference-body" : undefined}
        >
          <div className="flex-1 relative">
            {!referenceFrame && currentAgentMode !== "build" && (
              <div className="mb-2 flex">
                <span
                  className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[var(--mm-border)] bg-[var(--mm-bg-hover)] px-2.5 text-xs font-semibold text-[var(--color-success)]"
                  aria-label={`${currentAgentMode} 模式已启用`}
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
                  </svg>
                  {agentModeOptions.find((mode) => mode.value === currentAgentMode)?.label ?? currentAgentMode}
                </span>
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                syncCursorPosition(e.currentTarget);
                if (attachmentError) setAttachmentError(null);
                if (sendError) setSendError(null);
              }}
              onPaste={handlePaste}
              onSelect={handleSelect}
              onClick={handleSelect}
              onKeyUp={handleSelect}
              onKeyDown={handleKeyDown}
              placeholder={inputPlaceholder}
              className="min-h-[38px] w-full resize-none border-0 bg-transparent px-0 py-0 text-sm leading-5 text-[var(--mm-text-primary)] placeholder:text-[var(--mm-text-tertiary)] focus:outline-none focus-visible:!outline-none focus-visible:!shadow-none disabled:opacity-50"
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
            {!activeMention && activeCommand && slashCandidates.length > 0 && (
              <div
                ref={slashListboxRef}
                role="listbox"
                aria-label="Pi 命令候选"
                className="absolute left-0 bottom-full z-50 mb-1 max-h-64 w-[min(520px,calc(100vw-48px))] overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--mm-bg-sidebar)] py-1 shadow-lg"
              >
                {slashCandidates.map((candidate, i) => (
                  <button
                    key={`${candidate.command.source}:${candidate.command.name}`}
                    ref={(node) => {
                      slashOptionRefs.current[i] = node;
                    }}
                    type="button"
                    role="option"
                    aria-selected={i === slashHighlightIndex}
                    title={`/${candidate.command.name} ${candidate.command.description ?? candidate.command.source}`}
                    className={`flex h-9 w-full items-center gap-2 overflow-hidden px-3 text-left text-sm ${
                      i === slashHighlightIndex
                        ? "bg-[var(--mm-bg-active)] text-[var(--mm-text-on-active)]"
                        : "text-[var(--mm-text-primary)] hover:bg-[var(--mm-bg-hover)]"
                    }`}
                    onClick={() => {
                      const newText = selectSlashCandidate(candidate);
                      setInputValue(newText);
                      requestAnimationFrame(() => {
                        if (textareaRef.current) {
                          const pos = newText.length;
                          textareaRef.current.setSelectionRange(pos, pos);
                          setCursorPos(pos);
                        }
                      });
                    }}
                    onMouseEnter={() => setSlashHighlightIndex(i)}
                  >
                    <span className="max-w-[13rem] shrink-0 truncate font-mono text-xs opacity-90">/{candidate.command.name}</span>
                    <span className="min-w-0 flex-1 truncate text-xs opacity-80">
                      {candidate.command.description ?? candidate.command.source}
                    </span>
                    <span className="shrink-0 rounded border border-current/15 px-1.5 py-0.5 text-[10px] leading-none opacity-60">
                      {candidate.command.source}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!canSend}
            className={`${referenceFrame ? "hidden" : "flex"} h-7 w-8 flex-shrink-0 items-center justify-center self-end rounded-[5px] transition-all ${
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
        {referenceFrame ? (
          <div className="relative z-20 flex h-[34px] shrink-0 items-center justify-between px-3 pb-2 pt-0" data-testid="chat-input-reference-controls">
            <div className="flex items-center gap-3 text-[var(--mm-text-secondary)]">
              <button type="button" onClick={() => void handlePickFiles()} className="flex h-6 w-6 items-center justify-center rounded-[3px] hover:bg-[var(--mm-bg-hover)]" aria-label="添加文件或图片">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="m21 12-8.5 8.5a5 5 0 0 1-7-7L14 5a3 3 0 1 1 4 4L8.5 18.5a1.5 1.5 0 1 1-2-2L15 8" />
                </svg>
              </button>
              <button type="button" onClick={openSlashCommands} className="flex h-6 w-6 items-center justify-center rounded-[3px] hover:bg-[var(--mm-bg-hover)]" aria-label="打开 Slash 命令">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="m8 9-4 3 4 3m8-6 4 3-4 3M14 5l-4 14" />
                </svg>
              </button>
              <Popover
                align="start"
                contentClassName="w-[246px] rounded-[10px] border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-1.5 shadow-[0_16px_38px_rgba(20,31,50,0.14)]"
                trigger={
                  <button type="button" className="flex h-6 items-center gap-1 rounded-[4px] px-1.5 text-[11px] hover:bg-[var(--mm-bg-hover)]" aria-label="选择 Agent 模式">
                    <span className="font-medium text-[var(--mm-text-primary)]">
                      {agentModeOptions.find((mode) => mode.value === currentAgentMode)?.label ?? "Build"}
                    </span>
                    <svg className="h-3 w-3 text-[var(--mm-text-tertiary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m6 9 6 6 6-6" />
                    </svg>
                  </button>
                }
              >
                {(close) => (
                  <div role="menu" aria-label="Agent 模式">
                    {agentModeOptions.map((mode) => (
                      <button
                        key={mode.value}
                        type="button"
                        role="menuitemradio"
                        aria-checked={currentAgentMode === mode.value}
                        onClick={() => {
                          handleAgentModeSelect(mode.value);
                          close();
                        }}
                        className={`flex w-full items-start gap-2 rounded-[7px] px-2 py-2 text-left hover:bg-[var(--mm-bg-hover)] ${
                          currentAgentMode === mode.value ? "bg-[var(--mm-bg-selected)]" : ""
                        }`}
                      >
                        <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${currentAgentMode === mode.value ? "bg-[var(--mm-accent-blue)]" : "bg-[var(--mm-text-tertiary)]"}`} aria-hidden />
                        <span className="min-w-0">
                          <span className="block text-[12px] font-medium text-[var(--mm-text-primary)]">{mode.label}</span>
                          <span className="block text-[10px] leading-4 text-[var(--mm-text-secondary)]">{mode.desc}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </Popover>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex h-7 overflow-hidden rounded-[5px] border border-[var(--mm-border)] bg-[var(--mm-bg-control)]">
              <Popover
                align="end"
                contentClassName="min-w-[240px]"
                trigger={
                  <button
                    type="button"
                    className="flex h-7 w-[150px] items-center gap-1.5 px-2 text-left text-[10px] text-[var(--mm-text-secondary)] transition-colors hover:bg-[var(--mm-bg-hover)] focus-visible:!outline-none focus-visible:!shadow-none"
                    aria-label={`当前模型: ${currentModelLabel}`}
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--mm-accent-blue)]" aria-hidden />
                    <span className="truncate">{currentModelLabel}</span>
                  </button>
                }
              >
                {(close) => (
                  <div className="py-1">
                    <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-[var(--mm-text-tertiary)]">选择模型</div>
                    {piModels && piModels.length > 0 ? (
                      piModels.map((m) => {
                        const isSelected = settings.provider === m.provider && settings.model === m.id;
                        return (
                          <button
                            key={`${m.provider}:${m.id}`}
                            type="button"
                            role="menuitemradio"
                            aria-checked={isSelected}
                            aria-label={m.name}
                            onClick={() => {
                              handleModelSelect({ id: m.id, name: m.name, provider: m.provider });
                              close();
                            }}
                            className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-[var(--mm-bg-hover)]"
                          >
                            <span
                              className={`mt-0.5 inline-block h-3 w-3 flex-shrink-0 rounded-full border-2 ${
                                isSelected ? "border-[var(--mm-bg-active)] bg-[var(--mm-bg-active)]" : "border-[var(--color-border)]"
                              }`}
                              aria-hidden
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm text-[var(--mm-text-primary)]">{m.name}</span>
                              <span className="block text-xs text-[var(--mm-text-tertiary)]">{m.providerName}</span>
                            </span>
                          </button>
                        );
                      })
                    ) : (
                      <div className="px-3 py-3 text-xs text-[var(--mm-text-tertiary)]">
                        暂无可用模型 (Pi CLI 未配置)
                      </div>
                    )}
                  </div>
                )}
              </Popover>
              <Popover
                align="end"
                contentClassName="w-[180px] rounded-[10px] border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-1.5 shadow-[0_16px_38px_rgba(20,31,50,0.14)]"
                trigger={
                  <button
                    type="button"
                    className="flex h-7 items-center gap-1 border-l border-[var(--mm-border)] px-2 text-[10px] text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-hover)] focus-visible:!outline-none focus-visible:!shadow-none"
                    aria-label={`思考强度: ${currentThinkingLabel}`}
                  >
                    <span className="font-medium text-[var(--mm-text-primary)]">{currentThinkingLabel}</span>
                    <svg className="h-3 w-3 text-[var(--mm-text-tertiary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m6 9 6 6 6-6" />
                    </svg>
                  </button>
                }
              >
                {(close) => (
                  <div role="menu" aria-label="思考强度">
                    <div className="px-2 py-1 text-[10px] text-[var(--mm-text-tertiary)]">推理</div>
                    {THINKING_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        role="menuitemradio"
                        aria-checked={currentThinking === option.value}
                        onClick={() => {
                          handleThinkingSelect(option.value);
                          close();
                        }}
                        className={`flex h-8 w-full items-center justify-between rounded-[7px] px-2 text-left text-[12px] hover:bg-[var(--mm-bg-hover)] ${
                          currentThinking === option.value ? "bg-[var(--mm-bg-selected)] text-[var(--mm-text-primary)]" : "text-[var(--mm-text-secondary)]"
                        }`}
                      >
                        <span>{option.label}</span>
                        {currentThinking === option.value && (
                          <svg className="h-3.5 w-3.5 text-[var(--mm-accent-blue)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </Popover>
              </div>
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={!canSend}
                className="flex h-[32px] w-[51px] items-center justify-center rounded-[5px] bg-[var(--mm-accent-blue)] text-white shadow-[0_1px_2px_rgba(10,35,80,0.14)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-35"
                aria-label={t("chatInput.send")}
              >
                <svg className="h-5 w-5 -rotate-12" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3 11.7 21 3.8 13.1 21l-2.3-7.1L3 11.7Zm8.7 1.1 1.2 3.7 4-8.7-8.6 3.8 3.4 1.2Z" />
                </svg>
              </button>
            </div>
          </div>
        ) : (
        <div className="flex flex-wrap items-center justify-between gap-1.5 px-2 pb-2 pt-0">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <Popover
              align="start"
              contentClassName="w-[222px] rounded-[13px] border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-[7px] shadow-[0_18px_38px_rgba(20,20,18,0.12),0_2px_8px_rgba(20,20,18,0.05)]"
              trigger={
                <button
                  type="button"
                  className="flex h-[22px] w-[22px] items-center justify-center rounded-[4px] border border-[var(--mm-border)] bg-[var(--mm-bg-sidebar)] text-base leading-none text-[var(--mm-text-secondary)] transition-colors hover:bg-[var(--mm-bg-hover)] focus-visible:!outline-none focus-visible:!shadow-none"
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
                    className="flex min-h-8 w-full items-center justify-between gap-3 rounded-[9px] px-2 text-left text-sm text-[var(--mm-text-primary)] hover:bg-[var(--mm-bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label="添加文件或图片"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <svg className="h-3.5 w-3.5 shrink-0 text-[var(--mm-text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="m21 12-8.5 8.5a5 5 0 0 1-7-7L14 5a3 3 0 1 1 4 4L8.5 18.5a1.5 1.5 0 1 1-2-2L15 8" />
                      </svg>
                      添加文件或图片
                    </span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      close();
                      window.dispatchEvent(new CustomEvent("app:switch-section", { detail: { section: "skills" } }));
                    }}
                    className="flex min-h-8 w-full items-center justify-between gap-3 rounded-[9px] px-2 text-left text-sm text-[var(--mm-text-primary)] hover:bg-[var(--mm-bg-hover)]"
                    aria-label="打开技能面板"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <svg className="h-3.5 w-3.5 shrink-0 text-[var(--mm-text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M6 3h9l3 3v15H6zM14 3v5h5M9 13h6M9 17h4" />
                      </svg>
                      技能
                    </span>
                    <span className="text-[var(--mm-text-tertiary)]" aria-hidden>打开</span>
                  </button>
                </div>
              )}
            </Popover>

            <Popover
              align="start"
              contentClassName="min-w-[220px]"
              trigger={
                <div
                  className="flex h-[22px] max-w-[110px] cursor-pointer items-center gap-1 rounded-[4px] border border-transparent px-1.5 text-[10px] text-[var(--mm-text-secondary)] transition-all hover:border-[var(--mm-border)] hover:bg-[var(--mm-bg-sidebar)] focus-visible:!outline-none focus-visible:!shadow-none"
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
                      <div className="mx-3 my-1.5 h-px bg-[var(--mm-border)] opacity-70" aria-hidden="true" />
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
                  className="flex h-[22px] cursor-pointer items-center gap-1 rounded-[4px] border border-transparent px-1.5 text-[10px] text-[var(--mm-text-secondary)] transition-all hover:border-[var(--mm-border)] hover:bg-[var(--mm-bg-sidebar)] focus-visible:!outline-none focus-visible:!shadow-none"
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
                  className="flex h-[22px] max-w-[96px] cursor-pointer items-center gap-1 rounded-[4px] border border-transparent px-1.5 text-[10px] text-[var(--mm-text-secondary)] transition-all hover:border-[var(--mm-border)] hover:bg-[var(--mm-bg-sidebar)] focus-visible:!outline-none focus-visible:!shadow-none"
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
        )}
      </div>
    </div>
  );
}

