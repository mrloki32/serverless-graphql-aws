import type { Task, TaskStatus } from '../graphql';

const LABELS: Record<TaskStatus, string> = { TODO: 'To do', IN_PROGRESS: 'In progress', DONE: 'Done' };

interface Props {
  task: Task;
  onStatus: (status: TaskStatus) => void;
  onDelete: () => void;
}

export function TaskItem({ task, onStatus, onDelete }: Props) {
  return (
    <li className={`card task status-${task.status.toLowerCase()}`}>
      <div className="task-main">
        <strong>{task.title}</strong>
        {task.description && <p className="muted">{task.description}</p>}
        <span className="muted small">Created {new Date(task.createdAt).toLocaleString()}</span>
      </div>
      <div className="task-actions">
        <select
          aria-label={`Status of ${task.title}`}
          value={task.status}
          onChange={(e) => onStatus(e.target.value as TaskStatus)}
        >
          {(Object.keys(LABELS) as TaskStatus[]).map((s) => (
            <option key={s} value={s}>
              {LABELS[s]}
            </option>
          ))}
        </select>
        <button className="danger" aria-label={`Delete ${task.title}`} onClick={onDelete}>
          Delete
        </button>
      </div>
    </li>
  );
}
