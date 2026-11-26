import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

let client: SecretsManagerClient | undefined;
const cache = new Map<string, { value: string; expiresAt: number }>();

/** Default cache TTL. Short enough that rotated secrets are picked up without a redeploy. */
const DEFAULT_TTL_MS = 5 * 60 * 1000;

function sm(): SecretsManagerClient {
  client ??= new SecretsManagerClient({});
  return client;
}

/**
 * Reads a secret from AWS Secrets Manager with in-memory caching so warm Lambda
 * invocations don't call Secrets Manager on every request. Secret values are
 * never logged.
 */
export async function getSecretString(secretId: string, ttlMs = DEFAULT_TTL_MS): Promise<string> {
  const cached = cache.get(secretId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const res = await sm().send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!res.SecretString) throw new Error(`Secret ${secretId} has no SecretString`);
  cache.set(secretId, { value: res.SecretString, expiresAt: Date.now() + ttlMs });
  return res.SecretString;
}

export interface DbCredentials {
  username: string;
  password: string;
}

/** Parses an RDS-style JSON secret ({"username": "...", "password": "..."}). */
export async function getDbCredentials(secretId: string): Promise<DbCredentials> {
  const parsed = JSON.parse(await getSecretString(secretId)) as Partial<DbCredentials>;
  if (!parsed.username || !parsed.password) {
    throw new Error(`Secret ${secretId} is missing username/password`);
  }
  return { username: parsed.username, password: parsed.password };
}

/** Test hook. */
export function clearSecretCache(): void {
  cache.clear();
}
