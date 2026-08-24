#!/usr/bin/env bash
# scripts/pin-wasm-artifacts.sh
#
# Builds all three InvoiceFi Stellar contracts in release mode and copies
# the resulting WASM binaries into contracts/wasm-artifacts/v1/.
#
# Usage:
#   bash scripts/pin-wasm-artifacts.sh
#
# After running, commit the updated WASMs:
#   git add contracts/wasm-artifacts/v1/
#   git commit -m "chore: pin v1 wasm baseline"

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARTIFACT_DIR="${REPO_ROOT}/contracts/wasm-artifacts/v1"
CONTRACTS_DIR="${REPO_ROOT}/contracts"
TARGET_DIR="${CONTRACTS_DIR}/target/wasm32-unknown-unknown/release"

echo "▶  Building contracts in release mode…"
(
    cd "${CONTRACTS_DIR}"
    cargo build \
        --release \
        --target wasm32-unknown-unknown \
        -p invoice-contract \
        -p financing-pool-contract \
        -p settlement-contract
)

mkdir -p "${ARTIFACT_DIR}"

declare -A WASM_MAP=(
    ["invoice_contract.wasm"]="${TARGET_DIR}/invoice_contract.wasm"
    ["financing_pool_contract.wasm"]="${TARGET_DIR}/financing_pool_contract.wasm"
    ["settlement_contract.wasm"]="${TARGET_DIR}/settlement_contract.wasm"
)

echo ""
echo "▶  Copying WASM artifacts to ${ARTIFACT_DIR}…"
for dest_name in "${!WASM_MAP[@]}"; do
    src="${WASM_MAP[$dest_name]}"
    dest="${ARTIFACT_DIR}/${dest_name}"
    if [[ ! -f "${src}" ]]; then
        echo "  ✗  ${src} not found — build may have failed"
        exit 1
    fi
    cp "${src}" "${dest}"
    SIZE=$(du -sh "${dest}" | cut -f1)
    echo "  ✓  ${dest_name} (${SIZE})"
done

echo ""
echo "Done. Commit the updated WASMs:"
echo "  git add ${ARTIFACT_DIR}/"
echo "  git commit -m 'chore: pin vN wasm baseline'"
