import { NotFoundError } from '@gqlapp/core';
import { GraphQLError } from 'graphql';
import type { AddressInfo } from 'node:net';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, formatError, tokenMatches } from '../src/server';

const TOKEN = 'test-internal-token';
const fakePool = { query: async () => ({ rows: [{ '?column?': 1 }] }) } as unknown as pg.Pool;

describe('graphql-server http layer', () => {
  let base: string;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    const { httpServer, apollo } = await createServer({ pool: fakePool, internalToken: TOKEN, introspection: false });
    await new Promise<void>((r) => httpServer.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
    stop = () => apollo.stop();
  });
  afterAll(async () => stop());

  const gql = (query: string, token?: string, method = 'POST') =>
    fetch(`${base}/graphql`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { 'x-internal-token': token } : {}) },
      body: method === 'POST' ? JSON.stringify({ query }) : undefined,
    });

  it('serves an unauthenticated liveness probe', async () => {
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
  });

  it('rejects requests without the internal token', async () => {
    expect((await gql('{ health }')).status).toBe(401);
    expect((await gql('{ health }', 'wrong')).status).toBe(401);
  });

  it('only accepts POST', async () => {
    expect((await gql('', TOKEN, 'GET')).status).toBe(405);
  });

  it('executes queries with a valid token', async () => {
    const res = await gql('{ health }', TOKEN);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { health: 'ok' } });
  });

  it('returns business validation errors with their code', async () => {
    const res = await gql('{ task(owner: "u1", id: "not-a-uuid") { id } }', TOKEN);
    const body = (await res.json()) as { errors: Array<{ message: string; extensions: { code: string } }> };
    expect(body.errors[0]).toMatchObject({ message: 'id must be a UUID', extensions: { code: 'VALIDATION' } });
  });

  it('disables introspection in production mode', async () => {
    const res = await gql('{ __schema { types { name } } }', TOKEN);
    const body = (await res.json()) as { errors?: unknown[] };
    expect(body.errors?.length).toBeGreaterThan(0);
  });
});

describe('tokenMatches', () => {
  it('compares in constant time and handles bad input', () => {
    expect(tokenMatches('abc', 'abc')).toBe(true);
    expect(tokenMatches('abc', 'abcd')).toBe(false);
    expect(tokenMatches('abc', undefined)).toBe(false);
    expect(tokenMatches('abc', ['abc'])).toBe(false);
  });
});

describe('formatError', () => {
  it('passes AppErrors through with their code', () => {
    const err = new GraphQLError('x', { originalError: new NotFoundError('Task not found') });
    expect(formatError({ message: 'x', extensions: { code: 'INTERNAL_SERVER_ERROR' } }, err)).toMatchObject({
      message: 'Task not found',
      extensions: { code: 'NOT_FOUND' },
    });
  });

  it('masks unexpected internal errors', () => {
    const err = new GraphQLError('x', { originalError: new Error('connection to 10.0.3.7 refused') });
    const out = formatError({ message: 'connection to 10.0.3.7 refused', extensions: { code: 'INTERNAL_SERVER_ERROR' } }, err);
    expect(out.message).toBe('Internal server error');
  });
});
