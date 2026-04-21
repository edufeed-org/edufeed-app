#!/usr/bin/env bash
# Checks that en.json and de.json have the same set of top-level keys.
# Exit 1 if any keys are missing from either file.

set -euo pipefail

MESSAGES_DIR="$(git rev-parse --show-toplevel)/messages"
EN="$MESSAGES_DIR/en.json"
DE="$MESSAGES_DIR/de.json"

en_keys=$(jq -r 'keys[]' "$EN" | sort)
de_keys=$(jq -r 'keys[]' "$DE" | sort)

missing_in_de=$(comm -23 <(echo "$en_keys") <(echo "$de_keys"))
missing_in_en=$(comm -13 <(echo "$en_keys") <(echo "$de_keys"))

exit_code=0

if [ -n "$missing_in_de" ]; then
  echo "❌ Keys in en.json but missing from de.json:"
  echo "$missing_in_de" | sed 's/^/  /'
  exit_code=1
fi

if [ -n "$missing_in_en" ]; then
  echo "❌ Keys in de.json but missing from en.json:"
  echo "$missing_in_en" | sed 's/^/  /'
  exit_code=1
fi

if [ $exit_code -eq 0 ]; then
  echo "✅ i18n keys are in sync"
fi

exit $exit_code
