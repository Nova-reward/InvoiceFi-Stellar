# Database Migration Runbook

## Overview

This runbook provides step-by-step instructions for applying database migrations in production using the expand-contract pattern to achieve zero-downtime deployments.

## Prerequisites

- Access to production PostgreSQL 15 database
- Access to production NestJS application instances
- SSH access to production servers (or equivalent deployment platform access)
- Database credentials with migration privileges
- Understanding of the expand-contract pattern (see `backend/prisma/MIGRATION_GUIDE.md`)

## Pre-Migration Checklist

Before applying any migration to production:

- [ ] Migration has been tested in staging environment
- [ ] CI pipeline has passed (including migration validation)
- [ ] Migration follows expand-contract naming convention
- [ ] Migration has corresponding down-migration
- [ ] Application code has been updated to work with new schema (for expand migrations)
- [ ] Rollback plan has been documented
- [ ] Database backup has been created (see Backup Procedure)
- [ ] Team members have been notified of maintenance window (if applicable)
- [ ] Monitoring and alerting are in place

## Backup Procedure

### Automated Backup (Recommended)

```bash
# On production database server
pg_dump -U invoicefi -d invoicefi -F c -f /backups/invoicefi_pre_migration_$(date +%Y%m%d_%H%M%S).dump
```

### Manual Backup (Alternative)

```bash
# Create a backup before migration
pg_dump -U invoicefi -d invoicefi -F c -f /tmp/pre_migration_backup.dump

# Verify backup
pg_restore -l /tmp/pre_migration_backup.dump
```

## Migration Procedure

### Step 1: Preparation

1. **Review the migration**
   ```bash
   cat backend/prisma/migrations/<timestamp>_<phase>_<description>/migration.sql
   ```

2. **Verify database version**
   ```bash
   psql -U invoicefi -d invoicefi -c "SELECT version();"
   # Should output PostgreSQL 15.x
   ```

3. **Check current migration status**
   ```bash
   cd backend
   npx prisma migrate status
   ```

### Step 2: Apply Expand Migration

Expand migrations add new columns/tables and are safe to apply with the application running.

1. **Apply the migration**
   ```bash
   cd backend
   DATABASE_URL="postgresql://invoicefi:PASSWORD@HOST:5432/invoicefi" \
     npx prisma migrate deploy
   ```

2. **Verify migration applied successfully**
   ```bash
   npx prisma migrate status
   ```

3. **Check application logs for errors**
   - Monitor NestJS application logs
   - Verify no database connection errors
   - Check for any schema-related errors

### Step 3: Deploy Application Code

After the expand migration is applied, deploy the updated application code that uses the new schema.

1. **Deploy using your standard deployment process**
   - For Docker: `docker compose up -d backend`
   - For Kubernetes: `kubectl rollout restart deployment/backend`
   - For other platforms: follow your standard procedure

2. **Verify deployment**
   ```bash
   # Check health endpoint
   curl http://localhost:4000/health
   
   # Check application logs
   docker logs invoicefi_backend --tail 100
   ```

3. **Monitor for errors**
   - Watch for any database-related errors
   - Verify new columns are being used correctly
   - Check performance metrics

### Step 4: Contract Migration (If Applicable)

Contract migrations remove deprecated columns/tables. Only apply after:

- All application instances are running the new code
- The application has been stable for at least 24 hours
- You have confirmed the old columns/tables are no longer in use

1. **Verify old columns are not in use**
   ```bash
   # Check query logs for references to old columns
   # Monitor application metrics
   # Review application logs
   ```

2. **Apply contract migration**
   ```bash
   cd backend
   DATABASE_URL="postgresql://invoicefi:PASSWORD@HOST:5432/invoicefi" \
     npx prisma migrate deploy
   ```

3. **Verify migration applied successfully**
   ```bash
   npx prisma migrate status
   ```

4. **Monitor application**
   - Check for any errors
   - Verify performance is unchanged
   - Confirm application is functioning correctly

## Rollback Decision Tree

```
START
  │
  ├─ Migration failed during application?
  │   ├─ YES → Check error type
  │   │   ├─ Syntax error in migration SQL
  │   │   │   └─ Fix migration SQL → Re-test in staging → Retry from START
  │   │   ├─ Permission error
  │   │   │   └─ Verify database credentials → Retry from START
  │   │   ├─ Lock timeout
  │   │   │   └─ Wait for low-traffic period → Retry from START
  │   │   └─ Other error
  │   │       └─ Check PostgreSQL logs → Diagnose → Fix → Retry from START
  │   │
  │   └─ NO → Migration applied successfully
  │       │
  │       ├─ Application errors after migration?
  │       │   ├─ YES → Check error type
  │       │   │   ├─ Application code incompatible with new schema
  │       │   │   │   └─ Rollback migration → Fix application code → Retry from START
  │       │   │   ├─ Performance degradation
  │       │   │   │   └─ Analyze query performance → Add indexes if needed → Monitor
  │       │   │   └─ Other errors
  │       │   │       └─ Check application logs → Diagnose → Fix → Retry from START
  │       │   │
  │       │   └─ NO → Application running normally
  │       │       │
  │       │       ├─ Is this a contract migration?
  │       │       │   ├─ YES → Monitor for 24 hours
  │       │       │   │   │
  │       │       │   │   └─ Issues detected?
  │       │       │   │       ├─ YES → Rollback contract migration → Investigate
  │       │       │   │       └─ NO → Migration complete
  │       │       │   │
  │       │       │   └─ NO → Deploy application code
  │       │           │
  │       │           └─ Application deployment successful?
  │       │               ├─ YES → Monitor for 24 hours
  │       │               │   │
  │       │               │   └─ Issues detected?
  │       │               │       ├─ YES → Rollback application → Investigate
  │       │               │       └─ NO → Migration complete
  │       │               │
  │       │               └─ NO → Rollback application → Fix deployment → Retry
```

## Rollback Procedures

### Rollback Expand Migration

If you need to rollback an expand migration:

1. **Stop the application** (if it's using the new schema)
   ```bash
   docker stop invoicefi_backend
   # Or your platform-specific stop command
   ```

2. **Rollback the migration**
   ```bash
   cd backend
   # Prisma doesn't have automatic rollback, so you need to manually execute the down SQL
   # For expand migrations, this typically means dropping the new columns/tables
   psql -U invoicefi -d invoicefi -f path/to/down_migration.sql
   ```

3. **Restart the application with old code**
   ```bash
   # Deploy previous version of application
   docker compose up -d backend
   ```

4. **Verify application is running**
   ```bash
   curl http://localhost:4000/health
   ```

### Rollback Contract Migration

If you need to rollback a contract migration:

1. **Stop the application**
   ```bash
   docker stop invoicefi_backend
   ```

2. **Restore the dropped columns/tables**
   ```bash
   # You'll need to manually recreate the dropped structure
   # This is why contract migrations should only be done after thorough testing
   psql -U invoicefi -d invoicefi -f path/to/restore_contract_migration.sql
   ```

3. **Restart the application**
   ```bash
   docker compose up -d backend
   ```

4. **Verify application is running**
   ```bash
   curl http://localhost:4000/health
   ```

### Restore from Backup

If rollback is not possible:

1. **Stop the application**
   ```bash
   docker stop invoicefi_backend
   ```

2. **Restore from backup**
   ```bash
   pg_restore -U invoicefi -d invoicefi /backups/invoicefi_pre_migration_YYYYMMDD_HHMMSS.dump
   ```

3. **Restart the application**
   ```bash
   docker compose up -d backend
   ```

4. **Verify application is running**
   ```bash
   curl http://localhost:4000/health
   ```

## High-Write Table Migrations

For tables with high write volume (e.g., `Invoice`), follow these additional precautions:

### Adding Columns

1. **Use nullable columns** to avoid table locks
   ```sql
   ALTER TABLE "Invoice" ADD COLUMN "newColumn" TEXT;
   ```

2. **Apply during low-traffic periods** if possible
3. **Monitor for performance impact**
4. **Add indexes separately** after column is added

### Renaming Columns

Use the expand-contract pattern:

1. **Expand**: Add new column alongside old column
2. **Backfill**: Copy data from old to new column
3. **Deploy**: Update application to use new column
4. **Contract**: Remove old column

See example migrations:
- `20260723130000_expand_rename_investor_to_funder_part1`
- `20260723140000_expand_rename_investor_to_funder_part2`
- `20260723150000_contract_remove_old_investor_column`

## Monitoring During Migration

### Key Metrics to Monitor

- Database connection pool utilization
- Query latency (especially for affected tables)
- Application error rate
- Database lock wait times
- Replication lag (if using replication)

### Commands to Monitor

```bash
# Check for long-running queries
psql -U invoicefi -d invoicefi -c "SELECT pid, now() - pg_stat_activity.query_start AS duration, query FROM pg_stat_activity WHERE (now() - pg_stat_activity.query_start) > interval '5 minutes';"

# Check for locks
psql -U invoicefi -d invoicefi -c "SELECT * FROM pg_locks WHERE NOT granted;"

# Check table size
psql -U invoicefi -d invoicefi -c "SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size FROM pg_tables WHERE schemaname = 'public' ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;"
```

## Post-Migration Verification

After applying any migration:

1. **Verify schema matches expected state**
   ```bash
   cd backend
   npx prisma db pull
   git diff prisma/schema.prisma
   ```

2. **Run application tests**
   ```bash
   cd backend
   npm test
   ```

3. **Verify application health**
   ```bash
   curl http://localhost:4000/health
   ```

4. **Check application logs**
   ```bash
   docker logs invoicefi_backend --tail 200
   ```

5. **Monitor for 24 hours**
   - Watch for any errors
   - Check performance metrics
   - Verify application functionality

## Emergency Contacts

- Database Administrator: [CONTACT]
- Engineering Lead: [CONTACT]
- On-Call Engineer: [CONTACT]

## Related Documentation

- `backend/prisma/MIGRATION_GUIDE.md` - Migration development guide
- `backend/prisma/schema.prisma` - Current database schema
- `docs/operations/` - Additional operational documentation
