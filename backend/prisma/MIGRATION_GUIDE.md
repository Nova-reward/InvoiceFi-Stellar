# Database Migration Guide - Expand-Contract Pattern

## Overview

This document defines the expand-contract migration strategy for InvoiceFi-Stellar to enable zero-downtime schema changes on high-write tables.

## Pattern Philosophy

The expand-contract pattern separates schema changes into two phases:

1. **Expand Phase**: Add new columns/tables without removing or altering_existing structures
2. **Contract Phase**: Remove deprecated columns/tables after application code has migrated

This ensures backward compatibility during deployments, allowing rolling updates without downtime.

## Naming Convention

All migrations must follow the pattern: `{timestamp}_{phase}_{description}`

- **timestamp**: UTC in format `YYYYMMDDHHmmss`
- **phase**: `expand` or `contract`
- **description**: kebab-case description of the change

Examples:
- `20260723120000_expand_add_invoice_metadata`
- `20260723130000_contract_remove_legacy_investor_field`

## Migration Rules

### Expand Phase Requirements
- All new columns must be nullable or have safe defaults
- Never drop columns, tables, or indexes
- Never rename columns or tables
- Never add NOT NULL constraints to existing columns
- Never change column types in a way that breaks existing data

### Contract Phase Requirements
- Only remove columns/tables added in previous expand migrations
- Only drop indexes that are no longer needed
- Must be deployed after all application instances have been updated to use new schema
- Must include data backfill if required (documented separately)

### General Requirements
- Every migration must have a corresponding down-migration
- Up + down must leave the schema unchanged (verified in CI)
- Migrations must be tested against PostgreSQL 15 (production version)
- High-write table changes must avoid table locks (use `ALTER TABLE ... ADD COLUMN` with default values)

## High-Write Table Considerations

For tables with high write volume (e.g., `Invoice`):

1. **Adding columns**: Use `ALTER TABLE ... ADD COLUMN` with nullable or safe defaults
   - PostgreSQL 11+ allows this without table locks for nullable columns
   - For columns with defaults, use `DEFAULT` expression that doesn't require a table scan

2. **Avoid**: Operations that require table scans or locks
   - `ALTER TABLE ... ALTER COLUMN ... SET NOT NULL` (requires backfill first)
   - `ALTER TABLE ... RENAME COLUMN` (use expand-contract pattern instead)
   - Adding unique constraints on existing data

## Creating Migrations

### Step 1: Create Expand Migration

```bash
cd backend
npx prisma migrate dev --name expand_add_invoice_metadata --create-only
```

Edit the generated SQL to follow expand phase rules.

### Step 2: Apply Expand Migration

```bash
npx prisma migrate dev
```

### Step 3: Update Application Code

Update application code to:
- Write to new columns (if applicable)
- Read from new columns (with fallback to old columns during transition)
- Handle both old and new schema versions

### Step 4: Deploy Application

Deploy the updated application to all instances.

### Step 5: Create Contract Migration

```bash
npx prisma migrate dev --name contract_remove_legacy_fields --create-only
```

Edit the generated SQL to remove deprecated columns/tables.

### Step 6: Apply Contract Migration

```bash
npx prisma migrate dev
```

## CI Validation

The CI pipeline automatically validates:
- Each migration has a corresponding down-migration
- Up + down leaves the schema unchanged
- Migrations can be applied to a fresh PostgreSQL 15 database
- Migrations can be rolled back without errors

See `.github/workflows/migration-ci.yml` for implementation.

## Production Deployment

See `docs/operations/database-migrations.md` for the complete production runbook.

## Example Migrations

See the following example migrations in `backend/prisma/migrations/`:
- `20260723120000_expand_add_invoice_discount_field` - Adding a nullable column
- `20260723130000_expand_rename_investor_to_funder_part1` - Column rename (part 1)
- `20260723140000_expand_rename_investor_to_funder_part2` - Column rename (part 2)
- `20260723150000_contract_remove_old_investor_column` - Column rename (part 3)
