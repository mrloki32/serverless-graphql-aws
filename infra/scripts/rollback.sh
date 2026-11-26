#!/usr/bin/env bash
# Rollback tooling, used automatically by the deploy workflow and manually by the
# "Rollback" workflow (or an operator's shell).
#
#   rollback.sh <stage> capture                  # prints current versions (key=value)
#   rollback.sh <stage> list                     # shows available rollback targets
#   rollback.sh <stage> api <timestamp>          # serverless rollback (Lambda + AppSync)
#   rollback.sh <stage> ecs <image-uri>          # redeploy a previous immutable image
#   rollback.sh <stage> frontend <release-id>    # point CloudFront at a previous release
set -euo pipefail
# shellcheck source=infra/scripts/common.sh
source "$(dirname "$0")/common.sh"

STAGE="${1:-}"
ACTION="${2:-}"
TARGET="${3:-}"
require_stage "$STAGE"

latest_api_deployment() {
  local bucket prefixes
  bucket=$(stack_output "$APP_NAME-bootstrap" DeploymentBucketName)
  [[ -n "$bucket" ]] || return 0
  # Serverless stores each deployment under serverless/<service>/<stage>/<timestamp>-<iso date>/
  prefixes=$(aws s3api list-objects-v2 --bucket "$bucket" --prefix "serverless/$APP_NAME-api/$STAGE/" \
    --delimiter / --query 'CommonPrefixes[].Prefix' --output text 2>/dev/null || true)
  [[ -z "$prefixes" || "$prefixes" == "None" ]] && return 0
  tr '\t' '\n' <<<"$prefixes" | sort | tail -n 1 | awk -F/ '{print $4}' | cut -d- -f1
}

case "$ACTION" in
  capture)
    release=$(stack_param "$APP_NAME-$STAGE-frontend" ReleaseId)
    [[ "$release" == "initial" ]] && release=""
    echo "api_timestamp=$(latest_api_deployment)"
    echo "image_uri=$(stack_param "$APP_NAME-$STAGE-ecs" ImageUri)"
    echo "release_id=$release"
    ;;

  list)
    log "API deployments (use the timestamp)"
    (cd "$ROOT_DIR/services/api" && npx serverless deploy list --stage "$STAGE" --region "${AWS_REGION:?}")
    log "GraphQL server images (newest last)"
    repo_uri=$(require_output "$APP_NAME-bootstrap" EcrRepositoryUri)
    aws ecr describe-images --repository-name "${repo_uri#*/}" \
      --query 'sort_by(imageDetails,&imagePushedAt)[-10:].[imagePushedAt,imageTags[0]]' --output table
    echo "image uri = $repo_uri:<tag>"
    log "Frontend releases"
    aws s3 ls "s3://$(require_output "$APP_NAME-$STAGE-frontend" BucketName)/releases/"
    echo "currently live: $(stack_param "$APP_NAME-$STAGE-frontend" ReleaseId)"
    ;;

  api)
    [[ -n "$TARGET" ]] || die "timestamp required (rollback.sh $STAGE list)"
    log "Rolling API back to deployment $TARGET"
    # Re-deploys the stored CloudFormation template + artifacts of that deployment.
    # CodeDeploy shifts the Live alias back; migrations are forward-only and
    # backward compatible, so the previous code runs against the current schema.
    (cd "$ROOT_DIR/services/api" && npx serverless rollback --stage "$STAGE" --region "${AWS_REGION:?}" --timestamp "$TARGET")
    ;;

  ecs)
    [[ -n "$TARGET" ]] || die "image uri required (rollback.sh $STAGE list)"
    log "Rolling GraphQL server back to $TARGET"
    IMAGE_URI="$TARGET" bash "$SCRIPTS_DIR/deploy-stacks.sh" "$STAGE" ecs
    ;;

  frontend)
    [[ -n "$TARGET" ]] || die "release id required (rollback.sh $STAGE list)"
    log "Rolling frontend back to release $TARGET"
    RELEASE_ID="$TARGET" bash "$SCRIPTS_DIR/deploy-stacks.sh" "$STAGE" frontend
    dist_id=$(require_output "$APP_NAME-$STAGE-frontend" DistributionId)
    inv=$(aws cloudfront create-invalidation --distribution-id "$dist_id" --paths "/*" --query 'Invalidation.Id' --output text)
    aws cloudfront wait invalidation-completed --distribution-id "$dist_id" --id "$inv"
    ;;

  *)
    die "usage: rollback.sh <stage> <capture|list|api|ecs|frontend> [target]"
    ;;
esac
