import type pg from 'pg';
import { logger } from './logger';
import { scramSha256Verifier } from './scram';

/**
 * Forward-only, idempotent schema migrations.
 *
 * Rules (see docs/database.md):
 *  - Never edit a migration that has shipped; add a new one.
 *  - Migrations must be backward compatible with the currently deployed code
 *    (expand -> deploy -> contract), because they run BEFORE traffic shifts
 *    to the new Lambda version (CodeDeploy BeforeAllowTraffic hook).
 */
export interface Migration {
  id: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    id: '001_create_tasks',
    sql: `
      CREATE TABLE IF NOT EXISTS tasks (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner       text NOT NULL,
        title       text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
        description text CHECK (description IS NULL OR char_length(description) <= 2000),
        status      text NOT NULL DEFAULT 'TODO' CHECK (status IN ('TODO', 'IN_PROGRESS', 'DONE')),
        -- millisecond precision so ISO timestamps round-trip exactly in pagination cursors
        created_at  timestamptz NOT NULL DEFAULT date_trunc('milliseconds', clock_timestamp()),
        updated_at  timestamptz NOT NULL DEFAULT date_trunc('milliseconds', clock_timestamp())
      );
      CREATE INDEX IF NOT EXISTS tasks_owner_created_idx ON tasks (owner, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS tasks_owner_status_created_idx ON tasks (owner, status, created_at DESC, id DESC);
    `,
  },
  {
    id: '002_create_task_audit',
    sql: `
      CREATE TABLE IF NOT EXISTS task_audit (
        id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        task_id    uuid NOT NULL,
        owner      text NOT NULL,
        action     text NOT NULL CHECK (action IN ('CREATED', 'UPDATED', 'DELETED')),
        payload    jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS task_audit_task_idx ON task_audit (task_id, created_at DESC);
    `,
  },
];

/** Arbitrary constant so concurrent migrators (e.g. 3 CodeDeploy hooks) serialize. */
const MIGRATION_LOCK_ID = 727_001;

type Client = pg.Client | pg.PoolClient;

export async function runMigrations(client: Client, migrations: Migration[] = MIGRATIONS): Promise<string[]> {
  await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    const { rows } = await client.query<{ id: string }>('SELECT id FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.id));
    const ran: string[] = [];

    for (const m of migrations) {
      if (applied.has(m.id)) continue;
      logger.info('Applying migration', { migration: m.id });
      await client.query('BEGIN');
      try {
        await client.query(m.sql);
        await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [m.id]);
        await client.query('COMMIT');
        ran.push(m.id);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${m.id} failed: ${(err as Error).message}`);
      }
    }
    return ran;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
  }
}

export interface AppRole {
  username: string;
  password: string;
  access: 'readwrite' | 'readonly';
}

const IDENT_RE = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * Creates/updates the least-privilege application roles:
 *  - app_rw: DML only (used by the Fargate GraphQL server)
 *  - app_ro: SELECT only (used by the query Lambda / read replica)
 * Neither role can run DDL. Passwords are sent as SCRAM verifiers, so plaintext
 * never appears in SQL text or in PostgreSQL logs. Re-running this after a secret
 * rotation updates the password.
 */
export async function ensureAppRoles(client: Client, database: string, roles: AppRole[]): Promise<void> {
  if (!IDENT_RE.test(database)) throw new Error('Invalid database name');
  for (const role of roles) {
    if (!IDENT_RE.test(role.username)) throw new Error(`Invalid role name ${role.username}`);
    const r = role.username;
    const verifier = client.escapeLiteral(scramSha256Verifier(role.password));

    await client.query(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${r}') THEN CREATE ROLE ${r} LOGIN; END IF;
       END $$;`,
    );
    await client.query(`ALTER ROLE ${r} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${verifier}`);
    await client.query(`GRANT CONNECT ON DATABASE ${database} TO ${r}`);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${r}`);

    if (role.access === 'readwrite') {
      await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${r}`);
      await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${r}`);
      await client.query(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${r}`,
      );
      await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${r}`);
    } else {
      await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${r}`);
      await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ${r}`);
    }
    // Application roles have no business with migration bookkeeping.
    await client.query(`REVOKE ALL ON schema_migrations FROM ${r}`);
    logger.info('Ensured application role', { role: r, access: role.access });
  }
}
