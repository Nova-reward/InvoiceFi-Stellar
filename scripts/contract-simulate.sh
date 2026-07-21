#!/usr/bin/env bash
# ------------------------------------------------------------------
# Contract Simulation Runner
#
# For each contract that has changed, builds a release WASM and runs
# `soroban contract simulate` against every public entry point with
# representative test inputs defined in the script.
#
# Outputs per-entry-point resource usage as JSON lines to stdout:
#   {"contract":"<name>","entry":"<fn>","status":"ok|err","instructions":N,"fee":N}
#   {"contract":"<name>","entry":"<fn>","status":"err","error":"..."}
#
# Also writes a human-readable summary to a given output file.
# ------------------------------------------------------------------
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT_FILE="${1:-/tmp/contract-simulate-results.json}"
SUMMARY_FILE="${2:-/tmp/contract-simulate-summary.md}"
CHANGED_CONTRACTS="${3:-}"

# ---- helpers ----------------------------------------------------------------
info()  { echo "[info] $*"; }
err()   { echo "[error] $*" >&2; }

# ---- detect changed contracts ------------------------------------------------
detect_changed_contracts() {
  if [[ -n "$CHANGED_CONTRACTS" ]]; then
    echo "$CHANGED_CONTRACTS" | tr ',' '\n'
    return
  fi

  # If no explicit list, use git diff against base branch
  local base_ref="${BASE_BRANCH:-origin/main}"
  if git rev-parse --verify "$base_ref" &>/dev/null; then
    git diff --name-only "$base_ref" -- 'contracts/' | cut -d/ -f2 | sort -u
  else
    # Fall back: list all contracts
    for d in "$REPO_ROOT/contracts/"*/; do
      basename "$d"
    done
  fi
}

# ---- build WASM for a contract -----------------------------------------------
build_wasm() {
  local contract_dir=$1
  local contract_name
  contract_name=$(basename "$contract_dir")
  local wasm_out="/tmp/contracts-ci/${contract_name}.wasm"

  mkdir -p /tmp/contracts-ci

  info "Building WASM for $contract_name ..."
  CARGO_TARGET_DIR=/tmp/contracts-ci/target \
    cargo build \
    --manifest-path "$contract_dir/Cargo.toml" \
    --release \
    --target wasm32-unknown-unknown \
    2>&1

  # Find the built wasm (soroban puts it in target dir)
  local wasm_file
  wasm_file=$(find /tmp/contracts-ci/target/wasm32-unknown-unknown/release/ \
    -name "${contract_name//-/_}.wasm" -type f 2>/dev/null | head -1)

  if [[ -z "$wasm_file" ]]; then
    err "WASM not found for $contract_name"
    return 1
  fi

  cp "$wasm_file" "$wasm_out"
  echo "$wasm_out"
}

# ---- run soroban simulate ----------------------------------------------------
run_simulate() {
  local wasm_path=$1
  local contract_name=$2
  local entry_fn=$3
  shift 3
  local args=("$@")

  soroban contract simulate \
    --wasm "$wasm_path" \
    --function "$entry_fn" \
    --args "${args[@]}" \
    2>/dev/null || true
}

# ---- extract resource metrics -------------------------------------------------
extract_metrics() {
  local sim_json=$1
  local entry=$2
  local contract=$3

  if [[ -z "$sim_json" ]]; then
    echo "{\"contract\":\"$contract\",\"entry\":\"$entry\",\"status\":\"err\",\"error\":\"empty response\"}"
    return
  fi

  # Try to parse CPU instructions and fee from the simulation output.
  # soroban-cli outputs JSON with a "cost" or "footprint" section.
  local instructions fee
  instructions=$(echo "$sim_json" | jq -r '.cost.cpu_instructions // .cpu_instructions // .instructions // empty' 2>/dev/null || echo "")
  fee=$(echo "$sim_json" | jq -r '.cost.fee // .fee // empty' 2>/dev/null || echo "")

  if [[ -n "$instructions" && "$instructions" != "null" ]]; then
    echo "{\"contract\":\"$contract\",\"entry\":\"$entry\",\"status\":\"ok\",\"instructions\":$instructions,\"fee\":${fee:-0}}"
  else
    # Could be an error
    local error_msg
    error_msg=$(echo "$sim_json" | jq -r '.error // .message // "unknown"' 2>/dev/null | head -c 200)
    echo "{\"contract\":\"$contract\",\"entry\":\"$entry\",\"status\":\"err\",\"error\":\"$error_msg\"}"
  fi
}

# ---- entry points with representative inputs ----------------------------------
# Define representative test inputs per contract.
# Extend this map as new contracts and entry points are added.

declare -A CONTRACT_ENTRY_POINTS

# invoice contract (soroban-sdk v26)
CONTRACT_ENTRY_POINTS["invoice"]='{
  "initialize":    ["--arg", "address", "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"],
  "mint":          ["--arg", "address", "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", "--arg", "i128", "1000", "--arg", "symbol", "MAIZE", "--arg", "u64", "1900000000", "--arg", "string", "ipfs://valuation"],
  "get_invoice":   ["--arg", "u64", "1"],
  "owner_of":      ["--arg", "u64", "1"],
  "status_of":     ["--arg", "u64", "1"],
  "total_minted":  [],
  "exists":        ["--arg", "u64", "1"],
  "admin":         []
}'

# financing-pool contract (soroban-sdk v26)
CONTRACT_ENTRY_POINTS["financing-pool"]='{
  "initialize":           ["--arg", "address", "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", "--arg", "u32", "1000"],
  "deposit":              ["--arg", "address", "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", "--arg", "i128", "10000"],
  "withdraw":             ["--arg", "address", "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", "--arg", "i128", "100"],
  "fund_invoice":         ["--arg", "u64", "1", "--arg", "i128", "1000", "--arg", "address", "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"],
  "quote":                ["--arg", "i128", "1000"],
  "discount_amount":      ["--arg", "i128", "1000"],
  "balance_of":           ["--arg", "address", "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"],
  "available_liquidity":  [],
  "discount_bps":         [],
  "get_funding":          ["--arg", "u64", "1"],
  "is_funded":            ["--arg", "u64", "1"],
  "admin":                []
}'

# settlement contract (soroban-sdk v21) — separate workspace
CONTRACT_ENTRY_POINTS["settlement"]='{
  "init":                     ["--arg", "address", "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"],
  "get_admin":                [],
  "get_fee_rate":             [],
  "get_collected_fees":       [],
  "get_withdrawn_fees":       [],
  "list_authorized_payers":   [],
  "list_financiers":          [],
  "list_invoices":            []
}'

# ---- main --------------------------------------------------------------------
echo "[]" > "$OUTPUT_FILE"
results_json="["

changed=$(detect_changed_contracts)
first_result=true

for contract in $changed; do
  contract_dir="$REPO_ROOT/contracts/$contract"
  if [[ ! -d "$contract_dir" ]]; then
    info "Skipping $contract — no directory found"
    continue
  fi

  info "Processing contract: $contract"

  # Build WASM
  wasm_path=$(build_wasm "$contract_dir") || {
    err "Failed to build $contract, skipping simulation"
    if [[ "$first_result" == true ]]; then first_result=false; else results_json+=","; fi
    results_json+="{\"contract\":\"$contract\",\"entry\":\"build\",\"status\":\"err\",\"error\":\"build failed\"}"
    continue
  }

  # Look up entry points
  entries_json="${CONTRACT_ENTRY_POINTS[$contract]:-}"
  if [[ -z "$entries_json" || "$entries_json" == "{}" ]]; then
    info "No entry points defined for $contract, skipping simulation"
    if [[ "$first_result" == true ]]; then first_result=false; else results_json+=","; fi
    results_json+="{\"contract\":\"$contract\",\"entry\":\"all\",\"status\":\"skip\",\"error\":\"no entry points defined\"}"
    continue
  fi

  # Iterate over entry points
  for entry in $(echo "$entries_json" | jq -r 'keys[]'); do
    args_json=$(echo "$entries_json" | jq -r ".[\"$entry\"] | @json")
    # Convert JSON args array to shell array
    eval "args_arr=($(echo "$args_json" | jq -r '.[] | @sh'))"

    info "  Simulating $entry ..."
    sim_output=$(run_simulate "$wasm_path" "$contract" "$entry" "${args_arr[@]}")
    result=$(extract_metrics "$sim_output" "$entry" "$contract")

    if [[ "$first_result" == true ]]; then first_result=false; else results_json+=","; fi
    results_json+="$result"
  done
done

results_json+="]"
echo "$results_json" > "$OUTPUT_FILE"

# ---- generate summary markdown ------------------------------------------------
cat > "$SUMMARY_FILE" <<'MDHEADER'
# Contract Simulation Results

| Contract | Entry Point | Status | Instructions | Fee |
|----------|------------|--------|-------------|-----|
MDHEADER

echo "$results_json" | jq -r '.[] | 
  "|\(.contract)|\(.entry)|\(.status)|\(.instructions // "—")|\(.fee // "—")|"' \
  >> "$SUMMARY_FILE" 2>/dev/null || true

# Check for errors
errors=$(echo "$results_json" | jq '[.[] | select(.status == "err")] | length')
if [[ "$errors" -gt 0 ]]; then
  echo "" >> "$SUMMARY_FILE"
  echo "### ❌ Simulation Errors ($errors)" >> "$SUMMARY_FILE"
  echo "$results_json" | jq -r '.[] | select(.status == "err") | "- **\(.contract)/\(.entry)**: \(.error)"' \
    >> "$SUMMARY_FILE"
fi

echo ""
info "Simulation results written to $OUTPUT_FILE"
info "Summary written to $SUMMARY_FILE"
echo ""
echo "=== Simulation Summary ==="
cat "$SUMMARY_FILE"
echo "========================"

# Exit non-zero if any simulation failed
if [[ "$errors" -gt 0 ]]; then
  exit 1
fi
