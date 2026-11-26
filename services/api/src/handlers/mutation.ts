import {
  idSchema,
  NotFoundError,
  parseCreateTaskInput,
  parseOrThrow,
  parseUpdateTaskInput,
  type Task,
  type TaskChange,
} from '@gqlapp/core';
import { callInternal } from '../lib/internal-client';
import { createResolver, requireUserSub } from '../lib/resolver';

process.env.SERVICE_NAME ??= 'api-mutation';

const TASK_FIELDS = 'id owner title description status createdAt updatedAt';

/**
 * Mutation.* resolver. Input is validated here (fail fast, cheap), then the write
 * is delegated to the private GraphQL server, which owns the write path to RDS
 * (transaction + audit trail). The returned TaskChange is what AppSync fans out to
 * `onTaskChanged` subscribers.
 *
 * The owner ALWAYS comes from the verified Cognito identity, never from client input.
 */
export const handler = createResolver({
  createTask: async (event): Promise<TaskChange> => {
    const owner = requireUserSub(event);
    const input = parseCreateTaskInput(event.arguments?.input);
    const data = await callInternal<{ createTask: Task }>(
      `mutation Create($owner: ID!, $input: CreateTaskInput!) { createTask(owner: $owner, input: $input) { ${TASK_FIELDS} } }`,
      { owner, input },
    );
    return { action: 'CREATED', owner, task: data.createTask };
  },

  updateTask: async (event): Promise<TaskChange> => {
    const owner = requireUserSub(event);
    const input = parseUpdateTaskInput(event.arguments?.input);
    const data = await callInternal<{ updateTask: Task | null }>(
      `mutation Update($owner: ID!, $input: UpdateTaskInput!) { updateTask(owner: $owner, input: $input) { ${TASK_FIELDS} } }`,
      { owner, input },
    );
    if (!data.updateTask) throw new NotFoundError('Task not found');
    return { action: 'UPDATED', owner, task: data.updateTask };
  },

  deleteTask: async (event): Promise<TaskChange> => {
    const owner = requireUserSub(event);
    const id = parseOrThrow(idSchema, event.arguments?.id);
    const data = await callInternal<{ deleteTask: Task | null }>(
      `mutation Delete($owner: ID!, $id: ID!) { deleteTask(owner: $owner, id: $id) { ${TASK_FIELDS} } }`,
      { owner, id },
    );
    if (!data.deleteTask) throw new NotFoundError('Task not found');
    return { action: 'DELETED', owner, task: data.deleteTask };
  },
});
