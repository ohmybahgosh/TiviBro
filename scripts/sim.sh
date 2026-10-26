#!/usr/bin/env bash
# Run TiviBro in LG's webOS TV Simulator (an Electron AppImage kept in tools/, nothing installed system-wide).
#   bash scripts/sim.sh            launch app/ in the webOS 25 simulator (auto-reloads on save)
#   bash scripts/sim.sh --open     just open the simulator (then use its menu to launch app/ and service/)
#   SIM_VERSION=26 bash scripts/sim.sh    use another simulator version in tools/
# Troubleshooting only:  SIM_FLAGS="--ozone-platform=x11" bash scripts/sim.sh --open
#   (LG also suggests --no-sandbox on Ubuntu 24+; avoid it unless the simulator will not start without it.)
source "$(dirname "$0")/_common.sh"
V="${SIM_VERSION:-25}"
SIM_DIR="$(ls -d "$ROOT"/tools/webOS_TV_${V}_Simulator_*/ 2>/dev/null | sort -V | tail -1)"
SIM_DIR="${SIM_DIR%/}"
[ -n "$SIM_DIR" ] || { echo "No webOS $V simulator in tools/.  See docs/SIMULATOR.md." >&2; exit 1; }
APPIMAGE="$(ls "$SIM_DIR"/*.AppImage | head -1)"
chmod +x "$APPIMAGE"
# AppImages need FUSE 2.  Without it, extract-and-run works with no system changes.
if ! ldconfig -p 2>/dev/null | grep -q 'libfuse.so.2'; then
  echo "libfuse2 not found: running the AppImage in extract-and-run mode (no install needed)."
  export APPIMAGE_EXTRACT_AND_RUN=1
fi
# Log receiver: the app streams every log line to logs/latest.log while this runs.
node "$ROOT/scripts/logsink.js" & SINK=$!
# The network helper (CORS relay + web editor), running on this computer for the simulator.
node "$ROOT/tests/mock/relay_dev.js" & RELAY=$!
trap 'kill $SINK $RELAY 2>/dev/null' EXIT
if [ "${1:-}" = "--open" ]; then
  echo "Opening $(basename "$APPIMAGE")"
  "$APPIMAGE" ${SIM_FLAGS:-}; exit
fi
# Launch the AppImage directly with the app folder: this is exactly what ares-launch runs, but
# ares-launch 3.2.6 only looks for a lowercase ".appimage" file and LG ships ".AppImage".
echo "Launching app/ in $(basename "$SIM_DIR")"
"$APPIMAGE" ${SIM_FLAGS:-} "$ROOT/app" "{}"
