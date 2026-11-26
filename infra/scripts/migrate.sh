#!/usr/bin/env bash
# Invokes the migrate Lambda (inside the VPC - CI has no network path to RDS).
# Idempotent: on updates the CodeDeploy BeforeAllowTraffic hook has already run
# it; on the very first deploy this is what creates the schema and app roles.
#
#   migrate.sh <staging|prod>
set -euo pipefail
# shellcheck source=infra/scripts/common.sh
source "$(dirname "$0")/common.sh"

STAGE="${1:-}"
require_stage "$STAGE"
FUNCTION=$(require_output "$APP_NAME-api-$STAGE" MigrateFunctionName)
OUT=$(mktemp)
trap 'rm -f "$OUT"' EXIT

log "Invoking $FUNCTION"
ERROR=$(aws lambda invoke \
  --function-name "$FUNCTION" \
  --cli-binary-format raw-in-base64-out \
  --payload '{}' \
  --cli-read-timeout 180 \
  --query FunctionError --output text \
  "$OUT")
cat "$OUT"
echo

if [[ -n "$ERROR" && "$ERROR" != "None" ]]; then
  die "migration failed ($ERROR) - see CloudWatch Logs for $FUNCTION"
fi
log "Migrations applied"
