// WelcomeScreen — MiniMax Code 风格默认欢迎页 + 底部居中输入框
// 1:1 还原目标 UI (参考截图):
//   ┌────────────────── 主区 #fafafa, 垂直居中 ──────────────────┐
//   │                                                            │
//   │                     ┌────┐                                 │
//   │                     │ M  │  ← 48x48 圆角黑底 logo          │
//   │                     └────┘                                 │
//   │                                                            │
//   │        MiniMax Code, 让工作更简单。   ← 24px 标题          │
//   │                                                            │
//   │        [   MiniMaxCodeInput   ]   ← 大输入框              │
//   │                                                            │
//   │     [Team] [Slides] [PDF] [Doc] [Sheet]  ← 5 个快捷按钮  │
//   │                                                            │
//   └────────────────────────────────────────────────────────────┘
// 颜色/尺寸走 --mm-* token 或 spec 给定 hex. 组件不持有任何业务状态:
//   5 个快捷按钮通过 onQuickAction 上抛 action id, 由父级 (后续的
//   AppShell) 决定如何分发 (建 task / 唤起模态等); 输入框内部状态
//   由 MiniMaxCodeInput 自身管理.

import React from "react";
import { Button } from "../common/Button";
import { MiniMaxCodeInput, type MiniMaxCodeInputProps } from "./MiniMaxCodeInput";

/** 5 个快捷按钮的 id 联合类型 */
export type WelcomeQuickAction = "team" | "slides" | "pdf" | "doc" | "sheet";

export interface WelcomeScreenProps {
    /** 工作区名称 (传给 MiniMaxCodeInput) */
    workspaceName?: string;
    /** 模型名称 (传给 MiniMaxCodeInput, 默认 "MiniMax-M3") */
    modelName?: string;
    /** 5 个快捷按钮回调, action 是 id 联合 */
    onQuickAction: (action: WelcomeQuickAction) => void;
    /** 输入框发送回调 (转发给 MiniMaxCodeInput) */
    onSend: MiniMaxCodeInputProps["onSend"];
    /** 输入框附件回调 (可选, 转发给 MiniMaxCodeInput) */
    onAttach?: MiniMaxCodeInputProps["onAttach"];
    /** 输入框授权 toggle 回调 (可选, 转发给 MiniMaxCodeInput) */
    onToggleAuth?: MiniMaxCodeInputProps["onToggleAuth"];
}

interface QuickActionDef {
    id: WelcomeQuickAction;
    label: string;
    icon: React.ReactNode;
}

// 5 个快捷按钮: 创建 Team / 幻灯片 / PDF / 文档 / 表格
// 图标全部用内联 SVG (24x24 viewBox, 1.5 stroke), 与 IconBar/Button 风格一致
const TEAM_ICON = (
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
            d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0z"
        />
    </svg>
);

const SLIDES_ICON = (
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
            d="M3.75 3v11.25A2.25 2.25 0 0 0 6 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0 1 18 16.5h-2.25m-7.5 0v3.75m0 0h-3m3 0h3m-3-3.75h3m-3 0v3.75M9 16.5h6"
        />
    </svg>
);

const PDF_ICON = (
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
            d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9z"
        />
    </svg>
);

const DOC_ICON = (
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
            d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25M8.25 12h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9z"
        />
    </svg>
);

const SHEET_ICON = (
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
            d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 0 1-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-7.5A1.125 1.125 0 0 1 12 18.375m9.75-12.75c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125m19.5 0v1.5c0 .621-.504 1.125-1.125 1.125M2.25 5.625v1.5c0 .621.504 1.125 1.125 1.125m0 0h17.25m-17.25 0h7.5c.621 0 1.125.504 1.125 1.125M3.375 8.25c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m17.25-3.75h-7.5c-.621 0-1.125.504-1.125 1.125M20.625 12c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h7.5"
        />
    </svg>
);

const QUICK_ACTIONS: ReadonlyArray<QuickActionDef> = [
    { id: "team", label: "创建 Team", icon: TEAM_ICON },
    { id: "slides", label: "幻灯片", icon: SLIDES_ICON },
    { id: "pdf", label: "PDF", icon: PDF_ICON },
    { id: "doc", label: "文档", icon: DOC_ICON },
    { id: "sheet", label: "表格", icon: SHEET_ICON },
];

/**
 * MiniMax Code 风格欢迎页.
 *
 * 设计约束:
 *  - 垂直水平居中 (parent 通常是 MiniMaxCodeLayout 的中栏, 高度填满)
 *  - 48x48 圆角 12px 黑底 logo + 白色 "M" 字符
 *  - 主标题 24px (--font-size-2xl) 半粗, 居中, #1a1a1a
 *  - 5 个快捷按钮用 common/Button variant=outline + className 覆盖边框色
 *    (默认 1px #e5e5e5, hover 1px #999, 背景始终 transparent)
 */
export function WelcomeScreen({
    workspaceName = "pi-desktop",
    modelName = "MiniMax-M3",
    onQuickAction,
    onSend,
    onAttach,
    onToggleAuth,
}: WelcomeScreenProps): React.JSX.Element {
    return (
        <div
            className="flex h-full w-full items-center justify-center px-8 py-12"
            data-mmcode-region="welcome"
            role="region"
            aria-label="欢迎页"
        >
            <div className="flex w-full max-w-2xl flex-col items-center gap-8">
                {/* Logo — 48x48 圆角 12px 黑底, 内嵌白色 "M" */}
                <div
                    className="w-12 h-12 rounded-xl bg-[#1a1a1a] flex items-center justify-center"
                    aria-hidden="true"
                >
                    <span className="text-white text-2xl font-bold leading-none tracking-tight">
                        M
                    </span>
                </div>

                {/* Title — 24px 半粗 #1a1a1a 居中 */}
                <h1
                    className="text-2xl font-semibold text-[#1a1a1a] text-center leading-tight"
                    data-mmcode-welcome="title"
                >
                    MiniMax Code, 让工作更简单。
                </h1>

                {/* Input — 中央输入区 */}
                <MiniMaxCodeInput
                    workspaceName={workspaceName}
                    modelName={modelName}
                    onSend={onSend}
                    onAttach={onAttach}
                    onToggleAuth={onToggleAuth}
                />

                {/* Quick action buttons — 5 个横排, 圆角 8px 浅边框 */}
                <div
                    className="flex flex-wrap items-center justify-center gap-2"
                    role="group"
                    aria-label="快捷操作"
                    data-mmcode-welcome="quick-actions"
                >
                    {QUICK_ACTIONS.map((action) => (
                        <Button
                            key={action.id}
                            type="button"
                            variant="outline"
                            size="md"
                            onClick={() => onQuickAction(action.id)}
                            // 覆盖 outline variant 的灰边框 → spec 的 #e5e5e5,
                            // 移除 hover:bg-gray-100 → 保留白底, 只变 border.
                            className="!border-[#e5e5e5] hover:!border-[#999] hover:!bg-transparent !text-[#1a1a1a] gap-1.5"
                        >
                            {action.icon}
                            <span>{action.label}</span>
                        </Button>
                    ))}
                </div>
            </div>
        </div>
    );
}
