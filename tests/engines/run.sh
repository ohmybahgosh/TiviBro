#!/usr/bin/env bash
# TiviBro on the real engines of older webOS TVs (Linux x64).
#   bash tests/engines/run.sh            helper on every Node, then the app in every Chromium
#   bash tests/engines/run.sh helper     only the helper (no display needed)
#   bash tests/engines/run.sh browser    only the app (needs the mock provider on :8077, the dev
#                                        relay on :47811 and the app served on :8079, plus Xvfb)
# Downloads once into .engines/ (git-ignored, about 600 MB):
#   Node 0.12.2, 8.12.0, 12.22.12, 16.20.2, 20.18.0   official builds from npm (node-linux-x64)
#   Electron 1.4.16, 4.2.12, 7.3.3, 11.5.0             official GitHub releases, SHA-256 checked
# Electron 1.4 also needs GConf and the Pango 1.40 of Ubuntu 18.04 (today's Pango crashes it);
# those come from archive.ubuntu.com and are only put on its library path.
# Engines by TV: webOS 4 = Chromium 53 / Node 0.12, 5 = 68 / 8.12, 6 = 79 / 8.12, 22 = 87 / 12,
# 24 and 25 = 108 and 120 / 16, 26 = 132 / 20.  Electron 4.2 (69) stands in for 68 and 7.3 (78) for 79.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
E="$ROOT/.engines"
WHAT="${1:-all}"
NODES="0.12.2 8.12.0 12.22.12 16.20.2 20.18.0"
ELECTRONS="1.4.16 4.2.12 7.3.3 11.5.0"
mkdir -p "$E"
fail=0

node_bin() {
  local v=$1 d="$E/node-$1"
  if [ ! -d "$d" ]; then
    (cd "$E" && npm pack "node-linux-x64@$v" --silent >/dev/null) || return 1
    mkdir -p "$d" && tar xzf "$E/node-linux-x64-$v.tgz" -C "$d" && rm -f "$E/node-linux-x64-$v.tgz"
    # 0.x packages wrap the official tarball
    local inner; inner=$(ls "$d"/package/node-v*-linux-x64.tar.gz 2>/dev/null | head -1)
    [ -n "$inner" ] && tar xzf "$inner" -C "$d/package" && rm -f "$inner"
  fi
  local b; b=$(find "$d" -path '*bin/node' -type f | head -1)
  [ -x "$b" ] && echo "$b"
}

electron_dir() {
  local v=$1 d="$E/electron-$1" f="electron-v$1-linux-x64.zip" u="https://github.com/electron/electron/releases/download/v$1"
  if [ ! -x "$d/electron" ]; then
    curl -fsSL -o "$E/$f" "$u/$f" || return 1
    local want; want=$(curl -fsSL "$u/SHASUMS256.txt" | grep " \*\?$f\$" | awk '{print $1}')
    echo "$want  $E/$f" | sha256sum -c --quiet - || { echo "checksum mismatch: $f" >&2; rm -f "$E/$f"; return 1; }
    mkdir -p "$d" && unzip -qo "$E/$f" -d "$d" && rm -f "$E/$f"
  fi
  echo "$d"
}

old_libs() {
  local d="$E/libs-electron1" a=http://archive.ubuntu.com/ubuntu/pool
  if [ ! -d "$d/usr" ]; then
    mkdir -p "$d"
    for deb in universe/g/gconf/libgconf-2-4_3.2.6-7ubuntu2_amd64.deb main/p/pango1.0/libpango-1.0-0_1.40.14-1_amd64.deb \
               main/p/pango1.0/libpangocairo-1.0-0_1.40.14-1_amd64.deb main/p/pango1.0/libpangoft2-1.0-0_1.40.14-1_amd64.deb; do
      curl -fsSL -o "$E/tmp.deb" "$a/$deb" && dpkg-deb -x "$E/tmp.deb" "$d" || return 1
    done
    rm -f "$E/tmp.deb"
  fi
  echo "$d/usr/lib/x86_64-linux-gnu"
}

if [ "$WHAT" = all ] || [ "$WHAT" = helper ]; then
  for v in $NODES; do
    b=$(node_bin "$v") || { echo "FAIL could not get Node $v"; fail=1; continue; }
    out=$("$b" "$ROOT/tests/engines/helper.js" 2>/dev/null); rc=$?
    echo "$out" | grep -E '^(FAIL|NOTE)'; echo "$out" | tail -1
    [ $rc = 0 ] || fail=1
  done
fi

if [ "$WHAT" = all ] || [ "$WHAT" = browser ]; then
  command -v xvfb-run >/dev/null || { echo "xvfb-run is needed for the browser tests (apt install xvfb)"; exit 1; }
  for v in $ELECTRONS; do
    d=$(electron_dir "$v") || { echo "FAIL could not get Electron $v"; fail=1; continue; }
    lib=""
    case $v in 1.*) lib=$(old_libs) || { echo "FAIL could not get the libraries for Electron $v"; fail=1; continue; } ;; esac
    out="$ROOT/tests/.shots/engines-$v"; rm -rf "$out"; mkdir -p "$out"
    echo "== Electron $v"
    LD_LIBRARY_PATH="$lib" TB_OUT="$out" timeout 300 xvfb-run -a -s "-screen 0 1920x1080x24" "$d/electron" --no-sandbox "$ROOT/tests/engines/browser" 2>/dev/null | grep -E '^(PASS|FAIL)' | tee "$out/log.txt"
    grep -q '^PASS no uncaught page errors' "$out/log.txt" && ! grep -q '^FAIL' "$out/log.txt" || fail=1
  done
  echo "Screenshots: tests/.shots/engines-*/"
fi
[ $fail = 0 ] && echo "all engine tests passed"; exit $fail
