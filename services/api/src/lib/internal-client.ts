import { getSecretString, logger, NotFoundError, UpstreamError, ValidationError } from '@gqlapp/core';
import { config } from './config';

interface GraphQLResponse<T> {
  data?: T | null;
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
}

const TIMEOUT_MS = 5_000;

/**
 * Calls the private GraphQL server (ECS Fargate behind an internal ALB). Reachable
 * only from inside the VPC (security groups) and authenticated with a shared token
 * stored in Secrets Manager. Business errors from the server are mapped back to
 * AppErrors; everything else becomes a generic UpstreamError.
 */
export async function callInternal<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const token = await getSecretString(config.internalTokenSecretArn);
  let res: Response;
  try {
    res = await fetch(`${config.internalApiUrl}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-token': token },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    logger.error('Private GraphQL server unreachable', { error: (err as Error).message });
    throw new UpstreamError();
  }

  let body: GraphQLResponse<T>;
  try {
    body = (await res.json()) as GraphQLResponse<T>;
  } catch {
    logger.error('Private GraphQL server returned a non-JSON response', { status: res.status });
    throw new UpstreamError();
  }

  const first = body.errors?.[0];
  if (first) {
    const code = first.extensions?.code;
    if (code === 'VALIDATION' || code === 'BAD_USER_INPUT') throw new ValidationError(first.message);
    if (code === 'NOT_FOUND') throw new NotFoundError(first.message);
    logger.error('Private GraphQL server returned an error', { status: res.status, code, message: first.message });
    throw new UpstreamError();
  }
  if (!res.ok || !body.data) {
    logger.error('Private GraphQL server request failed', { status: res.status });
    throw new UpstreamError();
  }
  return body.data;
}
