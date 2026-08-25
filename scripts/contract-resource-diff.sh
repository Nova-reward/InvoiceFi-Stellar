#!/usr/bin/env bash
# ------------------------------------------------------------------
# Contract Resource Diff Script
#
# Compares resource usage (instruction count, fee estimates) between
# the base branch and the PR branch for each contract entry point
# that was simulated.
#
# Requires:
#   - scripts/contract-simulate.sh  (produces the JSON results)
#   - Base branch WASM results in /tmp/contracts-ci/base-results.json
#   - PR branch WASM results in /tmp/contracts-ci/pr-results.json
#
# Outputs a markdown diff report to PR_COMMENT_FILE (default:
# /tmp/contracts-ci/resource-diff.md).
# ------------------------------------------------------------------
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE_RESULTS="${1:-/tmp/contracts-ci/base-results.json}"
PR_RESULTS="${2:-/tmp/contracts-ci/pr-results.json}"
OUTPUT_FILE="${3:-/tmp/contracts-ci/resource-diff.md}"

mkdir -p "$(dirname "$OUTPUT_FILE")"

info()  { echo "[info] $*"; }
err()   { echo "[error] $*" >&2; }

# ---- load results ------------------------------------------------------------
if [[ ! -f "$BASE_RESULTS" ]]; then
  info "No base results found at $BASE_RESULTS — performing fresh simulation on base branch"

  # Checkout base branch, run simulation, return
  local base_ref="${BASE_BRANCH:-origin/main}"
  local current_branch
  current_branch=$(git rev-parse --abbrev-ref HEAD)

  # Stash uncommitted changes
  git stash --include-untracked 2>/dev/null || true
  git checkout "$base_ref" 2>/dev/null || true

  "$REPO_ROOT/scripts/contract-simulate.sh" \
    "$BASE_RESULTS" \
    "/tmp/contracts-ci/base-summary.md"

  # Return to original branch
  git checkout "$current_branch" 2>/dev/null || true
  git stash pop 2>/dev/null || true
fi

if [[ ! -f "$PR_RESULTS" ]]; then
  info "No PR results found at $PR_RESULTS — running simulation on current branch"
  "$REPO_ROOT/scripts/contract-simulate.sh" \
    "$PR_RESULTS" \
    "/tmp/contracts-ci/pr-summary.md"
fi

# ---- diff resources -----------------------------------------------------------
info "Comparing resource usage ..."

cat > "$OUTPUT_FILE" <<'MDHEADER'
# Contract Resource Diff Report

_Compares instruction count and fee estimates between base and PR branches._

> **Legend:** ✅ = no change  📈 = regressed  📉 = improved  ❌ = simulation error

| Contract | Entry Point | Base Instr | PR Instr | Δ Instr | Base Fee | PR Fee | Δ Fee | Status |
|----------|------------|-----------|---------|---------|---------|-------|-------|--------|
MDHEADER

has_regression=false

# Join base and PR results on (contract, entry) and compute diffs
jq -s '
  def idx: {(.contract): (.)};
  (.[0] | group_by(.contract + ":" + .entry) | map({key: .[0].contract + ":" + .[0].entry, value: .[0]})) as $base_map |
  (.[1] | group_by(.contract + ":" + .entry) | map({key: .[0].contract + ":" + .[0].entry, value: .[0]})) as $pr_map |
  $base_map + $pr_map | group_by(.key) | map({
    key: .[0].key,
    base: .[0].value,
    pr: (if .[1] then .[1].value else null end)
  })
' "$BASE_RESULTS" "$PR_RESULTS" 2>/dev/null | \
jq -r '.[] | 
  if (.base.status == "ok" and .pr.status == "ok") then
    (.base.contract as $c | .base.entry as $e |
     (.base.instructions | tostring) as $bi |
     (.pr.instructions | tostring) as $pi |
     ((.pr.instructions - .base.instructions) | tostring) as $di |
     (.base.fee | tostring) as $bf |
     (.pr.fee | tostring) as $pf |
     ((.pr.fee - .base.fee) | tostring) as $df |
     (if (.pr.instructions > .base.instructions) then "📈" elif (.pr.instructions < .base.instructions) then "📉" else "✅" end) as $icon |
     "|\($c)|\($e)|\($bi)|\($pi)|\($di)|\($bf)|\($pf)|\($df)|\($icon)|")
  elif (.pr.status == "err") then
    "|\(.base.contract // "")|\(.base.entry // "")|—|—|—|—|—|—|❌ \(.pr.error // "error")|"
  elif (.base.status == "err" and .pr.status == "ok") then
    "|\(.pr.contract)|\(.pr.entry)|—|\(.pr.instructions)|new|—|\(.pr.fee)|new|✅ (new entry point)|"
  else
    "|\(.base.contract // "")|\(.base.entry // "")|—|—|—|—|—|—|⏭️ skipped|"
  end' >> "$OUTPUT_FILE" 2>/dev/null || true

# ---- identify regressions -----------------------------------------------------
echo "" >> "$OUTPUT_FILE"
echo "## Summary" >> "$OUTPUT_FILE"

total=$(jq -s '[.[]] | length' "$BASE_RESULTS" "$PR_RESULTS" 2>/dev/null || echo 0)
err_count=$(jq -s '[.[][]] | select(.status == "err") | length' "$BASE_RESULTS" "$PR_RESULTS" 2>/dev/null || echo 0)
regressions=$(jq -s '
  .[0] as $base | .[1] as $pr |
  [$pr[] | select(.status == "ok") as $p |
   $base[] | select(.contract == $p.contract and .entry == $p.entry and .status == "ok") |
   if ($p.instructions > .instructions) then "\($p.contract)/\($p.entry): +\($p.instructions - .instructions) instructions" else empty end]
' "$BASE_RESULTS" "$PR_RESULTS" 2>/dev/null | jq -r '.[]')

new_entries=$(jq -s '
  .[1] as $pr | .[0] as $base |
  [$pr[] | select(.status == "ok") as $p |
   if ([$base[] | select(.contract == $p.contract and .entry == $p.entry)] | length) == 0 then
     "\($p.contract)/\($p.entry)"
   else empty end]
' "$BASE_RESULTS" "$PR_RESULTS" 2>/dev/null | jq -r '.[]')

echo "- **Total entry points compared:** $total" >> "$OUTPUT_FILE"
echo "- **Simulation errors:** $err_count" >> "$OUTPUT_FILE"

if [[ -n "$regressions" ]]; then
  has_regression=true
  echo "" >> "$OUTPUT_FILE"
  echo "### 🚨 Performance Regressions Detected" >> "$OUTPUT_FILE"
  echo "$regressions" | while IFS= read -r line; do
    echo "- $line" >> "$OUTPUT_FILE"
  done
fi

if [[ -n "$new_entries" ]]; then
  echo "" >> "$OUTPUT_FILE"
  echo "### 🆕 New Entry Points (no baseline)" >> "$OUTPUT_FILE"
  echo "$new_entries" | while IFS= read -r line; do
    echo "- $line" >> "$OUTPUT_FILE"
  done
fi

echo ""
echo "=== Resource Diff Report ==="
cat "$OUTPUT_FILE"
echo "==========================="

if [[ "$has_regression" == true ]]; then
  err "Performance regressions detected — see report for details."
  info "Note: instruction count increases are expected for new functionality."
  info "Review the diff report to determine if regressions are acceptable."
fi
