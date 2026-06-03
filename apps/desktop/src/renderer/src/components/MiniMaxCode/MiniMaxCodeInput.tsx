// MiniMaxCodeInput — MiniMax Code 风格中央输入区
// 1:1 还原目标 UI (参考截图):
//   ┌────────────────── 圆角 16px 白底 1px 浅边框 ──────────────────┐
//   │                                                                │
//   │   [textarea 多行, 自动撑高, max 200px]                         │
//   │   placeholder: "现在这项目完成度太低了。"                       │
//   │                                                                │
//   │   [+ 始终授权]                  [MiniMax-M3 ▾]  [▲ 圆形黑底]   │
//   ├────────────────────────────────────────────────────────────────┤
//   │   [📁 pi-desktop ▾]  [○ Worktree]  [👥 Agent Team ▾]           │
//   └────────────────────────────────────────────────────────────────┘
// 颜色/尺寸走 --mm-* token 或 spec 给定 hex. 组件仅持有 textarea 文本
// 与授权开关两个 UI 状态;数据/事件通过 props 上抛,父级 (WelcomeScreen)
// 决定如何处理. 无业务逻辑 (不调 IPC, 不解析消息).

import React, { useRef, useState } from "react";

export interface MiniMaxCodeInputProps {
    /** 工作区名称 (用于状态行的 [📁 name ▾] chip) */
    workspaceName: string;
    /** 模型名称 (默认 "MiniMax-M3") */
    modelName?: string;
    /** 发送回调: 拿到 trim 后的非空文本 */
    onSend: (text: string) => void;
    /** 附件按钮回调 (可选) */
    onAttach?: () => void;
    /** 始终授权 toggle 切换回调 (可选) */
    onToggleAuth?: (enabled: boolean) => void;
}

const MAX_TEXTAREA_HEIGHT = 200;
const MIN_TEXTAREA_HEIGHT = 24;

/**
 * MiniMax Code 风格中央输入区 — 多行 textarea + 工具栏 + 状态行.
 *
 * 设计约束:
 *  - 圆角 16px (--mm-radius-xl), 白底, 1px 浅边框 #e5e5e5, 微弱投影
 *  - textarea 透明, 自适应行高, 上限 200px 触发 overflow-y:auto
 *  - Enter 发送 / Shift+Enter 换行
 *  - 始终授权 用 role=switch + aria-checked; 视觉上是 pill 形小开关
 *  - 发送按钮 圆形黑底 #1a1a1a, 文本为空时禁用 (opacity 30%)
 *  - 状态行用 1px 顶边与上半部分隔
 */
export function MiniMaxCodeInput({
    workspaceName,
    modelName = "MiniMax-M3",
    onSend,
    onAttach,
    onToggleAuth,
}: MiniMaxCodeInputProps): React.JSX.Element {
    const [text, setText] = useState("");
    const [authorized, setAuthorized] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    const resetHeight = (): void => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.style.height = `${MIN_TEXTAREA_HEIGHT}px`;
    };

    const autoGrow = (): void => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.style.height = "auto";
        const next = Math.min(ta.scrollHeight, MAX_TEXTAREA_HEIGHT);
        ta.style.height = `${next}px`;
    };

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
        setText(e.target.value);
        autoGrow();
    };

    const handleSend = (): void => {
        const trimmed = text.trim();
        if (!trimmed) return;
        onSend(trimmed);
        setText("");
        // 发送后回到初始高度
        resetHeight();
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
        // Enter 直接发送; Shift+Enter 走默认行为 (换行)
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleToggleAuth = (): void => {
        const next = !authorized;
        setAuthorized(next);
        onToggleAuth?.(next);
    };

    const canSend = text.trim().length > 0;

    return (
        <div
            className="w-full bg-white border border-[#e5e5e5] rounded-2xl shadow-sm overflow-hidden"
            data-mmcode-input="root"
        >
            {/* Textarea */}
            <div className="px-5 pt-5 pb-3">
                <textarea
                    ref={textareaRef}
                    value={text}
                    onChange={handleChange}
                    onKeyDown={handleKeyDown}
                    placeholder="现在这项目完成度太低了。"
                    rows={1}
                    aria-label="消息输入"
                    data-mmcode-input="textarea"
                    className="w-full bg-transparent border-0 outline-none resize-none text-base text-[#1a1a1a] placeholder:text-[#999] leading-6 overflow-y-auto block"
                    style={{
                        minHeight: `${MIN_TEXTAREA_HEIGHT}px`,
                        maxHeight: `${MAX_TEXTAREA_HEIGHT}px`,
                    }}
                />
            </div>

            {/* Toolbar: [attach + auth] ........ [model + send] */}
            <div className="flex items-center justify-between gap-2 px-3 pb-3">
                <div className="flex items-center gap-1">
                    {/* Attach + button */}
                    <button
                        type="button"
                        onClick={() => onAttach?.()}
                        aria-label="添加附件"
                        data-mmcode-input="attach"
                        className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-[#666] hover:bg-[#f0f0f0] hover:text-[#1a1a1a] transition-colors"
                    >
                        <svg
                            className="w-4 h-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={1.5}
                            aria-hidden="true"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M12 4.5v15m7.5-7.5h-15"
                            />
                        </svg>
                    </button>

                    {/* 始终授权 switch — 整行可点; 视觉上是 [icon text switch] */}
                    <button
                        type="button"
                        role="switch"
                        aria-checked={authorized}
                        aria-label="始终授权"
                        data-mmcode-input="auth"
                        onClick={handleToggleAuth}
                        className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs text-[#666] hover:bg-[#f0f0f0] hover:text-[#1a1a1a] transition-colors"
                    >
                        <svg
                            className="w-3.5 h-3.5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={1.5}
                            aria-hidden="true"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
                            />
                        </svg>
                        <span>始终授权</span>
                        {/* 开关视觉: 24x14 轨道 + 10x10 拇指 */}
                        <span
                            className={`relative inline-block w-6 h-3.5 rounded-full transition-colors ${
                                authorized ? "bg-[#1a1a1a]" : "bg-[#e5e5e5]"
                            }`}
                            aria-hidden="true"
                        >
                            <span
                                className={`absolute top-0.5 left-0.5 w-2.5 h-2.5 bg-white rounded-full transition-transform ${
                                    authorized ? "translate-x-3" : "translate-x-0"
                                }`}
                            />
                        </span>
                    </button>
                </div>

                <div className="flex items-center gap-1">
                    {/* Model selector */}
                    <button
                        type="button"
                        aria-label={`当前模型 ${modelName}`}
                        data-mmcode-input="model"
                        className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-xs text-[#1a1a1a] hover:bg-[#f0f0f0] transition-colors"
                    >
                        <span>{modelName}</span>
                        <svg
                            className="w-3 h-3"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                            aria-hidden="true"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M19.5 8.25l-7.5 7.5-7.5-7.5"
                            />
                        </svg>
                    </button>

                    {/* Send button — 圆形黑底 32x32, ↑ icon */}
                    <button
                        type="button"
                        onClick={handleSend}
                        disabled={!canSend}
                        aria-label="发送"
                        data-mmcode-input="send"
                        className="w-8 h-8 inline-flex items-center justify-center rounded-full bg-[#1a1a1a] text-white hover:bg-[#333] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                        <svg
                            className="w-4 h-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2.5}
                            aria-hidden="true"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M12 19V5M5 12l7-7 7 7"
                            />
                        </svg>
                    </button>
                </div>
            </div>

            {/* Status row: workspace / worktree / agent team */}
            <div
                className="flex items-center justify-between gap-2 px-3 py-2 border-t border-[#e5e5e5] text-xs text-[#999]"
                data-mmcode-input="status-row"
            >
                {/* Workspace */}
                <button
                    type="button"
                    aria-label={`工作区 ${workspaceName}`}
                    data-mmcode-input="workspace"
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-[#f0f0f0] hover:text-[#1a1a1a] transition-colors"
                >
                    <svg
                        className="w-3.5 h-3.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={1.5}
                        aria-hidden="true"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 0 0-1.883 2.542l.857 6a2.25 2.25 0 0 0 2.227 1.932H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-1.883-2.542m-16.5 0V6A2.25 2.25 0 0 1 6 3.75h3.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.06.44H18A2.25 2.25 0 0 1 20.25 6v3.776"
                        />
                    </svg>
                    <span>{workspaceName}</span>
                    <svg
                        className="w-3 h-3"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                        aria-hidden="true"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M19.5 8.25l-7.5 7.5-7.5-7.5"
                        />
                    </svg>
                </button>

                {/* Worktree — 圆形 icon + 文字, 无下拉 */}
                <button
                    type="button"
                    aria-label="Worktree"
                    data-mmcode-input="worktree"
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-[#f0f0f0] hover:text-[#1a1a1a] transition-colors"
                >
                    <span
                        className="w-3 h-3 rounded-full border-[1.5px] border-current inline-block"
                        aria-hidden="true"
                    />
                    <span>Worktree</span>
                </button>

                {/* Agent Team */}
                <button
                    type="button"
                    aria-label="Agent Team"
                    data-mmcode-input="agent-team"
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-[#f0f0f0] hover:text-[#1a1a1a] transition-colors"
                >
                    <svg
                        className="w-3.5 h-3.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={1.5}
                        aria-hidden="true"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0z"
                        />
                    </svg>
                    <span>Agent Team</span>
                    <svg
                        className="w-3 h-3"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                        aria-hidden="true"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M19.5 8.25l-7.5 7.5-7.5-7.5"
                        />
                    </svg>
                </button>
            </div>
        </div>
    );
}
