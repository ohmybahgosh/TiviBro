/* A tiny MPEG-TS reader for tests: the H.264 SEI NAL units of the video stream, with their PTS in ms.
   seis(buffer) -> [{ pts, nal }]   (nal starts at the NAL header byte) */
'use strict';
function seis(buf) {
  let pmtPid = -1, vpid = -1, pes = null;
  const out = [];
  const flush = () => {
    if (!pes) return;
    const d = Buffer.concat(pes.parts);
    pes = null;
    if (d.length < 9 || d[0] !== 0 || d[1] !== 0 || d[2] !== 1) return;
    const hlen = d[8], flags = d[7];
    let pts = null;
    if (flags & 0x80) pts = ((d[9] & 0x0e) * 536870912 + d[10] * 4194304 + (d[11] & 0xfe) * 16384 + d[12] * 128 + (d[13] >> 1)) / 90;
    const es = d.subarray(9 + hlen);
    // Split Annex B.
    const starts = [];
    for (let i = 0; i + 3 < es.length; i++) if (es[i] === 0 && es[i + 1] === 0 && es[i + 2] === 1) { starts.push(i + 3); i += 2; }
    starts.forEach((s, k) => {
      let e = k + 1 < starts.length ? starts[k + 1] - 3 : es.length;
      while (e > s && es[e - 1] === 0) e--;
      if ((es[s] & 0x1f) === 6) out.push({ pts, nal: es.subarray(s, e) });
    });
  };
  for (let o = 0; o + 188 <= buf.length; o += 188) {
    if (buf[o] !== 0x47) { const n = buf.indexOf(0x47, o + 1); if (n < 0) break; o = n - 188; continue; }
    const pusi = buf[o + 1] & 0x40, pid = ((buf[o + 1] & 0x1f) << 8) | buf[o + 2], afc = (buf[o + 3] >> 4) & 3;
    let p = o + 4;
    if (afc & 2) p += 1 + buf[o + 4];
    if (!(afc & 1) || p >= o + 188) continue;
    const pay = buf.subarray(p, o + 188);
    if (pid === 0 && pusi) { const s = 1 + pay[0]; pmtPid = ((pay[s + 10] & 0x1f) << 8) | pay[s + 11]; continue; }
    if (pid === pmtPid && pusi && vpid < 0) {
      const s = 1 + pay[0], secLen = ((pay[s + 1] & 0x0f) << 8) | pay[s + 2], pil = ((pay[s + 10] & 0x0f) << 8) | pay[s + 11];
      let q = s + 12 + pil;
      const end = s + 3 + secLen - 4;
      while (q + 5 <= end) { const st = pay[q], ep = ((pay[q + 1] & 0x1f) << 8) | pay[q + 2], il = ((pay[q + 3] & 0x0f) << 8) | pay[q + 4]; if (st === 0x1b && vpid < 0) vpid = ep; q += 5 + il; }
      continue;
    }
    if (pid === vpid) {
      if (pusi) { flush(); pes = { parts: [] }; }
      if (pes) pes.parts.push(pay);
    }
  }
  flush();
  return out;
}
module.exports = { seis };
