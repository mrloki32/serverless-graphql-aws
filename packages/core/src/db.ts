import pg from 'pg';
import { logger } from './logger';

export interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  /**
   * When true, TLS is required and the server certificate is verified.
   * The RDS CA bundle is provided via NODE_EXTRA_CA_CERTS
   * (Lambda: /var/runtime/ca-cert.pem, container: downloaded at image build).
   */
  ssl: boolean;
  /** Max connections per process. Keep small for Lambda (one request per container). */
  max?: number;
  applicationName?: string;
}

/** Anything that can run a query: a Pool, or a checked-out client inside a transaction. */
export type Queryable = Pick<pg.Pool, 'query'>;

export function createPool(cfg: DbConfig): pg.Pool {
  const pool = new pg.Pool({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    ssl: cfg.ssl ? { rejectUnauthorized: true } : false,
    max: cfg.max ?? 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000,
    application_name: cfg.applicationName ?? 'gqlapp',
  });
  // An idle client erroring (e.g. DB failover) must not crash the process.
  pool.on('error', (err) => logger.error('Idle database client error', { error: err.message }));
  return pool;
}

export async function withTransaction<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function pingDatabase(db: Queryable): Promise<boolean> {
  try {
    await db.query('SELECT 1');
    return true;
  } catch (err) {
    logger.warn('Database ping failed', { error: (err as Error).message });
    return false;
  }
}
