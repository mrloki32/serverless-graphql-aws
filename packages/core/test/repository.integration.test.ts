/**
 * Integration tests against a real PostgreSQL (docker compose locally, a service
 * container in GitHub Actions). Skipped when DATABASE_URL is not set.
 *
 *   DATABASE_URL=postgres://dbadmin:localdev@localhost:5432/appdb npm test -w @gqlapp/core
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTask,
  deleteTask,
  ensureAppRoles,
  getTask,
  getTaskStats,
  listTasks,
  recordAudit,
  runMigrations,
  updateTask,
} from '../src';

const url = process.env.DATABASE_URL;

describe.skipIf(!url)('tasks repository (integration)', () => {
  let admin: pg.Client;
  let rw: pg.Client;
  let ro: pg.Client;
  const owner = `it-user-${Date.now()}`;
  const other = `${owner}-other`;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await runMigrations(admin);
    // Running twice must be a no-op (idempotency).
    expect(await runMigrations(admin)).toEqual([]);

    const dbName = new URL(url!).pathname.slice(1);
    await ensureAppRoles(admin, dbName, [
      { username: 'it_app_rw', password: 'it-rw-password', access: 'readwrite' },
      { username: 'it_app_ro', password: 'it-ro-password', access: 'readonly' },
    ]);

    const asRole = (user: string, password: string) => {
      const u = new URL(url!);
      u.username = user;
      u.password = password;
      return new pg.Client({ connectionString: u.toString() });
    };
    // Logging in proves the SCRAM verifier was accepted by PostgreSQL.
    rw = asRole('it_app_rw', 'it-rw-password');
    ro = asRole('it_app_ro', 'it-ro-password');
    await rw.connect();
    await ro.connect();
  });

  afterAll(async () => {
    await admin?.query('DELETE FROM tasks WHERE owner IN ($1, $2)', [owner, other]);
    await Promise.all([rw?.end(), ro?.end(), admin?.end()]);
  });

  it('creates, reads, updates and deletes scoped by owner', async () => {
    const t = await createTask(rw, owner, { title: 'First', description: 'desc' });
    expect(t.status).toBe('TODO');
    await recordAudit(rw, owner, 'CREATED', t);

    expect(await getTask(ro, owner, t.id)).toEqual(t);
    expect(await getTask(ro, other, t.id)).toBeNull();

    const u = await updateTask(rw, owner, { id: t.id, status: 'DONE', description: null });
    expect(u).toMatchObject({ status: 'DONE', description: null, title: 'First' });
    expect(await updateTask(rw, other, { id: t.id, status: 'TODO' })).toBeNull();

    expect(await getTaskStats(ro, owner)).toEqual({ total: 1, todo: 0, inProgress: 0, done: 1 });
    expect((await deleteTask(rw, owner, t.id))?.id).toBe(t.id);
    expect(await getTask(ro, owner, t.id)).toBeNull();
  });

  it('paginates with a stable keyset cursor', async () => {
    for (let i = 0; i < 5; i++) await createTask(rw, owner, { title: `Task ${i}` });
    const p1 = await listTasks(ro, owner, { limit: 2 });
    const p2 = await listTasks(ro, owner, { limit: 2, nextToken: p1.nextToken });
    const p3 = await listTasks(ro, owner, { limit: 2, nextToken: p2.nextToken });
    const titles = [...p1.items, ...p2.items, ...p3.items].map((t) => t.title);
    expect(titles).toEqual(['Task 4', 'Task 3', 'Task 2', 'Task 1', 'Task 0']);
    expect(p3.nextToken).toBeNull();
  });

  it('enforces least privilege on the read-only role', async () => {
    await expect(createTask(ro, owner, { title: 'nope' })).rejects.toThrow(/permission denied/);
    await expect(rw.query('CREATE TABLE should_fail (id int)')).rejects.toThrow(/permission denied/);
  });
});
