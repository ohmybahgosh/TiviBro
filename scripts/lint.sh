#!/usr/bin/env bash
# Syntax-check every JS file (app, service, tests).
source "$(dirname "$0")/_common.sh"
fail=0
for f in "$ROOT"/app/js/*.js "$ROOT"/service/*.js "$ROOT"/scripts/*.js "$ROOT"/tests/unit/*.js "$ROOT"/tests/mock/*.js "$ROOT"/tests/engines/*.js "$ROOT"/tests/engines/browser/*.js; do
  node --check "$f" || { echo "syntax error: $f"; fail=1; }
done
# Scripts written inside HTML pages (the web editor is one big inline script): a syntax error there
# leaves the page blank, and node --check never sees it.
for f in "$ROOT"/app/*.html "$ROOT"/service/editor/*.html; do
  node -e '
    const fs = require("fs"), vm = require("vm"), f = process.argv[1], s = fs.readFileSync(f, "utf8");
    const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g; let m, n = 0, bad = 0;
    while ((m = re.exec(s))) { n++; const line = s.slice(0, m.index).split("\n").length;
      try { new vm.Script(m[1], { filename: f + " (inline script " + n + ", from line " + line + ")" }); } catch (e) { bad = 1; console.error(f + ": inline script " + n + " (from line " + line + "): " + e.message); } }
    process.exit(bad);' "$f" || { echo "syntax error in an inline script: $f"; fail=1; }
done
for f in "$ROOT"/app/appinfo.json "$ROOT"/service/*.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" || { echo "bad JSON: $f"; fail=1; }; done
node "$ROOT/scripts/gen-nogap.js" --check >/dev/null || { echo "app/css/nogap.css is out of date (run npm run nogap)"; fail=1; }
for f in names.js tidy.js pubepg.js links.js; do cmp -s "$ROOT/app/js/$f" "$ROOT/service/editor/$f" || { echo "service/editor/$f is out of date (run npm run build)"; fail=1; }; done
[ $fail = 0 ] && echo "lint OK"; exit $fail
