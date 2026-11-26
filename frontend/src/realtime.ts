/**
 * Tiny client for the AppSync real-time WebSocket protocol
 * (https://docs.aws.amazon.com/appsync/latest/devguide/real-time-websocket-client.html).
 * Avoids pulling in the full Amplify library for one subscription.
 *
 * Handles: connection_init/ack, keep-alive timeout, start/stop, reconnect with
 * exponential backoff (fetching a fresh token on every reconnect).
 */
export type RealtimeStatus = 'connecting' | 'live' | 'reconnecting' | 'closed';

export interface SubscribeOptions<T> {
  graphqlUrl: string;
  realtimeUrl: string;
  getToken: () => string | undefined;
  query: string;
  variables: Record<string, unknown>;
  onData: (data: T) => void;
  onError?: (message: string) => void;
  onStatus?: (status: RealtimeStatus) => void;
  /** Injected in tests. */
  WebSocketImpl?: typeof WebSocket;
}

export interface Subscription {
  close(): void;
}

const b64 = (value: unknown) => btoa(JSON.stringify(value));

export function buildRealtimeUrl(realtimeUrl: string, host: string, token: string): string {
  return `${realtimeUrl}?header=${b64({ host, Authorization: token })}&payload=e30=`;
}

export function subscribe<T>(opts: SubscribeOptions<T>): Subscription {
  const WS = opts.WebSocketImpl ?? WebSocket;
  const host = new URL(opts.graphqlUrl).host;
  const id = crypto.randomUUID();
  let ws: WebSocket | undefined;
  let closed = false;
  let attempt = 0;
  let kaTimer: ReturnType<typeof setTimeout> | undefined;
  let kaTimeoutMs = 300_000;

  const setStatus = (s: RealtimeStatus) => opts.onStatus?.(s);

  const armKeepAlive = () => {
    clearTimeout(kaTimer);
    // No keep-alive within the server-advertised window -> connection is dead.
    kaTimer = setTimeout(() => ws?.close(), kaTimeoutMs);
  };

  const scheduleReconnect = () => {
    if (closed) return;
    setStatus('reconnecting');
    const delay = Math.min(30_000, 1_000 * 2 ** attempt) + Math.random() * 500;
    attempt += 1;
    setTimeout(connect, delay);
  };

  function connect() {
    if (closed) return;
    const token = opts.getToken();
    if (!token) return scheduleReconnect();
    setStatus(attempt === 0 ? 'connecting' : 'reconnecting');

    const socket = new WS(buildRealtimeUrl(opts.realtimeUrl, host, token), ['graphql-ws']);
    ws = socket;

    socket.onopen = () => socket.send(JSON.stringify({ type: 'connection_init' }));

    socket.onmessage = (event: MessageEvent) => {
      const msg = JSON.parse(String(event.data)) as {
        type: string;
        id?: string;
        payload?: { connectionTimeoutMs?: number; data?: T; errors?: Array<{ message?: string; errorType?: string }> };
      };
      switch (msg.type) {
        case 'connection_ack':
          kaTimeoutMs = msg.payload?.connectionTimeoutMs ?? kaTimeoutMs;
          armKeepAlive();
          socket.send(
            JSON.stringify({
              id,
              type: 'start',
              payload: {
                data: JSON.stringify({ query: opts.query, variables: opts.variables }),
                extensions: { authorization: { host, Authorization: opts.getToken() ?? token } },
              },
            }),
          );
          break;
        case 'ka':
          armKeepAlive();
          break;
        case 'start_ack':
          attempt = 0;
          setStatus('live');
          break;
        case 'data':
          if (msg.id === id && msg.payload?.data) opts.onData(msg.payload.data);
          break;
        case 'error':
        case 'connection_error': {
          const err = msg.payload?.errors?.[0];
          opts.onError?.(err?.message ?? err?.errorType ?? 'Subscription error');
          break;
        }
      }
    };

    socket.onclose = () => {
      clearTimeout(kaTimer);
      if (ws === socket) scheduleReconnect();
    };
  }

  connect();

  return {
    close() {
      closed = true;
      clearTimeout(kaTimer);
      if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'stop', id }));
      ws?.close();
      setStatus('closed');
    },
  };
}
