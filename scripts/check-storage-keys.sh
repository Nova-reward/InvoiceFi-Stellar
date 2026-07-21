#!/usr/bin/env bash
# ------------------------------------------------------------------
# Storage Key Convention Linter
#
# Scans contract Rust source files for storage-key-related patterns
# and validates they follow documented naming conventions:
#
#   - Instance keys:  UPPER_SNAKE_CASE  (e.g. "ADMIN", "FEE_RATE")
#   - Category tags:  UPPER_SNAKE_CASE  (e.g. "INVOICE_DATA", "BALANCE")
#   - DataKey enum variants: PascalCase (compiler-enforced, checked here)
#   - Symbol::new("<key>"):  the string argument must be UPPER_SNAKE_CASE
#   - StorageKey::new("CAT", ..):  category must be UPPER_SNAKE_CASE
#
# Exits non-zero if any violations are found.
# ------------------------------------------------------------------
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXIT_CODE=0

UPPER_SNAKE_RE='^[A-Z][A-Z0-9_]*$'

check_pattern() {
  local file=$1
  local pattern=$2
  local description=$3
  local extract_idx=${4:-0}

  while IFS=: read -r line_num line_text; do
    # Extract the matched group
    if [[ $line_text =~ $pattern ]]; then
      captured="${BASH_REMATCH[$extract_idx]}"
      if [[ -n "$captured" && ! "$captured" =~ $UPPER_SNAKE_RE ]]; then
        echo "ERROR: $file:$line_num — $description '$captured' (should be UPPER_SNAKE_CASE)"
        EXIT_CODE=1
      fi
    fi
  done < <(grep -n -P "$pattern" "$file" 2>/dev/null || true)
}

check_no_pattern() {
  local file=$1
  local pattern=$2
  local description=$3

  while IFS=: read -r line_num line_text; do
    echo "ERROR: $file:$line_num — $description"
    EXIT_CODE=1
  done < <(grep -n -P "$pattern" "$file" 2>/dev/null || true)
}

echo "::group:: Storage Key Convention Linter"
echo "Scanning contract source files for key naming violations ..."
echo ""

# Walk all Rust source files under contracts/
while IFS= read -r -d '' rs_file; do
  rel="${rs_file#$REPO_ROOT/}"

  # 1) Check StorageKey::instance("…") — inner string must be UPPER_SNAKE_CASE
  check_pattern "$rs_file" \
    'StorageKey::instance\("([^"]+)"\)' \
    "Instance key" 1

  # 2) Check StorageKey::new("CAT", …) — category must be UPPER_SNAKE_CASE
  check_pattern "$rs_file" \
    'StorageKey::new\("([^"]+)"' \
    "StorageKey category" 1

  # 3) Check Symbol::new(&e, "…") used as a storage-key-like (event symbols
  #    are excluded; only flag if used in storage context). We only flag
  #    obvious storage patterns like env.storage().*set/get/has with Symbol::new.
  check_pattern "$rs_file" \
    '(?:instance|persistent)\s*\(.*\)\s*\.\s*(?:set|get|has)\s*\(\s*&?\s*Symbol::new\s*\([^,]*,\s*"([^"]+)"' \
    "Inline Symbol::new in storage context" 1

  # 4) Flag any DataKey enum variant that uses non-UPPER_SNAKE_CASE naming
  #    (compiler enforces this is PascalCase, but we flag snake_case variants)
  check_no_pattern "$rs_file" \
    '^\s*[a-z][a-zA-Z0-9]*\s*\(' \
    "DataKey variant should be PascalCase (lowercase-start found)"

  # 5) Warn about Symbol::new in persistent/instance storage .has() 
  #    that doesn't follow the convention
  check_pattern "$rs_file" \
    'StorageKey::\w+\s*\(\s*&?\s*(?:Symbol::new|symbol_short)\s*\([^)]*\)' \
    "Nested Symbol creation inside StorageKey method" 0

done < <(find "$REPO_ROOT/contracts" -name '*.rs' -print0)

echo ""
if [[ $EXIT_CODE -eq 0 ]]; then
  echo "✅ All storage keys follow naming conventions."
else
  echo "❌ Some storage keys violate naming conventions (see above)."
fi
echo "::endgroup::"

exit $EXIT_CODE
