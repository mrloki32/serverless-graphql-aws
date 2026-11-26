import { ApolloServer, HeaderMap } from '@apollo/server';
import { ApolloServerPluginLandingPageDisabled } from '@apollo/server/plugin/disabled';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import { isAppError, logger } from '@gqlapp/core';
import type { GraphQLFormattedError } from 'graphql';
import { createHash, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import type pg from 'pg';
import { resolvers, type Context } from './resolvers';
import { typeDefs } from './schema';

const MAX_BODY_BYTES = 100 * 1024;

export interface CreateServerOptions {
  pool: pg.Pool;
  internalToken: string;
  introspection: boolean;
}

function digest(v: string): Buffer {
  return createHash('sha256').update(v).digest();
}

/** Constant-time comparison (hashing first removes the length side channel). */
export function tokenMatches(expected: string, provided: string | string[] | undefined): boolean {
  if (typeof provided !== 'string' || provided.length === 0) return false;
  return timingSafeEqual(digest(expected), digest(provided));
}

/** Follows GraphQLError.originalError links down to the error that was actually thrown. */
function rootCause(error: unknown): unknown {
  let current = error;
  for (let i = 0; i < 10; i++) {
    const next = (current as { originalError?: unknown } | null)?.originalError;
    if (!next) break;
    current = next;
  }
  return current;
}

/** Only deliberate AppErrors and GraphQL validation errors reach the caller; everything else is masked. */
export function formatError(formatted: GraphQLFormattedError, error: unknown): GraphQLFormattedError {
  const original = rootCause(error);
  if (isAppError(original)) {
    return { ...formatted, message: original.message, extensions: { code: original.code } };
  }
  if (formatted.extensions?.code === 'INTERNAL_SERVER_ERROR') {
    logger.error('Unhandled resolver error', {
      path: formatted.path,
      error: original instanceof Error ? original.message : String(original),
    });
    return { message: 'Internal server error', path: formatted.path, extensions: { code: 'INTERNAL_SERVER_ERROR' } };
  }
  return formatted;
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function createServer(opts: CreateServerOptions) {
  const httpServer = http.createServer();
  // Must exceed the ALB idle timeout (60s) to avoid 502s on reused connections.
  httpServer.keepAliveTimeout = 65_000;
  httpServer.headersTimeout = 66_000;

  const apollo = new ApolloServer<Context>({
    typeDefs,
    resolvers,
    introspection: opts.introspection,
    includeStacktraceInErrorResponses: false,
    formatError,
    plugins: [ApolloServerPluginLandingPageDisabled(), ApolloServerPluginDrainHttpServer({ httpServer })],
  });
  await apollo.start();

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://internal');

    // Liveness for the ALB target group / ECS container health check. Deliberately
    // does not touch the DB so a DB blip doesn't cause every task to be replaced.
    if (url.pathname === '/healthz') return send(res, 200, { status: 'ok' });
    if (url.pathname !== '/graphql') return send(res, 404, { error: 'not found' });
    if (!tokenMatches(opts.internalToken, req.headers['x-internal-token'])) {
      logger.warn('Rejected request with missing/invalid internal token', { ip: req.socket.remoteAddress });
      return send(res, 401, { error: 'unauthorized' });
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });

    const raw = await readBody(req);
    if (raw === null) return send(res, 413, { error: 'payload too large' });
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return send(res, 400, { error: 'invalid JSON body' });
    }

    const headers = new HeaderMap();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    }

    const result = await apollo.executeHTTPGraphQLRequest({
      httpGraphQLRequest: { method: 'POST', headers, search: url.search, body },
      context: async () => ({ pool: opts.pool }),
    });

    for (const [k, v] of result.headers) res.setHeader(k, v);
    res.statusCode = result.status ?? 200;
    if (result.body.kind === 'complete') {
      res.end(result.body.string);
    } else {
      for await (const chunk of result.body.asyncIterator) res.write(chunk);
      res.end();
    }
  }

  httpServer.on('request', (req, res) => {
    handle(req, res).catch((err: Error) => {
      logger.error('Request handling failed', { error: err.message });
      if (!res.headersSent) send(res, 500, { error: 'internal error' });
      else res.end();
    });
  });

  return { httpServer, apollo };
}
