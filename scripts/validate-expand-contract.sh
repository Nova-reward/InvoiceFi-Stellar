#!/bin/bash
# =============================================================================
# validate-expand-contract.sh
#
# Static validator for the expand-contract migration pattern.
#
# Checks:
#   1. Expand migrations must NOT contain DROP TABLE / DROP COLUMN / DROP INDEX.
#   2. Every contract migration must have a corresponding expand migration
#      that addresses the same logical change.
#   3. Contract migrations that are part of a multi-step rename series MUST be
#      preceded by TWO expand migrations (part1 and part2); a series that skips
#      from expand_part1 directly to contract (omitting the backfill step) is
#      rejected.  This prevents deploying a migration that would lose data by
#      removing a column before it has been backfilled.
#
# Exit codes:
#   0  All checks pass
#   1  One or more checks failed
# =============================================================================
set -euo pipefail

echo "Validating expand-contract pattern compliance..."

MIGRATIONS_DIR="${MIGRATIONS_DIR:-backend/prisma/migrations}"
EXPAND_MIGRATIONS=()
CONTRACT_MIGRATIONS=()
ERRORS=0

# Categorise migrations
for migration_dir in "${MIGRATIONS_DIR}"/*/; do
  if [ -d "${migration_dir}" ]; then
    migration_name=$(basename "${migration_dir}")

    # Skip the baseline init migration
    if [ "${migration_name}" = "00000000000000_init" ]; then
      continue
    fi

    if [[ "${migration_name}" =~ _expand_ ]]; then
      EXPAND_MIGRATIONS+=("${migration_name}")
    elif [[ "${migration_name}" =~ _contract_ ]]; then
      CONTRACT_MIGRATIONS+=("${migration_name}")
    fi
  fi
done

echo "Found ${#EXPAND_MIGRATIONS[@]} expand migration(s)"
echo "Found ${#CONTRACT_MIGRATIONS[@]} contract migration(s)"

# ---------------------------------------------------------------------------
# Check 1: expand migrations must not contain destructive DDL
# ---------------------------------------------------------------------------
echo ""
echo "Check 1: Expand migrations must not contain DROP operations..."
for expand in "${EXPAND_MIGRATIONS[@]}"; do
  migration_file="${MIGRATIONS_DIR}/${expand}/migration.sql"

  if [ -f "${migration_file}" ]; then
    if grep -qi "DROP TABLE\|DROP COLUMN\|DROP INDEX" "${migration_file}"; then
      echo "::error::Expand migration '${expand}' contains DROP operations (not allowed in expand phase)"
      ERRORS=$((ERRORS + 1))
    fi
  fi
done

# ---------------------------------------------------------------------------
# Check 2: every contract migration must have a matching expand migration
# ---------------------------------------------------------------------------
echo "Check 2: Contract migrations must have a corresponding expand migration..."
for contract in "${CONTRACT_MIGRATIONS[@]}"; do
  # Extract the description part after "_contract_"
  description="${contract#*_contract_}"

  # Look for any expand migration whose name contains the same description
  # (case-insensitive prefix match on the description token)
  corresponding_expand=""
  for expand in "${EXPAND_MIGRATIONS[@]}"; do
    expand_desc="${expand#*_expand_}"
    # Normalise by stripping trailing _part[0-9] suffix for looser matching
    expand_base="${expand_desc%_part*}"
    contract_base="${description%_part*}"
    if [[ "${expand_base,,}" == "${contract_base,,}" ]]; then
      corresponding_expand="${expand}"
      break
    fi
  done

  if [ -z "${corresponding_expand}" ]; then
    echo "::warning::Contract migration '${contract}' has no obvious corresponding expand migration (description: '${description}')"
  else
    echo "  Matched '${contract}' -> '${corresponding_expand}'"
  fi
done

# ---------------------------------------------------------------------------
# Check 3: multi-step rename series must not skip the intermediate backfill
#
# A valid series looks like:
#   <ts1>_expand_rename_<desc>_part1   (add new column)
#   <ts2>_expand_rename_<desc>_part2   (backfill + index)
#   <ts3>_contract_<desc>              (drop old column)
#
# An INVALID series that skips part2 looks like:
#   <ts1>_expand_rename_<desc>_part1
#   <ts2>_contract_<desc>
#
# Detection strategy: for each contract migration, collect the expand
# migrations that share the same normalised description base.  If the
# contract migration name contains "rename" and there is only ONE expand
# migration for that description (i.e. part2 is missing), emit an error.
# ---------------------------------------------------------------------------
echo "Check 3: Multi-step rename series must not skip the backfill step..."
for contract in "${CONTRACT_MIGRATIONS[@]}"; do
  description="${contract#*_contract_}"
  contract_base="${description%_part*}"

  # Collect all expand migrations for this description base
  matching_expands=()
  for expand in "${EXPAND_MIGRATIONS[@]}"; do
    expand_desc="${expand#*_expand_}"
    expand_base="${expand_desc%_part*}"
    if [[ "${expand_base,,}" == "${contract_base,,}" ]]; then
      matching_expands+=("${expand}")
    fi
  done

  # If the contract is part of a rename series and has fewer than 2 expand
  # predecessors, the backfill step is missing.
  if [[ "${contract,,}" == *"rename"* ]] && [ "${#matching_expands[@]}" -lt 2 ]; then
    echo "::error::Contract migration '${contract}' appears to skip the intermediate backfill step."
    echo "::error::  Expected at least 2 expand migrations for '${contract_base}' (part1 add-column + part2 backfill)."
    echo "::error::  Found: ${matching_expands[*]:-none}"
    echo "::error::  A rename contract migration MUST be preceded by both expand_part1 and expand_part2."
    ERRORS=$((ERRORS + 1))
  elif [[ "${contract,,}" == *"rename"* ]]; then
    echo "  Rename series for '${contract_base}' has ${#matching_expands[@]} expand migration(s) - OK"
  fi
done

# ---------------------------------------------------------------------------
# Result
# ---------------------------------------------------------------------------
echo ""
if [ "${ERRORS}" -eq 0 ]; then
  echo "Expand-contract pattern validated successfully."
  exit 0
else
  echo "::error::${ERRORS} expand-contract validation error(s) found."
  exit 1
fi
