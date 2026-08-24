#!/usr/bin/env bash
# ------------------------------------------------------------------
# Checked Math Linter
#
# Scans contract Rust source files for unchecked raw arithmetic
# operators (+, -, *, /) on financial amounts.
# ------------------------------------------------------------------
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXIT_CODE=0

echo "::group:: Checked Math Linter"
echo "Scanning contract source files for raw arithmetic violations ..."
echo ""

# Walk all Rust source files under contracts/invoice, contracts/financing-pool, and contracts/settlement
while IFS= read -r -d '' rs_file; do
  # Skip test files
  filename=$(basename "$rs_file")
  if [[ "$filename" == *test* ]]; then
    continue
  fi

  rel="${rs_file#$REPO_ROOT/}"

  # Scan for lines with +, -, *, /
  line_num=0
  while IFS= read -r line_text; do
    line_num=$((line_num + 1))
    
    # Skip comments using bash regex matching on original line
    if [[ "$line_text" =~ ^[[:space:]]*// ]] || [[ "$line_text" =~ ^[[:space:]]*\* ]]; then
      continue
    fi
    
    # Skip use statements
    if [[ "$line_text" =~ ^[[:space:]]*use\  ]]; then
      continue
    fi
    
    # Check for raw math operators:
    # 1. Addition (+), but not pointer/reference or part of += if we allow checked_add
    # 2. Subtraction (-), but not -> or negative literals or comments
    # 3. Multiplication (*), but not use statements or dereferencing (*self, *record, etc.)
    # 4. Division (/), but not comments/URLs
    
    # Check for infix +
    if [[ "$line_text" =~ [[:space:]]\+[[:space:]] ]]; then
      # Ignore allowed exceptions: id + 1
      if [[ "$line_text" =~ id\ \+\ 1 ]]; then
        continue
      fi
      echo "ERROR: $rel:$line_num — Raw addition operator found: $line_text"
      EXIT_CODE=1
    fi
    
    # Check for infix -
    if [[ "$line_text" =~ [[:space:]]-[[:space:]] ]]; then
      echo "ERROR: $rel:$line_num — Raw subtraction operator found: $line_text"
      EXIT_CODE=1
    fi
    
    # Check for infix *
    if [[ "$line_text" =~ [[:space:]]\*[[:space:]] ]]; then
      echo "ERROR: $rel:$line_num — Raw multiplication operator found: $line_text"
      EXIT_CODE=1
    fi
    
    # Check for infix /
    if [[ "$line_text" =~ [[:space:]]/[[:space:]] ]]; then
      echo "ERROR: $rel:$line_num — Raw division operator found: $line_text"
      EXIT_CODE=1
    fi

  done < "$rs_file"

done < <(find "$REPO_ROOT/contracts/invoice" "$REPO_ROOT/contracts/financing-pool" "$REPO_ROOT/contracts/settlement" -name '*.rs' -print0)

echo ""
if [[ $EXIT_CODE -eq 0 ]]; then
  echo "✅ All financial operations use checked arithmetic."
else
  echo "❌ Unchecked arithmetic operator found (see errors above)."
fi
echo "::endgroup::"

exit $EXIT_CODE
