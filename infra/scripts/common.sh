#!/usr/bin/env bash
# Shared helpers for the deployment scripts. Source it; do not execute it.
# shellcheck disable=SC2034  # variables are used by the scripts that source this file

APP_NAME="${APP_NAME:-gqlapp}"
SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(cd "$SCRIPTS_DIR/.." && pwd)"
ROOT_DIR="$(cd "$INFRA_DIR/.." && pwd)"

die() { echo "error: $*" >&2; exit 1; }
log() { echo "▶ $*" >&2; }

require_stage() {
  case "${1:-}" in
    staging | prod) ;;
    *) die "stage must be 'staging' or 'prod' (got '${1:-}')" ;;
  esac
}

load_stage_env() {
  require_stage "$1"
  # shellcheck source=/dev/null
  source "$INFRA_DIR/env/$1.env"
}

stack_exists() {
  aws cloudformation describe-stacks --stack-name "$1" >/dev/null 2>&1
}

# Prints a stack output value, or nothing when the stack/output does not exist.
stack_output() {
  local value
  value=$(aws cloudformation describe-stacks --stack-name "$1" \
    --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue | [0]" --output text 2>/dev/null || true)
  [[ "$value" == "None" ]] && value=""
  printf '%s' "$value"
}

# Prints a stack parameter value, or nothing when the stack/parameter does not exist.
stack_param() {
  local value
  value=$(aws cloudformation describe-stacks --stack-name "$1" \
    --query "Stacks[0].Parameters[?ParameterKey=='$2'].ParameterValue | [0]" --output text 2>/dev/null || true)
  [[ "$value" == "None" ]] && value=""
  printf '%s' "$value"
}

require_output() {
  local value
  value=$(stack_output "$1" "$2")
  [[ -n "$value" ]] || die "stack $1 has no output $2 (is it deployed?)"
  printf '%s' "$value"
}
