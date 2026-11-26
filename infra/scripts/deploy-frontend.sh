#!/usr/bin/env bash
# Publishes a frontend build as an immutable release and switches CloudFront to it.
#
#   deploy-frontend.sh <staging|prod> <release-id (git sha)> <dist-dir>
#
#   1. upload to s3://<bucket>/releases/<release-id>/ (old releases stay in place)
#   2. point the CloudFront origin path at the new release (frontend stack update)
#   3. invalidate the edge cache
# Rolling back = step 2 + 3 with the previous release id (see rollback.sh).
set -euo pipefail
# shellcheck source=infra/scripts/common.sh
source "$(dirname "$0")/common.sh"

STAGE="${1:-}"
RELEASE="${2:-}"
DIST="${3:-}"
require_stage "$STAGE"
[[ -n "$RELEASE" ]] || die "release id is required"
[[ -f "$DIST/index.html" ]] || die "$DIST does not contain a frontend build (index.html missing)"

BUCKET=$(require_output "$APP_NAME-$STAGE-frontend" BucketName)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cp -R "$DIST"/. "$WORK"/
bash "$SCRIPTS_DIR/frontend-config.sh" "$STAGE" "$RELEASE" >"$WORK/config.json"

TARGET="s3://$BUCKET/releases/$RELEASE"
log "Uploading release to $TARGET"
# Content-hashed bundles never change -> cache for a year at the edge and in browsers.
aws s3 sync "$WORK/assets" "$TARGET/assets" \
  --exclude "*.map" \
  --cache-control "public,max-age=31536000,immutable" \
  --only-show-errors
# Entry points must revalidate on every load so a release/rollback is seen at once.
aws s3 sync "$WORK" "$TARGET" \
  --exclude "assets/*" --exclude "*.map" \
  --cache-control "no-cache" \
  --only-show-errors

log "Switching CloudFront to release $RELEASE"
RELEASE_ID="$RELEASE" bash "$SCRIPTS_DIR/deploy-stacks.sh" "$STAGE" frontend

DISTRIBUTION_ID=$(require_output "$APP_NAME-$STAGE-frontend" DistributionId)
INVALIDATION=$(aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths "/*" \
  --query 'Invalidation.Id' --output text)
aws cloudfront wait invalidation-completed --distribution-id "$DISTRIBUTION_ID" --id "$INVALIDATION"
log "Release $RELEASE is live at $(stack_output "$APP_NAME-$STAGE-frontend" SiteUrl)"
