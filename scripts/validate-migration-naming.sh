#!/bin/bash
set -euo pipefail

# Validate migration naming convention
# Pattern: YYYYMMDDHHmmss_{expand|contract}_{description}

echo "Validating migration naming convention..."

MIGRATIONS_DIR="backend/prisma/migrations"
VALID_PATTERN="^[0-9]{14}_(expand|contract)_[a-z0-9-]+$"
INVALID_MIGRATIONS=()

for migration_dir in "$MIGRATIONS_DIR"/*; do
  if [ -d "$migration_dir" ]; then
    migration_name=$(basename "$migration_dir")
    
    # Skip the init migration
    if [ "$migration_name" = "00000000000000_init" ]; then
      continue
    fi
    
    if [[ ! "$migration_name" =~ $VALID_PATTERN ]]; then
      INVALID_MIGRATIONS+=("$migration_name")
    fi
  fi
done

if [ ${#INVALID_MIGRATIONS[@]} -gt 0 ]; then
  echo "::error::Invalid migration naming convention detected:"
  for migration in "${INVALID_MIGRATIONS[@]}"; do
    echo "  - $migration"
  done
  echo "Expected pattern: YYYYMMDDHHmmss_{expand|contract}_{description}"
  exit 1
fi

echo "✓ All migrations follow the naming convention"
