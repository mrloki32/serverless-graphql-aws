# Serverless GraphQL on AWS: React · AppSync/Lambda · Fargate · RDS

This is a production-style reference implementation of a scalable, secure,
serverless GraphQL architecture, with automated CI/CD, monitoring and layered
rollback. The sample domain is a **real-time task board**: each user manages their
own tasks, and changes stream live to every open tab.

```
Browser ──HTTPS──▶ CloudFront ──OAC──▶ S3 (React SPA)
   │
   ├──OAuth2 PKCE──▶ Cognito
   │
   └──HTTPS/WSS + JWT──▶ AppSync ──▶ λ query ──────────────▶ RDS read replica (app_ro)
                              │      └──▶ internal ALB ─┐
                              ├────▶ λ mutation ────────┼──▶ ECS Fargate (Apollo, private) ──▶ RDS primary (app_rw)
                              └────▶ λ subscription      ┘
               all compute in private subnets · RDS in isolated subnets · secrets in Secrets Manager
```

**Full diagram and design rationale:** [docs/architecture.md](docs/architecture.md)

## What's in the box

| Requirement | Implementation | Key files |
|---|---|---|
| React frontend on AWS: cost-optimized, cached, access-controlled, SSL | Vite + React 19 SPA in a private S3 bucket behind CloudFront **OAC**. HTTPS only (ACM or CloudFront certificate), long-cache hashed assets, no-cache entry points, CSP/HSTS headers, `PriceClass_100`, immutable releases | `frontend/`, `infra/frontend.yml`, `infra/scripts/deploy-frontend.sh` |
| Multiple TypeScript Lambdas for queries, mutations and subscriptions, via the **Serverless Framework** | AppSync plus 4 Lambdas (`query`, `mutation`, `subscription`, `migrate`), bundled with esbuild, arm64, CodeDeploy traffic shifting | `services/api/` |
| Private GraphQL server on **ECS Fargate** | Apollo Server in private subnets behind an **internal** ALB. Read-only, non-root container; the task role has no permissions; internal token; auto scaling | `services/graphql-server/`, `infra/ecs.yml` |
| **RDS** in a private subnet, connected to Lambda and Fargate | PostgreSQL 17 in isolated subnets: TLS-only, encrypted, managed master secret, least-privilege `app_rw` / `app_ro` users; replica and RDS Proxy in prod | `infra/network.yml`, `infra/database.yml`, `packages/core/` |
| Lambda ↔ GraphQL server ↔ RDS integration | Reads: Lambda → RDS. Writes and aggregates: Lambda → Fargate GraphQL → RDS. Migrations: Lambda → RDS. | `services/api/src/handlers/`, `services/graphql-server/src/` |
| CI/CD with **GitHub Actions** | CI (lint, types, unit tests, integration tests on Postgres, cfn-lint, offline Serverless validation, shellcheck, Trivy), then staging, then approval, then production, each with smoke tests | `.github/workflows/` |
| CloudWatch monitoring and alarms | About 30 alarms (Lambda errors/latency/throttles, AppSync, ECS/ALB, RDS connections/CPU/storage/latency/lag), a dashboard, JSON logs, X-Ray, Container Insights, SNS + EventBridge alerts | `infra/monitoring.yml`, `infra/alerts.yml`, plus alarms next to each resource |
| IAM access control | A dedicated role per workload. The OIDC CI role can only *pass* a CloudFormation execution role. The CodeDeploy role has no `AWSLambda_FullAccess`. The ECS task role has zero permissions. | `infra/bootstrap.yml`, [docs/security.md](docs/security.md) |
| Secrets and environment variables | Every secret is generated in Secrets Manager. GitHub holds **no secrets** (OIDC plus environment variables); only ARNs flow through the pipeline. | [docs/security.md](docs/security.md#secrets-and-environment-variables) |
| Scaling | Lambda reserved concurrency plus provisioned-concurrency auto scaling; ECS target tracking on CPU and requests; RDS storage autoscaling, replica and proxy | [docs/architecture.md](docs/architecture.md#scaling-strategy) |
| Rollback | 8 layers: CloudFormation, ECS circuit breaker, ECS alarm, CodeDeploy hook, CodeDeploy canary, pipeline auto-rollback, manual workflow, DB restore | [docs/monitoring-and-rollback.md](docs/monitoring-and-rollback.md#rollback-strategy) |

## Repository layout

```
frontend/                 React SPA (Vite); runtime config from /config.json
services/api/             Serverless Framework: AppSync schema, resolvers, Lambdas, Cognito, alarms
services/graphql-server/  Apollo GraphQL server + Dockerfile (ECS Fargate)
packages/core/            Shared data access, validation, migrations, secrets, logger
infra/                    CloudFormation stacks + per-stage settings + deployment scripts
scripts/                  Smoke test, offline Serverless validation, local migrations
.github/workflows/        CI, deploy pipeline, rollback
docs/                     Architecture, deployment, security, CI/CD, database, monitoring/rollback
```

## Quick start (local)

```bash
npm ci
npm run lint && npm run typecheck && npm test     # unit tests
npm run db:up && npm run db:migrate               # PostgreSQL 17 in Docker
DATABASE_URL=postgres://dbadmin:localdev@localhost:5432/appdb npm test -w @gqlapp/core   # integration tests
docker compose up -d --build graphql-server       # private GraphQL server on :4000
```

**[docs/deployment.md](docs/deployment.md)** covers deploying to AWS: the one-time
bootstrap, the GitHub environments, and the first pipeline run.

## Documentation

* [Architecture, request flows, scaling strategy, cost](docs/architecture.md)
* [Deploying and testing](docs/deployment.md)
* [IAM policies and security configuration](docs/security.md)
* [CI/CD pipeline](docs/cicd.md)
* [Database setup and security](docs/database.md)
* [Monitoring, alerting and rollback](docs/monitoring-and-rollback.md)

## Technology choices and caveats

* **Serverless Framework v3** is used because v4 requires a Serverless account
  (license key) in CI. v3 is no longer maintained upstream and pulls in some
  deprecated transitive dependencies. Its schema predates `nodejs22.x`, so it prints
  a configuration *warning*, but it deploys that runtime correctly. To move off v3,
  switch to v4 or the community-maintained v3 fork (`osls`); this configuration
  works with both.
* **AppSync** is the public GraphQL endpoint because it provides managed WebSocket
  subscriptions. The Lambdas hold the business logic. The Fargate server is a
  private, single-writer domain service.
* **Region:** the templates are region-agnostic. A CloudFront custom-domain
  certificate must be in `us-east-1`.
