#!/usr/bin/env bash
# Resolves the stage URLs and runs the end-to-end smoke test.
#
#   smoke.sh <staging|prod> [expected-version]
set -euo pipefail
# shellcheck source=infra/scripts/common.sh
source "$(dirname "$0")/common.sh"

STAGE="${1:-}"
require_stage "$STAGE"
API_URL=$(require_output "$APP_NAME-api-$STAGE" GraphQlApiUrl)
SITE_URL=$(require_output "$APP_NAME-$STAGE-frontend" SiteUrl)
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then echo "site_url=$SITE_URL" >>"$GITHUB_OUTPUT"; fi

API_URL="$API_URL" SITE_URL="$SITE_URL" EXPECT_VERSION="${2:-}" node "$ROOT_DIR/scripts/smoke-test.mjs"
