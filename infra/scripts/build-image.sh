#!/usr/bin/env bash
# Builds and pushes the private GraphQL server image, tagged with the git SHA.
# Tags are immutable: if the image already exists (e.g. built for staging) it is
# promoted as-is, so production runs the exact bytes that passed staging.
#
#   GIT_SHA=<sha> build-image.sh        -> prints image_uri=<uri> (for $GITHUB_OUTPUT)
set -euo pipefail
# shellcheck source=infra/scripts/common.sh
source "$(dirname "$0")/common.sh"

[[ -n "${GIT_SHA:-}" ]] || die "GIT_SHA must be set"
REPO_URI=$(require_output "$APP_NAME-bootstrap" EcrRepositoryUri)
REGISTRY="${REPO_URI%%/*}"
REPO_NAME="${REPO_URI#*/}"
IMAGE="$REPO_URI:$GIT_SHA"

if aws ecr describe-images --repository-name "$REPO_NAME" --image-ids "imageTag=$GIT_SHA" >/dev/null 2>&1; then
  log "Image $IMAGE already exists - promoting it unchanged"
else
  log "Building $IMAGE"
  aws ecr get-login-password | docker login --username AWS --password-stdin "$REGISTRY" >/dev/null
  docker build \
    --file "$ROOT_DIR/services/graphql-server/Dockerfile" \
    --label "org.opencontainers.image.revision=$GIT_SHA" \
    --tag "$IMAGE" \
    "$ROOT_DIR"
  docker push "$IMAGE"
fi

echo "image_uri=$IMAGE"
