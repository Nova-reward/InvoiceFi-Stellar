#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────────────
# Smoke Test Suite — InvoiceFi-Stellar
#
# Runs against a deployed environment to verify core functionality before
# traffic cutover. All tests must pass for the deployment to proceed.
#
# Environment variables:
#   TARGET_URL   – Base URL of the deployment to test (e.g. https://staging.invoicefi.io)
#   AUTH_TOKEN   – Bearer token for authenticated endpoints (optional in staging)
# ────────────────────────────────────────────────────────────────────────────

set -euo pipefail

TARGET_URL="${TARGET_URL:?TARGET_URL is required}"
PASS=0
FAIL=0
FAILURES=""

pass()   { PASS=$((PASS + 1)); echo "  ✅ $1"; }
fail()   { FAIL=$((FAIL + 1)); FAILURES="${FAILURES}  ❌ $1 ($2)\n"; echo "  ❌ $1 — $2"; }

echo "═══════════════════════════════════════════════════════════"
echo "  InvoiceFi Smoke Tests — ${TARGET_URL}"
echo "═══════════════════════════════════════════════════════════"

# ── Health check ──────────────────────────────────────────────────────────
echo ""
echo "── Health ────────────────────────────────────────────────"

HEALTH=$(curl -sf "${TARGET_URL}/health" 2>&1 || true)
if echo "$HEALTH" | grep -q '"ok"' || echo "$HEALTH" | grep -q '"status":"ok"'; then
  pass "Health endpoint returns ok"
else
  fail "Health endpoint" "Expected status ok, got: $HEALTH"
fi

# ── Pool stats (public) ───────────────────────────────────────────────────
echo ""
echo "── Pool Stats ────────────────────────────────────────────"

POOL=$(curl -sf "${TARGET_URL}/pool/stats" 2>&1 || true)
if echo "$POOL" | grep -q '"totalDeposited"'; then
  pass "Pool stats endpoint responds"
else
  fail "Pool stats endpoint" "Unexpected response: $POOL"
fi

# ── Invoice listing (authenticated) ──────────────────────────────────────
echo ""
echo "── Invoices ──────────────────────────────────────────────"

if [ -n "${AUTH_TOKEN:-}" ]; then
  AUTH_HEADER="Authorization: Bearer ${AUTH_TOKEN}"
  INVOICES=$(curl -sf -H "$AUTH_HEADER" "${TARGET_URL}/invoices" 2>&1 || true)
  if echo "$INVOICES" | grep -qE '(\[|\{|"id")'; then
    pass "Invoice list endpoint responds (authenticated)"
  else
    fail "Invoice list endpoint" "Unexpected response: $INVOICES"
  fi

  # Auth endpoints
  PROFILE=$(curl -sf -H "$AUTH_HEADER" "${TARGET_URL}/auth/profile" 2>&1 || true)
  if echo "$PROFILE" | grep -qE '("userId"|"role")'; then
    pass "Auth profile endpoint responds"
  else
    fail "Auth profile endpoint" "Unexpected response: $PROFILE"
  fi
else
  echo "  ⚠️  AUTH_TOKEN not set — skipping authenticated tests"
fi

# ── CORS headers ──────────────────────────────────────────────────────────
echo ""
echo "── CORS & Headers ────────────────────────────────────────"

CORS_OK=$(curl -s -o /dev/null -w "%{http_code}" -X OPTIONS \
  -H "Origin: https://app.invoicefi.io" \
  -H "Access-Control-Request-Method: GET" \
  "${TARGET_URL}/health" 2>&1 || true)
if [ "$CORS_OK" = "204" ] || [ "$CORS_OK" = "200" ]; then
  pass "CORS preflight returns $CORS_OK"
else
  fail "CORS preflight" "Expected 204/200, got $CORS_OK"
fi

CONTENT_TYPE=$(curl -sf "${TARGET_URL}/health" -w "%{content_type}" -o /dev/null 2>&1 || true)
if echo "$CONTENT_TYPE" | grep -qi "application/json"; then
  pass "Content-Type is application/json"
else
  fail "Content-Type" "Expected application/json, got $CONTENT_TYPE"
fi

# ── Response time ─────────────────────────────────────────────────────────
echo ""
echo "── Performance ───────────────────────────────────────────"

START=$(date +%s%N)
curl -sf "${TARGET_URL}/health" -o /dev/null 2>&1 || true
END=$(date +%s%N)
LATENCY=$(( (END - START) / 1000000 ))
if [ "$LATENCY" -lt 3000 ]; then
  pass "Health endpoint responds in ${LATENCY}ms (< 3s)"
else
  fail "Health endpoint latency" "${LATENCY}ms exceeds 3s threshold"
fi

# ── Summary ───────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Results:  ${PASS} passed,  ${FAIL} failed"
echo "═══════════════════════════════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "Failed checks:"
  echo -e "$FAILURES"
  exit 1
fi

exit 0
