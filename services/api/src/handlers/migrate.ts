import { CodeDeployClient, PutLifecycleEventHookExecutionStatusCommand } from '@aws-sdk/client-codedeploy';
import { ensureAppRoles, getDbCredentials, logger, runMigrations } from '@gqlapp/core';
import pg from 'pg';

process.env.SERVICE_NAME ??= 'api-migrate';

/**
 * Database migration function. Invoked two ways:
 *
 * 1. As the CodeDeploy BeforeAllowTraffic hook of every resolver function: runs
 *    after the new Lambda versions are created but BEFORE any traffic shifts to
 *    them. If migration fails, the hook reports `Failed`, CodeDeploy aborts the
 *    deployment and CloudFormation rolls the stack back - no traffic ever reaches
 *    code that expects a schema which does not exist.
 * 2. Directly by the CI/CD pipeline (`aws lambda invoke`) after the first deploy
 *    (a brand-new stack has no CodeDeploy deployment, hence no hook).
 *
 * Connects with the RDS-managed master secret straight to the DB instance (not the
 * proxy), applies migrations under an advisory lock, then (re)creates the
 * least-privilege app roles from their own secrets.
 */
interface HookEvent {
  DeploymentId?: string;
  LifecycleEventHookExecutionId?: string;
}

const codedeploy = new CodeDeployClient({});

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

async function migrate(): Promise<{ applied: string[] }> {
  const [master, rw, ro] = await Promise.all([
    getDbCredentials(env('DB_MASTER_SECRET_ARN')),
    getDbCredentials(env('DB_RW_SECRET_ARN')),
    getDbCredentials(env('DB_RO_SECRET_ARN')),
  ]);
  const database = env('DB_NAME');
  const client = new pg.Client({
    host: env('DB_INSTANCE_HOST'),
    port: Number(process.env.DB_PORT ?? 5432),
    database,
    user: master.username,
    password: master.password,
    ssl: (process.env.DB_SSL ?? 'true') === 'true' ? { rejectUnauthorized: true } : false,
    connectionTimeoutMillis: 10_000,
    application_name: 'migrate',
  });
  await client.connect();
  try {
    const applied = await runMigrations(client);
    await ensureAppRoles(client, database, [
      { username: rw.username, password: rw.password, access: 'readwrite' },
      { username: ro.username, password: ro.password, access: 'readonly' },
    ]);
    logger.info('Migration complete', { applied });
    return { applied };
  } finally {
    await client.end();
  }
}

export const handler = async (event: HookEvent = {}) => {
  const isHook = Boolean(event.DeploymentId && event.LifecycleEventHookExecutionId);
  let status: 'Succeeded' | 'Failed' = 'Succeeded';
  let result: { applied: string[] } | undefined;
  let failure: Error | undefined;

  try {
    result = await migrate();
  } catch (err) {
    status = 'Failed';
    failure = err as Error;
    logger.error('Migration failed', { error: failure.message, deploymentId: event.DeploymentId });
  }

  if (isHook) {
    await codedeploy.send(
      new PutLifecycleEventHookExecutionStatusCommand({
        deploymentId: event.DeploymentId,
        lifecycleEventHookExecutionId: event.LifecycleEventHookExecutionId,
        status,
      }),
    );
    return { status };
  }

  if (failure) throw failure;
  return result;
};
