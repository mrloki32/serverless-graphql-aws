#!/usr/bin/env bash
# Deploys the CloudFormation stacks of one stage, through the CloudFormation
# execution role created by infra/bootstrap.yml.
#
#   deploy-stacks.sh <staging|prod> foundation   # alerts + network + database
#   IMAGE_URI=...  deploy-stacks.sh <stage> ecs   # private GraphQL server
#   [RELEASE_ID=<sha>] deploy-stacks.sh <stage> frontend
#   deploy-stacks.sh <stage> monitoring           # dashboard (after the API stack)
#
# Optional env: ALERT_EMAIL, SITE_DOMAIN_NAME, SITE_CERTIFICATE_ARN, SITE_HOSTED_ZONE_ID
set -euo pipefail
# shellcheck source=infra/scripts/common.sh
source "$(dirname "$0")/common.sh"

STAGE="${1:-}"
COMPONENT="${2:-}"
load_stage_env "$STAGE"

CFN_ROLE_ARN=$(require_output "$APP_NAME-bootstrap" CfnExecutionRoleArn)

deploy() {
  local name=$1 template=$2
  shift 2
  log "Deploying $APP_NAME-$STAGE-$name ($template)"
  # CloudFormation rolls a failed update back to the last good state automatically.
  aws cloudformation deploy \
    --stack-name "$APP_NAME-$STAGE-$name" \
    --template-file "$INFRA_DIR/$template" \
    --role-arn "$CFN_ROLE_ARN" \
    --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
    --no-fail-on-empty-changeset \
    --tags "app=$APP_NAME" "stage=$STAGE" "managed-by=cloudformation" \
    --parameter-overrides "AppName=$APP_NAME" "Stage=$STAGE" "$@"
}

case "$COMPONENT" in
  foundation)
    deploy alerts alerts.yml "AlertEmail=${ALERT_EMAIL:-}"
    deploy network network.yml "HighAvailabilityNat=$HA_NAT"
    deploy database database.yml \
      "DbInstanceClass=$DB_INSTANCE_CLASS" \
      "MultiAZ=$DB_MULTI_AZ" \
      "CreateReadReplica=$DB_READ_REPLICA" \
      "EnableRdsProxy=$DB_PROXY" \
      "DeletionProtection=$DB_DELETION_PROTECTION" \
      "BackupRetentionDays=$DB_BACKUP_RETENTION_DAYS" \
      "EnablePerformanceInsights=$DB_PERFORMANCE_INSIGHTS" \
      "ConnectionsAlarmThreshold=$DB_CONNECTIONS_ALARM"
    ;;
  ecs)
    [[ -n "${IMAGE_URI:-}" ]] || die "IMAGE_URI must be set"
    deploy ecs ecs.yml \
      "ImageUri=$IMAGE_URI" \
      "MinTasks=$ECS_MIN_TASKS" \
      "MaxTasks=$ECS_MAX_TASKS" \
      "TaskCpu=$ECS_TASK_CPU" \
      "TaskMemory=$ECS_TASK_MEMORY" \
      "UseFargateSpot=$ECS_USE_SPOT" \
      "LogRetentionDays=$LOG_RETENTION_DAYS"
    ;;
  frontend)
    args=(
      "DomainName=${SITE_DOMAIN_NAME:-}"
      "CertificateArn=${SITE_CERTIFICATE_ARN:-}"
      "HostedZoneId=${SITE_HOSTED_ZONE_ID:-}"
    )
    # Without RELEASE_ID the currently served release is kept.
    if [[ -n "${RELEASE_ID:-}" ]]; then args+=("ReleaseId=$RELEASE_ID"); fi
    deploy frontend frontend.yml "${args[@]}"
    ;;
  monitoring)
    deploy monitoring monitoring.yml "ApiId=$(require_output "$APP_NAME-api-$STAGE" GraphQlApiId)"
    ;;
  *)
    die "usage: deploy-stacks.sh <staging|prod> <foundation|ecs|frontend|monitoring>"
    ;;
esac
