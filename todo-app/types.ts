/** TODO 核心类型定义 */

/** 创建 TODO 时的输入参数 */
export interface CreateTodoInput {
  title: string;
  description?: string;
  priority?: Priority;
}

/** 更新 TODO 时的输入参数 */
export interface UpdateTodoInput {
  title?: string;
  description?: string;
  completed?: boolean;
  priority?: Priority;
}

/** 优先级枚举 */
export type Priority = 'low' | 'medium' | 'high';

/** TODO 实体 */
export interface Todo {
  id: number;
  title: string;
  description: string;
  completed: boolean;
  priority: Priority;
  createdAt: Date;
  updatedAt: Date;
}

/** 统计信息 */
export interface TodoStats {
  total: number;
  completed: number;
  incomplete: number;
  byPriority: Record<Priority, number>;
}

/** 查询过滤条件 */
export interface TodoFilter {
  completed?: boolean;
  priority?: Priority;
}
