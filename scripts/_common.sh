# Shared helpers for TiviBro scripts.  Sourced, not run.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_ID="$(node -p "require('$ROOT/app/appinfo.json').id")"
VERSION="$(node -p "require('$ROOT/app/appinfo.json').version")"
IPK="$ROOT/dist/${APP_ID}_${VERSION}_all.ipk"
# Prefer the project-local webOS CLI (npm install), fall back to a global one.
ARES_BIN="$ROOT/node_modules/.bin"
# A copy of app/ in $1/app to package, with each script under a name with its hash (js/log.<hash>.js),
# so webOS's code cache can't keep running a changed script of the same length after an update
# (scripts/script-versions.js).  build.sh and test-build.sh package this, never app/ itself.
# The app, with TiviBro's license and the third-party notices beside index.html (THIRD-PARTY-NOTICES.md).
# A build from a checkout (not the Release workflow, which stamps the tag into log.js first) says which release it
# follows, like 0.6.0-alpha.174.dev, so test-build features (the phone app section, Report) show as on a real alpha.
stamp_dev() { local f="$1/app/js/log.js" t; grep -qE "^var TIVIBRO_VERSION = '[0-9]+\.[0-9]+\.[0-9]+';" "$f" || return 0
  t="$(git -C "$ROOT" describe --tags --abbrev=0 --match 'v*-*' 2>/dev/null)" || return 0
  sed -i "s/^var TIVIBRO_VERSION = .*/var TIVIBRO_VERSION = '${t#v}.dev';/" "$f"; }
stage_app() { cp -R "$ROOT/app" "$1/app" && cp "$ROOT/LICENSE" "$1/app/LICENSE.txt" && cp "$ROOT/THIRD-PARTY-NOTICES.md" "$1/app/THIRD-PARTY-NOTICES.md" && stamp_dev "$1" && node "$ROOT/scripts/script-versions.js" "$1/app"; }
ares() { local c="$1"; shift; if [ -x "$ARES_BIN/$c" ]; then "$ARES_BIN/$c" "$@"; else command -v "$c" >/dev/null || { echo "webOS CLI not found. Run: npm install" >&2; exit 1; }; "$c" "$@"; fi; }
# Target TV: pass -d <name> or set TIVIBRO_DEVICE.  Configure devices with: npx ares-setup-device
DEVICE="${TIVIBRO_DEVICE:-}"
parse_device() { while getopts "d:" o; do case $o in d) DEVICE="$OPTARG";; esac; done; }
device_args() { if [ -n "$DEVICE" ]; then echo "--device $DEVICE"; fi; }
