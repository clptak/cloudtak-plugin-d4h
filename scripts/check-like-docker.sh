#!/usr/bin/env bash
# Simulate CloudTAK Docker: vue-tsc from api/web without plugin node_modules.
set -euo pipefail

WEB="${1:-$HOME/CloudTAK/api/web}"
PLUGIN_NM="$WEB/plugins/schedule/node_modules"
BACKUP=""

if [[ -d "$PLUGIN_NM" ]]; then
  BACKUP="$(mktemp -d)"
  mv "$PLUGIN_NM" "$BACKUP/node_modules"
fi

cleanup() {
  if [[ -n "$BACKUP" && -d "$BACKUP/node_modules" ]]; then
    mkdir -p "$(dirname "$PLUGIN_NM")"
    mv "$BACKUP/node_modules" "$PLUGIN_NM"
    rmdir "$BACKUP" 2>/dev/null || true
  fi
}
trap cleanup EXIT

cd "$WEB"
npm run check 2>&1 | tee /tmp/cloudtak-check.log
if grep -q 'plugins/schedule/' /tmp/cloudtak-check.log; then
  echo >&2
  echo "schedule plugin errors — merge host deps or install plugin packages before check:" >&2
  echo "  bash plugins/schedule/scripts/merge-cloudtak-web-deps.sh package.json  # then rebuild image" >&2
  exit 1
fi
echo "check passed (no plugins/schedule/ errors)"
