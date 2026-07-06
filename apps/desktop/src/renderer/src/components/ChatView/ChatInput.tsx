// ChatInput — v1.1
// v1.0.13: 附件/权限/模型下拉真接通
// v1.1: @ 文件引用弹窗 + 图片粘贴 + 暗色主题 (所有颜色走 CSS 变量)

import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useSettingsStore } from "../../stores/settings-store";
import { useAttachmentsStore } from "../../stores/attachments-store";
import { useI18n } from "../../i18n";
import { Popover } from "../common/Popover";
import { useMentions } from "../../hooks/useMentions";
import { useSlashCommands } from "../../hooks/useSlashCommands";
import { useAgentModeStore } from "../../stores/agent-mode-store";
import { usePermissionStore } from "../../stores/permission-store";
import { useRuntimeFeatureStore, clampAgentModeByRuntime, supportedAgentModes } from "../../stores/runtime-feature-store";
import { useWorkspaceStore } from "../../stores/workspace-store";
import { logger } from "../../utils/logger";
import { isIpcError, type AgentMode, type PermissionMode } from "@shared";
import { useInputText } from "./hooks/useInputText";
import { usePrefillConsumer } from "./hooks/usePrefillConsumer";
import { useInputShortcuts } from "./hooks/useInputShortcuts";

interface ChatInputProps {
  isConnected: boolean;
  isProcessing: boolean;
  runContext?: "plan_execution" | null;
  onSend: (message: string, options?: { visibleContent?: string }) => Promise<void>;
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

const PERMISSION_OPTIONS: Array<{ value: PermissionMode; labelKey: string; descKey: string }> = [
  { value: "ask", labelKey: "chatInput.permissions.ask.label", descKey: "chatInput.permissions.ask.desc" },
  { value: "smart", labelKey: "chatInput.permissions.smart.label", descKey: "chatInput.permissions.smart.desc" },
  { value: "always", labelKey: "chatInput.permissions.always.label", descKey: "chatInput.permissions.always.desc" },
];

const AGENT_MODE_OPTIONS: Array<{ value: AgentMode; labelKey: string; descKey: string }> = [
  { value: "build", labelKey: "chatInput.agentMode.build.label", descKey: "chatInput.agentMode.build.desc" },
  { value: "plan", labelKey: "chatInput.agentMode.plan.label", descKey: "chatInput.agentMode.plan.desc" },
  { value: "compose", labelKey: "chatInput.agentMode.compose.label", descKey: "chatInput.agentMode.compose.desc" },
];

const THINKING_OPTIONS = [
  { value: "none", labelKey: "chatInput.thinking.none" },
  { value: "low", labelKey: "chatInput.thinking.low" },
  { value: "medium", labelKey: "chatInput.thinking.medium" },
  { value: "high", labelKey: "chatInput.thinking.high" },
] as const;

type ThinkingLevel = typeof THINKING_OPTIONS[number]["value"];

const COMPOSER_MIN_HEIGHT = 95;
const COMPOSER_MAX_HEIGHT = 240;

/** 单张粘贴图片的大小上限 (5MB). 超过拒绝, 避免 dataUrl 膨胀 + vision API 超载. */
const MAX_PASTE_BYTES = 5 * 1024 * 1024;

function normalizePermissionMode(value: unknown): PermissionMode {
  if (value === "ask" || value === "read") return "ask";
  if (value === "always" || value === "full") return "always";
  return "smart";
}

function basename(p: string): string {
  const m = p.match(/[^\\/]+$/);
  return m ? m[0] : p;
}

function buildVisibleAttachmentSummary(inputValue: string, attachments: Array<{ kind: "file" | "image"; name: string; value: string }>): string {
  const trimmedInput = inputValue.trim();
  const lines: string[] = [];
  const fileNames = attachments
    .filter((attachment) => attachment.kind === "file")
    .map((attachment) => basename(attachment.value))
    .filter(Boolean);
  const imageNames = attachments
    .filter((attachment) => attachment.kind === "image")
    .map((attachment) => attachment.name.trim())
    .filter(Boolean);

  if (trimmedInput) lines.push(trimmedInput);
  if (fileNames.length > 0) {
    lines.push(`附件: ${fileNames.join(", ")}`);
  }
  if (imageNames.length > 0) {
    lines.push(`图片: ${imageNames.join(", ")}`);
  }

  return lines.join("\n").trim();
}

function errorMessage(value: unknown, fallback: string): string {
  if (isIpcError(value)) return value.fallback;
  if (value instanceof Error) return value.message;
  if (typeof value === "string" && value.trim()) return value;
  return fallback;
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
  const { textareaRef, inputValue, setInputValue } = useInputText();
  const shellRef = useRef<HTMLDivElement>(null);
  const [cursorPos, setCursorPos] = useState(0);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [composerHeight, setComposerHeight] = useState(COMPOSER_MIN_HEIGHT);
  const slashListboxRef = useRef<HTMLDivElement>(null);
  const slashOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const sendingRef = useRef(false);
  const resizeStateRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const syncCursorPosition = useCallback((textarea: HTMLTextAreaElement) => {
    setCursorPos(textarea.selectionStart ?? textarea.value.length);
  }, []);
  const { settings, updateSettings, piModels } = useSettingsStore();
  const permissionStore = usePermissionStore();
  const runtimeFeatureState = useRuntimeFeatureStore((state) => state.featureState);
  const refreshRuntimeFeatureState = useRuntimeFeatureStore((state) => state.refresh);
  const { t } = useI18n();
  const permissionOptions = useMemo(
    () => PERMISSION_OPTIONS.map((option) => ({
      ...option,
      label: t(option.labelKey),
      desc: t(option.descKey),
    })),
    [t],
  );
  const translatedAgentModeOptions = useMemo(
    () => AGENT_MODE_OPTIONS.map((option) => ({
      ...option,
      label: t(option.labelKey),
      desc: t(option.descKey),
    })),
    [t],
  );
  const thinkingOptions = useMemo(
    () => THINKING_OPTIONS.map((option) => ({
      ...option,
      label: t(option.labelKey),
    })),
    [t],
  );
  const longHorizon = settings.longHorizon;
  const longHorizonEnabled = longHorizon?.enabled ?? true;
  const allowedModes = supportedAgentModes(runtimeFeatureState, longHorizon);
  const defaultAgentMode = clampAgentModeByRuntime(
    longHorizonEnabled ? (longHorizon?.defaultMode ?? "build") : "build",
    runtimeFeatureState,
    longHorizon,
  );
  const agentModeOptions = translatedAgentModeOptions.filter((mode) => allowedModes.includes(mode.value));
  const currentAgentMode = useAgentModeStore((state) => {
    const mode = state.getMode(workspaceId, defaultAgentMode);
    return agentModeOptions.some((option) => option.value === mode) ? mode : "build";
  });
  const setAgentMode = useAgentModeStore((state) => state.setMode);
  const { workspaces, getCurrentWorkspace, setCurrentWorkspace, addWorkspace, createWorkspace } = useWorkspaceStore();
  const { add: addAttachment, remove: removeAttachment, clear: clearAttachments, list: listAttachments } = useAttachmentsStore();

  const mention = useMentions(inputValue, cursorPos, workspacePath);
  const {
    activeMention,
    candidates,
    highlightIndex,
    setHighlightIndex,
    selectCandidate,
    close: closeMentions,
  } = mention;

  const slash = useSlashCommands(inputValue, cursorPos, workspaceId, agentId, currentAgentMode);
  const {
    activeCommand,
    candidates: slashCandidates,
    highlightIndex: slashHighlightIndex,
    setHighlightIndex: setSlashHighlightIndex,
    selectCandidate: selectSlashCandidate,
  } = slash;

  const attachments = workspaceId ? listAttachments(workspaceId) : [];

  useEffect(() => {
    if (!runtimeFeatureState) {
      void refreshRuntimeFeatureState();
    }
  }, [refreshRuntimeFeatureState, runtimeFeatureState]);

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
          // 排除 SVG: dataUrl 内联 SVG 在 vision pipeline 中不可控, 暂不支持
          if (file.type === "image/svg+xml") {
            setAttachmentError(t("chatInput.errors.svgNotSupported"));
            continue;
          }
          // 大小上限: 5MB, 超限拒绝避免 dataUrl 膨胀 + vision API 超载
          if (file.size > MAX_PASTE_BYTES) {
            setAttachmentError(t("chatInput.errors.imageTooLarge"));
            continue;
          }
          setAttachmentError(null);
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
    [workspaceId, addAttachment, t],
  );

  usePrefillConsumer(prefill, prefillKey, onPrefillConsumed, textareaRef, setInputValue);

  useEffect(() => {
    if (focusKey === undefined) return;
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [focusKey, textareaRef]);

  useEffect(() => {
    const focusComposer = (): void => {
      requestAnimationFrame(() => textareaRef.current?.focus());
    };
    window.addEventListener("chat-input:focus", focusComposer);
    return () => window.removeEventListener("chat-input:focus", focusComposer);
  }, [textareaRef]);

  const handleSend = async (): Promise<void> => {
    if (sendingRef.current || !inputValue.trim() || !isConnected) return;
    const slashDraft = parseSlashCommandDraft(inputValue);
    if (slashDraft && attachments.length > 0) {
      setAttachmentError(t("chatInput.errors.slashWithAttachment"));
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
        setSendError(t("chatInput.errors.sendFailed", { message: errorMessage(err, t("chatInput.errors.unknown")) }));
        sendingRef.current = false;
        setIsSending(false);
        return;
      }
    }
    const imageAttachments = attachments.filter((attachment) => attachment.kind === "image");
    let imagePrefix = "";
    if (imageAttachments.length > 0) {
      if (!settings.visionProvider || !settings.visionModel) {
        setAttachmentError(t("chatInput.errors.visionNotConfigured"));
        sendingRef.current = false;
        setIsSending(false);
        return;
      }
      if (!window.piAPI?.describeImages) {
        setAttachmentError(t("chatInput.errors.visionUnavailable"));
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
        setAttachmentError(t("chatInput.errors.visionFailed", { message: errorMessage(err, t("chatInput.errors.unknown")) }));
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
    const visibleContent = prefixes.length > 0
      ? buildVisibleAttachmentSummary(inputValue, attachments)
      : undefined;
    const draftSnapshot = inputValue;
    const attachmentSnapshot = attachments.map((attachment) => ({ ...attachment }));
    setInputValue("");
    setAttachmentError(null);
    if (workspaceId) clearAttachments(workspaceId);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    try {
      if (visibleContent) {
        await onSend(outbound, { visibleContent });
      } else {
        await onSend(outbound);
      }
    } catch (err) {
      setSendError(t("chatInput.errors.sendFailed", { message: errorMessage(err, t("chatInput.errors.unknown")) }));
      setInputValue(draftSnapshot);
      if (workspaceId) {
        clearAttachments(workspaceId);
        for (const attachment of attachmentSnapshot) {
          addAttachment(workspaceId, attachment);
        }
      }
      requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        textarea.focus();
        const nextPos = draftSnapshot.length;
        textarea.setSelectionRange(nextPos, nextPos);
        syncCursorPosition(textarea);
      });
      sendingRef.current = false;
      setIsSending(false);
      return;
    }
    sendingRef.current = false;
    setIsSending(false);
  };

  const handleKeyDown = useInputShortcuts({
    mention,
    slash,
    setInputValue,
    textareaRef,
    setCursorPos,
    submit: handleSend,
  });

  const handleSelect = useCallback((): void => {
    const ta = textareaRef.current;
    if (ta) {
      syncCursorPosition(ta);
    }
  }, [syncCursorPosition, textareaRef]);

  const handlePickFiles = useCallback(async (): Promise<void> => {
    if (!window.piAPI?.selectFiles) {
      setAttachmentError(t("chatInput.errors.filePickerUnavailable"));
      return;
    }
    if (!workspaceId) {
      setAttachmentError(t("chatInput.errors.workspaceRequired"));
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
      setAttachmentError(t("chatInput.errors.filePickerFailed", { message: errorMessage(err, t("chatInput.errors.unknown")) }));
    }
  }, [workspaceId, addAttachment, t]);

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
  }, [setInputValue, textareaRef]);
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
        setAttachmentError(t("chatInput.errors.switchWorkspaceFailed", { message: errorMessage(e, t("chatInput.errors.unknown")) }));
      }
    },
    [setCurrentWorkspace, t, workspaces],
  );
  const handleSelectNewWorkspace = useCallback(async (): Promise<void> => {
    if (!window.piAPI?.selectDirectory) {
      setAttachmentError(t("chatInput.errors.directoryPickerUnavailable"));
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
        setAttachmentError(useWorkspaceStore.getState().lastError ?? t("chatInput.errors.createWorkspaceFailed", { message: t("chatInput.errors.unknown") }));
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
      setAttachmentError(t("chatInput.errors.createWorkspaceFailed", { message: errorMessage(e, t("chatInput.errors.unknown")) }));
    }
  }, [addWorkspace, createWorkspace, handleSwitchWorkspace, setCurrentWorkspace, t, workspaces]);

  const canSend = inputValue.trim().length > 0 && isConnected && !isSending;
  const currentPermissionLabel = permissionOptions.find((p) => p.value === currentPermission)?.label ?? t("chatInput.permissions.smart.label");
  const currentModelLabel = [settings.provider, currentModel].filter(Boolean).join(" / ") || t("chatInput.model.notConfigured");
  const currentThinking = thinkingOptions.some((option) => option.value === settings.thinkingLevel)
    ? settings.thinkingLevel as ThinkingLevel
    : "medium";
  const currentThinkingLabel = thinkingOptions.find((option) => option.value === currentThinking)?.label ?? t("chatInput.thinking.medium");
  const inputPlaceholder = !isConnected
    ? t("chatInput.placeholder.noConnection")
    : referenceFrame
      ? t("chatInput.placeholder.reference")
    : isProcessing
      ? runContext === "plan_execution"
        ? t("chatInput.placeholder.planRunning")
        : t("chatInput.placeholder.taskRunning")
      : t("chatInput.placeholder.ready");
  const runningLabel = runContext === "plan_execution"
    ? t("chatInput.running.plan")
    : t("chatInput.running.task");
  const stopLabel = runContext === "plan_execution" ? t("chatInput.pauseExecution") : t("chatInput.stop");
  const stopAriaLabel = runContext === "plan_execution" ? t("chatInput.pauseExecution") : t("chatView.stopGeneration");
  const showStopAction = isProcessing;
  const primaryActionDisabled = showStopAction ? false : !canSend;
  const primaryActionLabel = showStopAction ? stopLabel : t("chatInput.send");
  const primaryActionAriaLabel = showStopAction ? stopAriaLabel : t("chatInput.send");
  const handlePrimaryAction = (): void => {
    if (showStopAction) {
      onStop();
      return;
    }
    void handleSend();
  };
  const permissionPopover = (
    <Popover
      align="start"
      contentClassName="min-w-[158px]"
      trigger={
        <button
          type="button"
          className={referenceFrame
            ? "flex h-6 items-center gap-1 rounded-[4px] px-1.5 text-[11px] text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-hover)]"
            : "flex h-[22px] items-center gap-1 rounded-[4px] border border-transparent px-1.5 text-[10px] text-[var(--mm-text-secondary)] transition-all hover:border-[var(--mm-border)] hover:bg-[var(--mm-bg-sidebar)] focus-visible:!outline-none focus-visible:!shadow-none"}
          aria-label={t("chatInput.permissionAria", { label: currentPermissionLabel })}
          data-testid="chat-input-permission-trigger"
        >
          <span className="flex h-4 w-4 shrink-0 items-center justify-center text-[var(--mm-text-tertiary)]" aria-hidden>
            <PermissionModeIcon mode={currentPermission} />
          </span>
          <span>{currentPermissionLabel}</span>
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      }
    >
      {(close) => (
        <div className="py-1">
          {permissionOptions.map((opt) => (
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
  );
  const syncGlobalComposerBounds = useCallback(() => {
    if (typeof document === "undefined") return;
    if (!referenceFrame || !shellRef.current) {
      document.documentElement.style.removeProperty("--pi-global-composer-left");
      document.documentElement.style.removeProperty("--pi-global-composer-right");
      return;
    }
    const rect = shellRef.current.getBoundingClientRect();
    document.documentElement.style.setProperty("--pi-global-composer-left", `${Math.round(rect.left)}px`);
    document.documentElement.style.setProperty(
      "--pi-global-composer-right",
      `${Math.max(0, Math.round(window.innerWidth - rect.right))}px`,
    );
  }, [referenceFrame]);

  useEffect(() => {
    syncGlobalComposerBounds();
    if (!referenceFrame || !shellRef.current) {
      return () => {
        document.documentElement.style.removeProperty("--pi-global-composer-left");
        document.documentElement.style.removeProperty("--pi-global-composer-right");
      };
    }
    const shell = shellRef.current;
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
        syncGlobalComposerBounds();
      });
    const handleWindowResize = (): void => {
      syncGlobalComposerBounds();
    };
    resizeObserver?.observe(shell);
    window.addEventListener("resize", handleWindowResize);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", handleWindowResize);
      document.documentElement.style.removeProperty("--pi-global-composer-left");
      document.documentElement.style.removeProperty("--pi-global-composer-right");
    };
  }, [referenceFrame, syncGlobalComposerBounds]);

  // TODO: extract sub-components (InputAttachments, InputMentionPopover, InputCommandPopover, InputToolbar)
  return (
    <div className={`${referenceFrame ? "pointer-events-auto w-full px-2 pb-2" : "w-full px-3 pb-6"} bg-transparent pt-1`}>
      <div
        ref={shellRef}
        data-testid="chat-input-shell"
        className={`${referenceFrame ? "mx-0 flex w-full max-w-none flex-col" : "mx-auto max-w-[770px]"} relative overflow-visible rounded-[7px] border border-[var(--mm-border)] bg-[var(--mm-bg-composer)] shadow-none transition-all focus-within:border-[var(--mm-border-strong)]`}
        style={referenceFrame ? { height: `${composerHeight}px` } : undefined}
      >
        {referenceFrame ? (
          <div
            role="separator"
            aria-label={t("chatInput.resizeComposer")}
            aria-orientation="horizontal"
            tabIndex={0}
            onPointerDown={handleResizePointerDown}
            className="absolute left-2 right-2 top-0 z-10 flex h-2 cursor-ns-resize items-start justify-center"
          >
            <span className="mt-[2px] h-[2px] w-9 rounded-full bg-[var(--mm-border-strong)]" aria-hidden />
          </div>
        ) : null}
        {isProcessing && (
          <div
            role="status"
            aria-label="任务运行中提醒"
            aria-live="polite"
            className="absolute bottom-full left-0 right-0 z-20 mb-1 flex items-center gap-2 rounded-[7px] border border-[var(--mm-border)] bg-[var(--mm-bg-sidebar)] px-3 py-1.5 text-[11px] shadow-[0_8px_24px_rgba(15,23,42,0.12)]"
          >
            <div className="flex min-w-0 items-center gap-2 text-[var(--mm-text-secondary)]">
              <span className="relative inline-flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
                <span className="absolute inset-0 rounded-full bg-[var(--mm-bg-active)] opacity-25 animate-ping" />
                <span className="relative h-2.5 w-2.5 rounded-full bg-[var(--mm-bg-active)]" />
              </span>
              <span className="truncate">{runningLabel}</span>
            </div>
          </div>
        )}
        {/* 附件 chips */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-4 pt-3" role="list" aria-label={t("chatInput.attachmentsSelected")}>
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
                  aria-label={t("chatInput.removeAttachment", { name: a.name })}
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
                  aria-label={t("chatInput.agentMode.enabled", { mode: currentAgentMode })}
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
                aria-label={t("chatInput.fileCandidates")}
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
                aria-label={t("chatInput.commandCandidates")}
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
            onClick={handlePrimaryAction}
            disabled={primaryActionDisabled}
            className={`${referenceFrame ? "hidden" : "flex"} h-7 w-8 flex-shrink-0 items-center justify-center self-end rounded-[5px] transition-all ${
              showStopAction
                ? "border border-[var(--mm-bg-active)] bg-[var(--mm-bg-active)] text-[var(--mm-text-on-active)] hover:opacity-90"
                : "bg-[var(--mm-bg-active)] text-[var(--mm-text-on-active)] hover:opacity-90 disabled:cursor-not-allowed disabled:bg-[var(--mm-bg-selected)] disabled:text-[var(--mm-text-tertiary)]"
            }`}
            aria-label={primaryActionAriaLabel}
            title={primaryActionLabel}
          >
            {showStopAction ? (
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" />
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
              <button type="button" onClick={() => void handlePickFiles()} className="flex h-6 w-6 items-center justify-center rounded-[3px] hover:bg-[var(--mm-bg-hover)]" aria-label={t("chatInput.addFileOrImage")}>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="m21 12-8.5 8.5a5 5 0 0 1-7-7L14 5a3 3 0 1 1 4 4L8.5 18.5a1.5 1.5 0 1 1-2-2L15 8" />
                </svg>
              </button>
              <button type="button" onClick={openSlashCommands} className="flex h-6 w-6 items-center justify-center rounded-[3px] hover:bg-[var(--mm-bg-hover)]" aria-label={t("chatInput.openSlashCommands")}>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="m8 9-4 3 4 3m8-6 4 3-4 3M14 5l-4 14" />
                </svg>
              </button>
              <Popover
                align="start"
                contentClassName="w-[246px] rounded-[10px] border border-[var(--mm-border)] bg-[var(--mm-bg-panel)] p-1.5 shadow-[0_16px_38px_rgba(20,31,50,0.14)]"
                trigger={
                  <button type="button" className="flex h-6 items-center gap-1 rounded-[4px] px-1.5 text-[11px] hover:bg-[var(--mm-bg-hover)]" aria-label={t("chatInput.agentMode.aria")}>
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
                  <div role="menu" aria-label={t("chatInput.agentMode.menu")}>
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
              {permissionPopover}
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
                    aria-label={t("chatInput.model.current", { model: currentModelLabel })}
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--mm-accent-blue)]" aria-hidden />
                    <span className="truncate">{currentModelLabel}</span>
                  </button>
                }
              >
                {(close) => (
                  <div className="py-1">
                    <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-[var(--mm-text-tertiary)]">{t("chatInput.model.select")}</div>
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
                        {t("chatInput.model.empty")}
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
                    aria-label={t("chatInput.thinking.aria", { label: currentThinkingLabel })}
                  >
                    <span className="font-medium text-[var(--mm-text-primary)]">{currentThinkingLabel}</span>
                    <svg className="h-3 w-3 text-[var(--mm-text-tertiary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m6 9 6 6 6-6" />
                    </svg>
                  </button>
                }
              >
                {(close) => (
                  <div role="menu" aria-label={t("chatInput.thinking.menu")}>
                    <div className="px-2 py-1 text-[10px] text-[var(--mm-text-tertiary)]">{t("chatInput.thinking.heading")}</div>
                    {thinkingOptions.map((option) => (
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
                onClick={handlePrimaryAction}
                disabled={primaryActionDisabled}
                className={`flex h-[32px] items-center justify-center rounded-[5px] shadow-[0_1px_2px_rgba(10,35,80,0.14)] transition-opacity ${
                  showStopAction
                    ? "w-[32px] bg-[var(--mm-bg-active)] text-[var(--mm-text-on-active)] hover:opacity-90"
                    : "w-[51px] bg-[var(--mm-accent-blue)] text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-35"
                }`}
                aria-label={primaryActionAriaLabel}
                title={primaryActionLabel}
              >
                {showStopAction ? (
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" />
                  </svg>
                ) : (
                  <svg className="h-5 w-5 -rotate-12" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M3 11.7 21 3.8 13.1 21l-2.3-7.1L3 11.7Zm8.7 1.1 1.2 3.7 4-8.7-8.6 3.8 3.4 1.2Z" />
                  </svg>
                )}
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
                  aria-label={t("chatInput.addAttachmentAndTools")}
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
                    aria-label={t("chatInput.addFileOrImage")}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <svg className="h-3.5 w-3.5 shrink-0 text-[var(--mm-text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="m21 12-8.5 8.5a5 5 0 0 1-7-7L14 5a3 3 0 1 1 4 4L8.5 18.5a1.5 1.5 0 1 1-2-2L15 8" />
                      </svg>
                      {t("chatInput.addFileOrImage")}
                    </span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      close();
                      window.dispatchEvent(new CustomEvent("app:switch-section", { detail: { section: "tools" } }));
                    }}
                    className="flex min-h-8 w-full items-center justify-between gap-3 rounded-[9px] px-2 text-left text-sm text-[var(--mm-text-primary)] hover:bg-[var(--mm-bg-hover)]"
                    aria-label={t("chatInput.openTools")}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <svg className="h-3.5 w-3.5 shrink-0 text-[var(--mm-text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M6 3h9l3 3v15H6zM14 3v5h5M9 13h6M9 17h4" />
                      </svg>
                      {t("chatInput.tools")}
                    </span>
                    <span className="text-[var(--mm-text-tertiary)]" aria-hidden>{t("chatInput.open")}</span>
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
                  aria-label={currentWorkspace ? t("chatInput.workspace.current", { name: currentWorkspace.name }) : t("chatInput.workspace.select")}
                  data-testid="chat-input-workspace-trigger"
                >
                  <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
                  </svg>
                  <span className="truncate">{currentWorkspace?.name ?? t("chatInput.workspace.select")}</span>
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
                      <div className="px-3 py-1.5 text-[10px] text-[var(--mm-text-tertiary)]">{t("chatInput.workspace.recent")}</div>
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
                    <span className="truncate">{t("chatInput.workspace.chooseNew")}</span>
                  </button>
                </div>
              )}
            </Popover>
            {permissionPopover}

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
                  aria-label={currentModel ? t("chatInput.model.current", { model: currentModel }) : t("chatInput.model.notSelected")}
                  data-testid="chat-input-model-trigger"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  <span className="truncate">{currentModel || t("chatInput.model.notSelected")}</span>
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              }
            >
              {(close) => (
                <div className="py-1">
                  <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-[var(--mm-text-tertiary)]">{t("chatInput.model.select")}</div>
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
                      {t("chatInput.model.empty")}
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

