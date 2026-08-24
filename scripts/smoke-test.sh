#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# InvoiceFi-Stellar – Smoke Test Suite
#
# Runs a battery of health and integration checks against a deployed stack.
# Succeeds (exit 0) only if ALL checks pass. Used as the deployment gate
# between staging and production — a failing smoke test blocks the cutover.
#
# Usage:
#   bash scripts/smoke-test.sh [--flags]
#
# Flags:
#   --base-url URL      Base URL of the deployed API (default: http://localhost:4000)
#   --horizon-url URL   Stellar Horizon URL for chain queries (default: http://localhost:8000)
#   --timeout SECS      Max seconds per check (default: 15)
#   --verbose           Print detailed pass/fail per check
#   --help              Show this help message
#
# Exit codes:
#   0  All checks passed
#   1  One or more checks failed (gate the cutover)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Defaults ────────────────────────────────────────────────────────────────
BASE_URL="http://localhost:4000"
HORIZON_URL="http://localhost:8000"
TIMEOUT=15
VERBOSE=false

# ── Parse arguments ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url)    BASE_URL="$2";    shift 2 ;;
    --horizon-url) HORIZON_URL="$2"; shift 2 ;;
    --timeout)     TIMEOUT="$2";     shift 2 ;;
    --verbose)     VERBOSE=true;     shift   ;;
    --help|-h)
      sed -n '/^# Usage:/,/^exit codes:/p' "$0" | sed 's/^# //'
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 2 ;;
  esac
done

# ── Globals ──────────────────────────────────────────────────────────────────
PASS_COUNT=0
FAIL_COUNT=0
declare -a FAILURES

# ── Helpers ──────────────────────────────────────────────────────────────────
pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  if [[ "$VERBOSE" == true ]]; then echo "  ✅ $1"; fi
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  FAILURES+=("$1: $2")
  if [[ "$VERBOSE" == true ]]; then echo "  ❌ $1 — $2"; fi
}

check_http() {
  local label="$1"
  local url="$2"
  local expected_status="${3:-200}"
  local result

  result=$(curl -sSf -o /dev/null -w '%{http_code}' \
    --max-time "$TIMEOUT" \
    "$url" 2>&1 || true)

  if [[ "$result" == "$expected_status" ]]; then
    pass "$label"
  else
    fail "$label" "HTTP $result (expected $expected_status)"
  fi
}

check_json_field() {
  local label="$1"
  local url="$2"
  local field="$3"
  local expected_value="$4"
  local result

  result=$(curl -sS --max-time "$TIMEOUT" "$url" 2>/dev/null || echo '{}')
  local actual
  actual=$(echo "$result" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    val = d
    for part in '$field'.split('.'):
        val = val.get(part, '')
    print(str(val).lower())
except Exception:
    print('parse_error')
" 2>/dev/null || echo 'fetch_error')

  if [[ "$actual" == "$expected_value" ]]; then
    pass "$label"
  else
    fail "$label" "expected $field=$expected_value, got $actual"
  fi
}

check_horizon() {
  local label="$1"
  local result

  result=$(curl -sS -o /dev/null -w '%{http_code}' \
    --max-time "$TIMEOUT" \
    "$HORIZON_URL" 2>&1 || true)

  if [[ "$result" == "200" ]]; then
    pass "$label — Horizon reachable"
  else
    fail "$label" "Horizon HTTP $result (expected 200)"
  fi
}

check_horizon_liveness() {
  local label="$1"
  local result

  # Check if Horizon is catching up / healthy
  result=$(curl -sS --max-time "$TIMEOUT" \
    "$HORIZON_URL" 2>/dev/null | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('core_latest_ledger', 0) > 0)
except Exception:
    print('false')
" 2>/dev/null || echo 'false')

  if [[ "$result" == "True" ]]; then
    pass "$label — Horizon has latest ledger"
  else
    fail "$label" "Horizon not healthy or no ledger data"
  fi
}

# ── Test Suites ──────────────────────────────────────────────────────────────

suite_header() {
  echo ""
  echo "═══════════════════════════════════════════════"
  echo "  $1"
  echo "═══════════════════════════════════════════════"
}

# ── 1. API Health ────────────────────────────────────────────────────────────
suite_header "API Health Checks"

check_http "Backend health endpoint"           "$BASE_URL/health" 200
check_http "Root endpoint reachable"           "$BASE_URL/"       200
check_json_field "API version field present"   "$BASE_URL/health" "status" "ok"

# ── 2. API Core Endpoints ────────────────────────────────────────────────────
suite_header "API Core Endpoints"

check_http "Invoice list endpoint"             "$BASE_URL/invoices"      200
check_http "Pool status endpoint"             "$BASE_URL/pool/status"    200
check_http "Settlement status endpoint"       "$BASE_URL/settlements"    200
check_http "Auth challenge endpoint"          "$BASE_URL/auth/challenge" 200

# ── 3. Stellar Network ───────────────────────────────────────────────────────
suite_header "Stellar Network"

check_horizon "Horizon API reachable"
check_horizon_liveness "Horizon ledger sync"

# ── 4. Database Connectivity ──────────────────────────────────────────────────
suite_header "Database Connectivity"

check_json_field "DB migration status" "$BASE_URL/health" "database.connected" "true"
check_http "Prisma migrate status"     "$BASE_URL/health/db" 200

# ── 5. Contract Deployment (read queries) ─────────────────────────────────────
suite_header "Contract Read Queries"

# Invoice contract — admin() read
check_http "Invoice contract admin query"        "$BASE_URL/contracts/invoice/admin" 200
# Financing pool — liquidity query
check_http "Pool liquidity query"                 "$BASE_URL/contracts/pool/liquidity" 200

# ── 6. Security Headers ──────────────────────────────────────────────────────
suite_header "Security Headers"

local STS_HEADER
STS_HEADER=$(curl -sS --max-time "$TIMEOUT" -I "$BASE_URL/health" 2>/dev/null | grep -i 'strict-transport-security' || true)
if [[ -n "$STS_HEADER" ]]; then
  pass "Strict-Transport-Security header present"
else
  fail "Security Headers" "Missing Strict-Transport-Security header"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════"
echo "  Smoke Test Summary"
echo "═══════════════════════════════════════════════"
echo "  Passed: $PASS_COUNT"
echo "  Failed: $FAIL_COUNT"
echo ""

if [[ "$FAIL_COUNT" -gt 0 ]]; then
  echo "  ❌ FAILURES:"
  for f in "${FAILURES[@]}"; do
    echo "     • $f"
  done
  echo ""
  echo "  ❌ SMOKE TEST FAILED — deployment cutover blocked."
  echo "     Investigate the failures above and re-run."
  exit 1
fi

echo "  ✅ ALL CHECKS PASSED — deployment is healthy."
exit 0
