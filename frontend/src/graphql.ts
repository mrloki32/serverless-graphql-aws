export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE';
export type ChangeAction = 'CREATED' | 'UPDATED' | 'DELETED';

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
}

export interface TaskChange {
  action: ChangeAction;
  owner: string;
  task: Task;
}

export interface TaskStats {
  total: number;
  todo: number;
  inProgress: number;
  done: number;
}

const TASK_FIELDS = 'id title description status createdAt updatedAt';
// AppSync pushes to subscribers ONLY the fields selected by the mutation, so every
// mutation selects the full TaskChange shape the subscription asks for.
const CHANGE_FIELDS = `action owner task { ${TASK_FIELDS} }`;

export const LIST_TASKS = `query ListTasks($status: TaskStatus, $limit: Int, $nextToken: String) {
  tasks(status: $status, limit: $limit, nextToken: $nextToken) { items { ${TASK_FIELDS} } nextToken }
}`;
export const TASK_STATS = `query TaskStats { taskStats { total todo inProgress done } }`;
export const CREATE_TASK = `mutation CreateTask($input: CreateTaskInput!) { createTask(input: $input) { ${CHANGE_FIELDS} } }`;
export const UPDATE_TASK = `mutation UpdateTask($input: UpdateTaskInput!) { updateTask(input: $input) { ${CHANGE_FIELDS} } }`;
export const DELETE_TASK = `mutation DeleteTask($id: ID!) { deleteTask(id: $id) { ${CHANGE_FIELDS} } }`;
export const ON_TASK_CHANGED = `subscription OnTaskChanged($owner: ID!) { onTaskChanged(owner: $owner) { ${CHANGE_FIELDS} } }`;

export class GraphQLRequestError extends Error {
  constructor(
    message: string,
    public readonly errorType?: string,
  ) {
    super(message);
    this.name = 'GraphQLRequestError';
  }
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; errorType?: string }>;
}

/** Minimal AppSync client: the Cognito access token goes in the Authorization header. */
export function createClient(url: string, getToken: () => string | undefined) {
  return async function request<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const token = getToken();
    if (!token) throw new GraphQLRequestError('You are signed out', 'UNAUTHORIZED');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: token },
      body: JSON.stringify({ query, variables }),
    });
    const body = (await res.json().catch(() => ({}))) as GraphQLResponse<T>;
    const first = body.errors?.[0];
    if (first) throw new GraphQLRequestError(first.message, first.errorType);
    if (!res.ok || !body.data) throw new GraphQLRequestError(`Request failed (HTTP ${res.status})`);
    return body.data;
  };
}

export type GraphQLRequest = ReturnType<typeof createClient>;
