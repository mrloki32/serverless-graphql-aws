#!/usr/bin/env bash
# Takes a manual RDS snapshot before a deployment (used for prod). Manual
# snapshots are kept until deleted, independent of automated backups/PITR, and are
# the restore point if a migration ever needs to be undone.
#
#   GIT_SHA=<sha> db-snapshot.sh <staging|prod>
set -euo pipefail
# shellcheck source=infra/scripts/common.sh
source "$(dirname "$0")/common.sh"

STAGE="${1:-}"
require_stage "$STAGE"
DB_ID=$(stack_output "$APP_NAME-$STAGE-database" DbInstanceIdentifier)
if [[ -z "$DB_ID" ]]; then
  log "No database deployed yet for $STAGE - skipping snapshot"
  exit 0
fi

SNAPSHOT="$APP_NAME-$STAGE-predeploy-${GIT_SHA:0:12}-$(date -u +%Y%m%d%H%M%S)"
log "Creating snapshot $SNAPSHOT of $DB_ID"
aws rds create-db-snapshot \
  --db-instance-identifier "$DB_ID" \
  --db-snapshot-identifier "$SNAPSHOT" \
  --tags "Key=app,Value=$APP_NAME" "Key=reason,Value=pre-deploy" "Key=git-sha,Value=${GIT_SHA:-unknown}" \
  >/dev/null
aws rds wait db-snapshot-available --db-snapshot-identifier "$SNAPSHOT"
log "Snapshot $SNAPSHOT available"
