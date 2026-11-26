import { z } from 'zod';
import { ValidationError } from './errors';
import { TASK_STATUSES, type CreateTaskInput, type UpdateTaskInput } from './types';

const status = z.enum(TASK_STATUSES);
const title = z.string().trim().min(1, 'title must not be empty').max(200, 'title is too long');
const description = z.string().trim().max(2000, 'description is too long');

export const idSchema = z.string().uuid('id must be a UUID');

export const createTaskInputSchema = z
  .object({
    title,
    description: description.nullish(),
    status: status.nullish(),
  })
  .strict();

export const updateTaskInputSchema = z
  .object({
    id: idSchema,
    title: title.nullish(),
    description: description.nullish(),
    status: status.nullish(),
  })
  .strict()
  .refine(
    (v) => v.title != null || v.description !== undefined || v.status != null,
    'at least one of title, description or status must be provided',
  );

export const listTasksArgsSchema = z
  .object({
    status: status.nullish(),
    limit: z.number().int().min(1).max(100).nullish(),
    nextToken: z.string().max(512).nullish(),
  })
  .strict();

export function parseOrThrow<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const message = result.error.issues
      .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
      .join('; ');
    throw new ValidationError(message);
  }
  return result.data;
}

export function parseCreateTaskInput(input: unknown): CreateTaskInput {
  const v = parseOrThrow(createTaskInputSchema, input);
  return { title: v.title, description: v.description ?? null, status: v.status ?? undefined };
}

export function parseUpdateTaskInput(input: unknown): UpdateTaskInput {
  const v = parseOrThrow(updateTaskInputSchema, input);
  return {
    id: v.id,
    // `null` for title/status is treated as "not provided" (they are NOT NULL columns);
    // `null` for description explicitly clears it.
    title: v.title ?? undefined,
    description: v.description,
    status: v.status ?? undefined,
  };
}
