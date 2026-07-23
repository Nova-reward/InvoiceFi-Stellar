#!/bin/bash
set -euo pipefail

# Validate expand-contract pattern compliance
# Ensures contract migrations have corresponding expand migrations

echo "Validating expand-contract pattern compliance..."

MIGRATIONS_DIR="backend/prisma/migrations"
EXPAND_MIGRATIONS=()
CONTRACT_MIGRATIONS=()

# Categorize migrations
for migration_dir in "$MIGRATIONS_DIR"/*; do
  if [ -d "$migration_dir" ]; then
    migration_name=$(basename "$migration_dir")
    
    # Skip the init migration
    if [ "$migration_name" = "00000000000000_init" ]; then
      continue
    fi
    
    if [[ "$migration_name" =~ _expand_ ]]; then
      EXPAND_MIGRATIONS+=("$migration_name")
    elif [[ "$migration_name" =~ _contract_ ]]; then
      CONTRACT_MIGRATIONS+=("$migration_name")
    fi
  fi
done

echo "Found ${#EXPAND_MIGRATIONS[@]} expand migrations"
echo "Found ${#CONTRACT_MIGRATIONS[@]} contract migrations"

# Validate contract migrations have corresponding expand migrations
for contract in "${CONTRACT_MIGRATIONS[@]}"; do
  # Extract the description part (after contract_)
  description="${contract#*_contract_}"
  
  # Look for corresponding expand migration
  # This is a simple check - in practice, you might want more sophisticated matching
  corresponding_expand=$(printf "%s\n" "${EXPAND_MIGRATIONS[@]}" | grep -i "${description}" || true)
  
  if [ -z "$corresponding_expand" ]; then
    echo "::warning::Contract migration $contract has no obvious corresponding expand migration"
  fi
done

# Validate expand migrations don't contain contract operations
for expand in "${EXPAND_MIGRATIONS[@]}"; do
  migration_file="$MIGRATIONS_DIR/$expand/migration.sql"
  
  if [ -f "$migration_file" ]; then
    if grep -qi "DROP TABLE\|DROP COLUMN\|DROP INDEX" "$migration_file"; then
      echo "::error::Expand migration $expand contains DROP operations (not allowed in expand phase)"
      exit 1
    fi
  fi
done

echo "✓ Expand-contract pattern validated"
