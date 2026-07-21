# Incident Response — Compromised Secret Rotation

**Owner:** Platform / DevSecOps Team  
**Last reviewed:** <!-- update on each review -->  
**Applies to:** InvoiceFi-Stellar backend (all environments)

---

## 1. Scope

This procedure covers any secret managed by HashiCorp Vault:

| Secret path | What it protects |
|---|---|
| `secret/invoicefi/database` | PostgreSQL credentials |
| `secret/invoicefi/auth` | JWT signing secret |
| `secret/invoicefi/smtp` | SMTP relay credentials |
| `secret/invoicefi/stellar` | Stellar RPC / Horizon network config |

> **Out of scope — Stellar signing keys (secret keys / seed phrases).**  
> Stellar secret keys must be stored in a Hardware Security Module (HSM).  
> See [§7 HSM Recommendation](#7-hsm-recommendation-for-stellar-signing-keys).

---

## 2. Detection

A secret may be compromised by:

- CI audit script (`scripts/audit-secrets.sh`) flagging a pattern in a PR.
- A developer accidentally pushing a `.env` or credential file to Git.
- A third-party breach notification (e.g., AWS, SendGrid).
- Anomalous access patterns in Vault audit logs.
- An unexpected authentication failure in production logs indicating credential use from an unknown source.

---

## 3. Severity Classification

| Severity | Criteria | SLA |
|---|---|---|
| **P1 — Critical** | Database password, JWT secret, Stellar signing key | Rotate within **1 hour** |
| **P2 — High** | SMTP credentials, external API keys | Rotate within **4 hours** |
| **P3 — Medium** | Non-sensitive config exposed (RPC URLs, etc.) | Rotate within **24 hours** |

---

## 4. General Rotation Procedure

Follow these steps for **any** compromised secret.

### Step 1 — Confirm & isolate

```bash
# 1a. Revoke all tokens that have accessed the compromised path.
vault lease revoke -prefix secret/invoicefi/<path>

# 1b. If a root token or unseal key is compromised, generate a new root token
#     and immediately revoke the old one.
vault token revoke <compromised-token>
```

### Step 2 — Audit access history

```bash
# Enable audit device if not already enabled.
vault audit enable file file_path=/var/log/vault/audit.log

# Review who accessed the secret and when.
grep '"path":"secret/data/invoicefi/<path>"' /var/log/vault/audit.log \
  | jq '{time: .time, accessor: .auth.accessor, remote_address: .request.remote_address}'
```

Preserve the audit log output as evidence before proceeding.

### Step 3 — Generate new credentials

Generate the new secret **outside** Vault first (e.g., create a new DB password in your cloud console), then write it:

```bash
vault kv put secret/invoicefi/<path> \
  <key>="<new-value>" \
  [<key2>="<new-value2>"]
```

### Step 4 — Application reconnection (zero-downtime)

The application handles database credential rotation automatically:

1. `PrismaService.withRetry()` detects PostgreSQL error `28P01` (authentication failure).  
2. It calls `VaultService.refreshDatabaseSecrets()` to fetch the new credentials.  
3. It rebuilds `PrismaClient` and reconnects without restarting the process.

For JWT secret or SMTP credential rotation, a **rolling restart** of the backend pods/containers is required (existing issued JWTs signed with the old secret will be invalid after the restart — users will be asked to re-authenticate):

```bash
# Kubernetes rolling restart (zero-downtime):
kubectl rollout restart deployment/invoicefi-backend

# Docker Compose (brief downtime):
docker compose restart backend
```

### Step 5 — Verify

```bash
# Confirm the backend is healthy and using the new credentials.
curl -s http://localhost:4000/health | jq .

# Check backend logs for any residual auth errors.
docker compose logs --tail=50 backend
```

### Step 6 — Post-incident review

Within 48 hours, hold a blameless post-mortem. Document:

- Root cause of the exposure.
- Timeline of detection → containment → rotation.
- Any affected systems or data.
- Preventive measures (e.g., adding a new audit rule, tightening RBAC).

---

## 5. Database Credential Rotation (Planned, Zero-Downtime)

For **scheduled** rotations (not incident-driven), use this procedure to achieve zero downtime.

```bash
# 1. Create the new database user in PostgreSQL.
psql -U postgres -c "CREATE USER invoicefi_v2 WITH PASSWORD 'new_strong_password';"
psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE invoicefi TO invoicefi_v2;"

# 2. Write the new credentials to Vault.
vault kv put secret/invoicefi/database \
  username="invoicefi_v2" \
  password="new_strong_password" \
  database="invoicefi" \
  host="<db-host>" \
  port="5432"

# 3. The application will automatically pick up the new credentials on the
#    next database authentication failure (triggered by the next query after
#    you drop the old user — see step 5).
#
# 4. Wait for Vault's lease to confirm replication, then drop the old user.
psql -U postgres -c "REVOKE ALL PRIVILEGES ON DATABASE invoicefi FROM invoicefi;"
psql -U postgres -c "DROP USER invoicefi;"
```

The `PrismaService` rotation retry logic (exponential back-off, max 3 attempts) handles the brief window between dropping the old user and the application detecting the auth error.

---

## 6. JWT Secret Rotation

Rotating the JWT secret invalidates all currently issued tokens. Plan this during a maintenance window or use a grace period approach:

```bash
# Write the new secret. The backend will use it for all new tokens immediately
# after the rolling restart.
vault kv put secret/invoicefi/auth \
  jwt_secret="$(openssl rand -base64 48)"

# Rolling restart (Kubernetes — zero HTTP downtime, but existing JWTs invalidated).
kubectl rollout restart deployment/invoicefi-backend
```

Communicate to users that they will need to re-authenticate. Consider issuing a session-ending notification before the rotation.

---

## 7. HSM Recommendation for Stellar Signing Keys

> **This is a strong security recommendation, not yet implemented.**

Stellar secret keys (seed phrases / `S...` keys) used to sign Soroban transactions represent the highest-value credentials in this system. If compromised, an attacker can drain any on-chain funds controlled by those keys.

**Recommended architecture:**

| Component | Recommendation |
|---|---|
| Key storage | AWS CloudHSM, Azure Dedicated HSM, or Google Cloud HSM |
| Signing operations | Keys never leave the HSM boundary; signing is performed inside the HSM via the PKCS#11 or JCE interface |
| Vault integration | Use Vault's [Transit Secrets Engine](https://developer.hashicorp.com/vault/docs/secrets/transit) as a software HSM bridge until dedicated HSM hardware is provisioned |
| Access control | IAM role attached to the backend service account; principle of least privilege |
| Audit | Every signing operation logged to an immutable audit trail |

**Interim mitigation (before HSM):**

- Store Stellar keys as a Vault secret: `secret/invoicefi/stellar-signing-key`.
- Restrict the Vault policy so only the backend's AppRole can read this path.
- Enable Vault audit logging to record every read of this path.
- Rotate the key immediately if any unauthorized read is detected.

---

## 8. Contacts & Escalation

| Role | Responsibility |
|---|---|
| On-call engineer | First responder; executes this runbook |
| Platform / DevSecOps lead | Approves root token revocation; leads post-mortem |
| CTO / Engineering manager | Notified for all P1 incidents |

---

## 9. References

- [HashiCorp Vault — Key/Value Secrets Engine](https://developer.hashicorp.com/vault/docs/secrets/kv/kv-v2)
- [HashiCorp Vault — AppRole Auth Method](https://developer.hashicorp.com/vault/docs/auth/approle)
- [HashiCorp Vault — Lease Revocation](https://developer.hashicorp.com/vault/docs/concepts/lease)
- [Stellar — Key Management Best Practices](https://developers.stellar.org/docs/encyclopedia/security)
- [NIST SP 800-57 — Recommendation for Key Management](https://csrc.nist.gov/publications/detail/sp/800-57-part-1/rev-5/final)
