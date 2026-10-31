#!/usr/bin/env bash
# Turns the raw recordings from scripts/demo/record.js into README media:
#   docs/media/<name>.gif  (small, plays inline on GitHub)
#   docs/media/<name>.mp4  (full quality, 1920 wide)
# Usage: bash scripts/demo/encode.sh [name ...]      (all recordings when none are named)
# Needs ffmpeg with libx264 and drawtext (fontconfig) for the side-by-side labels.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RAW="$ROOT/docs/media/raw"; OUT="$ROOT/docs/media"
GIF_W="${GIF_W:-800}"; GIF_FPS="${GIF_FPS:-10}"; DUAL_GIF_W="${DUAL_GIF_W:-1280}"
mkdir -p "$OUT"

trim() {  # trim <webm> -> "-ss S -t D" from the .start/.end files beside it
  local s e; s=$(cat "$1.start" 2>/dev/null || echo 0)
  if [ -f "$1.end" ]; then e=$(cat "$1.end"); echo "-ss $s -t $(echo "$e - $s" | bc)"; else echo "-ss $s"; fi
}

# Full-screen video scenes have big moving gradients, which GIF stores badly: smaller and slower for those.
HEAVY=" guide zap catchup options versions parental reminders channels "
gif() {  # gif <in.mp4> <out.gif> <width>
  local w=$3 fps=$GIF_FPS colors=128 bayer=4
  case "$HEAVY" in *" $(basename "$2" .gif) "*) w=720; fps=8; colors=96; bayer=5 ;; esac
  case " zap options " in *" $(basename "$2" .gif) "*) fps=6 ;; esac      # the longest fullscreen clips
  ffmpeg -v error -y -i "$1" -vf "fps=$fps,scale=$w:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=$colors:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=$bayer:diff_mode=rectangle" "$2"
}

single() {
  local n=$1 w="$RAW/$1.webm"
  ffmpeg -v error -y $(trim "$w") -i "$w" -vf "fps=30,format=yuv420p" -c:v libx264 -preset slow -crf 22 -movflags +faststart -an "$OUT/$n.mp4"
  gif "$OUT/$n.mp4" "$OUT/$n.gif" "$GIF_W"
}

dual() {  # computer on the left, TV on the right, each 960x540 under a label
  local n=$1 ed="$RAW/$1-ed.webm" tv="$RAW/$1-tv.webm"
  local lab="fontcolor=0x8f9bbf:fontsize=28:font=Inter:y=20"
  ffmpeg -v error -y $(trim "$ed") -i "$ed" $(trim "$tv") -i "$tv" -filter_complex \
    "[0:v]fps=30,scale=944:531:flags=lanczos,pad=960:600:8:61:0x0b0e1a,drawtext=text='On your computer':x=12:$lab[l];
     [1:v]fps=30,scale=944:531:flags=lanczos,pad=960:600:8:61:0x0b0e1a,drawtext=text='On your TV':x=12:$lab[r];
     [l][r]hstack=inputs=2:shortest=1,format=yuv420p[v]" \
    -map "[v]" -c:v libx264 -preset slow -crf 22 -movflags +faststart "$OUT/$n.mp4"
  gif "$OUT/$n.mp4" "$OUT/$n.gif" "$DUAL_GIF_W"
}

names=("$@")
if [ ${#names[@]} -eq 0 ]; then
  for f in "$RAW"/*.webm; do b=$(basename "$f" .webm); names+=("${b%-tv}"); done
fi
for n in "${names[@]}"; do
  case "$n" in *-ed) continue ;; esac
  if [ -f "$RAW/$n-tv.webm" ]; then dual "$n"; elif [ -f "$RAW/$n.webm" ]; then single "$n"; else echo "no recording for $n" >&2; continue; fi
  printf '%-12s gif %6s KB   mp4 %6s KB\n' "$n" $(( $(stat -c%s "$OUT/$n.gif") / 1024 )) $(( $(stat -c%s "$OUT/$n.mp4") / 1024 ))
done
