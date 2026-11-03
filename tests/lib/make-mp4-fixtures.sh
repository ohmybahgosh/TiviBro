#!/usr/bin/env bash
# Tiny MP4 files with real 3GPP timed-text (tx3g, ffmpeg's mov_text) subtitle tracks, made by a real
# muxer so the MP4 subtitle reader (app/js/mp4subs.js) is checked against files it didn't write
# itself.  A 12 s, 64x36, 1 fps black picture, an English and a Dutch subtitle track.  No real media.
#   bash tests/lib/make-mp4-fixtures.sh      writes tests/lib/mp4/{faststart,moovend}.mp4 and, from
#                                            ffprobe, the expected sample tables next to them
# Needs ffmpeg and ffprobe (tested with 9.0.2) with libx264.  The outputs are committed; run this
# only to change them.
set -euo pipefail
OUT="$(cd "$(dirname "$0")" && pwd)/mp4"; mkdir -p "$OUT"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
printf '1\n00:00:01,000 --> 00:00:03,000\nHello, Café\n\n2\n00:00:04,500 --> 00:00:06,000\n日本 line\nsecond line\n\n3\n00:00:08,000 --> 00:00:10,250\nLast 😀\n' > "$T/eng.srt"
printf '1\n00:00:02,000 --> 00:00:04,000\nHallo\n\n2\n00:00:07,000 --> 00:00:09,000\nTot ziens\n' > "$T/nld.srt"
for kind in faststart moovend; do
  flags=(); [ "$kind" = faststart ] && flags=(-movflags +faststart)
  ffmpeg -hide_banner -loglevel error -y -fflags +bitexact \
    -f lavfi -i color=c=black:s=64x36:r=1:d=12 -i "$T/eng.srt" -i "$T/nld.srt" \
    -map 0:v -map 1 -map 2 -c:v libx264 -preset ultrafast -crf 51 -flags:v +bitexact -c:s mov_text \
    -metadata:s:s:0 language=eng -metadata:s:s:1 language=nld -metadata:s:s:1 title=Nederlands \
    ${flags[@]+"${flags[@]}"} "$OUT/$kind.mp4"
  ffprobe -v error -show_entries stream=index,codec_name:stream_tags=language,title \
    -show_entries packet=stream_index,pts_time,duration_time,pos,size -select_streams s -of json "$OUT/$kind.mp4" > "$OUT/$kind.expected.json"
done
ls -l "$OUT"
