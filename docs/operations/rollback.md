# Rollback Procedure

**Target:** Under 10 minutes from decision to full recovery.

## Quick Reference

| Scenario | Action | Time |
|----------|--------|------|
| Bad deployment (traffic already switched) | Swap back to old stack | 60s |
| Contract failed pre-flight | Revert to previous WASM | 3 min |
| Database migration issue | Restore from pg_dump | 5 min |
| Full stack failure | Docker rollback + DNS revert | 5 min |

---

## 1. Traffic / Blue-Green Switchback (60s)

If the new deployment is already serving live traffic:

```bash
# Identify active and standby stacks
docker compose ls

# For nginx/Caddy reverse proxy — reload upstream to old stack
# Edit the proxy config to point at the OLD stack port and reload:
ssh deploy@host
sudo systemctl reload nginx    # or: caddy reload

# Verify traffic routes correctly
curl -sf https://invoicefi.io/health

# Stop the bad stack (DO NOT remove volumes — keep for investigation)
docker compose -p invoicefi-prod-<BAD_STACK> down --timeout 30
```

**Rollback always uses the previous stack's Docker images and volumes.**  
The `latest` tag on ghcr.io is NOT rolled back — we re-deploy the previous `sha` tag:

```bash
docker pull ghcr.io/nova-reward/invoicefi-stellar/backend:<PREVIOUS_SHA>
docker tag ghcr.io/nova-reward/invoicefi-stellar/backend:<PREVIOUS_SHA> \
             ghcr.io/nova-reward/invoicefi-stellar/backend:latest
docker compose -f docker-compose.yml -p invoicefi-prod up --detach
```

---

## 2. Contract WASM Rollback (3 min)

Soroban contract state changes are **irreversible**. You cannot "undo" a contract
`upgrade` that changed storage. The rollback procedure for contracts is therefore a
**re-deployment of the previous WASM under a new contract ID**, followed by updating
references.

### Pre-flight verification (always do this before any rollback)

```bash
# Simulate the PREVIOUS WASM against current state to verify compatibility
soroban contract simulate \
  --wasm /tmp/wasm-artifacts/<previous-contract>.wasm \
  --function initialize \
  --rpc-url https://soroban-mainnet.stellar.org
```

### Rollback steps

```bash
# 1. Deploy the previous WASM as a new contract instance
CONTRACT_ID=$(soroban contract deploy \
  --wasm /tmp/wasm-artifacts/<previous-contract>.wasm \
  --source <ADMIN_SECRET_KEY> \
  --network mainnet \
  --rpc-url https://soroban-mainnet.stellar.org)

echo "New contract instance: $CONTRACT_ID"

# 2. Update the backend environment to point at the new contract instance
ssh deploy@host
sed -i "s/^INVOICE_CONTRACT_ID=.*/INVOICE_CONTRACT_ID=$CONTRACT_ID/" .env

# 3. Restart backend to pick up the new contract reference
docker compose -p invoicefi-prod restart backend

# 4. Verify the new contract responds correctly
curl -sf https://invoicefi.io/contracts/invoice/admin
```

**Important:** Because `upgrade` is not reversible, the recommended deployment
strategy is to **always deploy new WASM versions as new contract instances** and
update the backend config, rather than using `soroban contract upgrade`. This
preserves the ability to roll back by re-pointing config.

---

## 3. Database Rollback (5 min)

Database rollbacks require a pre-deployment `pg_dump` snapshot. The deployment
pipeline should create this automatically before any migration runs.

### Automatic pre-deployment snapshot

```bash
# This runs in the deploy-staging job before Prisma migrations
PGPASSWORD=$POSTGRES_PASSWORD pg_dump \
  -h localhost \
  -U $POSTGRES_USER \
  -d $POSTGRES_DB \
  --format=custom \
  -f /tmp/pre-deploy-dump-$(date +%Y%m%d_%H%M%S).pgdump
```

### Manual restore

```bash
# 1. Stop the backend (prevents writes during restore)
docker compose -p invoicefi-prod stop backend

# 2. Restore the pre-deployment snapshot
PGPASSWORD=$POSTGRES_PASSWORD pg_restore \
  -h localhost \
  -U $POSTGRES_USER \
  -d $POSTGRES_DB \
  --clean --if-exists \
  /tmp/pre-deploy-dump-<TIMESTAMP>.pgdump

# 3. Roll back the backend image (see section 1)
# 4. Restart
docker compose -p invoicefi-prod start backend

# 5. Verify
curl -sf https://invoicefi.io/health
```

---

## 4. Quick-Start Rollback Script

Save this as `/opt/invoicefi/rollback.sh` on production hosts:

```bash
#!/usr/bin/env bash
# Usage: sudo bash rollback.sh [--db] [--contracts]
set -euo pipefail

SNAPSHOT="${1:-/tmp/pre-deploy-dump.latest.pgdump}"
STACK="${2:-blue}"

echo "=== Rollback to $STACK stack ==="

# 1. Traffic switch
docker compose -p "invoicefi-prod-$STACK" up --detach
sleep 10
curl -sf http://localhost:4000/health || { echo "Backend not healthy"; exit 1; }

# 2. Switch proxy to $STACK ports
# (edit proxy config here)

echo "=== Traffic switched to $STACK ==="

# 3. Database rollback (if --db flag)
if [[ "${1:-}" == "--db" ]]; then
  echo "Restoring database from $SNAPSHOT ..."
  docker compose -p invoicefi-prod stop backend
  pg_restore --clean --if-exists -d invoicefi "$SNAPSHOT"
  docker compose -p invoicefi-prod start backend
  echo "Database restored."
fi

echo "=== Rollback complete ==="
```

---

## 5. Post-Rollback Verification

After any rollback, run:

```bash
# Smoke test
bash scripts/smoke-test.sh \
  --base-url https://invoicefi.io \
  --horizon-url https://horizon.stellar.org \
  --verbose

# Verify contract state (if contracts were rolled back)
curl -sf https://invoicefi.io/contracts/invoice/admin
curl -sf https://invoicefi.io/pool/status

# Check database integrity
curl -sf https://invoicefi.io/health/db | python3 -m json.tool

# Check recent errors
docker compose -p invoicefi-prod logs --tail=50 backend | grep -i error || echo "No errors"

echo "=== Rollback verified ==="
```

---

## Operational Notes

- **Deployments are idempotent.** Running the same pipeline twice with the same
  image SHA produces the same result.
- **Contract WASM is immutable per network.** Deploy a new contract instance
  rather than upgrading an existing one. This makes rollback config-only (update
  contract ID in env).
- **Database migrations should be backward-compatible for 1 release.** This
  allows running the old backend code against the new schema during a blue-green
  transition. Prisma `migrate deploy` runs automatically on backend startup.
- **Secrets are managed via GitHub Environments** (`staging`, `production`) with
  required reviewers for production deploys. The `STAGING_SSH_KEY`, `PRODUCTION_SSH_KEY`,
  `STAGING_HOST`, `PRODUCTION_HOST`, and their user secrets must be configured in
  the repo settings before the pipeline first runs.
