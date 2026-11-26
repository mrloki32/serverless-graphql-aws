# Monitoring, alerting and rollback

## Logs

| Source | Log group | Retention (staging / prod) |
|---|---|---|
| Lambda functions | `/aws/lambda/gqlapp-api-<stage>-{query,mutation,subscription}`, `/aws/lambda/CodeDeployHook_gqlapp-<stage>-migrate` | 30 / 90 days |
| AppSync | `/aws/appsync/apis/<api-id>` (field-level ERROR, no request bodies) | 30 / 90 days |
| ECS GraphQL server | `/ecs/gqlapp-<stage>/graphql-server` | 30 / 90 days |
| RDS | `/aws/rds/instance/gqlapp-<stage>-postgres/{postgresql,upgrade}` | CloudWatch default |
| VPC (rejected traffic) | `/vpc/gqlapp-<stage>/flow-logs` | 30 days |

Application logs are **one JSON object per line**: `level`, `message`, `service`,
plus fields, with secret-looking keys redacted. They can be queried directly in
Logs Insights:

```sql
-- Unexpected resolver failures in the last hour
fields @timestamp, service, field, error
| filter level = "error"
| sort @timestamp desc

-- Rejected requests by reason
filter message = "Request rejected" | stats count() by code, reason
```

X-Ray tracing is enabled for AppSync and the Lambda functions. ECS has Container
Insights enabled.

## Dashboard

`infra/monitoring.yml` creates the CloudWatch dashboard **`gqlapp-<stage>`**:
* AppSync: 4xx/5xx errors, p50/p95 latency, WebSocket connections and subscriptions
* Lambda: invocations, errors, throttles, p95 duration, concurrency
* ECS: CPU and memory, running vs desired tasks; internal ALB: requests, 5xx, p95
  response time
* RDS: CPU, connections, read/write latency, free storage and memory, replica lag

## Alarms

Every alarm notifies the SNS topic `gqlapp-<stage>-alarms` (email, if configured).
**EventBridge rules** on the same topic also report ECS deployment failures and
CodeDeploy failures or rollbacks, so automatic rollbacks never go unnoticed.

| Area | Alarm | Condition | Also used for |
|---|---|---|---|
| Lambda | `…-lambda-{query,mutation,subscription}-errors` | ≥ 1 error in 2 of 5 minutes (expected business errors excluded) | **CodeDeploy automatic rollback** |
| Lambda | `…-lambda-migrate-errors` | any error | |
| Lambda | `…-lambda-{query,mutation}-throttles` | ≥ 5 throttles / 5 min | |
| Lambda | `…-lambda-query-p95-duration` / `mutation` | p95 > 2 s / 3 s for 15 min | |
| AppSync | `…-appsync-5xx` | ≥ 5 / 5 min | |
| AppSync | `…-appsync-p95-latency` | p95 > 2.5 s for 15 min | |
| ECS / ALB | `…-graphql-server-5xx` | ≥ 5 target 5xx in 2 of 3 minutes | **ECS deployment rollback** |
| ECS / ALB | `…-graphql-server-p95-latency` | p95 > 1 s for 15 min | |
| ECS / ALB | `…-graphql-server-unhealthy-hosts` | > 0 for 3 min | |
| ECS / ALB | `…-graphql-server-{cpu,memory}-high` | > 85 % for 15 min | |
| ECS / ALB | `…-graphql-server-running-tasks-low` | running < minimum for 5 min | |
| RDS | `…-rds-cpu-high` | > 80 % for 15 min | |
| RDS | `…-rds-connections-high` | > 60 (staging) / 300 (prod) | |
| RDS | `…-rds-free-storage-low` | < 2 GiB | |
| RDS | `…-rds-freeable-memory-low` | < 64 MiB | |
| RDS | `…-rds-write-latency-high` | > 50 ms average | |
| RDS | `…-rds-replica-lag-high` (prod) | > 30 s | |

## Rollback strategy

Rollback works in layers, from automatic and fine-grained to manual and coarse.

| # | Layer | Trigger | What happens | Who |
|---|---|---|---|---|
| 1 | **CloudFormation** | Any stack update fails | The stack reverts to its last good state | automatic |
| 2 | **ECS deployment circuit breaker** | New tasks never become healthy | ECS restores the previous task definition, CloudFormation fails the update and rolls back | automatic |
| 3 | **ECS alarm rollback** | `graphql-server-5xx` alarm during a deployment | Same as 2 | automatic |
| 4 | **CodeDeploy pre-traffic hook** | Migration fails | Deployment aborted before any traffic shifts, then CloudFormation rolls back | automatic |
| 5 | **CodeDeploy canary** (prod) | Lambda error alarm fires during the 10 % / 5 min canary | The `Live` alias shifts back to the previous version, then CloudFormation rolls back | automatic |
| 6 | **Pipeline rollback** | Any later step fails, including the smoke tests | Components already deployed in this run are restored to the versions recorded at the start: `serverless rollback --timestamp <prev>`, previous ECS image, previous CloudFront release. Then the smoke tests are re-run. | automatic (GitHub Actions) |
| 7 | **Manual rollback** | Problem found later | **Actions → Rollback**: pick the environment and component, run once with an empty target to list versions, then again with the target | operator |
| 8 | **Database restore** | Data damage | Restore from point-in-time or the pre-deploy snapshot ([database.md](database.md#backup-and-recovery)) | operator |

### Why rollbacks are safe and fast

* **Immutable versions everywhere.**
  * Lambda versions are kept (`versionFunctions: true`), and Serverless keeps the
    last deployments' artifacts in S3.
  * ECR tags are immutable, so a git SHA always means the same image.
  * Frontend releases stay side by side under `releases/<sha>/`, so a frontend
    rollback only changes the CloudFront origin path and invalidates the cache.
* **Backward-compatible migrations** (expand → contract), so old code runs on the
  new schema and code rollbacks never need schema rollbacks.
* **Same artifacts in staging and production.** Rolling forward and back moves
  between versions that have already been tested.

### Manual rollback from a shell

```bash
export AWS_REGION=ap-south-1
bash infra/scripts/rollback.sh prod list                        # versions available
bash infra/scripts/rollback.sh prod api 1764120000000           # serverless deployment timestamp
bash infra/scripts/rollback.sh prod ecs <account>.dkr.ecr.<region>.amazonaws.com/gqlapp/graphql-server:<sha>
bash infra/scripts/rollback.sh prod frontend <sha>
bash infra/scripts/smoke.sh prod
```

### Exercising the rollback path

Do this in staging. Push a commit that makes `Query.health` return `degraded`, for
example by pointing `INTERNAL_API_URL` at a bad host. The deploy succeeds, the smoke
test fails, the pipeline rolls the API back to the recorded timestamp, and the
re-run smoke test passes on the previous version. The run summary lists what was
rolled back.
