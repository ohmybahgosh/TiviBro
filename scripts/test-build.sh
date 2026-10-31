#!/usr/bin/env bash
# Run guide soak tests against the minified release build, not the source.  The release build is
# minified by ares-package (names renamed, comments dropped), which once broke the guide worker
# ("pubKeys is not defined", "s is not defined") while every test of the source passed.
#   MOCK_EVENTS=1 MOCK_PORT=8088 node tests/mock/mock_provider.js &
#   npm run serve &
#   bash scripts/test-build.sh
source "$(dirname "$0")/_common.sh"
OUT="$(mktemp -d)"; trap 'kill $SRV 2>/dev/null; rm -rf "$OUT"' EXIT
ares ares-package -o "$OUT" "$ROOT/app" "$ROOT/service" >/dev/null
( cd "$OUT" && ar x ./*.ipk && tar xzf data.tar.gz )
PORT="${BUILD_PORT:-8081}"
( cd "$OUT/usr/palm/applications/$APP_ID" && exec python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 ) & SRV=$!
sleep 1
export APP="http://127.0.0.1:$PORT/index.html"
echo "Testing the minified build at $APP"
node "$ROOT/tests/soak/pubepg.js"
node "$ROOT/tests/soak/boot.js"
