// TaskProgressPanel (MiniMax Code - 右侧任务进度列表)
//
// 风格:严格 1:1 还原 MiniMax Code 右栏(参考布局 280px 宽、白底、零阴影)。
//  本组件本身不强制宽度,直接填满父容器(由 MiniMaxCodeLayout 的右 aside
//  通过 --mm-width-sidebar-right: 280px 提供尺寸约束)。
//
// 视觉:
//   ┌─────────────────────────────┐
//   │ 任务进度            12px 弱化│  ← header,padding 16px
//   ├─────────────────────────────┤
//   │ ◯ 任务名称              1m  │  ← list item,padding 12px
//   │ ▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░   │  ← 可选进度条
//   │ ◯ 任务名称              1m  │
//   │ ◯ 任务名称              1m  │
//   └─────────────────────────────┘
//
// 设计约束:
//  - 纯展示组件,不持有任何业务状态;任务数据由父级传入(props.tasks)
//  - 颜色/尺寸优先 --mm-* token;进度条/时间戳等 MiniMax Code 未提供 token 的
//    视觉细节,按本组件 spec 硬编码(本轮不改 globals.css)
//  - a11y: role=list / role=listitem,整行作为可点击 button

import React from "react";

/** 任务状态 */
export type TaskStatus = "pending" | "running" | "completed" | "failed";

/** 列表中一条任务项 */
export interface TaskProgressItem {
    id: string;
    name: string;
    status: TaskStatus;
    /** 0-100 的整数百分比;缺省/非数字时不渲染进度条 */
    progress?: number;
    /** 毫秒时间戳;缺省时不渲染时间戳 */
    timestamp?: number;
}

export interface TaskProgressPanelProps {
    tasks?: TaskProgressItem[];
    /** 单击某条任务时回调;未提供时整行仍可点击但无副作用(便于做纯展示态) */
    onTaskClick?: (id: string) => void;
    className?: string;
}

// 状态 icon (16px) — pending / running / completed / failed
const StatusIcon: React.FC<{ status: TaskStatus }> = ({ status }) => {
    switch (status) {
        case "pending":
            return (
                <span
                    aria-hidden
                    className="inline-block w-4 h-4 rounded-full border-2 border-[#d4d4d4] flex-shrink-0 bg-transparent"
                />
            );
        case "running":
            return (
                <svg
                    aria-hidden
                    className="w-4 h-4 text-[var(--mm-text-primary)] animate-spin flex-shrink-0"
                    viewBox="0 0 24 24"
                    fill="none"
                >
                    <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="3"
                    />
                    <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                </svg>
            );
        case "completed":
            return (
                <svg
                    aria-hidden
                    className="w-4 h-4 text-[#10b981] flex-shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                >
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2.5}
                        d="M5 13l4 4L19 7"
                    />
                </svg>
            );
        case "failed":
            return (
                <svg
                    aria-hidden
                    className="w-4 h-4 text-[var(--color-error)] flex-shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                >
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2.5}
                        d="M6 18L18 6M6 6l12 12"
                    />
                </svg>
            );
        default:
            return null;
    }
};

/** 把毫秒时间戳格式化为 24h HH:MM:SS,空值返回 null */
const formatTimestamp = (ts: number | undefined): string | null => {
    if (typeof ts !== "number" || Number.isNaN(ts)) return null;
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return null;
    const pad = (n: number): string => n.toString().padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

/**
 * MiniMax Code 风格的右侧任务进度面板
 *
 * 用法:
 * ```tsx
 * <MiniMaxCodeLayout
 *   leftSlot={...}
 *   centerSlot={...}
 *   rightSlot={<TaskProgressPanel tasks={tasks} onTaskClick={...} />}
 * />
 * ```
 */
export function TaskProgressPanel({
    tasks = [],
    onTaskClick,
    className = "",
}: TaskProgressPanelProps): React.JSX.Element {
    return (
        <div
            className={`flex h-full w-full flex-col bg-transparent px-3 py-14 text-[var(--mm-text-primary)] ${className}`}
            data-mmcode-panel="task-progress"
        >
            <div
                className="overflow-hidden rounded-2xl border border-[var(--mm-border)] bg-[var(--mm-bg-panel)]"
                data-mmcode-region="task-progress-card"
            >
                {/* 顶部标题(header,padding 16px) */}
                <div
                    className="flex items-center justify-between px-4 pt-4 pb-3"
                    data-mmcode-region="task-progress-header"
                >
                    <h2
                        className="m-0 p-0 text-[13px] leading-none font-medium text-[var(--mm-text-primary)]"
                        data-mmcode-region="task-progress-title"
                    >
                        活动
                    </h2>
                    <svg className="h-3.5 w-3.5 text-[var(--mm-text-tertiary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 9l-7 7-7-7" />
                    </svg>
                </div>

                {/* 任务列表 / 空状态 */}
                <div
                    className="min-h-0 overflow-y-auto"
                    data-mmcode-region="task-progress-body"
                >
                    {tasks.length === 0 ? (
                        <div
                            className="px-4 pb-4"
                            data-mmcode-region="task-progress-empty"
                        >
                            <p className="m-0 text-[12px] leading-5 text-[var(--mm-text-secondary)]">
                                暂无任务
                            </p>
                        </div>
                    ) : (
                        <ul role="list" className="m-0 max-h-[360px] list-none overflow-y-auto p-0">
                            {tasks.map((t) => {
                                const hasProgress =
                                    typeof t.progress === "number" &&
                                    !Number.isNaN(t.progress);
                                const clamped = hasProgress
                                    ? Math.max(0, Math.min(100, t.progress as number))
                                    : 0;
                                const ts = formatTimestamp(t.timestamp);
                                return (
                                    <li
                                        key={t.id}
                                        role="listitem"
                                        className="m-0 border-t border-[var(--mm-border)] p-0"
                                        data-task-status={t.status}
                                    >
                                        <button
                                            type="button"
                                            onClick={
                                                onTaskClick
                                                    ? () => onTaskClick(t.id)
                                                    : undefined
                                            }
                                            aria-label={`task ${t.name} ${t.status}`}
                                            className="group block w-full p-3 text-left transition-colors hover:bg-[var(--mm-bg-hover)] focus:bg-[var(--mm-bg-hover)] focus:outline-none"
                                        >
                                            <div className="flex min-w-0 items-center gap-2">
                                                <StatusIcon status={t.status} />
                                                <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--mm-text-primary)]">
                                                    {t.name}
                                                </span>
                                                {ts !== null && (
                                                    <span
                                                        className="flex-shrink-0 text-[11px] leading-none tabular-nums text-[var(--mm-text-tertiary)]"
                                                        data-mmcode-region="task-progress-timestamp"
                                                    >
                                                        {ts}
                                                    </span>
                                                )}
                                            </div>
                                            {hasProgress && (
                                                <div
                                                    role="progressbar"
                                                    aria-valuenow={clamped}
                                                    aria-valuemin={0}
                                                    aria-valuemax={100}
                                                    aria-label={`${t.name} 进度`}
                                                    className="mt-1.5 h-[2px] w-full overflow-hidden rounded-[1px] bg-[var(--mm-bg-hover)]"
                                                >
                                                    <div
                                                        className="h-full bg-[#1a1a1a] transition-[width] duration-[var(--motion-panel)]"
                                                        style={{ width: `${clamped}%` }}
                                                    />
                                                </div>
                                            )}
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    );
}
