import { isAppError, logger, UnauthorizedError } from '@gqlapp/core';

/** Payload built by resolvers/lambda-invoke.js (AppSync JS request function). */
export interface ResolverEvent<TArgs = Record<string, unknown>> {
  parentTypeName: string;
  fieldName: string;
  arguments: TArgs;
  identity: Record<string, unknown> | null;
}

export type ResolverResult = { data: unknown } | { error: { message: string; type: string } };

type FieldHandler = (event: ResolverEvent<any>) => Promise<unknown>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The Cognito user id (`sub`) of the caller; throws if the caller is not a Cognito user. */
export function requireUserSub(event: ResolverEvent<unknown>): string {
  const sub = event.identity?.sub;
  if (typeof sub !== 'string' || sub.length === 0) throw new UnauthorizedError('A signed-in user is required');
  return sub;
}

/**
 * Dispatches an AppSync field to its handler.
 *  - Expected failures (AppError) are returned as { error } -> GraphQL error for the
 *    client, but the invocation succeeds (no Lambda `Errors` metric, no canary rollback).
 *  - Unexpected failures are logged with detail and rethrown with a generic message,
 *    so internals (hostnames, SQL) never leak to clients.
 */
export function createResolver(handlers: Record<string, FieldHandler>) {
  return async (event: ResolverEvent): Promise<ResolverResult> => {
    const handler = handlers[event.fieldName];
    const field = `${event.parentTypeName}.${event.fieldName}`;
    if (!handler) {
      logger.error('No handler for field', { field });
      throw new Error('Internal server error');
    }
    try {
      return { data: await handler(event) };
    } catch (err) {
      if (isAppError(err)) {
        logger.info('Request rejected', { field, code: err.code, reason: err.message });
        return { error: { message: err.message, type: err.code } };
      }
      logger.error('Resolver failed', { field, error: (err as Error).message, stack: (err as Error).stack });
      throw new Error('Internal server error');
    }
  };
}
