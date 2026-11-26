# Database setup and security

## Topology

| Setting | Staging | Production | Where |
|---|---|---|---|
| Engine | PostgreSQL 17.11 (auto minor upgrades) | same | `infra/database.yml` |
| Instance | db.t4g.micro (Graviton) | db.t4g.medium | `infra/env/<stage>.env` |
| Multi-AZ | no | **yes** (synchronous standby, automatic failover) | |
| Read replica | no | **yes** (query Lambda reads) | |
| RDS Proxy | no | **yes** (pooling, faster failover) | |
| Storage | gp3, 20 GiB, autoscaling to 100 GiB | same | |
| Backups / PITR | 7 days | 14 days, plus a manual snapshot before every deploy | |
| Deletion protection | off | **on**; a final snapshot is taken on stack deletion in both stages | |
| Performance Insights | off | on (7 days, free tier) | |

## Network placement

The instance, replica and proxy live in **isolated subnets**. Their route table has
only local routes, so there is no path to or from the internet, and the instance is
`PubliclyAccessible: false`. The DB security group accepts port 5432 only from the
Lambda and ECS security groups, and from itself for the proxy. CI cannot reach the
database either: migrations run inside the VPC in the `migrate` Lambda.

For break-glass access, temporarily run a one-off Fargate task or an SSM-managed
instance in a private subnet with the ECS security group. Never open the database
security group to the internet.

## Users and authentication

| DB role | Privileges | Credentials | Used by |
|---|---|---|---|
| `dbadmin` (master) | `rds_superuser` | Generated and **rotated automatically** by RDS + Secrets Manager (`ManageMasterUserPassword`) | `migrate` Lambda only |
| `app_rw` | `SELECT/INSERT/UPDATE/DELETE` on app tables. **No DDL**, and no access to `schema_migrations`. | Secrets Manager `gqlapp/<stage>/db/app-rw` | Fargate GraphQL server |
| `app_ro` | `SELECT` only | Secrets Manager `gqlapp/<stage>/db/app-ro` | query Lambda |

* The roles are created and updated by `ensureAppRoles()` (`packages/core/src/migrations.ts`).
  Passwords are sent as **SCRAM-SHA-256 verifiers**, so plaintext never reaches SQL
  text or the PostgreSQL logs. `password_encryption = scram-sha-256`.
* TLS is **mandatory** (`rds.force_ssl = 1`), and clients verify the server
  certificate against the RDS CA bundle.
* IAM database authentication is enabled on the instance, as an option for human or
  break-glass access.

## Schema

```sql
tasks(id uuid PK, owner text, title text CHECK 1..200, description text CHECK <= 2000,
      status text CHECK IN ('TODO','IN_PROGRESS','DONE'),
      created_at timestamptz(ms), updated_at timestamptz(ms))
  INDEX (owner, created_at DESC, id DESC)
  INDEX (owner, status, created_at DESC, id DESC)

task_audit(id bigint identity PK, task_id uuid, owner text, action text, payload jsonb, created_at)
schema_migrations(id text PK, applied_at)
```

Every query is owner-scoped and uses **keyset pagination** on
`(created_at, id)` with an opaque cursor. Timestamps are stored with millisecond
precision so cursors round-trip exactly. Writes go through the Fargate server in a
transaction together with an audit row.

## Migrations

* Defined in code (`MIGRATIONS` in `packages/core/src/migrations.ts`). They are
  **forward-only** and **idempotent**, recorded in `schema_migrations`, and
  serialized with a PostgreSQL **advisory lock**.
* They run in the **`migrate` Lambda**:
  1. as the CodeDeploy **BeforeAllowTraffic** hook. That is after the new Lambda
     versions exist but **before any traffic** reaches them, so a failing migration
     aborts the deployment and CloudFormation rolls back.
  2. explicitly by the pipeline after `serverless deploy` (`infra/scripts/migrate.sh`),
     which covers the very first deployment, where no hook runs.
* **Rule: expand → deploy → contract.** Each migration must work with both the
  current and the previous application version. For example, add a nullable column,
  deploy code that uses it, and only drop the old column in a later release. This
  keeps code rollbacks safe without schema rollbacks.
* To change the schema, append a new `{ id: '003_…', sql: … }` entry. Never edit a
  migration that has shipped.

## Connection management

* Lambda: one module-scope pool per container with `max: 1`, reused across warm
  invocations. Credentials are cached for 5 minutes; after a password rotation the
  pool is rebuilt on the first `28P01` authentication error.
* Fargate: a pool of 10 per task, with `statement_timeout` at 10 s and
  `idle_in_transaction_session_timeout` at 60 s.
* Reserved Lambda concurrency caps the total connection count (see the *connection
  budget* in [architecture.md](architecture.md#scaling-strategy)). In production,
  RDS Proxy multiplexes writer connections.

## Backup and recovery

| Scenario | Recovery |
|---|---|
| Bad data or accidental delete | Point-in-time restore to a new instance, within the retention window |
| Failed or harmful migration | Restore the **pre-deploy snapshot** taken by the pipeline (prod), then repoint `database.yml` or copy the data back |
| AZ failure | Multi-AZ automatic failover (prod). RDS Proxy shortens the client-visible failover time. |
| Stack deletion | `DeletionPolicy: Snapshot` takes a final snapshot automatically |

## Database monitoring

The alarms are defined in `database.yml` and covered in
[monitoring-and-rollback.md](monitoring-and-rollback.md): CPU, connections, free
storage, freeable memory, write latency and replica lag. PostgreSQL and upgrade logs
are exported to CloudWatch Logs, and statements slower than 1 s are logged.
