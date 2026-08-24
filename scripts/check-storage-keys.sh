#!/usr/bin/env bash
set -euo pipefail

echo "====================================================="
echo " InvoiceFi Storage Key Collision & Namespacing Check "
echo "====================================================="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "--> Checking contract prefix namespacing definitions..."

CONTRACTS=("access-control" "invoice" "financing-pool" "settlement")
PREFIXES=()

for contract in "${CONTRACTS[@]}"; do
    FILE="${ROOT_DIR}/contracts/${contract}/src/lib.rs"
    if [ ! -f "$FILE" ]; then
        echo "Error: Contract file $FILE not found!"
        exit 1
    fi
    PREFIX=$(grep -E 'pub const CONTRACT_PREFIX:' "$FILE" | head -n1 | cut -d'"' -f2 || true)
    if [ -z "$PREFIX" ]; then
        echo "Error: CONTRACT_PREFIX not found in $contract/src/lib.rs"
        exit 1
    fi
    echo "  - Contract '$contract' uses CONTRACT_PREFIX: '$PREFIX'"
    PREFIXES+=("$PREFIX")
done

# Check for duplicate prefixes
UNIQUE_PREFIXES=($(echo "${PREFIXES[@]}" | tr ' ' '\n' | sort -u))
if [ "${#PREFIXES[@]}" -ne "${#UNIQUE_PREFIXES[@]}" ]; then
    echo "ERROR: Duplicate CONTRACT_PREFIX detected across contracts!"
    exit 1
fi
echo "✓ All contracts use unique CONTRACT_PREFIX values."

echo "--> Running Rust storage key collision integration tests..."
cd "${ROOT_DIR}/contracts"
cargo test -p integration-tests --test storage_key_collision_test -- --nocapture

echo "====================================================="
echo " SUCCESS: Storage key collision check passed!        "
echo "====================================================="
