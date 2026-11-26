import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppConfig } from '../config';
import {
  createClient,
  CREATE_TASK,
  DELETE_TASK,
  LIST_TASKS,
  ON_TASK_CHANGED,
  TASK_STATS,
  UPDATE_TASK,
  type Task,
  type TaskChange,
  type TaskStats,
  type TaskStatus,
} from '../graphql';
import { subscribe, type RealtimeStatus } from '../realtime';
import { applyChange } from '../taskState';
import { TaskForm } from './TaskForm';
import { TaskItem } from './TaskItem';

interface Props {
  config: AppConfig;
  owner: string;
  email?: string;
  getToken: () => string | undefined;
  onSignOut: () => void;
}

const FILTERS: Array<{ label: string; value: TaskStatus | null }> = [
  { label: 'All', value: null },
  { label: 'To do', value: 'TODO' },
  { label: 'In progress', value: 'IN_PROGRESS' },
  { label: 'Done', value: 'DONE' },
];

export function TaskBoard({ config, owner, email, getToken, onSignOut }: Props) {
  const request = useMemo(() => createClient(config.graphqlUrl, getToken), [config.graphqlUrl, getToken]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [stats, setStats] = useState<TaskStats | null>(null);
  const [filter, setFilter] = useState<TaskStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<RealtimeStatus>('connecting');

  const refreshStats = useCallback(() => {
    request<{ taskStats: TaskStats }>(TASK_STATS)
      .then((d) => setStats(d.taskStats))
      .catch(() => undefined); // stats are non-critical
  }, [request]);

  const load = useCallback(
    async (token: string | null) => {
      setLoading(true);
      try {
        const d = await request<{ tasks: { items: Task[]; nextToken: string | null } }>(LIST_TASKS, {
          status: filter,
          limit: 20,
          nextToken: token,
        });
        setTasks((prev) => (token ? [...prev, ...d.tasks.items] : d.tasks.items));
        setNextToken(d.tasks.nextToken);
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [request, filter],
  );

  useEffect(() => {
    void load(null);
    refreshStats();
  }, [load, refreshStats]);

  const onChange = useCallback(
    (change: TaskChange) => {
      setTasks((prev) => applyChange(prev, change, filter));
      refreshStats();
    },
    [filter, refreshStats],
  );

  // Real-time updates (e.g. from another tab/device) via AppSync subscriptions.
  useEffect(() => {
    const sub = subscribe<{ onTaskChanged: TaskChange | null }>({
      graphqlUrl: config.graphqlUrl,
      realtimeUrl: config.realtimeUrl,
      getToken,
      query: ON_TASK_CHANGED,
      variables: { owner },
      onData: (d) => d.onTaskChanged && onChange(d.onTaskChanged),
      onError: (m) => setError(`Live updates: ${m}`),
      onStatus: setLive,
    });
    return () => sub.close();
  }, [config.graphqlUrl, config.realtimeUrl, getToken, owner, onChange]);

  const mutate = async (query: string, variables: Record<string, unknown>, key: string) => {
    try {
      const d = await request<Record<string, TaskChange>>(query, variables);
      onChange(d[key]!);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="layout">
      <header className="topbar">
        <h1>Task Board</h1>
        <div className="topbar-right">
          <span className={`live live-${live}`} title={`Real-time: ${live}`}>
            ● {live === 'live' ? 'Live' : live}
          </span>
          <span className="muted small">{email}</span>
          <button onClick={onSignOut}>Sign out</button>
        </div>
      </header>

      <main className="content">
        {stats && (
          <section className="stats" aria-label="Task statistics">
            <Stat label="Total" value={stats.total} />
            <Stat label="To do" value={stats.todo} />
            <Stat label="In progress" value={stats.inProgress} />
            <Stat label="Done" value={stats.done} />
          </section>
        )}

        <TaskForm onCreate={(input) => mutate(CREATE_TASK, { input }, 'createTask')} />

        <nav className="filters" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <button key={f.label} className={filter === f.value ? 'active' : ''} onClick={() => setFilter(f.value)}>
              {f.label}
            </button>
          ))}
        </nav>

        {error && (
          <div className="card error" role="alert">
            {error}
          </div>
        )}

        <ul className="tasks">
          {tasks.map((t) => (
            <TaskItem
              key={t.id}
              task={t}
              onStatus={(status) => mutate(UPDATE_TASK, { input: { id: t.id, status } }, 'updateTask')}
              onDelete={() => mutate(DELETE_TASK, { id: t.id }, 'deleteTask')}
            />
          ))}
        </ul>

        {!loading && tasks.length === 0 && <p className="muted centered-text">No tasks yet.</p>}
        {loading && <p className="muted centered-text">Loading…</p>}
        {nextToken && !loading && (
          <button className="more" onClick={() => void load(nextToken)}>
            Load more
          </button>
        )}
      </main>

      <footer className="muted small centered-text">
        {config.stage} · build {config.version}
      </footer>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}
