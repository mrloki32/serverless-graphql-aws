# Deploying and testing

## Prerequisites

* An AWS account and an administrator able to run the one-time bootstrap
* AWS CLI v2, Node.js 22, Docker, Bash (Git Bash or WSL on Windows)
* A GitHub repository containing this code

The default region is `us-east-1`. Any region works, but a CloudFront custom-domain
certificate must always be issued in `us-east-1`.

## 1. One-time account bootstrap (administrator)

```bash
aws cloudformation deploy \
  --stack-name gqlapp-bootstrap \
  --template-file infra/bootstrap.yml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides GitHubOrg=<org-or-user> GitHubRepo=<repo>
# If the GitHub OIDC provider already exists in the account, add:
#   CreateOidcProvider=false ExistingOidcProviderArn=arn:aws:iam::<account-id>:oidc-provider/token.actions.githubusercontent.com

aws cloudformation describe-stacks --stack-name gqlapp-bootstrap --query "Stacks[0].Outputs" --output table
```

This creates the GitHub OIDC trust, the CI role (`gqlapp-github-deploy`), the
CloudFormation execution role, the Serverless deployment bucket and the ECR
repository. See [security.md](security.md) for what each one can do.

## 2. GitHub configuration

1. **Settings → Environments**: create `staging` and `production`.
   * `production`: add **Required reviewers**. This is the manual approval gate.
   * Both: under **Deployment branches**, allow only `main`.
2. **Variables** on each environment. None of these are secret:

   | Variable | Value |
   |---|---|
   | `AWS_REGION` | e.g. `us-east-1` |
   | `AWS_DEPLOY_ROLE_ARN` | `GitHubDeployRoleArn` output of `gqlapp-bootstrap` |
   | `ALERT_EMAIL` | optional, receives alarms |
   | `SITE_DOMAIN_NAME`, `SITE_CERTIFICATE_ARN`, `SITE_HOSTED_ZONE_ID` | optional custom domain (certificate in us-east-1) |

3. **Branch protection** on `main`: require the `CI` checks to pass before merging.

No AWS access keys or other secrets are stored in GitHub.

## 3. Deploy

Push to `main`, or run **Actions → Deploy → Run workflow**. The pipeline then:

1. runs CI (lint, typecheck, unit and integration tests, IaC validation, image scan),
2. deploys **staging** and smoke-tests it,
3. waits for **approval**, then deploys **production** the same way, with the same
   image and the same frontend build.

The first deployment takes about 25 minutes, mostly creating RDS and the CloudFront
distribution. If you set `ALERT_EMAIL`, confirm the SNS subscription email.

### Deploying from a workstation

The pipeline only calls scripts, so you can run the same steps by hand. You need
credentials that can assume or pass the CloudFormation execution role:

```bash
export AWS_REGION=us-east-1 GIT_SHA=$(git rev-parse HEAD) STAGE=staging
npm ci && npm run build -w @gqlapp/frontend

bash infra/scripts/deploy-stacks.sh $STAGE foundation             # alerts, network, database
IMAGE_URI=$(bash infra/scripts/build-image.sh | sed 's/^image_uri=//')
IMAGE_URI=$IMAGE_URI bash infra/scripts/deploy-stacks.sh $STAGE ecs
bash infra/scripts/deploy-stacks.sh $STAGE frontend
(cd services/api && npx serverless deploy --stage $STAGE)
bash infra/scripts/migrate.sh $STAGE
bash infra/scripts/deploy-frontend.sh $STAGE $GIT_SHA frontend/dist
bash infra/scripts/deploy-stacks.sh $STAGE monitoring
bash infra/scripts/smoke.sh $STAGE $GIT_SHA
```

## 4. Try it

1. Open the site URL (`SiteUrl` output of `gqlapp-<stage>-frontend`, also shown on the
   GitHub deployment).
2. **Sign in**, then use **Sign up** on the Cognito hosted page and verify the email.
3. Create, update and delete tasks. Open a second tab: changes appear there live
   through the AppSync subscription. The badge in the header shows the WebSocket status.

## 5. Testing

| Level | What | How |
|---|---|---|
| Unit | Validation, cursors, SCRAM, resolver auth/ownership, error masking, internal client, server HTTP layer, realtime protocol, UI state merging | `npm test` |
| Integration | Real PostgreSQL: migrations (idempotent), app-role provisioning, least privilege (`app_ro` cannot write, `app_rw` cannot DDL), owner scoping, keyset pagination | `npm run db:up` then `DATABASE_URL=postgres://dbadmin:localdev@localhost:5432/appdb npm test -w @gqlapp/core` (CI runs this against a Postgres 17 service container) |
| Static / IaC | ESLint, `tsc`, `cfn-lint` on all templates, offline `serverless package` + `cfn-lint` of the generated stack, `shellcheck`, Trivy image scan | `npm run lint`, `npm run typecheck`, `cfn-lint infra/*.yml`, `npm run validate:api` |
| Smoke (post-deploy) | IAM-signed `health` query proves Lambda → RDS and Lambda → Fargate → RDS work, and that the `Live` alias runs the expected git SHA; unauthenticated requests rejected; site served with security headers, SPA fallback, `config.json` pointing at this API and version | `bash infra/scripts/smoke.sh <stage> [sha]` (runs automatically after every deploy and rollback) |

## 6. Local development

```bash
npm ci
npm run db:up                          # PostgreSQL 17 in Docker
npm run db:migrate                     # schema + app_rw/app_ro roles (local throwaway passwords)
docker compose up -d --build graphql-server   # the production image, on :4000

curl -s localhost:4000/graphql -H 'content-type: application/json' \
  -H 'x-internal-token: local-internal-token' -d '{"query":"{ health }"}'

# Frontend against a deployed stage (Cognito/AppSync are AWS-only):
bash infra/scripts/frontend-config.sh staging > frontend/public/config.json
npm run dev:frontend                   # http://localhost:5173 (allowed as a callback URL outside prod)
```

## 7. Tearing down a stage

Delete the stacks in reverse order: `gqlapp-<stage>-monitoring`, then
`gqlapp-api-<stage>` (`npx serverless remove --stage <stage>`), then
`-frontend` (empty the bucket first), `-ecs`, `-database`, `-network` and `-alerts`.
In prod, first turn off `DB_DELETION_PROTECTION`. Note that the Cognito pool has
deletion protection in prod. Deleting the database stack takes a final snapshot.
