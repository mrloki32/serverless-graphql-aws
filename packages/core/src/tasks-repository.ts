import type { Queryable } from './db';
import { decodeCursor, encodeCursor } from './cursor';
import type {
  ChangeAction,
  CreateTaskInput,
  Task,
  TaskPage,
  TaskStats,
  TaskStatus,
  UpdateTaskInput,
} from './types';

/**
 * Data-access layer for the `tasks` table. Every query is scoped by `owner`
 * (the Cognito user id) so one user can never read or modify another user's rows,
 * and every value is passed as a bind parameter (no string-built SQL with user input).
 */

const COLUMNS = 'id, owner, title, description, status, created_at, updated_at';

interface TaskRow {
  id: string;
  owner: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  created_at: Date;
  updated_at: Date;
}

function toTask(r: TaskRow): Task {
  return {
    id: r.id,
    owner: r.owner,
    title: r.title,
    description: r.description,
    status: r.status,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

export interface ListTasksOptions {
  status?: TaskStatus | null;
  limit?: number | null;
  nextToken?: string | null;
}

export async function listTasks(db: Queryable, owner: string, opts: ListTasksOptions = {}): Promise<TaskPage> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const params: unknown[] = [owner];
  let where = 'owner = $1';

  if (opts.status) {
    params.push(opts.status);
    where += ` AND status = $${params.length}`;
  }
  if (opts.nextToken) {
    const c = decodeCursor(opts.nextToken);
    params.push(c.createdAt, c.id);
    where += ` AND (created_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
  }
  params.push(limit + 1);

  const { rows } = await db.query<TaskRow>(
    `SELECT ${COLUMNS} FROM tasks WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT $${params.length}`,
    params,
  );

  const items = rows.slice(0, limit).map(toTask);
  const last = items.at(-1);
  return {
    items,
    nextToken: rows.length > limit && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
  };
}

export async function getTask(db: Queryable, owner: string, id: string): Promise<Task | null> {
  const { rows } = await db.query<TaskRow>(`SELECT ${COLUMNS} FROM tasks WHERE owner = $1 AND id = $2`, [owner, id]);
  return rows[0] ? toTask(rows[0]) : null;
}

export async function createTask(db: Queryable, owner: string, input: CreateTaskInput): Promise<Task> {
  const { rows } = await db.query<TaskRow>(
    `INSERT INTO tasks (owner, title, description, status)
     VALUES ($1, $2, $3, COALESCE($4, 'TODO'))
     RETURNING ${COLUMNS}`,
    [owner, input.title, input.description ?? null, input.status ?? null],
  );
  return toTask(rows[0]!);
}

export async function updateTask(db: Queryable, owner: string, input: UpdateTaskInput): Promise<Task | null> {
  const params: unknown[] = [owner, input.id];
  const sets: string[] = [];
  // Column names come from this fixed list, never from user input.
  const fields: Array<[string, unknown]> = [
    ['title', input.title],
    ['description', input.description],
    ['status', input.status],
  ];
  for (const [column, value] of fields) {
    if (value !== undefined) {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
  }
  sets.push(`updated_at = date_trunc('milliseconds', clock_timestamp())`);

  const { rows } = await db.query<TaskRow>(
    `UPDATE tasks SET ${sets.join(', ')} WHERE owner = $1 AND id = $2 RETURNING ${COLUMNS}`,
    params,
  );
  return rows[0] ? toTask(rows[0]) : null;
}

export async function deleteTask(db: Queryable, owner: string, id: string): Promise<Task | null> {
  const { rows } = await db.query<TaskRow>(`DELETE FROM tasks WHERE owner = $1 AND id = $2 RETURNING ${COLUMNS}`, [
    owner,
    id,
  ]);
  return rows[0] ? toTask(rows[0]) : null;
}

export async function getTaskStats(db: Queryable, owner: string): Promise<TaskStats> {
  const { rows } = await db.query<{ total: string; todo: string; in_progress: string; done: string }>(
    `SELECT count(*) AS total,
            count(*) FILTER (WHERE status = 'TODO') AS todo,
            count(*) FILTER (WHERE status = 'IN_PROGRESS') AS in_progress,
            count(*) FILTER (WHERE status = 'DONE') AS done
       FROM tasks WHERE owner = $1`,
    [owner],
  );
  const r = rows[0]!;
  return { total: Number(r.total), todo: Number(r.todo), inProgress: Number(r.in_progress), done: Number(r.done) };
}

export async function recordAudit(db: Queryable, owner: string, action: ChangeAction, task: Task): Promise<void> {
  await db.query(`INSERT INTO task_audit (task_id, owner, action, payload) VALUES ($1, $2, $3, $4)`, [
    task.id,
    owner,
    action,
    JSON.stringify(task),
  ]);
}
