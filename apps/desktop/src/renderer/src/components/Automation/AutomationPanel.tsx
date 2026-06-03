// AutomationPanel - 定时任务管理面板
//
// v1.0.x 真实实现 (替换原 App.tsx 中的 "Coming soon" 占位):
//   - 顶部: 标题 + "新建任务" 按钮 (右上)
//   - 列表: 每行展示 name / cron / status / lastRun / 启停 toggle / 删除按钮
//   - 空状态: 居中提示
//   - 真实数据源: useAutomationStore (zustand); store 内已预填 3 条示例任务
//   - 后续可接 cron runner + IPC 持久化
//
// 样式: 复用 globals.css 设计 token (border / radius / 文本色阶)
// 按钮: 复用 common/Button (新 variant subtle / size xs)
// 简易 a11y: role="region" / role="list" / role="listitem" / aria-label / role="switch"

import React from "react";
import { useAutomationStore, type AutomationStatus } from "../../stores/automation-store";
import { Button } from "../common/Button";

/** 状态对应的中文标签 + 颜色 */
const STATUS_LABEL: Record<AutomationStatus, { label: string; dotClass: string; textClass: string }> = {
    running: {
        label: "运行中",
        dotClass: "bg-[#10b981]",
        textClass: "text-[#10b981]",
    },
    idle: {
        label: "已停止",
        dotClass: "bg-[#999999]",
        textClass: "text-[#666666]",
    },
    failed: {
        label: "失败",
        dotClass: "bg-[#ef4444]",
        textClass: "text-[#ef4444]",
    },
};

/** 简单 ISO 字符串 -> 形如 "06-03 14:00" 的本地时间 (无依赖 dayjs) */
function formatDateTime(iso: string | undefined): string {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AutomationPanel(): React.JSX.Element {
    const tasks = useAutomationStore((s) => s.tasks);
    const addTask = useAutomationStore((s) => s.addTask);
    const removeTask = useAutomationStore((s) => s.removeTask);
    const toggleTask = useAutomationStore((s) => s.toggleTask);

    const handleCreate = (): void => {
        // 简易新建: 两次 prompt 拿 name + cron (与 SkillsMarketplace 的 GitHub URL prompt 同款风格)
        // 取消/留空 → 不创建
        const name = window.prompt("任务名 (例如: 每日工作区备份)")?.trim();
        if (!name) return;
        const cron = window.prompt("Cron 表达式 (5 段, 例如: 0 2 * * * 表示每天凌晨 2 点)", "0 * * * *")?.trim();
        if (!cron) return;
        addTask({ name, cron });
    };

    return (
        <div
            className="flex flex-col h-full bg-white"
            role="region"
            aria-label="定时任务面板"
        >
            {/* 顶部: 标题 + 新建按钮 */}
            <header
                className="flex items-center justify-between px-4 py-3 border-b border-[#e5e5e5] bg-[#fafafa]"
                aria-label="面板标题栏"
            >
                <div className="flex items-center gap-2">
                    <h2 className="text-sm font-medium text-[#1a1a1a]">定时任务</h2>
                    <span className="text-xs text-[#999999]" aria-label="任务总数">
                        {tasks.length} 个
                    </span>
                </div>
                <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={handleCreate}
                    aria-label="新建定时任务"
                >
                    + 新建任务
                </Button>
            </header>

            {/* 列表区 */}
            {tasks.length === 0 ? (
                <div
                    className="flex-1 flex items-center justify-center text-[#999999] text-sm"
                    role="status"
                >
                    暂无定时任务,点右上角新建
                </div>
            ) : (
                <ul
                    className="flex-1 overflow-y-auto list-none divide-y divide-[#e5e5e5]"
                    role="list"
                    aria-label="定时任务列表"
                >
                    {tasks.map((task) => {
                        const meta = STATUS_LABEL[task.status];
                        const isRunning = task.status === "running";
                        return (
                            <li
                                key={task.id}
                                role="listitem"
                                className="group flex items-center gap-3 px-4 py-3 hover:bg-[#f5f5f5] transition-colors"
                                aria-label={`任务 ${task.name}`}
                            >
                                {/* 状态点 */}
                                <span
                                    className={`w-2 h-2 rounded-full flex-shrink-0 ${meta.dotClass}`}
                                    aria-hidden="true"
                                />

                                {/* 名称 + cron */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium text-[#1a1a1a] truncate">
                                            {task.name}
                                        </span>
                                        <span className={`text-xs ${meta.textClass}`}>
                                            {meta.label}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-3 mt-0.5 text-xs text-[#666666]">
                                        <code className="font-mono text-[#999999]">{task.cron}</code>
                                        <span>·</span>
                                        <span>上次: {formatDateTime(task.lastRun)}</span>
                                        {task.nextRun && (
                                            <>
                                                <span>·</span>
                                                <span>下次: {formatDateTime(task.nextRun)}</span>
                                            </>
                                        )}
                                    </div>
                                </div>

                                {/* 启停 toggle */}
                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={isRunning}
                                    aria-label={isRunning ? `停止 ${task.name}` : `启动 ${task.name}`}
                                    onClick={() => toggleTask(task.id)}
                                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs transition-colors ${
                                        isRunning
                                            ? "bg-[#dcfce7] text-[#166534]"
                                            : "bg-white border border-[#e5e5e5] text-[#666666] hover:bg-[#f0f0f0]"
                                    }`}
                                    title={isRunning ? "点击停止" : "点击启动"}
                                >
                                    <span
                                        aria-hidden="true"
                                        className={`w-2 h-2 rounded-full ${
                                            isRunning ? "bg-[#10b981]" : "bg-[#cccccc]"
                                        }`}
                                    />
                                    {isRunning ? "运行中" : "已停止"}
                                </button>

                                {/* 删除 */}
                                <Button
                                    type="button"
                                    variant="subtle"
                                    size="xs"
                                    onClick={() => removeTask(task.id)}
                                    aria-label={`删除任务 ${task.name}`}
                                    title="删除任务"
                                >
                                    删除
                                </Button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
