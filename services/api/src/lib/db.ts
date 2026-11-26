import { clearSecretCache, createPool, getDbCredentials, logger } from '@gqlapp/core';
import type pg from 'pg';
import { config } from './config';

let readPool: Promise<pg.Pool> | undefined;

async function buildReadPool(): Promise<pg.Pool> {
  const creds = await getDbCredentials(config.readOnlySecretArn);
  return createPool({
    host: config.dbReadHost,
    port: config.dbPort,
    database: config.dbName,
    user: creds.username,
    password: creds.password,
    ssl: config.dbSsl,
    // A Lambda container serves one request at a time, so one connection is enough.
    // Worst case = reserved concurrency x 1 (see docs/database.md, connection budget).
    max: 1,
    applicationName: process.env.AWS_LAMBDA_FUNCTION_NAME ?? 'lambda',
  });
}

/** Reuses the pool across warm invocations (module scope survives between invocations). */
function getReadPool(): Promise<pg.Pool> {
  readPool ??= buildReadPool().catch((err) => {
    readPool = undefined;
    throw err;
  });
  return readPool;
}

const AUTH_FAILED = '28P01';

/**
 * Runs `fn` with the read-only pool (app_ro user, RDS read endpoint). If the
 * password was rotated since the pool was built, the pool and secret cache are
 * reset and the call is retried once with fresh credentials.
 */
export async function withReadPool<T>(fn: (pool: pg.Pool) => Promise<T>): Promise<T> {
  try {
    return await fn(await getReadPool());
  } catch (err) {
    if ((err as { code?: string }).code !== AUTH_FAILED) throw err;
    logger.warn('DB authentication failed; refreshing credentials');
    const stale = readPool;
    readPool = undefined;
    clearSecretCache();
    void stale?.then((p) => p.end()).catch(() => undefined);
    return fn(await getReadPool());
  }
}
