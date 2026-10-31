#!/usr/bin/env bash
# The website's pictures (site/img/shots/*.webp) from the screenshots in docs/screenshots: every .webp
# already there is made again from the .png of the same name, TV and computer shots 1280 wide, phone
# shots 390 wide.  Run after scripts/demo/record.js.  Needs ffmpeg with libwebp.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
for w in "$ROOT"/site/img/shots/*.webp; do
  n=$(basename "$w" .webp); png="$ROOT/docs/screenshots/$n.png"
  [ -f "$png" ] || { echo "no docs/screenshots/$n.png, kept $n.webp"; continue; }
  case "$n" in *phone*) width=390 ;; *) width=1280 ;; esac
  ffmpeg -v error -y -i "$png" -vf "scale=$width:-2:flags=lanczos" -c:v libwebp -quality 82 -compression_level 6 "$w"
  echo "$n.webp"
done
