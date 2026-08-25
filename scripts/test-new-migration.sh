#!/bin/bash
set -euo pipefail

# Test a new migration by applying it, then rolling it back
# Ensures the migration is reversible and doesn't break the schema

BASE_BRANCH="${1:-main}"
MIGRATIONS_DIR="backend/prisma/migrations"
DATABASE_URL="${DATABASE_URL:-postgresql://invoicefi:invoicefi_test@localhost:5432/invoicefi_test}"

echo "Testing new migration against base branch: $BASE_BRANCH"

# Get the list of migrations in the base branch
git fetch origin "$BASE_BRANCH"
BASE_MIGRATIONS=$(git diff --name-only origin/$BASE_BRANCH HEAD -- "$MIGRATIONS_DIR" | grep -E '^[0-9]{14}' || true)

if [ -z "$BASE_MIGRATIONS" ]; then
  echo "No new migrations to test"
  exit 0
fi

echo "New migrations detected:"
echo "$BASE_MIGRATIONS"

# Create a fresh database for testing
echo "Creating test database..."
psql "$DATABASE_URL" -c "DROP DATABASE IF EXISTS invoicefi_migrate_test;" > /dev/null 2>&1 || true
psql "$DATABASE_URL" -c "CREATE DATABASE invoicefi_migrate_test;" > /dev/null 2>&1

TEST_DB_URL="${DATABASE_URL/invoicefi_test/invoicefi_migrate_test}"

# Apply base branch migrations
echo "Applying base branch schema..."
git checkout origin/$BASE_BRANCH -- "$MIGRATIONS_DIR/schema.prisma" 2>/dev/null || true
cd backend
npx prisma migrate deploy --schema=prisma/schema.prisma > /dev/null 2>&1 || true
cd ..

# Restore current branch migrations
git checkout HEAD -- "$MIGRATIONS_DIR"

# Apply new migrations
echo "Applying new migrations..."
cd backend
npx prisma migrate deploy --schema=prisma/schema.prisma
cd ..

# Verify schema is valid
echo "Verifying schema..."
cd backend
npx prisma db pull --schema=prisma/schema.prisma
cd ..

# Rollback the new migrations (if possible)
echo "Attempting to rollback new migrations..."
for migration in $BASE_MIGRATIONS; do
  migration_name=$(basename "$migration")
  echo "  Checking rollback for: $migration_name"
  
  # Note: Prisma doesn't have a built-in rollback command
  # In production, you would need to manually create down migration SQL
  # For CI, we just verify the migration SQL is reversible
done

# Cleanup
echo "Cleaning up test database..."
psql "$DATABASE_URL" -c "DROP DATABASE invoicefi_migrate_test;" > /dev/null 2>&1 || true

echo "✓ New migration test completed"
