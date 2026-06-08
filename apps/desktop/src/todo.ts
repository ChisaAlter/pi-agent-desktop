// src/todo.ts

export interface TodoItem {
  id: string;
  title: string;
  done: boolean;
  createdAt: number;
}

export class TodoStore {
  private readonly items: Map<string, TodoItem> = new Map();

  add(title: string): TodoItem {
    const item: TodoItem = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      title,
      done: false,
      createdAt: Date.now(),
    };
    this.items.set(item.id, item);
    return item;
  }

  remove(id: string): boolean {
    return this.items.delete(id);
  }

  toggle(id: string): TodoItem | undefined {
    const item = this.items.get(id);
    if (!item) return undefined;
    item.done = !item.done;
    return item;
  }

  list(): TodoItem[] {
    return Array.from(this.items.values()).sort((a, b) => a.createdAt - b.createdAt);
  }

  get(id: string): TodoItem | undefined {
    return this.items.get(id);
  }

  size(): number {
    return this.items.size;
  }

  clear(): void {
    this.items.clear();
  }
}

export const store = new TodoStore();

export function main(): void {
  // 增
  const a = store.add("学习 TypeScript");
  console.log("[add] =>", a);
  const b = store.add("编写 TODO 应用");
  console.log("[add] =>", b);
  const c = store.add("阅读源码");
  console.log("[add] =>", c);

  // 查
  console.log("[list] =>", store.list());

  // 改
  const toggled = store.toggle(a.id);
  console.log("[toggle] =>", toggled);
  const toggledAgain = store.toggle(a.id);
  console.log("[toggle] =>", toggledAgain);

  // 删
  const removed = store.remove(c.id);
  console.log("[remove]", c.id, "=>", removed);
  const removedMissing = store.remove("not-exist");
  console.log("[remove] missing =>", removedMissing);

  // 最终列表
  console.log("[final] =>", store.list());
  console.log("[size] =>", store.size());
}

main();
