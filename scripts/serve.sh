#!/usr/bin/env bash
# Run the app in a desktop browser: static server for app/ on :8078 plus the dev relay on :47811.
# Open http://localhost:8078/index.html  (the app picks up the relay via localStorage 'tivibro.devRelay'=47811).
source "$(dirname "$0")/_common.sh"
node "$ROOT/tests/mock/relay_dev.js" & RELAY=$!
node "$ROOT/scripts/logsink.js" & SINK=$!
trap 'kill $RELAY $SINK 2>/dev/null' EXIT
echo "App:   http://localhost:8078/index.html"
echo "Relay: http://127.0.0.1:47811/ping"
cd "$ROOT/app" && python3 -m http.server 8078 --bind 127.0.0.1
