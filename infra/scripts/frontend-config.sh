#!/usr/bin/env bash
# Prints the runtime config.json for the React app from CloudFormation outputs.
# Public identifiers only - nothing secret ends up in the browser.
#
#   frontend-config.sh <staging|prod> [version]
#   frontend-config.sh staging > frontend/public/config.json   # local dev against staging
set -euo pipefail
# shellcheck source=infra/scripts/common.sh
source "$(dirname "$0")/common.sh"

STAGE="${1:-}"
require_stage "$STAGE"
API_STACK="$APP_NAME-api-$STAGE"

export CFG_STAGE="$STAGE"
export CFG_VERSION="${2:-${GIT_SHA:-local}}"
export CFG_REGION="${AWS_REGION:-$(aws configure get region)}"
CFG_GRAPHQL_URL=$(require_output "$API_STACK" GraphQlApiUrl)
CFG_REALTIME_URL=$(require_output "$API_STACK" GraphQlRealtimeUrl)
CFG_USER_POOL_ID=$(require_output "$API_STACK" UserPoolId)
CFG_CLIENT_ID=$(require_output "$API_STACK" UserPoolClientId)
CFG_COGNITO_DOMAIN=$(require_output "$API_STACK" CognitoDomain)
export CFG_GRAPHQL_URL CFG_REALTIME_URL CFG_USER_POOL_ID CFG_CLIENT_ID CFG_COGNITO_DOMAIN

node -e '
const e = process.env;
process.stdout.write(JSON.stringify({
  stage: e.CFG_STAGE,
  region: e.CFG_REGION,
  graphqlUrl: e.CFG_GRAPHQL_URL,
  realtimeUrl: e.CFG_REALTIME_URL,
  userPoolId: e.CFG_USER_POOL_ID,
  userPoolClientId: e.CFG_CLIENT_ID,
  cognitoDomain: e.CFG_COGNITO_DOMAIN,
  version: e.CFG_VERSION,
}, null, 2) + "\n");
'
