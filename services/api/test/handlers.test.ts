import type { Task } from '@gqlapp/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolverEvent } from '../src/lib/resolver';

const callInternal = vi.fn();
const fakeDb = { query: vi.fn() };

vi.mock('../src/lib/internal-client', () => ({ callInternal: (...a: unknown[]) => callInternal(...a) }));
vi.mock('../src/lib/db', () => ({ withReadPool: (fn: (db: unknown) => unknown) => fn(fakeDb) }));

const { handler: query } = await import('../src/handlers/query');
const { handler: mutation } = await import('../src/handlers/mutation');
const { handler: subscription } = await import('../src/handlers/subscription');

const USER = 'a1b2c3d4-0000-4000-8000-000000000001';
const TASK_ID = '2f1c1a8e-4c1b-4a43-9d8a-0b6f6f0f5d11';

function event(parentTypeName: string, fieldName: string, args: object, identity: object | null = { sub: USER }) {
  return { parentTypeName, fieldName, arguments: args, identity } as ResolverEvent;
}

const task: Task = {
  id: TASK_ID,
  owner: USER,
  title: 'Write docs',
  description: null,
  status: 'TODO',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  callInternal.mockReset();
  fakeDb.query.mockReset();
});

describe('query handler', () => {
  it('lists only the caller’s tasks', async () => {
    fakeDb.query.mockResolvedValue({
      rows: [{ ...task, created_at: new Date(task.createdAt), updated_at: new Date(task.updatedAt) }],
    });
    const res = await query(event('Query', 'tasks', { limit: 10 }));
    expect(res).toMatchObject({ data: { items: [{ id: TASK_ID }], nextToken: null } });
    expect(fakeDb.query.mock.calls[0]![1]![0]).toBe(USER);
  });

  it('returns an UNAUTHORIZED error (not a Lambda failure) without a Cognito identity', async () => {
    const res = await query(event('Query', 'tasks', {}, null));
    expect(res).toEqual({ error: { message: 'A signed-in user is required', type: 'UNAUTHORIZED' } });
  });

  it('returns a VALIDATION error for bad arguments', async () => {
    const res = await query(event('Query', 'tasks', { limit: 1000 }));
    expect(res).toMatchObject({ error: { type: 'VALIDATION' } });
  });

  it('reports degraded health when the private server is down', async () => {
    fakeDb.query.mockResolvedValue({ rows: [] });
    callInternal.mockRejectedValue(new Error('down'));
    const res = await query(event('Query', 'health', {}, { accountId: '123' }));
    expect(res).toMatchObject({ data: { status: 'degraded', database: 'ok', graphqlServer: 'unreachable' } });
  });

  it('masks unexpected errors', async () => {
    fakeDb.query.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.3.7:5432'));
    await expect(query(event('Query', 'task', { id: TASK_ID }))).rejects.toThrow('Internal server error');
  });
});

describe('mutation handler', () => {
  it('uses the authenticated owner, never one from input', async () => {
    callInternal.mockResolvedValue({ createTask: task });
    const res = await mutation(event('Mutation', 'createTask', { input: { title: 'Write docs' } }));
    expect(res).toEqual({ data: { action: 'CREATED', owner: USER, task } });
    expect(callInternal.mock.calls[0]![1]).toMatchObject({ owner: USER });

    const spoof = await mutation(event('Mutation', 'createTask', { input: { title: 'x', owner: 'victim' } }));
    expect(spoof).toMatchObject({ error: { type: 'VALIDATION' } });
  });

  it('maps a missing task to NOT_FOUND', async () => {
    callInternal.mockResolvedValue({ deleteTask: null });
    const res = await mutation(event('Mutation', 'deleteTask', { id: TASK_ID }));
    expect(res).toEqual({ error: { message: 'Task not found', type: 'NOT_FOUND' } });
  });
});

describe('subscription handler', () => {
  it('allows subscribing to your own changes', async () => {
    expect(await subscription(event('Subscription', 'onTaskChanged', { owner: USER }))).toEqual({ data: null });
  });

  it('rejects subscribing to someone else’s changes', async () => {
    const res = await subscription(event('Subscription', 'onTaskChanged', { owner: 'someone-else' }));
    expect(res).toMatchObject({ error: { type: 'UNAUTHORIZED' } });
  });
});
