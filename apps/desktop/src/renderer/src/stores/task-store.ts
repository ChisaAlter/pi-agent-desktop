// Task Store - 任务状态管理

import { create } from 'zustand';

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface TaskStep {
  id: string;
  description: string;
  status: StepStatus;
  detail?: string;
  error?: string;
}

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  steps: TaskStep[];
  startedAt: Date;
  completedAt?: Date;
}

interface TaskState {
  tasks: Task[];
  currentTaskId: string | null;

  // Actions
  addTask: (title: string) => Task;
  updateTask: (id: string, updates: Partial<Pick<Task, 'title' | 'status' | 'completedAt'>>) => void;
  addStep: (taskId: string, description: string) => TaskStep;
  updateStep: (taskId: string, stepId: string, updates: Partial<Pick<TaskStep, 'status' | 'detail' | 'error'>>) => void;
  setCurrentTask: (id: string | null) => void;
  getCurrentTask: () => Task | null;
}

let taskCounter = 0;
let stepCounter = 0;

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  currentTaskId: null,

  addTask: (title: string) => {
    const task: Task = {
      id: `task-${++taskCounter}`,
      title,
      status: 'pending',
      steps: [],
      startedAt: new Date(),
    };
    set((state) => ({
      tasks: [...state.tasks, task],
      currentTaskId: task.id,
    }));
    return task;
  },

  updateTask: (id, updates) => {
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === id ? { ...t, ...updates } : t
      ),
    }));
  },

  addStep: (taskId, description) => {
    const step: TaskStep = {
      id: `step-${++stepCounter}`,
      description,
      status: 'pending',
    };
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId ? { ...t, steps: [...t.steps, step] } : t
      ),
    }));
    return step;
  },

  updateStep: (taskId, stepId, updates) => {
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId
          ? {
              ...t,
              steps: t.steps.map((s) =>
                s.id === stepId ? { ...s, ...updates } : s
              ),
            }
          : t
      ),
    }));
  },

  setCurrentTask: (id) => {
    set({ currentTaskId: id });
  },

  getCurrentTask: () => {
    const { tasks, currentTaskId } = get();
    return tasks.find((t) => t.id === currentTaskId) ?? null;
  },
}));
