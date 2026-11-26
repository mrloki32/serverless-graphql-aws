export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'DONE'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const CHANGE_ACTIONS = ['CREATED', 'UPDATED', 'DELETED'] as const;
export type ChangeAction = (typeof CHANGE_ACTIONS)[number];

export interface Task {
  id: string;
  owner: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  /** ISO-8601 with millisecond precision (matches the DB column precision). */
  createdAt: string;
  updatedAt: string;
}

export interface TaskPage {
  items: Task[];
  nextToken: string | null;
}

export interface TaskStats {
  total: number;
  todo: number;
  inProgress: number;
  done: number;
}

/** Payload returned by every mutation and pushed to `onTaskChanged` subscribers. */
export interface TaskChange {
  action: ChangeAction;
  owner: string;
  task: Task;
}

export interface CreateTaskInput {
  title: string;
  description?: string | null;
  status?: TaskStatus;
}

export interface UpdateTaskInput {
  id: string;
  title?: string;
  /** `null` clears the description, `undefined` leaves it unchanged. */
  description?: string | null;
  status?: TaskStatus;
}
