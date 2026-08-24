#!/usr/bin/env bash
#
# setup-test-env.sh – One-shot script to provision test accounts, deploy
# contracts, and verify the local stack is ready for E2E testing.
#
# Usage:
#   ./scripts/setup-test-env.sh
#
# Requires: docker, node, stellar CLI

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
E2E_DIR="$(dirname "$SCRIPT_DIR")"
ROOT_DIR="$(dirname "$E2E_DIR")"

log() {
  echo "[setup] $*"
}

check_deps() {
  local missing=()
  command -v docker >/dev/null 2>&1 || missing+=("docker")
  command -v node >/dev/null 2>&1 || missing+=("node")
  command -v stellar >/dev/null 2>&1 || missing+=("stellar CLI")

  if [ ${#missing[@]} -gt 0 ]; then
    echo "Missing required dependencies: ${missing[*]}"
    exit 1
  fi
  log "All dependencies found."
}

wait_for_service() {
  local url="$1"
  local name="$2"
  local max_retries="${3:-30}"
  local delay="${4:-5}"

  log "Waiting for $name at $url..."
  for i in $(seq 1 "$max_retries"); do
    if curl -sf "$url" > /dev/null 2>&1; then
      log "$name is ready."
      return 0
    fi
    sleep "$delay"
  done

  log "ERROR: $name did not become ready after $((max_retries * delay))s"
  exit 1
}

start_stack() {
  log "Starting Docker Compose stack..."
  cd "$ROOT_DIR"
  docker compose up -d --build --remove-orphans
  cd "$E2E_DIR"
}

provision_accounts() {
  log "Provisioning Stellar test accounts..."
  node "$SCRIPT_DIR/provision-accounts.mjs"
}

deploy_contracts() {
  log "Deploying Soroban contracts..."
  node "$SCRIPT_DIR/deploy-contracts.mjs"
}

verify_stack() {
  log "Verifying stack health..."

  wait_for_service "http://localhost:5432" "PostgreSQL" 20 3 || true
  wait_for_service "http://localhost:8000" "Horizon" 30 5
  wait_for_service "http://localhost:8001" "Soroban RPC" 30 5
  wait_for_service "http://localhost:4000/health" "Backend API" 30 5
  wait_for_service "http://localhost:3000" "Frontend" 30 5

  log "All services healthy."
}

run_tests() {
  log "Running E2E tests..."
  cd "$E2E_DIR"
  npx playwright test --reporter=list
}

main() {
  log "=== InvoiceFi E2E Test Environment Setup ==="

  check_deps
  start_stack
  verify_stack
  provision_accounts
  deploy_contracts
  verify_stack

  log "=== Setup complete ==="
  log ""
  log "To run tests:  cd tests/e2e && npm test"
  log "To run headed: cd tests/e2e && npm run test:headed"
  log "To debug:      cd tests/e2e && npm run test:debug"
}

if [[ "${1:-}" == "--run-tests" ]]; then
  main
  run_tests
else
  main
fi
