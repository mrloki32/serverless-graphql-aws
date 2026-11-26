import { NotFoundError, UpstreamError, ValidationError } from '@gqlapp/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@gqlapp/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gqlapp/core')>()),
  getSecretString: vi.fn(async () => 'token-from-secrets-manager'),
}));

const { callInternal } = await import('../src/lib/internal-client');

const fetchMock = vi.fn();

beforeEach(() => {
  process.env.INTERNAL_API_URL = 'http://internal-alb.local';
  process.env.INTERNAL_API_TOKEN_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:111111111111:secret:token';
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

const reply = (status: number, body: unknown) =>
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

describe('callInternal', () => {
  it('sends the internal token and returns data', async () => {
    reply(200, { data: { health: 'ok' } });
    await expect(callInternal('{ health }')).resolves.toEqual({ health: 'ok' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://internal-alb.local/graphql');
    expect(init.headers['x-internal-token']).toBe('token-from-secrets-manager');
  });

  it('maps business errors', async () => {
    reply(200, { data: null, errors: [{ message: 'title is too long', extensions: { code: 'VALIDATION' } }] });
    await expect(callInternal('m')).rejects.toBeInstanceOf(ValidationError);
    reply(200, { data: null, errors: [{ message: 'gone', extensions: { code: 'NOT_FOUND' } }] });
    await expect(callInternal('m')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('hides internal failures behind UpstreamError', async () => {
    reply(200, { data: null, errors: [{ message: 'Internal server error', extensions: { code: 'INTERNAL_SERVER_ERROR' } }] });
    await expect(callInternal('q')).rejects.toBeInstanceOf(UpstreamError);
    reply(401, { error: 'unauthorized' });
    await expect(callInternal('q')).rejects.toBeInstanceOf(UpstreamError);
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(callInternal('q')).rejects.toBeInstanceOf(UpstreamError);
  });
});
