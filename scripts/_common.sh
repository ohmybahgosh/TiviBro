# Shared helpers for TiviBro scripts.  Sourced, not run.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_ID="$(node -p "require('$ROOT/app/appinfo.json').id")"
VERSION="$(node -p "require('$ROOT/app/appinfo.json').version")"
IPK="$ROOT/dist/${APP_ID}_${VERSION}_all.ipk"
# Prefer the project-local webOS CLI (npm install), fall back to a global one.
ARES_BIN="$ROOT/node_modules/.bin"
ares() { local c="$1"; shift; if [ -x "$ARES_BIN/$c" ]; then "$ARES_BIN/$c" "$@"; else command -v "$c" >/dev/null || { echo "webOS CLI not found. Run: npm install" >&2; exit 1; }; "$c" "$@"; fi; }
# Target TV: pass -d <name> or set TIVIBRO_DEVICE.  Configure devices with: npx ares-setup-device
DEVICE="${TIVIBRO_DEVICE:-}"
parse_device() { while getopts "d:" o; do case $o in d) DEVICE="$OPTARG";; esac; done; }
device_args() { if [ -n "$DEVICE" ]; then echo "--device $DEVICE"; fi; }
