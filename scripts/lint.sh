#!/usr/bin/env bash
# Syntax-check every JS file (app, service, tests).
source "$(dirname "$0")/_common.sh"
fail=0
for f in "$ROOT"/app/js/*.js "$ROOT"/service/*.js "$ROOT"/scripts/*.js "$ROOT"/tests/unit/*.js "$ROOT"/tests/mock/*.js "$ROOT"/tests/engines/*.js "$ROOT"/tests/engines/browser/*.js; do
  node --check "$f" || { echo "syntax error: $f"; fail=1; }
done
for f in "$ROOT"/app/appinfo.json "$ROOT"/service/*.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" || { echo "bad JSON: $f"; fail=1; }; done
node "$ROOT/scripts/gen-nogap.js" --check >/dev/null || { echo "app/css/nogap.css is out of date (run npm run nogap)"; fail=1; }
cmp -s "$ROOT/app/js/names.js" "$ROOT/service/editor/names.js" || { echo "service/editor/names.js is out of date (run npm run build)"; fail=1; }
[ $fail = 0 ] && echo "lint OK"; exit $fail
