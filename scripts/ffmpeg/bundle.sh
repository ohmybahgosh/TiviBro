#!/usr/bin/env bash
# Puts the audio converter into the package: the two .gz builds from the ffmpeg release named in
# service/ffmpeg.js (TAG), checked against its SHA256 there, plus the licence and source notes the
# LGPL asks to travel with it.  Into service/ffmpeg-bundle/ (not in git), from a cache in
# tools/ffmpeg-cache/ so a rebuild doesn't download again.  scripts/build.sh runs it.
#   TIVIBRO_NO_FFMPEG_BUNDLE=1  leaves it out (the helper then downloads it when a movie needs it)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/service/ffmpeg-bundle"
rm -rf "$OUT"
if [ "${TIVIBRO_NO_FFMPEG_BUNDLE:-}" = 1 ]; then echo "ffmpeg bundle: left out (TIVIBRO_NO_FFMPEG_BUNDLE=1)"; exit 0; fi
TAG="$(node -p "require('$ROOT/service/ffmpeg.js').TAG")"
BASE="https://github.com/ohmybahgosh/TiviBro/releases/download/$TAG"
CACHE="$ROOT/tools/ffmpeg-cache/$TAG"
mkdir -p "$CACHE" "$OUT"
sha() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
for a in armv7 aarch64; do
  f="tivibro-ffmpeg-$a.gz"; want="$(node -p "require('$ROOT/service/ffmpeg.js').SHA256['$a']")"
  if [ ! -f "$CACHE/$f" ] || [ "$(sha "$CACHE/$f")" != "$want" ]; then
    curl -fsSL --retry 3 -o "$CACHE/$f.part" "$BASE/$f"
    mv "$CACHE/$f.part" "$CACHE/$f"
  fi
  got="$(sha "$CACHE/$f")"
  [ "$got" = "$want" ] || { echo "ffmpeg bundle: $f does not match its SHA-256 in service/ffmpeg.js ($got)" >&2; exit 1; }
  cp "$CACHE/$f" "$OUT/$f"
done
for f in COPYING.LGPLv3 COPYING.LGPLv2.1 LICENSE.md LICENSE.mbedtls.txt SOURCE.txt; do
  [ -f "$CACHE/$f" ] || curl -fsSL --retry 3 -o "$CACHE/$f" "$BASE/$f"
  cp "$CACHE/$f" "$OUT/$f"
done
echo "ffmpeg bundle: $TAG, $(du -sh "$OUT" | cut -f1) in service/ffmpeg-bundle"
