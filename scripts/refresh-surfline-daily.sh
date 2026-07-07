#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

if ! curl -s --max-time 2 http://127.0.0.1:9333/json/version >/dev/null; then
  echo "Chrome CDP not available on :9333 -- skipping (launch per CLAUDE.md)"
  exit 0
fi

node scripts/refresh-surfline-conditions.js --transport=cdp --port=9333

git diff --quiet -- data/surfline-conditions.json || {
  git add data/surfline-conditions.json
  git commit -m 'chore(data): refresh surfline conditions'
  git push
}
