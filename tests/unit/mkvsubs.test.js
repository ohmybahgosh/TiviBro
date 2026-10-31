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

if (fail) { console.log(fail + ' mkvsubs test(s) failed'); process.exit(1); }
console.log('all mkvsubs tests passed');
