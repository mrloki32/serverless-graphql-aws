import {
  createTask,
  deleteTask,
  getTask,
  getTaskStats,
  idSchema,
  parseCreateTaskInput,
  parseOrThrow,
  parseUpdateTaskInput,
  pingDatabase,
  recordAudit,
  updateTask,
  withTransaction,
} from '@gqlapp/core';
import type pg from 'pg';
import { z } from 'zod';

export interface Context {
  pool: pg.Pool;
}

const ownerSchema = z.string().min(1).max(128);

export const resolvers = {
  Query: {
    health: async (_: unknown, __: unknown, ctx: Context) => ((await pingDatabase(ctx.pool)) ? 'ok' : 'degraded'),

    task: (_: unknown, args: { owner: string; id: string }, ctx: Context) =>
      getTask(ctx.pool, parseOrThrow(ownerSchema, args.owner), parseOrThrow(idSchema, args.id)),

    taskStats: (_: unknown, args: { owner: string }, ctx: Context) =>
      getTaskStats(ctx.pool, parseOrThrow(ownerSchema, args.owner)),
  },

  // Every write and its audit record commit atomically.
  Mutation: {
    createTask: (_: unknown, args: { owner: string; input: unknown }, ctx: Context) => {
      const owner = parseOrThrow(ownerSchema, args.owner);
      const input = parseCreateTaskInput(args.input);
      return withTransaction(ctx.pool, async (c) => {
        const task = await createTask(c, owner, input);
        await recordAudit(c, owner, 'CREATED', task);
        return task;
      });
    },

    updateTask: (_: unknown, args: { owner: string; input: unknown }, ctx: Context) => {
      const owner = parseOrThrow(ownerSchema, args.owner);
      const input = parseUpdateTaskInput({ ...(args.input as object) });
      return withTransaction(ctx.pool, async (c) => {
        const task = await updateTask(c, owner, input);
        if (task) await recordAudit(c, owner, 'UPDATED', task);
        return task;
      });
    },

    deleteTask: (_: unknown, args: { owner: string; id: string }, ctx: Context) => {
      const owner = parseOrThrow(ownerSchema, args.owner);
      const id = parseOrThrow(idSchema, args.id);
      return withTransaction(ctx.pool, async (c) => {
        const task = await deleteTask(c, owner, id);
        if (task) await recordAudit(c, owner, 'DELETED', task);
        return task;
      });
    },
  },
};
