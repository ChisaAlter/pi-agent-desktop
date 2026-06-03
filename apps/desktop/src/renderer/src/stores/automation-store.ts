// Automation Store - 定时任务 (scheduled tasks) 状态管理
//
// v1.0.x: 内存中维护任务列表,UI 层可做增删改启停.
//         后续迭代会接 cron runner (主进程) + IPC 持久化.
//
// 任务形状: { id, name, cron, status, lastRun?, nextRun? }
//   - id:     内部唯一标识 (genId 生成)
//   - name:   用户可读的任务名 (如 "每日工作区备份")
//   - cron:   cron 表达式 (展示用, 5 段标准式)
//   - status: running(已启用) / idle(已停用) / failed(上次执行失败)
//   - lastRun / nextRun: ISO 字符串,可空

import { create } from 'zustand';

export type AutomationStatus = 'running' | 'idle' | 'failed';

export interface AutomationTask {
    id: string;
    name: string;
    cron: string;
    status: AutomationStatus;
    /** 上次执行时间 (ISO 字符串) */
    lastRun?: string;
    /** 下次计划执行时间 (ISO 字符串) */
    nextRun?: string;
}

interface AutomationState {
    tasks: AutomationTask[];

    // Actions
    /** 新建任务,返回分配到的 id */
    addTask: (task: Omit<AutomationTask, 'id' | 'status'>) => string;
    /** 删除任务 */
    removeTask: (id: string) => void;
    /** 启停切换: running → idle, idle/failed → running */
    toggleTask: (id: string) => void;
    /** 更新某任务的最近执行结果; ok=true 保持原 status, ok=false 标记为 failed */
    updateLastRun: (id: string, ok: boolean, at?: string) => void;
}

function genId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// 3 条示例任务,首次打开面板用户即可看到效果
const SAMPLE_TASKS: AutomationTask[] = [
    {
        id: 'task_sample_backup',
        name: '每日工作区备份',
        cron: '0 2 * * *',
        status: 'running',
        lastRun: '2026-06-02T02:00:00.000Z',
        nextRun: '2026-06-04T02:00:00.000Z',
    },
    {
        id: 'task_sample_index',
        name: '代码索引同步',
        cron: '*/30 * * * *',
        status: 'idle',
        lastRun: '2026-06-03T14:00:00.000Z',
        nextRun: '2026-06-03T14:30:00.000Z',
    },
    {
        id: 'task_sample_clean',
        name: '临时文件清理',
        cron: '0 0 * * 0',
        status: 'failed',
        lastRun: '2026-06-01T00:00:00.000Z',
        nextRun: '2026-06-08T00:00:00.000Z',
    },
];

export const useAutomationStore = create<AutomationState>((set) => ({
    tasks: SAMPLE_TASKS,

    addTask: (task) => {
        const id = genId();
        const newTask: AutomationTask = { ...task, id, status: 'idle' };
        set((state) => ({ tasks: [...state.tasks, newTask] }));
        return id;
    },

    removeTask: (id) => {
        set((state) => ({ tasks: state.tasks.filter((t) => t.id !== id) }));
    },

    toggleTask: (id) => {
        set((state) => ({
            tasks: state.tasks.map((t) =>
                t.id === id
                    ? { ...t, status: t.status === 'running' ? ('idle' as const) : ('running' as const) }
                    : t,
            ),
        }));
    },

    updateLastRun: (id, ok, at) => {
        set((state) => ({
            tasks: state.tasks.map((t) =>
                t.id === id
                    ? {
                        ...t,
                        lastRun: at ?? new Date().toISOString(),
                        // 成功不主动改 status (保留 running/idle);失败才标 failed
                        status: ok ? t.status : ('failed' as const),
                    }
                    : t,
            ),
        }));
    },
}));
