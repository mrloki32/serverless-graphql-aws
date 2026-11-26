/**
 * Local development only: applies migrations and creates the app roles in the
 * docker-compose PostgreSQL (passwords match docker-compose.yml; throwaway values).
 * In AWS the same code runs inside the migrate Lambda with Secrets Manager credentials.
 *
 *   npm run db:up && npm run db:migrate
 */
import { ensureAppRoles, runMigrations } from '@gqlapp/core';
import pg from 'pg';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? 'postgres://dbadmin:localdev@localhost:5432/appdb';
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const applied = await runMigrations(client);
    await ensureAppRoles(client, new URL(url).pathname.slice(1), [
      { username: 'app_rw', password: 'app_rw_localdev', access: 'readwrite' },
      { username: 'app_ro', password: 'app_ro_localdev', access: 'readonly' },
    ]);
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Schema already up to date');
  } finally {
    await client.end();
  }
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
