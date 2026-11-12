#!/usr/bin/env bash
# Every soak test, each with the mock providers its header asks for (the "node tests/mock/mock_provider.js"
# lines, with their MOCK_ settings; a plain one on :8077 when it names none), against one app server.
#   bash scripts/soak-all.sh [name ...]        all of tests/soak, or the ones named (without .js)
# Writes a line per test and a log per test to $OUT (default /tmp/soak-all), and a summary at the end.
#   SKIP="chaos monkey"   leave some out          TIME=600   seconds each test may take
#   FRESH=1   a new app server for every test, with its own empty storage (slower; no test sees another's web
#             editor, phone pairing or the playlist a test before it stored, from a mock with other channels)
set -u
cd "$(dirname "$0")/.."
export NODE_PATH=${NODE_PATH:-/opt/node-tools/node_modules}
OUT=${OUT:-/tmp/soak-all}; TIME=${TIME:-600}; SKIP=" ${SKIP:-} "
mkdir -p "$OUT"; : > "$OUT/summary.txt"
pids() { ps -eo pid=,args= | awk -v p="$1" '$0 ~ p && !/awk/ {print $1}'; }
stop_mocks() { pids 'tests/mock/mock_provider.js' | xargs -r kill; sleep 1; }
stop_all() { stop_mocks; pids 'scripts/serve.sh|relay_dev|logsink|http.server 80(78|79|95)|service/index.js' | xargs -r kill; }
start_serve() {
  TIVIBRO_OS_BASE=http://127.0.0.1:8077/os/api/v1 TIVIBRO_FFMPEG=/usr/local/bin/ffmpeg nohup bash scripts/serve.sh > "$OUT/serve.log" 2>&1 &
  for i in $(seq 1 30); do curl -s -o /dev/null http://127.0.0.1:8078/index.html && break; sleep 1; done
}
trap stop_all EXIT
stop_all; start_serve
names=("$@"); [ ${#names[@]} = 0 ] && names=($(ls tests/soak/*.js | xargs -n1 basename | sed 's/\.js$//'))
pass=0; fail=0
for n in "${names[@]}"; do
  case "$SKIP" in *" $n "*) echo "SKIP $n" | tee -a "$OUT/summary.txt"; continue;; esac
  f=tests/soak/$n.js
  if [ -n "${FRESH:-}" ]; then stop_all; export TIVIBRO_KV_DIR="$OUT/kv-$n"; rm -rf "$TIVIBRO_KV_DIR"; mkdir -p "$TIVIBRO_KV_DIR"; start_serve; else stop_mocks; fi
  mocks=$(head -25 "$f" | grep -o '\([A-Z_0-9]*=[^ ]* \)*node tests/mock/mock_provider.js' | sed 's/ *node tests\/mock\/mock_provider.js//' | sort -u)
  [ -z "$(head -25 "$f" | grep -o 'node tests/mock/mock_provider.js')" ] && mocks="PLAIN"
  i=0
  while IFS= read -r m; do
    i=$((i+1)); [ "$m" = PLAIN ] && m=""
    env $m nohup node tests/mock/mock_provider.js > "$OUT/$n.mock$i.log" 2>&1 &
  done <<< "$mocks"
  # A test whose mocks are all on other ports still signs in to :8077 for the default playlist.
  echo "$mocks" | grep -qv 'MOCK_PORT' || nohup node tests/mock/mock_provider.js > "$OUT/$n.mock0.log" 2>&1 &
  sleep 3
  start=$(date +%s)
  # A test whose header runs it with the converter (TIVIBRO_FFMPEG=... node tests/soak/<name>.js) gets it.
  ff=""; head -25 "$f" | grep -q "TIVIBRO_FFMPEG=[^ ]* node tests/soak/$n.js" && ff="TIVIBRO_FFMPEG=${TIVIBRO_FFMPEG:-/usr/local/bin/ffmpeg}"
  gcx=""; head -25 "$f" | grep -q "node --expose-gc tests/soak/$n.js" && gcx="--expose-gc"   # a memory test's header asks for it
  env $ff timeout "$TIME" node $gcx "$f" > "$OUT/$n.log" 2>&1; rc=$?
  secs=$(( $(date +%s) - start ))
  if [ $rc = 0 ]; then pass=$((pass+1)); line="PASS $n (${secs}s)"; else fail=$((fail+1)); line="FAIL $n (exit $rc, ${secs}s): $(grep -m3 -E '^FAIL|Error|harness' "$OUT/$n.log" | tr '\n' ' ' | cut -c1-300)"; fi
  echo "$line" | tee -a "$OUT/summary.txt"
done
echo "$pass passed, $fail failed" | tee -a "$OUT/summary.txt"
