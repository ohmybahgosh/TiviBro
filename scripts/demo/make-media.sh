#!/usr/bin/env bash
# Demo streams for the mock provider (tests/mock/mock_provider.js): one looping-looking clip per
# channel category, plus a movie file.  Plain test-pattern video, clearly marked as a demo.
#   bash scripts/demo/make-media.sh            writes tests/mock/media/*.ts and movie.mp4
# Needs ffmpeg with libx264 and drawtext.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/tests/mock/media"; mkdir -p "$OUT"
FONT="${DEMO_FONT:-$(fc-match -f '%{file}' 'Inter:bold' 2>/dev/null || echo /usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf)}"
DUR="${DEMO_SECONDS:-120}"
# name | title on screen | three gradient colours
CLIPS=(
  "news|NEWS|0x0b1d4a|0x1f55ff|0x0b0e1a"
  "sports|SPORTS|0x0a3d2a|0x1fbf73|0x06140e"
  "movies|MOVIES|0x2a0b3d|0x8b5cf6|0x0c0a14"
  "kids|KIDS|0x3d2a0b|0xffb547|0x1c1408"
  "docs|DOCUMENTARY|0x0b3a3d|0x14b8a6|0x071214"
  "music|MUSIC|0x3d0b2a|0xff4fa3|0x14070e"
  "ent|ENTERTAINMENT|0x3d1a0b|0xff6a3d|0x140a07"
  "local|LOCAL|0x1a2a3d|0x5b8cff|0x0b0e1a"
  "intl|WORLD|0x2a2a0b|0xd6c440|0x12120a"
  "ppv|EVENT|0x3d0b0b|0xe5484d|0x140707"
)
for c in "${CLIPS[@]}"; do
  IFS='|' read -r name title c0 c1 c2 <<< "$c"
  f="$OUT/$name.ts"; [ -s "$f" ] && continue
  echo "making $name.ts"
  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "gradients=s=960x540:r=25:d=$DUR:c0=$c0:c1=$c1:c2=$c2:nb_colors=3:speed=0.012" \
    -f lavfi -i "anullsrc=r=48000:cl=stereo" -t "$DUR" \
    -vf "drawtext=fontfile=$FONT:text='$title':fontcolor=white:fontsize=96:x=(w-tw)/2:y=(h-th)/2:shadowcolor=black@0.5:shadowx=4:shadowy=4,\
drawtext=fontfile=$FONT:text='DEMO STREAM':fontcolor=white@0.55:fontsize=22:x=(w-tw)/2:y=(h-th)/2+88,\
drawbox=x=(w-14)/2+cos(t*1.3)*220:y=h*0.30+sin(t*1.3)*30:w=12:h=12:color=white@0.6:t=fill" \
    -c:v libx264 -preset ultrafast -profile:v main -pix_fmt yuv420p -g 50 -b:v 1200k -c:a aac -b:a 64k -shortest -f mpegts "$f"
done
# Long busy clip for the sloppy-stream soak test (MOCK_CHAOS=1, tests/soak/chaos.js): ten minutes of
# moving test pattern with a clock, so freezes and jumps are easy to see.
if [ ! -s "$OUT/chaos.ts" ]; then
  echo "making chaos.ts"
  ffmpeg -hide_banner -loglevel error -y -f lavfi -i "testsrc2=s=960x540:r=25:d=600" \
    -f lavfi -i "sine=f=440:r=48000" -t 600 \
    -vf "drawtext=fontfile=$FONT:text='%{pts\\:hms}':fontcolor=white:fontsize=48:x=40:y=40:box=1:boxcolor=black@0.6" \
    -c:v libx264 -preset ultrafast -profile:v main -pix_fmt yuv420p -g 50 -b:v 1200k -c:a aac -b:a 64k -shortest -f mpegts "$OUT/chaos.ts"
fi
if [ ! -s "$OUT/movie.mp4" ]; then
  echo "making movie.mp4"
  ffmpeg -hide_banner -loglevel error -y -f lavfi -i "gradients=s=960x540:r=25:d=$DUR:c0=0x1a0b3d:c1=0x5b8cff:c2=0x33e1ff:speed=0.01" \
    -f lavfi -i "anullsrc=r=48000:cl=stereo" -t "$DUR" \
    -vf "drawtext=fontfile=$FONT:text='FEATURE PRESENTATION':fontcolor=white:fontsize=64:x=(w-tw)/2:y=(h-th)/2:shadowcolor=black@0.5:shadowx=4:shadowy=4,\
drawtext=fontfile=$FONT:text='%{pts\:hms}':fontcolor=white@0.7:fontsize=30:x=w-tw-60:y=h-80" \
    -c:v libx264 -preset ultrafast -pix_fmt yuv420p -b:v 1200k -c:a aac -shortest -movflags +faststart "$OUT/movie.mp4"
fi
ls -la "$OUT"
