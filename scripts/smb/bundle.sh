#!/usr/bin/env bash
# Puts the SMB program for Windows shares into the package: the two .gz builds from the release named in
# service/smb.js (TAG), checked against its SHA256 there, plus the licence and source notes the LGPL asks
# to travel with it.  Into service/smb-bundle/ (not in git), from a cache in tools/smb-cache/ so a rebuild
# doesn't download again.  scripts/build.sh runs it.  See docs/SMB.md.
#   TIVIBRO_NO_SMB_BUNDLE=1  leaves it out (My media then says this build can't open Windows shares)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/service/smb-bundle"
rm -rf "$OUT"
if [ "${TIVIBRO_NO_SMB_BUNDLE:-}" = 1 ]; then echo "smb bundle: left out (TIVIBRO_NO_SMB_BUNDLE=1)"; exit 0; fi
TAG="$(node -p "require('$ROOT/service/smb.js').TAG")"
if [ -z "$(node -p "require('$ROOT/service/smb.js').SHA256.armv7")" ]; then echo "smb bundle: $TAG isn't published yet, left out"; exit 0; fi
BASE="https://github.com/ohmybahgosh/TiviBro/releases/download/$TAG"
CACHE="$ROOT/tools/smb-cache/$TAG"
mkdir -p "$CACHE" "$OUT"
sha() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
for a in armv7 aarch64; do
  f="tivibro-smb-$a.gz"; want="$(node -p "require('$ROOT/service/smb.js').SHA256['$a']")"
  if [ ! -f "$CACHE/$f" ] || [ "$(sha "$CACHE/$f")" != "$want" ]; then
    curl -fsSL --retry 3 -o "$CACHE/$f.part" "$BASE/$f"
    mv "$CACHE/$f.part" "$CACHE/$f"
  fi
  got="$(sha "$CACHE/$f")"
  [ "$got" = "$want" ] || { echo "smb bundle: $f does not match its SHA-256 in service/smb.js ($got)" >&2; exit 1; }
  cp "$CACHE/$f" "$OUT/$f"
done
for f in COPYING.LGPLv2.1 SOURCE.txt; do
  [ -f "$CACHE/$f" ] || curl -fsSL --retry 3 -o "$CACHE/$f" "$BASE/$f"
  cp "$CACHE/$f" "$OUT/$f"
done
echo "smb bundle: $TAG, $(du -sh "$OUT" | cut -f1) in service/smb-bundle"
