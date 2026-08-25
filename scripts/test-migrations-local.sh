#!/bin/bash
set -euo pipefail

# Test migrations against PostgreSQL 15 (matching production version)
# This script creates a fresh PostgreSQL 15 database and applies all migrations

echo "Testing migrations against PostgreSQL 15..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
  echo "::error::Docker is not running. Please start Docker and try again."
  exit 1
fi

# Start PostgreSQL 15 container
echo "Starting PostgreSQL 15 container..."
docker run -d \
  --name invoicefi_migration_test \
  -e POSTGRES_USER=invoicefi \
  -e POSTGRES_PASSWORD=invoicefi_test \
  -e POSTGRES_DB=invoicefi_test \
  -p 5433:5432 \
  postgres:15-alpine

# Wait for PostgreSQL to be ready
echo "Waiting for PostgreSQL to be ready..."
for i in {1..30}; do
  if docker exec invoicefi_migration_test pg_isready -U invoicefi > /dev/null 2>&1; then
    echo "PostgreSQL is ready"
    break
  fi
  echo "Waiting... ($i/30)"
  sleep 1
done

if ! docker exec invoicefi_migration_test pg_isready -U invoicefi > /dev/null 2>&1; then
  echo "::error::PostgreSQL failed to start"
  docker rm -f invoicefi_migration_test
  exit 1
fi

# Verify PostgreSQL version
echo "Verifying PostgreSQL version..."
PG_VERSION=$(docker exec invoicefi_migration_test psql -U invoicefi -d invoicefi_test -t -c "SELECT version();" | grep -o "PostgreSQL [0-9]*\.[0-9]*" || true)
echo "PostgreSQL version: $PG_VERSION"

if [[ ! "$PG_VERSION" =~ "PostgreSQL 15" ]]; then
  echo "::error::PostgreSQL version is not 15.x"
  docker rm -f invoicefi_migration_test
  exit 1
fi

# Apply migrations
echo "Applying migrations..."
cd backend
DATABASE_URL="postgresql://invoicefi:invoicefi_test@localhost:5433/invoicefi_test" \
  npx prisma migrate deploy

# Verify schema
echo "Verifying schema..."
DATABASE_URL="postgresql://invoicefi:invoicefi_test@localhost:5433/invoicefi_test" \
  npx prisma db pull

# Check for schema drift
if [ -n "$(git diff prisma/schema.prisma)" ]; then
  echo "::error::Schema drift detected. Applied migrations do not match schema.prisma"
  git diff prisma/schema.prisma
  cd ..
  docker rm -f invoicefi_migration_test
  exit 1
fi

cd ..

# Cleanup
echo "Cleaning up..."
docker rm -f invoicefi_migration_test

echo "✓ All migrations tested successfully against PostgreSQL 15"
