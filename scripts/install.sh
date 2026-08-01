#!/usr/bin/env bash
# Install cloudtak-plugin-d4h into a CloudTAK checkout.
#
# Usage:
#   ./scripts/install.sh [/path/to/CloudTAK]
#
# Defaults CLOUDTAK_ROOT to ~/CloudTAK when unset / not passed.
# Copies:
#   web plugin  → $CLOUDTAK/api/web/plugins/d4h  (symlink preferred)
#   server/*.ts → $CLOUDTAK/api/stateless/routes/  (plugin-d4h.ts + d4h-sync.ts)
#
# After install, rebuild/restart the API image so schema.load picks up the new routes.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLOUDTAK_ROOT="${1:-${CLOUDTAK_ROOT:-$HOME/CloudTAK}}"

WEB_PLUGINS="$CLOUDTAK_ROOT/api/web/plugins"
ROUTES_DIR="$CLOUDTAK_ROOT/api/stateless/routes"
TARGET_PLUGIN="$WEB_PLUGINS/d4h"

if [[ ! -d "$CLOUDTAK_ROOT/api" ]]; then
  echo "error: CloudTAK not found at $CLOUDTAK_ROOT (pass path as arg or set CLOUDTAK_ROOT)" >&2
  exit 1
fi

if [[ ! -d "$ROUTES_DIR" ]]; then
  echo "error: expected routes dir missing: $ROUTES_DIR" >&2
  echo "       (this install targets CloudTAK builds that load api/stateless/routes/)" >&2
  exit 1
fi

mkdir -p "$WEB_PLUGINS"

if [[ -L "$TARGET_PLUGIN" || -d "$TARGET_PLUGIN" ]]; then
  echo "ok - web plugin already present at $TARGET_PLUGIN"
else
  ln -s "$PLUGIN_ROOT" "$TARGET_PLUGIN"
  echo "ok - symlinked web plugin → $TARGET_PLUGIN"
fi

for f in plugin-d4h.ts d4h-sync.ts; do
  src="$PLUGIN_ROOT/server/$f"
  dst="$ROUTES_DIR/$f"
  if [[ ! -f "$src" ]]; then
    echo "error: missing $src" >&2
    exit 1
  fi
  cp "$src" "$dst"
  echo "ok - copied $f → $dst"
done

cat <<EOF

Install complete.

Next steps:
  1. Rebuild/restart the CloudTAK API container so routes are loaded.
  2. Rebuild the web UI (from api/web) if the plugin symlink is new:
       cd $CLOUDTAK_ROOT/api/web && npm run build
  3. As a system admin, open the D4H plugin → Edit config → Server sync,
     paste the D4H token, set default TAK groups + interval, Save.
  4. Click Sync now (admin) once, or wait for the periodic timer.

Note: the in-process periodic timer assumes a single API replica.
      For multi-replica deploys, hit POST /api/d4h/sync from external cron instead.
EOF
