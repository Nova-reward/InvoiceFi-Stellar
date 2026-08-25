#!/usr/bin/env bash
# =============================================================================
# scripts/audit-secrets.sh
#
# CI security audit: scans the codebase for patterns that indicate hardcoded
# credentials or secrets. Exits with code 1 (fails the build) if any match
# is found.
#
# Usage:
#   ./scripts/audit-secrets.sh              # scan entire repo
#   ./scripts/audit-secrets.sh ./backend    # scan a subtree
#
# Add to CI (GitHub Actions example):
#   - name: Audit hardcoded secrets
#     run: ./scripts/audit-secrets.sh
# =============================================================================

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────

SCAN_ROOT="${1:-.}"
FOUND=0

# Files and directories to always exclude from scanning.
EXCLUDE_DIRS=(
  ".git"
  "node_modules"
  "dist"
  ".next"
  "build"
  "coverage"
  "vendor"
)

# File extensions to exclude (binary / generated / lock files).
EXCLUDE_EXTS=(
  "*.lock"
  "*.png"
  "*.jpg"
  "*.jpeg"
  "*.gif"
  "*.svg"
  "*.ico"
  "*.woff"
  "*.woff2"
  "*.ttf"
  "*.eot"
  "*.pdf"
  "*.zip"
  "*.tar"
  "*.gz"
)

# This script itself and example/doc files are allowed to reference patterns.
EXCLUDE_FILES=(
  "scripts/audit-secrets.sh"
  ".env.example"
  "*.md"
  "*.example"
)

# ── Build grep exclude flags ───────────────────────────────────────────────────

GREP_EXCLUDES=()
for dir in "${EXCLUDE_DIRS[@]}"; do
  GREP_EXCLUDES+=("--exclude-dir=${dir}")
done
for ext in "${EXCLUDE_EXTS[@]}"; do
  GREP_EXCLUDES+=("--exclude=${ext}")
done
for file in "${EXCLUDE_FILES[@]}"; do
  GREP_EXCLUDES+=("--exclude=${file}")
done

# ── Color output ──────────────────────────────────────────────────────────────

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

# ── Scan function ─────────────────────────────────────────────────────────────

scan() {
  local description="$1"
  local pattern="$2"

  # Use grep -rn (recursive, line-numbered, case-sensitive unless noted).
  local results
  results=$(grep -rn --include="*" "${GREP_EXCLUDES[@]}" -E "${pattern}" "${SCAN_ROOT}" 2>/dev/null || true)

  if [[ -n "${results}" ]]; then
    echo -e "${RED}[FAIL]${NC} ${description}"
    echo "${results}" | while IFS= read -r line; do
      echo -e "  ${YELLOW}${line}${NC}"
    done
    echo ""
    FOUND=1
  fi
}

# ── Rules ─────────────────────────────────────────────────────────────────────

echo "============================================================"
echo " InvoiceFi Secret Audit — scanning: ${SCAN_ROOT}"
echo "============================================================"
echo ""

# AWS Access Key ID
scan \
  "AWS Access Key ID (AKIA...)" \
  "(AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}"

# AWS Secret Access Key (heuristic: 40-char base64-ish after known keyword)
scan \
  "Potential AWS Secret Access Key" \
  "aws[_\-]?(secret|access)[_\-]?key[_\-]?(id)?['\"]?\s*[:=]\s*['\"]?[A-Za-z0-9/+=]{40}"

# Private key headers (RSA, EC, OpenSSH, PGP)
scan \
  "Private key block (BEGIN ... PRIVATE KEY)" \
  "-----BEGIN (RSA|EC|DSA|OPENSSH|PGP) PRIVATE KEY"

# GitHub personal access token (classic and fine-grained)
scan \
  "GitHub personal access token" \
  "gh[pousr]_[A-Za-z0-9_]{36,255}"

# Generic high-entropy quoted strings assigned to secret-sounding variables
scan \
  "Hardcoded password/secret assignment" \
  "(password|passwd|secret|api_key|apikey|api_secret|client_secret)\s*[=:]\s*['\"][^'\"]{8,}['\"]"

# JWT secret hardcoded (not sourced from vault/env)
scan \
  "Hardcoded JWT secret" \
  "jwt[_\-]?secret\s*[=:]\s*['\"][^'\"]{8,}['\"]"

# Postgres / MySQL connection string with embedded credentials
scan \
  "Database URL with embedded credentials" \
  "(postgresql|postgres|mysql|mongodb)://[^:]+:[^@]{4,}@"

# Stripe API keys
scan \
  "Stripe API key" \
  "(sk|rk)_(live|test)_[A-Za-z0-9]{24,}"

# SendGrid API key
scan \
  "SendGrid API key" \
  "SG\.[A-Za-z0-9_\-]{22,}\.[A-Za-z0-9_\-]{43}"

# Twilio auth token / SID
scan \
  "Twilio SID or auth token" \
  "AC[a-z0-9]{32}|SK[a-z0-9]{32}"

# Generic base64-looking secret longer than 40 chars assigned to a variable
scan \
  "Potential base64-encoded secret assigned to a variable" \
  "(token|secret|key|credential)['\"]?\s*[:=]\s*['\"][A-Za-z0-9+/]{40,}={0,2}['\"]"

# process.env usage for sensitive keys (warns that secrets should come from Vault)
scan \
  "process.env access for sensitive keys (use VaultService instead)" \
  "process\.env\[?['\"]?(JWT_SECRET|DATABASE_URL|SMTP_PASSWORD|POSTGRES_PASSWORD|API_KEY|SECRET)['\"]?\]?"

# ── Result ────────────────────────────────────────────────────────────────────

echo "============================================================"
if [[ "${FOUND}" -eq 0 ]]; then
  echo -e "${GREEN}[PASS]${NC} No hardcoded secret patterns detected."
  exit 0
else
  echo -e "${RED}[FAIL]${NC} Hardcoded secret patterns found. Resolve all issues above before merging."
  exit 1
fi
