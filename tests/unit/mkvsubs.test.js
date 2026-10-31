// MkvSubs: extracts embedded SRT subtitle tracks from MKV movies/series (the native
// engine's <video> doesn't expose them on its own) via targeted EBML reads over HTTP
// Range requests. Runs mkvsubs.js against hand-built EBML byte fragments.
const fs = require('fs'), path = require('path'), vm = require('vm');
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + x : '')); if (!c) fail++; };

// ---- tiny EBML byte builders, for constructing fixtures only ----
function idBytes(hex) { const b = []; for (let i = 0; i < hex.length; i += 2) b.push(parseInt(hex.slice(i, i + 2), 16)); return b; }
function sizeByte(n) {
  for (let len = 1; len <= 8; len++) {
    if (n <= Math.pow(2, 7 * len) - 1) {
      const bytes = [];
      let v = n;
      for (let i = len - 1; i >= 0; i--) { bytes[i] = v & 0xFF; v = Math.floor(v / 256); }
      bytes[0] |= (0x80 >> (len - 1));
      return bytes;
    }
  }
  throw new Error('size too large for fixture helper');
}
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
function trackVint(n) { return [0x80 | n]; }
function i16be(n) { if (n < 0) n = 0x10000 + n; return [(n >> 8) & 0xFF, n & 0xFF]; }
function blockHeader(track, relTimecode, flags) { return trackVint(track).concat(i16be(relTimecode), [flags]); }
function blockGroupEl(track, relTimecode, duration, text) {
  const blockContent = blockHeader(track, relTimecode, 0x00).concat(strBytes(text));
  return el('A0', [].concat(el('A1', blockContent), el('9B', uintBytes(duration))));
}
function simpleBlockEl(track, relTimecode, flags, text) { return el('A3', blockHeader(track, relTimecode, flags).concat(strBytes(text))); }
// Fixed-width (4-byte) uint encoding: length is independent of value, so a SeekHead/Cues
// entry's own byte length can be computed before the position value it will hold is known.
function uintBytesFixed(n) { const b = []; let v = n; for (let i = 0; i < 4; i++) { b.unshift(v & 0xFF); v = Math.floor(v / 256); } return b; }
function seekFixed(idHex, pos) { return el('4DBB', [].concat(el('53AB', idBytes(idHex)), el('53AC', uintBytesFixed(pos)))); }
function cuePointFixed(time, track, clusterPos) { return el('BB', [].concat(el('B3', uintBytes(time)), el('B7', [].concat(el('F7', uintBytes(track)), el('F1', uintBytesFixed(clusterPos)))))); }

// A complete synthetic MKV: EBML header + Segment{Info, Tracks, SeekHead->Cues, Cues->Cluster}.
// opts.subtitleTrack: {number, lang} or null (no subtitle track at all).
// opts.cuesIndexesSubtitle: whether Cues' CuePoint references the subtitle track (true) or
//   only the video track (false) -- the "Cues doesn't index the subtitle track" case.
function buildMkv(opts) {
  const ebmlHeader = el('1A45DFA3', []);
  const infoEl = el('1549A966', el('2AD7B1', uintBytes(1000000)));
  let tracksContent = trackEntry(1, 1, 'V_MPEG4/ISO/AVC', '', false);
  if (opts.subtitleTrack) tracksContent = tracksContent.concat(trackEntry(opts.subtitleTrack.number, 17, 'S_TEXT/UTF8', opts.subtitleTrack.lang || '', false));
  const tracksEl = el('1654AE6B', tracksContent);
  const preSeekLen = infoEl.length + tracksEl.length;
  const seekEntryLen = seekFixed('1C53BB6B', 0).length; // fixed-width: same length for any value
  const seekHeadFullLen = idBytes('114D9B74').length + sizeByte(seekEntryLen).length + seekEntryLen; // SeekHead's own id+size header + its one Seek entry
  const cuesOffset = preSeekLen + seekHeadFullLen; // Cues sits right after the whole SeekHead element, not just its inner Seek entry
  const seekHeadEl = el('114D9B74', seekFixed('1C53BB6B', cuesOffset));

  const cuesTrack = (opts.cuesIndexesSubtitle && opts.subtitleTrack) ? opts.subtitleTrack.number : 1;
  const cuePointLen = cuePointFixed(0, cuesTrack, 0).length; // fixed-width: same length for any value
  const cuesElLenSoFar = idBytes('1C53BB6B').length + 1 /* 1-byte size */ + cuePointLen;
  const clusterPos = cuesOffset + cuesElLenSoFar;
  const cuesEl = el('1C53BB6B', cuePointFixed(0, cuesTrack, clusterPos));

  let clusterContent = el('E7', uintBytes(1000)); // cluster timecode
  if (opts.subtitleTrack) clusterContent = clusterContent.concat(blockGroupEl(opts.subtitleTrack.number, 0, opts.cueDuration || 2000, opts.cueText || 'Hi there'));
  const clusterEl = el('1F43B675', clusterContent);

  const segmentContent = [].concat(infoEl, tracksEl, seekHeadEl, cuesEl, clusterEl);
  const segmentEl = el('18538067', segmentContent);
  return Uint8Array.from([].concat(ebmlHeader, segmentEl));
}

const mkvFixtures = {
  '1.mkv': buildMkv({ subtitleTrack: { number: 7, lang: 'en' }, cuesIndexesSubtitle: true }),
  'novideosubs.mkv': buildMkv({ subtitleTrack: { number: 7, lang: 'en' }, cuesIndexesSubtitle: false }),
  'novsubtracks.mkv': buildMkv({ subtitleTrack: null }),
  // real files tag Language with the raw 3-letter metadata code (e.g. 'dut' for Dutch),
  // not a display name -- the menu/UI should show "Dutch", not "dut".
  'dutlabel.mkv': buildMkv({ subtitleTrack: { number: 7, lang: 'dut' }, cuesIndexesSubtitle: true }),
  'cacheme.mkv': buildMkv({ subtitleTrack: { number: 7, lang: 'en' }, cuesIndexesSubtitle: true }),
  // fresh, single-use fixtures so the cross-reconnect cache doesn't make these tests
  // hit the synchronous cached fast-path instead of the async path they exercise
  'cancelearly.mkv': buildMkv({ subtitleTrack: { number: 7, lang: 'en' }, cuesIndexesSubtitle: true }),
  'delay.mkv': buildMkv({ subtitleTrack: { number: 7, lang: 'en' }, cuesIndexesSubtitle: true })
};
let fetchCallCount = 0;
function fakeFetch(url, options) {
  fetchCallCount++;
  const m = /\/([^/]+)$/.exec(url);
  const name = m ? m[1] : '';
  if (name === 'dropsconnection.mkv') return Promise.reject(new Error('simulated connection drop'));
  const data = mkvFixtures[name];
  if (!data) return Promise.resolve({ ok: false, status: 404, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) });
  const range = (options && options.headers && options.headers.Range) || '';
  const rm = /bytes=(\d+)-(\d+)/.exec(range);
  let start = 0, end = data.length - 1;
  if (rm) { start = +rm[1]; end = Math.min(+rm[2], data.length - 1); }
  if (start >= data.length) return Promise.resolve({ ok: false, status: 416, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) });
  const slice = data.slice(start, end + 1);
  return Promise.resolve({ ok: true, status: 206, contentRange: 'bytes ' + start + '-' + end + '/' + data.length, arrayBuffer: () => Promise.resolve(slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength)) });
}
let abortedRequests = 0, responseMode = '', bodyReads = 0, redirectTarget = '', requestUrls = [], faultResponse = null;
class FakeXHR {
  open(method, url) { this.url = url; requestUrls.push(url); }
  setRequestHeader(k, v) { this.headers = this.headers || {}; this.headers[k] = v; }
  getResponseHeader() { return this.contentRange; }
  send() {
    if (responseMode === 'pending') return;
    fakeFetch(this.url, {headers: this.headers}).then(r => {
      if (this.aborted) return;
      this.responseURL = redirectTarget || this.url;
      this.status = (faultResponse && faultResponse(this)) || (responseMode === 'ignoreRange' ? 200 : r.status);
      this.contentRange = responseMode === 'wrongRange' ? 'bytes 1-20/100' : r.contentRange;
      this.readyState = 2;
      this.onreadystatechange();
      if (this.aborted) return;
      bodyReads++;
      return r.arrayBuffer().then(ab => { if (!this.aborted) { this.response = ab; this.onload(); } });
    }).catch(() => { if (!this.aborted) this.onerror(); });
  }
  abort() { this.aborted = true; abortedRequests++; if (this.onabort) this.onabort(); }
}
function makeFakeTrackElement() {
  const cues = [];
  return { kind: '', label: '', srclang: '', track: { cues: cues, addCue(c) { cues.push(c); } } };
}
function flush(rounds) {
  rounds = rounds || 20;
  let p = Promise.resolve();
  for (let i = 0; i < rounds; i++) p = p.then(() => new Promise(res => setTimeout(res, 0)));
  return p;
}
function waitForAsync(cond) { return flush().then(() => cond()); }

const ctx = {
  console, Promise, setTimeout, clearTimeout, XMLHttpRequest: FakeXHR,
  fetch: (...a) => fakeFetch(...a),
  Net: { wrap: u => u },
  Log: { debug() {}, warn() {}, info() {} },
  document: { createElement: tag => (tag === 'track' ? makeFakeTrackElement() : {textContent: ''}) },
  VTTCue: function (start, end, text) { this.startTime = start; this.endTime = end; this.text = text; }
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/js/util.js'), 'utf8') + '\nthis.U = U;', ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/js/mkvsubs.js'), 'utf8') + '\nthis.MkvSubs = MkvSubs;', ctx);
const MkvSubs = ctx.MkvSubs;
MkvSubs.startupDelayMs = 0; // keep every other test fast/deterministic; the dedicated delay test below sets its own value and restores this

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

// ---- readClusterBlocks ----
const clusterBuf = u8([].concat(
  el('E7', uintBytes(1000)),
  blockGroupEl(3, 500, 1500, 'Hello, world!'),
  blockGroupEl(1, 0, 1000, 'ignored'),
  simpleBlockEl(3, 0, 0x02, 'laced-skip')
));
ok('reads one subtitle cue from a Cluster with correct absolute timing and text',
  (() => {
    const cues = MkvSubs.readClusterBlocks(clusterBuf, 0, clusterBuf.length, 3, 1000000);
    const c = cues.find(c => c.text === 'Hello, world!');
    return c && Math.abs(c.startSec - 1.5) < 0.001 && Math.abs(c.endSec - 3.0) < 0.001;
  })());

ok('ignores blocks belonging to other tracks',
  MkvSubs.readClusterBlocks(clusterBuf, 0, clusterBuf.length, 1, 1000000).every(c => c.text !== 'Hello, world!'));

ok('skips a laced block for the target track instead of misreading it',
  MkvSubs.readClusterBlocks(clusterBuf, 0, clusterBuf.length, 3, 1000000).length === 1);

ok('a truncated Cluster buffer does not throw',
  (() => { try { MkvSubs.readClusterBlocks(clusterBuf.slice(0, 10), 0, 10, 3, 1000000); return true; } catch (e) { return false; } })());

// Some releases tag their S_TEXT/UTF8 track as plain SRT but the text still carries ASS
// override codes like {\an8} (position overrides) -- strip them, don't display them.
const assTagCluster = u8([].concat(
  el('E7', uintBytes(1000)),
  blockGroupEl(3, 500, 1500, '{\\an8}Hello, world!')
));
ok('strips ASS override codes like {\\an8} from cue text instead of displaying them literally',
  MkvSubs.readClusterBlocks(assTagCluster, 0, assTagCluster.length, 3, 1000000)[0].text === 'Hello, world!');

// ---- clusterFetchOrder: prioritize clusters near current playback position, not file order ----
ok('orders clusters by proximity to current playback position, nearest first, deduped', (() => {
  const perTrackCues = [
    { track: { number: 7 }, cues: [{ timeSec: 20, clusterPos: 100 }, { timeSec: 2300, clusterPos: 500 }] },
    { track: { number: 7 }, cues: [{ timeSec: 2290, clusterPos: 500 }] } // same cluster as above -> must dedupe to one entry
  ];
  const order = MkvSubs.clusterFetchOrder(perTrackCues, 2295, 10);
  return JSON.stringify(order) === JSON.stringify([510, 110]);
})());

// ---- extract() ----
(async function () {
  ok('extracts a subtitle cue end to end and adds it to a <track> on the video', await (async () => {
    const video = { children: [], appendChild(el) { this.children.push(el); } };
    MkvSubs.extract('http://p/movie/u/p/1.mkv', video);
    return waitForAsync(() => video.children.length === 1 && video.children[0].track.cues.length === 1 && video.children[0].track.cues[0].text === 'Hi there');
  })());

  ok('a non-.mkv URL does nothing: no fetch call, no <track> added', await (async () => {
    const video = { children: [], appendChild(el) { this.children.push(el); } };
    fetchCallCount = 0;
    MkvSubs.extract('http://p/movie/u/p/1.mp4', video);
    await flush();
    return fetchCallCount === 0 && video.children.length === 0;
  })());

  ok('a file whose Cues does not index the subtitle track adds nothing, no scan attempted', await (async () => {
    const video = { children: [], appendChild(el) { this.children.push(el); } };
    fetchCallCount = 0;
    MkvSubs.extract('http://p/movie/u/p/novideosubs.mkv', video);
    const settled = await waitForAsync(() => video.children.length === 0);
    return settled && fetchCallCount === 3;
  })());

  ok("cancel() before the async fetches resolve prevents any <track> from being added", await (async () => {
    const video = { children: [], appendChild(el) { this.children.push(el); } };
    const h = MkvSubs.extract('http://p/movie/u/p/cancelearly.mkv', video);
    h.cancel();
    return waitForAsync(() => video.children.length === 0);
  })());

  ok('a fetch that rejects (simulated dropped connection) does not throw out of extract()', (() => {
    const video = { children: [], appendChild(el) { this.children.push(el); } };
    try { MkvSubs.extract('http://p/movie/u/p/dropsconnection.mkv', video); return true; } catch (e) { return false; }
  })());

  ok('a valid MKV with a Tracks element but zero subtitle tracks adds nothing, no error', await (async () => {
    const video = { children: [], appendChild(el) { this.children.push(el); } };
    MkvSubs.extract('http://p/movie/u/p/novsubtracks.mkv', video);
    return waitForAsync(() => video.children.length === 0);
  })());

  ok('startupDelayMs defers the first fetch, so the video connection gets priority right after a (re)connect', await (async () => {
    const video = { children: [], appendChild(el) { this.children.push(el); } };
    MkvSubs.startupDelayMs = 50;
    fetchCallCount = 0;
    MkvSubs.extract('http://p/movie/u/p/delay.mkv', video);
    const nothingYet = fetchCallCount === 0;
    await new Promise(r => setTimeout(r, 120));
    await flush();
    MkvSubs.startupDelayMs = 0;
    return nothingYet && fetchCallCount > 0 && video.children.length === 1;
  })());

  ok('uses a human-readable language name for the label, not the raw metadata code', await (async () => {
    const video = { children: [], appendChild(el) { this.children.push(el); } };
    MkvSubs.extract('http://p/movie/u/p/dutlabel.mkv', video);
    return waitForAsync(() => video.children.length === 1 && video.children[0].label === 'Dutch' && video.children[0].srclang === 'nl');
  })());

  ok('cancel() after a <track> was already attached removes it from the video (a reconnect must not leave stale tracks behind)', await (async () => {
    const video = { children: [], appendChild(el) { this.children.push(el); }, removeChild(el) { const i = this.children.indexOf(el); if (i >= 0) this.children.splice(i, 1); } };
    const h = MkvSubs.extract('http://p/movie/u/p/1.mkv', video);
    const attachedOk = await waitForAsync(() => video.children.length === 1);
    h.cancel();
    await flush();
    return attachedOk && video.children.length === 0;
  })());

  ok('caches cues across extract() calls: a reconnect re-attaches cached cues without re-fetching the clusters', await (async () => {
    // First extraction (populates the cache for this URL).
    const v1 = { children: [], appendChild(el) { this.children.push(el); }, removeChild(el) { const i = this.children.indexOf(el); if (i >= 0) this.children.splice(i, 1); } };
    MkvSubs.extract('http://p/movie/u/p/cacheme.mkv', v1);
    await waitForAsync(() => v1.children.length === 1 && v1.children[0].track.cues.length === 1);
    // Simulate a reconnect: fresh extract() for the SAME url, fresh video element.
    const v2 = { children: [], appendChild(el) { this.children.push(el); }, removeChild(el) { const i = this.children.indexOf(el); if (i >= 0) this.children.splice(i, 1); } };
    fetchCallCount = 0;
    MkvSubs.extract('http://p/movie/u/p/cacheme.mkv', v2);
    await flush();
    // Cue present on the reconnect, and no per-cluster peek/full fetches happened (served from cache).
    return v2.children.length === 1 && v2.children[0].track.cues.length === 1 && v2.children[0].track.cues[0].text === 'Hi there' && fetchCallCount === 0;
  })());

  ok('cached cues attach synchronously on reconnect (no await), so subtitles do not vanish on every provider cut', (() => {
    // cacheme.mkv is already fully cached by the previous test.
    const v = { children: [], appendChild(el) { this.children.push(el); }, removeChild(el) { const i = this.children.indexOf(el); if (i >= 0) this.children.splice(i, 1); } };
    MkvSubs.extract('http://p/movie/u/p/cacheme.mkv', v);
    // No flush/await: must already be attached from cache.
    return v.children.length === 1 && v.children[0].track.cues.length === 1;
  })());

  ok('sparse extraction skips a 2 MB video payload and preserves subtitle timing', await (async () => {
    const media = el('A3', blockHeader(1, 0, 0).concat(new Array(2 * 1024 * 1024).fill(42)));
    const bytes = u8(el('1F43B675', el('E7', uintBytes(1000)).concat(media, blockGroupEl(7, 250, 3000, 'Sparse subtitle'))));
    let total = 0;
    const cues = await MkvSubs.readSparseCluster((start, end) => {
      const data = bytes.slice(start, end + 1); total += data.length; return Promise.resolve(data);
    }, 0, [7], 1000000);
    console.log('Sparse cluster transferred ' + total + ' bytes of ' + bytes.length);
    return total < 10000 && cues.length === 1 && cues[0].text === 'Sparse subtitle' && cues[0].startSec === 1.25 && cues[0].endSec === 4.25;
  })());

  ok('relative cue positions skip intervening media headers', await (async () => {
    const stamp = el('E7', uintBytes(1000));
    const media = el('A3', blockHeader(1, 0, 0).concat(new Array(10000).fill(42)));
    const pos = stamp.length + media.length;
    const bytes = u8(el('1F43B675', stamp.concat(media, blockGroupEl(7, -250, 3000, 'Indexed'))));
    let calls = 0;
    const cues = await MkvSubs.readSparseCluster((start, end) => {
      calls++; return Promise.resolve(bytes.slice(start, end + 1));
    }, 0, [7], 1000000, [pos]);
    const index = u8(el('BB', el('B3', [0]).concat(el('B7', el('F7', [7]).concat(el('F1', [0]), el('F0', uintBytes(pos)))))));
    const parsed = MkvSubs.readCuesForTrack(index, 0, index.length, 7, 1000000);
    return calls === 3 && cues.length === 1 && cues[0].text === 'Indexed' && cues[0].startSec === 0.75 && parsed[0].relativePos === pos;
  })());

  ok('buffering aborts an active read and resumes after the buffer refills', await (async () => {
    mkvFixtures['resume.mkv'] = mkvFixtures['1.mkv'];
    const events = {}, before = abortedRequests;
    const video = {currentTime: 0, readyState: 4, buffered: {length: 1, start() {return 0;}, end() {return 20;}},
      children: [], appendChild(el) {this.children.push(el);}, removeChild() {},
      addEventListener(n, f) {events[n] = f;}, removeEventListener(n) {delete events[n];}};
    responseMode = 'pending';
    const h = MkvSubs.extract('http://p/resume.mkv', video);
    await flush();
    video.readyState = 2; events.waiting();
    responseMode = '';
    await flush();
    const held = video.children.length === 0 && abortedRequests === before + 1;
    video.readyState = 4;
    await new Promise(r => setTimeout(r, 1050));
    const resumed = video.children.length === 1 && video.children[0].track.cues.length === 1;
    h.cancel();
    return held && resumed;
  })());

  for (const mode of ['ignoreRange', 'wrongRange']) {
    ok(mode + ': rejects headers before reading the movie body', await (async () => {
      responseMode = mode; bodyReads = 0;
      const before = abortedRequests;
      const h = MkvSubs.extract('http://p/' + mode + '.mkv', {appendChild() {}});
      await flush(); h.cancel(); responseMode = '';
      return bodyReads === 0 && abortedRequests > before;
    })());
  }

  ok('cancel aborts an in-flight HTTP request', await (async () => {
    responseMode = 'pending';
    const before = abortedRequests;
    const h = MkvSubs.extract('http://p/pending.mkv', {});
    await flush(); h.cancel(); responseMode = '';
    await flush();
    return abortedRequests === before + 1;
  })());

  ok('low playback buffer allows discovery but prevents cluster requests', await (async () => {
    mkvFixtures['lowbuffer.mkv'] = mkvFixtures['1.mkv'];
    fetchCallCount = 0;
    const video = {children: [], appendChild(el) {this.children.push(el);}, removeChild() {}, currentTime: 0, readyState: 2, buffered: {length: 1, start() {return 0;}, end() {return 2;}}};
    const h = MkvSubs.extract('http://p/lowbuffer.mkv', video);
    await flush(); h.cancel();
    return fetchCallCount === 3 && video.children.length === 1;
  })());

  ok('only fetches near the playhead, then follows timeupdate', await (async () => {
    mkvFixtures['window.mkv'] = mkvFixtures['1.mkv'];
    const events = {};
    const video = {currentTime: 300, children: [], appendChild(el) {this.children.push(el);}, removeChild() {},
      addEventListener(n, fn) {events[n] = fn;}, removeEventListener(n) {delete events[n];}};
    const h = MkvSubs.extract('http://p/window.mkv', video);
    await flush();
    const empty = video.children.length === 1 && video.children[0].track.cues.length === 0;
    video.currentTime = 0; events.timeupdate();
    await flush();
    const loaded = video.children[0].track.cues.length === 1;
    h.cancel();
    return empty && loaded && !events.timeupdate;
  })());

  ok('reuses redirected URL instead of reopening the provider entry URL per range', await (async () => {
    mkvFixtures['redirect.mkv'] = mkvFixtures['1.mkv'];
    mkvFixtures['edge.mkv'] = mkvFixtures['1.mkv'];
    redirectTarget = 'http://edge/edge.mkv'; requestUrls = [];
    const v = {children: [], appendChild(el) {this.children.push(el);}, removeChild() {}};
    const h = MkvSubs.extract('http://provider/redirect.mkv', v);
    await flush(); h.cancel(); redirectTarget = '';
    return v.children[0].track.cues.length === 1 && requestUrls[0] === 'http://provider/redirect.mkv' && requestUrls.slice(1).every(u => u === 'http://edge/edge.mkv');
  })());

  ok('DOM captions follow time and selected track even when native activeCues is empty', await (async () => {
    mkvFixtures['overlay.mkv'] = mkvFixtures['1.mkv'];
    const events = {}, classes = {};
    const parent = {children: [], appendChild(el) {this.children.push(el);el.parentNode=this;}, removeChild(el) {this.children.splice(this.children.indexOf(el),1);}};
    const v = {currentTime: 1.5, style: {}, parentNode: parent, children: [],
      classList: {toggle(k,val) {classes[k]=val;}, remove(k) {delete classes[k];}},
      appendChild(el) {this.children.push(el);}, removeChild(el) {this.children.splice(this.children.indexOf(el),1);},
      addEventListener(n,f) {events[n]=f;}, removeEventListener(n) {delete events[n];}};
    const h = MkvSubs.extract('http://p/overlay.mkv', v);
    await flush();
    const t = v.children[0].track; t.mode = 'showing'; t.activeCues = [];
    events.timeupdate();
    const visible = parent.children[0].textContent === 'Hi there' && classes['mkv-captions-active'];
    t.mode = 'disabled'; events.timeupdate();
    const off = parent.children[0].textContent === '' && !classes['mkv-captions-active'];
    t.mode = 'showing'; v.currentTime = 5; events.timeupdate();
    const expired = parent.children[0].textContent === '';
    h.cancel();
    const h2 = MkvSubs.extract('http://p/overlay.mkv', v);
    const preserved = v.children[0].track.mode === 'showing'; h2.cancel();
    return visible && off && expired && preserved && parent.children.length === 0;
  })());

  ok('playback and subtitles share the first resolved session URL', await (async () => {
    mkvFixtures['shared.mkv'] = mkvFixtures['1.mkv'];
    redirectTarget = 'http://edge/edge.mkv'; requestUrls = [];
    let playbackUrl = '', starts = 0;
    const v = {children: [], appendChild(el) {this.children.push(el);}, removeChild() {}};
    const h = MkvSubs.extract('http://provider/shared.mkv', v, u => {playbackUrl=u;starts++;});
    await flush(); h.cancel(); redirectTarget = '';
    return starts === 1 && playbackUrl === 'http://edge/edge.mkv' && requestUrls.filter(u=>u==='http://provider/shared.mkv').length===1 && v.children[0].track.cues.length===1;
  })());

  ok('metadata failure still starts native playback once', await (async () => {
    let starts = 0, playbackUrl = '';
    const h = MkvSubs.extract('http://p/dropsconnection.mkv', {}, u => {starts++;playbackUrl=u;});
    await flush(); h.cancel();
    return starts === 1 && playbackUrl === 'http://p/dropsconnection.mkv';
  })());

  ok('a healthy native stream with five seconds buffered still loads subtitles', await (async () => {
    mkvFixtures['smallbuffer.mkv'] = mkvFixtures['1.mkv'];
    const v = {currentTime: 0, readyState: 4, buffered: {length:1,start(){return 0;},end(){return 5;}},
      children:[], appendChild(el){this.children.push(el);}, removeChild(){}};
    const h = MkvSubs.extract('http://p/smallbuffer.mkv',v);
    await flush();
    const loaded = v.children.length===1 && v.children[0].track.cues.length===1;
    h.cancel(); return loaded;
  })());

  ok('a transient cluster failure retries in the same session without a seek or reconnect', await (async () => {
    mkvFixtures['retry.mkv'] = mkvFixtures['1.mkv'];
    mkvFixtures['retry-edge.mkv'] = mkvFixtures['1.mkv'];
    redirectTarget = 'http://edge/retry-edge.mkv'; requestUrls = []; bodyReads = 0;
    let faults = 0;
    faultResponse = () => {if (bodyReads === 3 && !faults++) return 503;};
    const v = {children:[],appendChild(el){this.children.push(el);},removeChild(){}};
    const h = MkvSubs.extract('http://provider/retry.mkv',v);
    await flush();
    const recovering = v._mkvSubsState==='recovering' && v.children[0].track.cues.length===0;
    await new Promise(r=>setTimeout(r,1100));
    const loaded = v._mkvSubsState==='ready' && v.children[0].track.cues.length===1;
    h.cancel(); faultResponse=null; redirectTarget='';
    return recovering && loaded && requestUrls.filter(u=>u==='http://provider/retry.mkv').length===1;
  })());

  ok('cancelling during retry backoff prevents further requests', await (async () => {
    mkvFixtures['cancelretry.mkv'] = mkvFixtures['1.mkv']; bodyReads=0;
    faultResponse=()=>bodyReads>=3?503:0;
    const v={children:[],appendChild(el){this.children.push(el);},removeChild(){}};
    const h=MkvSubs.extract('http://p/cancelretry.mkv',v);
    await flush();
    const recovering=v._mkvSubsState==='recovering';
    h.cancel(); const count=fetchCallCount;
    await new Promise(r=>setTimeout(r,1100)); faultResponse=null;
    return recovering && fetchCallCount===count;
  })());

  if (fail) { console.log(fail + ' mkvsubs test(s) failed'); process.exit(1); }
  console.log('all mkvsubs tests passed');
})();
