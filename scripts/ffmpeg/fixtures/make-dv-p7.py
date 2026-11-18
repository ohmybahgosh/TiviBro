#!/usr/bin/env python3
"""dv-p7.hevc: a 1-second test clip shaped like Dolby Vision profile 7 (UHD Blu-ray): an HDR10 base layer,
an enhancement-layer NAL (type 63) and an RPU (type 62) in every access unit, the RPU saying the
enhancement layer is in use (residual on, NLQ, a non-identity mapping).  For the smoke test of the dovi_rpu
filter's p81 option (build.sh) and tests/unit/dovi-p81.test.js.  Not a picture anyone watches.

  ffmpeg -f lavfi -i testsrc2=size=320x180:rate=24:duration=1 -pix_fmt yuv420p10le -c:v libx265 \\
    -x265-params aud=1:keyint=12:min-keyint=12:repeat-headers=1:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc \\
    -f hevc bl.hevc
  cc -I<ffmpeg 7.1 tree> -o gen_p7 gen_p7.c <tree>/libavcodec/libavcodec.a <tree>/libavutil/libavutil.a -lm -lpthread
  ./gen_p7 24 > rpus.bin
  python3 make-dv-p7.py bl.hevc rpus.bin dv-p7.hevc
"""
import re, struct, sys
bl, rpus, out_path = sys.argv[1:4]
d = open(bl, 'rb').read()
pos = [m.start() for m in re.finditer(b'\x00\x00\x01', d)]
nals = [d[p + 3:(pos[i + 1] if i + 1 < len(pos) else len(d))].rstrip(b'\x00') for i, p in enumerate(pos)]
r = open(rpus, 'rb').read(); rp = []; i = 0
while i < len(r):
    n = struct.unpack('>I', r[i:i + 4])[0]; rp.append(r[i + 4:i + 4 + n]); i += 4 + n
aus, cur = [], []
for n in nals:                                  # access units start at each AUD (type 35)
    if ((n[0] >> 1) & 0x3f) == 35 and cur: aus.append(cur); cur = []
    cur.append(n)
aus.append(cur)
out = bytearray()
for k, au in enumerate(aus):
    for n in au: out += b'\x00\x00\x00\x01' + n
    out += b'\x00\x00\x00\x01' + bytes([63 << 1, 1]) + b'\x11\x22\x33\x44\x55' * 4   # enhancement layer
    out += b'\x00\x00\x00\x01' + bytes([62 << 1, 1]) + rp[k % len(rp)]             # the RPU, last
open(out_path, 'wb').write(out)
