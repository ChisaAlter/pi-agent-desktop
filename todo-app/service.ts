import type {
  Todo,
  CreateTodoInput,
  UpdateTodoInput,
  TodoStats,
  TodoFilter,
  Priority,
} from './types';

/** TODO 数据访问层 */
export class TodoRepository {
  private todos: Map<number, Todo> = new Map();
  private nextId = 1;

  /** 保存（创建或更新） */
  save(todo: Todo): Todo {
    this.todos.set(todo.id, todo);
    return { ...todo };
  }

  /** 按 ID 查找 */
  findById(id: number): Todo | undefined {
    const todo = this.todos.get(id);
    return todo ? { ...todo } : undefined;
  }

  /** 查找全部（可带过滤） */
  findAll(filter?: TodoFilter): Todo[] {
    let result = Array.from(this.todos.values());

    if (filter?.completed !== undefined) {
      result = result.filter((t) => t.completed === filter.completed);
    }
    if (filter?.priority !== undefined) {
      result = result.filter((t) => t.priority === filter.priority);
    }

    return result.map((t) => ({ ...t }));
  }

  /** 删除 */
  delete(id: number): boolean {
    return this.todos.delete(id);
  }

  /** 生成下一个 ID */
  nextIdValue(): number {
    return this.nextId++;
  }
}

/** TODO 业务逻辑层 */
export class TodoService {
  constructor(private repository: TodoRepository) {}

  /** 创建 TODO */
  create(input: CreateTodoInput): Todo {
    if (!input.title.trim()) {
      throw new Error('标题不能为空');
    }

    const now = new Date();
    const todo: Todo = {
      id: this.repository.nextIdValue(),
      title: input.title.trim(),
      description: input.description?.trim() ?? '',
      completed: false,
      priority: input.priority ?? 'medium',
      createdAt: now,
      updatedAt: now,
    };

    return this.repository.save(todo);
  }

  /** 按 ID 查询 */
  getById(id: number): Todo {
    const todo = this.repository.findById(id);
    if (!todo) {
      throw new Error(`ID ${id} 不存在`);
    }
    return todo;
  }

  /** 查询全部（可带过滤） */
  getAll(filter?: TodoFilter): Todo[] {
    return this.repository.findAll(filter);
  }

  /** 更新 TODO */
  update(id: number, input: UpdateTodoInput): Todo {
    const existing = this.repository.findById(id);
    if (!existing) {
      throw new Error(`ID ${id} 不存在`);
    }

    const updated: Todo = {
      ...existing,
      ...(input.title !== undefined && { title: input.title.trim() }),
      ...(input.description !== undefined && { description: input.description.trim() }),
      ...(input.completed !== undefined && { completed: input.completed }),
      ...(input.priority !== undefined && { priority: input.priority }),
      updatedAt: new Date(),
    };

    if (!updated.title) {
      throw new Error('标题不能为空');
    }

    return this.repository.save(updated);
  }

  /** 删除 TODO */
  delete(id: number): void {
    if (!this.repository.delete(id)) {
      throw new Error(`ID ${id} 不存在`);
    }
  }

  /** 切换完成状态 */
  toggle(id: number): Todo {
    const todo = this.getById(id);
    return this.update(id, { completed: !todo.completed });
  }

  /** 获取统计信息 */
  getStats(): TodoStats {
    const all = this.repository.findAll();
    const priorities: Priority[] = ['low', 'medium', 'high'];

    return {
      total: all.length,
      completed: all.filter((t) => t.completed).length,
      incomplete: all.filter((t) => !t.completed).length,
      byPriority: priorities.reduce(
        (acc, p) => {
          acc[p] = all.filter((t) => t.priority === p).length;
          return acc;
        },
        {} as Record<Priority, number>
      ),
    };
  }

  /** 批量标记完成 */
  completeAll(ids: number[]): Todo[] {
    return ids.map((id) => this.update(id, { completed: true }));
  }

  /** 批量删除 */
  deleteAll(ids: number[]): number {
    let count = 0;
    for (const id of ids) {
      if (this.repository.delete(id)) count++;
    }
    return count;
  }
}
