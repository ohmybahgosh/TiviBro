// MkvSubs: extracts embedded SRT subtitle tracks from MKV movies/series (the native
// engine's <video> doesn't expose them on its own) via targeted EBML reads over HTTP
// Range requests. Runs mkvsubs.js against hand-built EBML byte fragments.
const fs = require('fs'), path = require('path'), vm = require('vm');
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + x : '')); if (!c) fail++; };

// ---- tiny EBML byte builders, for constructing fixtures only ----
function idBytes(hex) { const b = []; for (let i = 0; i < hex.length; i += 2) b.push(parseInt(hex.slice(i, i + 2), 16)); return b; }
function sizeByte(n) { if (n > 127) throw new Error('fixture helper only supports 1-byte sizes'); return [0x80 | n]; }
function strBytes(s) { return Array.from(s).map(c => c.charCodeAt(0)); }
function el(hexId, contentBytes) { return idBytes(hexId).concat(sizeByte(contentBytes.length)).concat(contentBytes); }
function trackEntry(num, type, codecId, lang, forced) {
  let content = [].concat(el('D7', [num]), el('83', [type]), el('86', strBytes(codecId)));
  if (lang) content = content.concat(el('22B59C', strBytes(lang)));
  if (forced) content = content.concat(el('55AA', [1]));
  return el('AE', content);
}
function u8(arr) { return Uint8Array.from(arr); }
function uintBytes(n) { if (n === 0) return [0]; const b = []; let v = n; while (v > 0) { b.unshift(v & 0xFF); v = Math.floor(v / 256); } return b; }
function seek(idHex, pos) { return el('4DBB', [].concat(el('53AB', idBytes(idHex)), el('53AC', uintBytes(pos)))); }
function cuePoint(time, track, clusterPos) { return el('BB', [].concat(el('B3', uintBytes(time)), el('B7', [].concat(el('F7', uintBytes(track)), el('F1', uintBytes(clusterPos)))))); }

const ctx = { console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/js/mkvsubs.js'), 'utf8') + '\nthis.MkvSubs = MkvSubs;', ctx);
const MkvSubs = ctx.MkvSubs;

// ---- readTracks ----
const buf = u8([].concat(
  trackEntry(3, 17, 'S_TEXT/UTF8', 'nl', true),
  trackEntry(1, 1, 'V_MPEG4/ISO/AVC', '', false)
));
ok('reads a subtitle track with language and forced flag',
  (() => {
    const tracks = MkvSubs.readTracks(buf, 0, buf.length);
    const sub = tracks.find(t => t.type === 17);
    return !!sub && sub.number === 3 && sub.codecId === 'S_TEXT/UTF8' && sub.language === 'nl' && sub.forced === true;
  })());

ok('reads a video track with no language tag as empty string, not throwing',
  (() => {
    const tracks = MkvSubs.readTracks(buf, 0, buf.length);
    const vid = tracks.find(t => t.type === 1);
    return !!vid && vid.number === 1 && vid.codecId === 'V_MPEG4/ISO/AVC' && vid.language === '';
  })());

const videoOnlyBuf = u8(trackEntry(1, 1, 'V_MPEG4/ISO/AVC', '', false));
ok('an MKV with no subtitle track returns an empty subtitle list, not throwing',
  MkvSubs.readTracks(videoOnlyBuf, 0, videoOnlyBuf.length).filter(t => t.type === 17).length === 0);

ok('a truncated Tracks buffer does not throw and returns whatever it could read',
  (() => { try { MkvSubs.readTracks(buf.slice(0, 5), 0, 5); return true; } catch (e) { return false; } })());

// ---- readSeekHead ----
const seekHeadBuf = u8([].concat(seek('1C53BB6B', 900), seek('1654AE6B', 50)));
ok('SeekHead maps Cues to its segment-relative position',
  MkvSubs.readSeekHead(seekHeadBuf, 0, seekHeadBuf.length)['1C53BB6B'] === 900);

// ---- readCuesForTrack ----
const cuesBuf = u8([].concat(
  cuePoint(0, 3, 120),
  cuePoint(2000, 3, 5000),
  cuePoint(999, 1, 10)
));
ok('readCuesForTrack returns only the requested track, in order, with correct times',
  (() => {
    const cues = MkvSubs.readCuesForTrack(cuesBuf, 0, cuesBuf.length, 3, 1000000);
    return cues.length === 2 && cues[0].timeSec === 0 && cues[0].clusterPos === 120 && cues[1].timeSec === 2 && cues[1].clusterPos === 5000;
  })());

ok('a track number with no cues in Cues returns an empty array, not throwing',
  MkvSubs.readCuesForTrack(cuesBuf, 0, cuesBuf.length, 99, 1000000).length === 0);

if (fail) { console.log(fail + ' mkvsubs test(s) failed'); process.exit(1); }
console.log('all mkvsubs tests passed');
