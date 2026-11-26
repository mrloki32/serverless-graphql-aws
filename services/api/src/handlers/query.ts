import {
  getTask,
  idSchema,
  listTasks,
  listTasksArgsSchema,
  parseOrThrow,
  pingDatabase,
  type TaskStats,
} from '@gqlapp/core';
import { config } from '../lib/config';
import { withReadPool } from '../lib/db';
import { callInternal } from '../lib/internal-client';
import { createResolver, requireUserSub } from '../lib/resolver';

process.env.SERVICE_NAME ??= 'api-query';

/**
 * Query.* resolver.
 *  - tasks / task   -> RDS directly (read-only DB user, read replica when enabled)
 *  - taskStats      -> private GraphQL server on ECS Fargate
 *  - health         -> checks both paths (used by CI/CD smoke tests via IAM auth)
 */
export const handler = createResolver({
  tasks: async (event) => {
    const owner = requireUserSub(event);
    const args = parseOrThrow(listTasksArgsSchema, event.arguments ?? {});
    return withReadPool((db) => listTasks(db, owner, args));
  },

  task: async (event) => {
    const owner = requireUserSub(event);
    const id = parseOrThrow(idSchema, event.arguments?.id);
    return withReadPool((db) => getTask(db, owner, id));
  },

  taskStats: async (event) => {
    const owner = requireUserSub(event);
    const data = await callInternal<{ taskStats: TaskStats }>(
      'query Stats($owner: ID!) { taskStats(owner: $owner) { total todo inProgress done } }',
      { owner },
    );
    return data.taskStats;
  },

  health: async () => {
    const [database, graphqlServer] = await Promise.all([
      withReadPool(pingDatabase).catch(() => false),
      callInternal<{ health: string }>('query { health }')
        .then((d) => d.health)
        .catch(() => 'unreachable'),
    ]);
    return {
      status: database && graphqlServer === 'ok' ? 'ok' : 'degraded',
      database: database ? 'ok' : 'unreachable',
      graphqlServer,
      version: config.version,
    };
  },
});
