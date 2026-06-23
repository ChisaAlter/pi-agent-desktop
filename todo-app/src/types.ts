export interface Todo {
  id: number;
  title: string;
  completed: boolean;
  createdAt: Date;
}

export interface CreateTodoDto {
  title: string;
}

export interface UpdateTodoDto {
  title?: string;
  completed?: boolean;
}