import { describe, expect, it, vi } from 'vitest';
import { parseConfig } from './config';
import type { Task } from './graphql';
import { buildRealtimeUrl, subscribe } from './realtime';
import { applyChange } from './taskState';

const task = (id: string, createdAt: string, extra: Partial<Task> = {}): Task => ({
  id,
  title: id,
  description: null,
  status: 'TODO',
  createdAt,
  updatedAt: createdAt,
  ...extra,
});

describe('parseConfig', () => {
  const valid = {
    stage: 'staging',
    region: 'us-east-1',
    graphqlUrl: 'https://x.appsync-api.us-east-1.amazonaws.com/graphql',
    realtimeUrl: 'wss://x.appsync-realtime-api.us-east-1.amazonaws.com/graphql',
    userPoolId: 'us-east-1_abc',
    userPoolClientId: 'client',
    cognitoDomain: 'd.auth.us-east-1.amazoncognito.com',
    version: 'abc123',
  };
  it('accepts a complete config', () => expect(parseConfig(valid)).toEqual(valid));
  it('rejects missing keys and insecure URLs', () => {
    expect(() => parseConfig({ ...valid, userPoolId: '' })).toThrow(/userPoolId/);
    expect(() => parseConfig({ ...valid, graphqlUrl: 'http://x/graphql' })).toThrow(/https/);
  });
});

describe('applyChange', () => {
  const a = task('a', '2026-01-01T00:00:00.000Z');
  const b = task('b', '2026-01-02T00:00:00.000Z');

  it('inserts newest first and is idempotent', () => {
    const once = applyChange([a], { action: 'CREATED', owner: 'u', task: b }, null);
    expect(once.map((t) => t.id)).toEqual(['b', 'a']);
    expect(applyChange(once, { action: 'CREATED', owner: 'u', task: b }, null)).toHaveLength(2);
  });

  it('removes deleted tasks and tasks that no longer match the filter', () => {
    expect(applyChange([a, b], { action: 'DELETED', owner: 'u', task: a }, null)).toEqual([b]);
    const done = { ...a, status: 'DONE' as const, updatedAt: '2026-01-03T00:00:00.000Z' };
    expect(applyChange([a], { action: 'UPDATED', owner: 'u', task: done }, 'TODO')).toEqual([]);
  });

  it('ignores stale updates', () => {
    const newer = { ...a, title: 'new', updatedAt: '2026-01-05T00:00:00.000Z' };
    const older = { ...a, title: 'old', updatedAt: '2026-01-04T00:00:00.000Z' };
    expect(applyChange([newer], { action: 'UPDATED', owner: 'u', task: older }, null)[0]!.title).toBe('new');
  });
});

describe('realtime', () => {
  it('encodes the AppSync auth header into the connection URL', () => {
    const url = buildRealtimeUrl('wss://rt.example/graphql', 'api.example', 'jwt');
    const header = new URL(url).searchParams.get('header')!;
    expect(JSON.parse(atob(header))).toEqual({ host: 'api.example', Authorization: 'jwt' });
    expect(url).toContain('payload=e30=');
  });

  it('runs the init -> ack -> start -> data handshake', () => {
    const sent: Array<Record<string, unknown>> = [];
    let socket!: FakeSocket;
    class FakeSocket {
      readyState = 1;
      onopen?: () => void;
      onmessage?: (e: { data: string }) => void;
      onclose?: () => void;
      constructor(
        public url: string,
        public protocols: string[],
      ) {
        socket = this; // eslint-disable-line @typescript-eslint/no-this-alias
      }
      send(m: string) {
        sent.push(JSON.parse(m));
      }
      close() {}
    }
    const onData = vi.fn();
    const onStatus = vi.fn();
    const sub = subscribe({
      graphqlUrl: 'https://api.example/graphql',
      realtimeUrl: 'wss://rt.example/graphql',
      getToken: () => 'jwt',
      query: 'subscription { x }',
      variables: { owner: 'u' },
      onData,
      onStatus,
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
    });

    expect(socket.protocols).toEqual(['graphql-ws']);
    socket.onopen!();
    expect(sent[0]).toEqual({ type: 'connection_init' });
    socket.onmessage!({ data: JSON.stringify({ type: 'connection_ack', payload: { connectionTimeoutMs: 300000 } }) });
    const start = sent[1] as { id: string; type: string; payload: { data: string } };
    expect(start.type).toBe('start');
    expect(JSON.parse(start.payload.data)).toEqual({ query: 'subscription { x }', variables: { owner: 'u' } });
    socket.onmessage!({ data: JSON.stringify({ type: 'start_ack', id: start.id }) });
    expect(onStatus).toHaveBeenLastCalledWith('live');
    socket.onmessage!({ data: JSON.stringify({ type: 'data', id: start.id, payload: { data: { x: 1 } } }) });
    expect(onData).toHaveBeenCalledWith({ x: 1 });

    sub.close();
    expect(sent.at(-1)).toEqual({ type: 'stop', id: start.id });
  });
});
