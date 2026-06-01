// 输入区域 - 圆角输入框 + 附件按钮 + 模型选择 + 发送按钮
// M2: 集成 @ mention + 图片粘贴 + 附件 chips

import React, { useState, useRef, useEffect, useCallback } from "react";
import { useSettingsStore } from "../../stores/settings-store";
import { useWorkspaceStore } from "../../stores/workspace-store";
import { useAttachmentsStore } from "../../stores/attachments-store";
import { resolveMention } from "../../utils/mention-parser";
import { MentionPopover } from "../ChatInput/MentionPopover";
import { AttachmentChip } from "../ChatInput/AttachmentChip";
import type { Attachment } from "../../types/attachments";

interface ChatInputProps {
    isConnected: boolean;
    isProcessing: boolean;
    onSend: (message: string, attachments: Attachment[]) => Promise<void>;
    onStop: () => void;
}

export function ChatInput({ isConnected, isProcessing, onSend, onStop }: ChatInputProps): React.JSX.Element {
    const [inputValue, setInputValue] = useState("");
    const [cursor, setCursor] = useState(0);
    const [showPopover, setShowPopover] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const { settings } = useSettingsStore();
    const { getCurrentWorkspace } = useWorkspaceStore();
    const currentWorkspace = getCurrentWorkspace();
    const workspaceId = currentWorkspace?.id ?? "default";
    const [permission] = useState("完全访问权限");

    const attachments = useAttachmentsStore((s) => s.list(workspaceId));

    // 检测 @ mention
    const atIdx = inputValue.lastIndexOf("@", cursor - 1);
    const between = atIdx === -1 ? null : inputValue.slice(atIdx + 1, cursor);
    const activeMention = atIdx !== -1 && between !== null && !/\s/.test(between)
        ? { start: atIdx, query: between }
        : null;

    useEffect(() => {
        setShowPopover(!!activeMention && !isProcessing);
    }, [activeMention, isProcessing]);

    // 自动调整 textarea 高度
    useEffect(() => {
        const ta = textareaRef.current;
        if (ta) {
            ta.style.height = "auto";
            ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
        }
    }, [inputValue]);

    const handleSend = async () => {
        if ((!inputValue.trim() && attachments.length === 0) || isProcessing) return;
        const msg = inputValue.trim();
        await onSend(msg, attachments);
        setInputValue("");
        useAttachmentsStore.getState().clear(workspaceId);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            // 如果 popover 开着, 不发送, 让 popover 处理 Enter
            if (showPopover) {
                e.preventDefault();
                return;
            }
            e.preventDefault();
            handleSend();
        } else if (e.key === "Escape" && showPopover) {
            setShowPopover(false);
        }
    };

    const updateCursor = () => {
        setCursor(textareaRef.current?.selectionStart ?? 0);
    };

    const handleSelectFile = useCallback(
        (filePath: string) => {
            if (!activeMention) return;
            const newText = resolveMention(inputValue, activeMention, filePath);
            setInputValue(newText);
            const newCursor = activeMention.start + 1 + filePath.length;
            setCursor(newCursor);
            setShowPopover(false);
            setTimeout(() => {
                textareaRef.current?.focus();
                textareaRef.current?.setSelectionRange(newCursor, newCursor);
            }, 0);
        },
        [activeMention, inputValue]
    );

    // 图片粘贴
    const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
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
                    const attachment: Attachment = {
                        id: `img_${Date.now()}_${i}`,
                        kind: "image",
                        name: file.name || `pasted-${i}.png`,
                        value: dataUrl,
                        mimeType: file.type,
                        size: file.size,
                    };
                    useAttachmentsStore.getState().add(workspaceId, attachment);
                };
                reader.readAsDataURL(file);
            }
        }
    };

    return (
        <div ref={wrapperRef} className="p-4 bg-white border-t border-[#e5e5e5]">
            <div className="max-w-3xl mx-auto">
                {/* 附件 chips (M2) */}
                {attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2">
                        {attachments.map((a) => (
                            <AttachmentChip
                                key={a.id}
                                attachment={a}
                                onRemove={(id) => useAttachmentsStore.getState().remove(workspaceId, id)}
                            />
                        ))}
                    </div>
                )}

                {/* 输入框 + popover (M2) */}
                <div className="relative">
                    <div className="flex gap-3 mb-3">
                        <textarea
                            ref={textareaRef}
                            value={inputValue}
                            onChange={(e) => {
                                setInputValue(e.target.value);
                                setCursor(e.target.selectionStart ?? 0);
                            }}
                            onKeyDown={handleKeyDown}
                            onSelect={updateCursor}
                            onKeyUp={updateCursor}
                            onClick={updateCursor}
                            onPaste={handlePaste}
                            placeholder={isConnected ? "描述你的任务... (用 @ 引用文件, Ctrl+K 搜全局)" : "Pi CLI 未连接..."}
                            className="flex-1 px-4 py-3 bg-[#f5f5f5] border border-[#e5e5e5] rounded-xl text-sm text-[#1a1a1a] placeholder:text-[#999] resize-none focus:outline-none focus:border-[#1a1a1a] disabled:opacity-50 min-h-[48px] leading-relaxed"
                            rows={1}
                            disabled={isProcessing || !isConnected}
                        />
                        <button
                            onClick={isProcessing ? onStop : handleSend}
                            disabled={!isProcessing && (!inputValue.trim() && attachments.length === 0 || !isConnected)}
                            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all flex-shrink-0 self-end ${
                                isProcessing
                                    ? "bg-[#ef4444] hover:bg-[#dc2626] text-white"
                                    : "bg-[#1a1a1a] hover:bg-[#333] text-white disabled:opacity-30 disabled:cursor-not-allowed"
                            }`}
                        >
                            {isProcessing ? (
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                                </svg>
                            ) : (
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                                </svg>
                            )}
                        </button>
                    </div>

                    {/* @ mention popover (M2) */}
                    {showPopover && currentWorkspace && (
                        <MentionPopover
                            query={activeMention!.query}
                            workspacePath={currentWorkspace.path}
                            onSelect={handleSelectFile}
                            onClose={() => setShowPopover(false)}
                        />
                    )}
                </div>

                {/* 控制栏 */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => textareaRef.current?.focus()}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#f5f5f5] border border-[#e5e5e5] rounded text-xs text-[#666] hover:bg-[#f0f0f0] transition-all"
                            title="粘贴或拖入图片"
                        >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                            附件
                        </button>
                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#f5f5f5] border border-[#e5e5e5] rounded text-xs text-[#666] cursor-pointer hover:bg-[#f0f0f0] transition-all">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                            </svg>
                            <span>{permission}</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#f5f5f5] border border-[#e5e5e5] rounded text-xs text-[#666] cursor-pointer hover:bg-[#f0f0f0] transition-all">
                            <span>{settings.model}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
