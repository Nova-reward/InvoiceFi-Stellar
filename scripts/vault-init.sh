#!/usr/bin/env sh
# =============================================================================
# scripts/vault-init.sh
#
# Seeds HashiCorp Vault (dev mode) with all local development secrets.
# Runs once as the "vault-init" Docker Compose service after Vault is healthy.
#
# In production, this script is NOT used. Secrets are provisioned by your
# infrastructure pipeline (Terraform, Ansible, etc.) using proper auth methods
# (AppRole, Kubernetes auth, AWS IAM, etc.) instead of a root token.
# =============================================================================

set -eu

VAULT_ADDR="${VAULT_ADDR:-http://vault:8200}"
VAULT_TOKEN="${VAULT_TOKEN:-dev-only-root-token}"

export VAULT_ADDR VAULT_TOKEN

echo "[vault-init] Waiting for Vault to be ready at ${VAULT_ADDR}..."
until vault status > /dev/null 2>&1; do
  sleep 1
done
echo "[vault-init] Vault is ready."

# ── Enable KV v2 secrets engine at path "secret/" ────────────────────────────
# Dev mode already enables this; the command is idempotent via || true.
vault secrets enable -path=secret kv-v2 2>/dev/null || true
echo "[vault-init] KV v2 engine ensured at path: secret/"

# ── Database credentials ──────────────────────────────────────────────────────
vault kv put secret/invoicefi/database \
  username="${POSTGRES_USER:-invoicefi}" \
  password="${POSTGRES_PASSWORD:-invoicefi_secret}" \
  database="${POSTGRES_DB:-invoicefi}" \
  host="postgres" \
  port="5432"
echo "[vault-init] Written: secret/invoicefi/database"

# ── JWT signing secret ────────────────────────────────────────────────────────
vault kv put secret/invoicefi/auth \
  jwt_secret="${JWT_SECRET:-dev_jwt_secret_change_in_production}"
echo "[vault-init] Written: secret/invoicefi/auth"

# ── SMTP credentials ──────────────────────────────────────────────────────────
vault kv put secret/invoicefi/smtp \
  host="${SMTP_HOST:-smtp.gmail.com}" \
  port="${SMTP_PORT:-587}" \
  secure="${SMTP_SECURE:-false}" \
  user="${SMTP_USER:-dev@example.com}" \
  password="${SMTP_PASSWORD:-dev_smtp_password}" \
  from="${SMTP_FROM:-noreply@invoicefi.com}"
echo "[vault-init] Written: secret/invoicefi/smtp"

# ── Stellar / Soroban config (non-signing, network config only) ───────────────
# NOTE: Stellar signing keys (secret keys) should be stored in an HSM in
# production (e.g., AWS CloudHSM, Azure Dedicated HSM). See docs/security/
# secret-rotation.md for the recommendation.
vault kv put secret/invoicefi/stellar \
  network_passphrase="Standalone Network ; February 2017" \
  rpc_url="http://stellar-standalone:8001" \
  horizon_url="http://stellar-standalone:8000"
echo "[vault-init] Written: secret/invoicefi/stellar"

# ── AppRole auth method (for production-style local testing) ─────────────────
# Enable AppRole so developers can test the production auth path locally.
vault auth enable approle 2>/dev/null || true

# Write a policy that allows reading all invoicefi secrets.
vault policy write invoicefi-backend - <<'EOF'
path "secret/data/invoicefi/*" {
  capabilities = ["read", "list"]
}
path "secret/metadata/invoicefi/*" {
  capabilities = ["read", "list"]
}
EOF
echo "[vault-init] Policy written: invoicefi-backend"

# Create the AppRole bound to the policy with a short token TTL.
vault write auth/approle/role/invoicefi-backend \
  token_policies="invoicefi-backend" \
  token_ttl="1h" \
  token_max_ttl="4h" \
  secret_id_ttl="24h"

ROLE_ID=$(vault read -field=role_id auth/approle/role/invoicefi-backend/role-id)
SECRET_ID=$(vault write -f -field=secret_id auth/approle/role/invoicefi-backend/secret-id)

echo "[vault-init] AppRole credentials (for local testing only):"
echo "  VAULT_ROLE_ID=${ROLE_ID}"
echo "  VAULT_SECRET_ID=${SECRET_ID}"

echo "[vault-init] Vault seeding complete."
