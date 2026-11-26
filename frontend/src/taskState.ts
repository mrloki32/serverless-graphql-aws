import type { Task, TaskChange, TaskStatus } from './graphql';

/**
 * Applies a change (from our own mutation response or from the subscription) to
 * the visible list. Idempotent, so receiving the same change twice is harmless.
 */
export function applyChange(tasks: Task[], change: TaskChange, filter: TaskStatus | null): Task[] {
  const { task, action } = change;
  const without = tasks.filter((t) => t.id !== task.id);
  if (action === 'DELETED') return without;
  if (filter && task.status !== filter) return without;
  const index = tasks.findIndex((t) => t.id === task.id);
  if (index === -1) {
    return [task, ...tasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  // Ignore out-of-order (older) updates.
  if (tasks[index]!.updatedAt > task.updatedAt) return tasks;
  const next = [...tasks];
  next[index] = task;
  return next;
}
