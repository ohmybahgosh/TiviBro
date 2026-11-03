// EmbedSubs: the container-neutral core behind embedded subtitles (MKV, MP4).  Runs
// embedsubs.js against a fake format adapter and a fake Range server, so the core's own
// contract is tested apart from any container parser.
const fs = require('fs'), path = require('path'), vm = require('vm');
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fail++; };

const files = {};                 // name -> Uint8Array
let requestUrls = [], requestRanges = [], logs = [], aborted = 0, pending = false, redirect = '', active = 0, maxActive = 0;
class FakeXHR {
  open(method, url) { this.url = url; requestUrls.push(url); }
  setRequestHeader(k, v) { this.headers = this.headers || {}; this.headers[k] = v; }
  getResponseHeader() { return this.contentRange; }
  send() {
    requestRanges.push(this.headers.Range);
    if (pending) return;
    active++; maxActive = Math.max(maxActive, active);
    const name = /\/([^/?]+)(?:\?.*)?$/.exec(this.url)[1], data = files[name];
    const rm = /bytes=(\d+)-(\d+)/.exec(this.headers.Range);
    setTimeout(() => {
      active--;
      if (this.aborted) return;
      if (!data) { this.status = 404; this.readyState = 2; this.onreadystatechange(); return this.onload(); }
      const start = +rm[1], end = Math.min(+rm[2], data.length - 1), slice = data.slice(start, end + 1);
      this.responseURL = redirect || this.url;
      this.status = 206; this.contentRange = 'bytes ' + start + '-' + end + '/' + data.length;
      this.readyState = 2; this.onreadystatechange();
      if (this.aborted) return;
      this.response = slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.length); this.onload();
    }, 1);
  }
  abort() { this.aborted = true; aborted++; if (this.onabort) this.onabort(); }
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (cond, ms) => { for (let t = 0; t < (ms || 2000) && !cond(); t += 2) await wait(2); return cond(); };
function makeTrackElement() { const cues = []; return { kind: '', label: '', srclang: '', track: { mode: 'disabled', cues, addCue(c) { cues.push(c); } } }; }
function makeVideo(extra) {
  const listeners = {};
  return Object.assign({
    children: [], listeners,
    appendChild(el) { this.children.push(el); },
    removeChild(el) { this.children.splice(this.children.indexOf(el), 1); },
    addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); },
    removeEventListener(t, f) { listeners[t] = (listeners[t] || []).filter(g => g !== f); }
  }, extra || {});
}
const ctx = {
  console, Promise, setTimeout, clearTimeout, Date, XMLHttpRequest: FakeXHR,
  Net: { wrap: u => u },
  Log: { debug: (t, m) => logs.push(m), warn: (t, m) => logs.push(m), info() {} },
  document: { createElement: tag => (tag === 'track' ? makeTrackElement() : { textContent: '', className: '' }) },
  VTTCue: function (start, end, text) { this.startTime = start; this.endTime = end; this.text = text; }
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/js/util.js'), 'utf8') + '\nthis.U = U;', ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/js/embedsubs.js'), 'utf8') + '\nthis.EmbedSubs = EmbedSubs;', ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/js/mkvsubs.js'), 'utf8') + '\nthis.MkvSubs = MkvSubs;', ctx);
const EmbedSubs = ctx.EmbedSubs, MkvSubs = ctx.MkvSubs;
const { buildMkv } = require('../lib/mkv-fixture');

// A fake format: one English track; candidates are named work items with cue times.
function fakeAdapter(opts) {
  opts = opts || {};
  const reads = [];
  const a = {
    id: 'fake', headBytes: 16, startupDeadlineMs: 0, reads,
    discover(head, range) { return Promise.resolve(opts.discover ? opts.discover(head, range) : { items: opts.items || [{ id: 'a', s: 1 }] }); },
    describe() { return [{ label: 'English', srclang: 'en' }]; },
    candidates(rec, now) { return rec.index.items.filter(it => !rec.fetched[it.id]).sort((x, y) => Math.abs(x.s - now) - Math.abs(y.s - now)); },
    complete(rec) { return rec.index.items.every(it => rec.fetched[it.id]); },
    read(rec, item, range) {
      reads.push(item.id);
      if (opts.failRead && opts.failRead(item, reads)) return Promise.reject(new Error('simulated read failure'));
      return range(0, 3).then(() => [{ track: 0, s: item.s, e: item.s + 1, text: 'line ' + item.id }]);
    }
  };
  return a;
}
files['f1'] = new Uint8Array(64); files['f2'] = new Uint8Array(64); files['f3'] = new Uint8Array(64);
files['f4'] = new Uint8Array(64); files['f5'] = new Uint8Array(64); files['f6'] = new Uint8Array(64);

(async () => {
  // 1. Session resolution: one head read, the video starts on the response URL.
  {
    requestUrls = []; requestRanges = []; redirect = 'http://cdn/session/f1';
    const video = makeVideo(), resolved = [];
    const h = EmbedSubs.run('http://p/movie/f1', video, u => resolved.push(u), fakeAdapter());
    await wait(40);
    redirect = '';
    const t = video.children[0] && video.children[0].track;
    ok('head read happens once and resolves the video with the responseURL',
      resolved.length === 1 && resolved[0] === 'http://cdn/session/f1' && requestUrls[0] === 'http://p/movie/f1' &&
      requestUrls.slice(1).every(u => u === 'http://cdn/session/f1') && requestRanges.filter(r => r === 'bytes=0-15').length === 1 &&
      t && t.cues.length === 1 && t.cues[0].text === 'line a',
      { resolved, requestUrls, requestRanges });
    h.cancel();
  }
  // 2. Work items: nearest first, one request at a time, only while the playback buffer holds.
  {
    maxActive = 0;
    const buffered = { length: 1, start: () => 0, end: () => 1e9 };
    const video = makeVideo({ currentTime: 50, readyState: 2, seeking: false, buffered });
    const ad = fakeAdapter({ items: [{ id: 'far', s: 300 }, { id: 'near', s: 52 }, { id: 'mid', s: 80 }] });
    const h = EmbedSubs.run('http://p/movie/f2', video, () => {}, ad);
    await wait(60);
    const beforeBuffer = ad.reads.length;
    video.readyState = 4;
    await wait(1200);
    ok('candidates are read one at a time, nearest first, only while buffered',
      beforeBuffer === 0 && ad.reads.join() === 'near,mid,far' && maxActive === 1, { beforeBuffer, reads: ad.reads, maxActive });
    h.cancel();
  }
  // 3. Backoff: a failing item waits 1 s, then 2 s, while other items continue.
  {
    const times = {};
    const ad = fakeAdapter({ items: [{ id: 'a', s: 1 }, { id: 'b', s: 2 }],
      failRead: (item, reads) => { (times[item.id] = times[item.id] || []).push(Date.now()); return item.id === 'a' && times.a.length <= 2; } });
    const video = makeVideo({ currentTime: 0 });
    const h = EmbedSubs.run('http://p/movie/f3', video, () => {}, ad);
    await wait(3400);
    const gaps = times.a && times.a.slice(1).map((t, i) => t - times.a[i]);
    ok('a failed read backs off 1 s then 2 s and other candidates continue',
      ad.reads[0] === 'a' && ad.reads[1] === 'b' && times.a.length === 3 && gaps[0] >= 950 && gaps[1] >= 1950 && video.children[0].track.cues.length === 2,
      { reads: ad.reads, gaps });
    h.cancel();
  }
  // 4. No usable subtitles: unavailable, remembered for a reanchor (no new reads).
  {
    requestUrls = [];
    const v1 = makeVideo();
    const h1 = EmbedSubs.run('http://p/movie/f4', v1, () => {}, fakeAdapter({ discover: () => null }));
    await wait(40);
    const state1 = v1._mkvSubsState, reqs = requestUrls.length;
    h1.cancel();
    const v2 = makeVideo();
    EmbedSubs.run('http://p/movie/f4', v2, null, fakeAdapter({ discover: () => null })).cancel;
    await wait(40);
    ok('discover null settles unavailable and is remembered for reanchor',
      state1 === 'unavailable' && v2._mkvSubsState === 'unavailable' && requestUrls.length === reqs, { state1, s2: v2._mkvSubsState, reqs, now: requestUrls.length });
  }
  // 5. cancel() undoes everything and aborts the request in flight.
  {
    const parent = { kids: [], appendChild(el) { el.parentNode = this; this.kids.push(el); }, removeChild(el) { this.kids.splice(this.kids.indexOf(el), 1); } };
    const video = makeVideo({ parentNode: parent, style: {}, classList: { toggle() {}, remove() {} }, textTracks: [] });
    const tl = video.textTracks.listeners = [];
    video.textTracks.addEventListener = (t, f) => tl.push(f); video.textTracks.removeEventListener = (t, f) => tl.splice(tl.indexOf(f), 1);
    let open = false;
    const ad = fakeAdapter({ items: [{ id: 'a', s: 1 }, { id: 'later', s: 9 }] });
    const all = ad.candidates;
    ad.candidates = (rec, now) => all(rec, now).filter(it => open || it.id === 'a');
    const h = EmbedSubs.run('http://p/movie/f5', video, () => {}, ad);
    await wait(40);
    const hadTrack = video.children.length === 1, hadOverlay = parent.kids.length === 1;
    pending = true; open = true; aborted = 0;
    for (const f of video.listeners.timeupdate || []) f();      // starts the read of "later", which never answers
    await wait(10);
    h.cancel();
    pending = false;
    const left = Object.keys(video.listeners).filter(k => video.listeners[k].length);
    ok('cancel removes tracks, overlay and listeners and aborts the request',
      hadTrack && hadOverlay && aborted === 1 && video.children.length === 0 && parent.kids.length === 0 && left.length === 0 && tl.length === 0 && video._mkvSubsState === '',
      { hadTrack, hadOverlay, kids: video.children.length, overlay: parent.kids.length, left, trackListeners: tl.length, aborted });
  }
  // 6. MKV: stopping playback as the video starts (inside onResolved) reads nothing more and logs nothing.
  {
    files['c.mkv'] = buildMkv({ subtitleTrack: { number: 7, lang: 'en' }, cuesIndexesSubtitle: true });
    requestRanges = []; logs = [];
    const video = makeVideo();
    let h = null;
    h = MkvSubs.extract('http://p/movie/c.mkv', video, () => { h.cancel(); });
    await wait(60);
    ok('cancelling from onResolved stops before the Cues read, silently',
      requestRanges.length === 1 && logs.length === 0 && video.children.length === 0, { requestRanges, logs });
  }
  // ---- Task 2: what MP4 needs from the core ----
  {
    const enc = t => new Uint8Array(Buffer.from(t, 'utf8'));
    ok('utf8 fallback decodes "Café 日本 😀" without TextDecoder', typeof ctx.TextDecoder === 'undefined' && EmbedSubs.utf8(enc('Café 日本 😀'), 0, enc('Café 日本 😀').length) === 'Café 日本 😀');
    const cut = enc('ab日'); // 'ab' + 3-byte char, cut after its first byte
    ok('truncated utf8 gives U+FFFD', EmbedSubs.utf8(cut, 0, 3) === 'ab�' && EmbedSubs.utf8(new Uint8Array([0x61, 0xC3, 0x28]), 0, 3) === 'a�(');
    const be = new Uint8Array([0x00, 0x48, 0x00, 0xE9, 0xD8, 0x3D, 0xDE, 0x00]), le = new Uint8Array([0x48, 0x00, 0xE9, 0x00]);
    ok('utf16 BE and LE', EmbedSubs.utf16(be, 0, 8, false) === 'Hé😀' && EmbedSubs.utf16(le, 0, 4, true) === 'Hé');
  }
  {
    let seenTotal;
    const ad = fakeAdapter({ discover: head => { seenTotal = head.total; return { items: [{ id: 'a', s: 1 }] }; } });
    const h = EmbedSubs.run('http://p/movie/f6', makeVideo(), () => {}, ad);
    await wait(40);
    ok('range bytes carry total from Content-Range', seenTotal === 64, seenTotal);
    h.cancel();
  }
  {
    files['slow'] = new Uint8Array(64);
    pending = true; aborted = 0;
    const resolved = [], video = makeVideo();
    const ad = Object.assign(fakeAdapter(), { startupDeadlineMs: 50 });
    const h = EmbedSubs.run('http://p/movie/slow', video, u => resolved.push(u), ad);
    await wait(120);
    pending = false;
    const v2 = makeVideo(); requestRanges = [];
    const h2 = EmbedSubs.run('http://p/movie/slow', v2, null, ad);
    await wait(40);
    ok('startup deadline starts the original URL and settles error, remembered for a seek',
      resolved.length === 1 && resolved[0] === 'http://p/movie/slow' && aborted === 1 && video._mkvSubsState === 'error' &&
      v2._mkvSubsState === 'error' && requestRanges.length === 0, { resolved, aborted, s: video._mkvSubsState, s2: v2._mkvSubsState, requestRanges });
    h.cancel(); h2.cancel();
  }
  {
    let discovers = 0;
    const ad = fakeAdapter({ items: [{ id: 'a', s: 1 }, { id: 'b', s: 500 }] });
    const d0 = ad.discover; ad.discover = function () { discovers++; return d0.apply(this, arguments); };
    ad.complete = () => false;
    const h1 = EmbedSubs.run('http://p/movie/f7', makeVideo({ currentTime: 0 }), () => {}, ad);
    files['f7'] = new Uint8Array(64);
    await wait(40); h1.cancel();
    requestRanges = [];
    const v = makeVideo({ currentTime: 0 }), resolved = [];
    const h2 = EmbedSubs.run('http://p/movie/f7', v, u => resolved.push(u), ad);
    await wait(40);
    const heads = requestRanges.filter(r => r === 'bytes=0-15').length;
    requestRanges = [];
    const v3 = makeVideo({ currentTime: 0 });
    const h3 = EmbedSubs.run('http://p/movie/f7', v3, null, ad);       // a seek: no new session needed
    await wait(40);
    ok('a new engine start re-opens the link with a small read but not the index (issue #34), a seek reads neither',
      discovers === 1 && heads === 1 && resolved.length === 1 && v.children[0].track.cues.length >= 1 &&
      requestRanges.filter(r => r === 'bytes=0-15').length === 0, { discovers, heads, seekReads: requestRanges });
    h2.cancel(); h3.cancel();
  }
  {
    let discovers = 0;
    files['f8'] = new Uint8Array(64);
    const ad = fakeAdapter();
    const d0 = ad.discover; ad.discover = function () { discovers++; return d0.apply(this, arguments); };
    ad.complete = () => false;
    const h1 = EmbedSubs.run('http://p/movie/f8', makeVideo(), () => {}, ad);
    await wait(40); h1.cancel();
    files['f8'] = new Uint8Array(128);                               // the link now serves another file
    const v = makeVideo();
    const h2 = EmbedSubs.run('http://p/movie/f8', v, () => {}, ad);
    await wait(40);
    ok('changed total size drops the cached index', discovers === 2 && v.children.length === 1, { discovers, tracks: v.children.length });
    h2.cancel();
  }
  {
    files['f9'] = new Uint8Array(64); requestRanges = [];
    const v = makeVideo();
    const h = EmbedSubs.run('http://p/movie/f9', v, () => {}, fakeAdapter({ discover: () => ({ none: 'empty' }) }));
    await wait(40); h.cancel();
    const n = requestRanges.length, v2 = makeVideo();
    EmbedSubs.run('http://p/movie/f9', v2, null, fakeAdapter({ discover: () => ({ none: 'empty' }) }));
    await wait(40);
    ok('empty settles to blank state, remembered', v._mkvSubsState === '' && v2._mkvSubsState === '' && requestRanges.length === n && v.children.length === 0,
      { s: v._mkvSubsState, s2: v2._mkvSubsState });
  }
  {
    for (const n of ['l1', 'l2', 'l3', 'l4']) files[n] = new Uint8Array(64);
    for (const n of ['l1', 'l2', 'l3', 'l4']) { const h = EmbedSubs.run('http://p/movie/' + n, makeVideo(), () => {}, fakeAdapter()); await wait(30); h.cancel(); }
    requestRanges = [];
    const kept = makeVideo(); EmbedSubs.run('http://p/movie/l4', kept, null, fakeAdapter()).cancel;
    await wait(30);
    const keptReads = requestRanges.length;
    const gone = makeVideo(); EmbedSubs.run('http://p/movie/l1', gone, null, fakeAdapter());
    await wait(30);
    ok('LRU keeps 3 files', keptReads === 0 && kept.children.length === 1 && requestRanges.length > 0, { keptReads, after: requestRanges.length });
  }
  {
    // An item's lines are kept whole or not at all, and an item whose lines weren't kept is read
    // again after a seek (MKV too): the cap must not lose subtitles for the rest of the play.
    files['big'] = new Uint8Array(64);
    const ad = fakeAdapter({ items: [{ id: 'a', s: 1 }, { id: 'b', s: 3 }] });
    ad.read = (rec, item, range) => { ad.reads.push(item.id); return range(0, 3).then(() => item.id === 'a'
      ? [{ track: 0, s: 1, e: 2, text: 'a'.repeat(1500000) }, { track: 0, s: 2, e: 2.5, text: 'A'.repeat(1000000) }]
      : [{ track: 0, s: 3, e: 4, text: 'b'.repeat(1000000) }]); };
    const v = makeVideo();
    const h = EmbedSubs.run('http://p/movie/big', v, () => {}, ad);
    await wait(60);
    const live = v.children[0] ? v.children[0].track.cues.length : -1;
    h.cancel();
    const v2 = makeVideo();
    const h2 = EmbedSubs.run('http://p/movie/big', v2, null, ad);
    const replayed = v2.children[0] ? v2.children[0].track.cues.length : -1;
    await wait(60);
    const after = v2.children[0] ? v2.children[0].track.cues.map(c => c.text[0]).sort().join('') : '';
    ok('cue text cap keeps whole items and re-reads the rest after a seek', live === 3 && replayed === 1 && after === 'Aab' &&
      ad.reads.join() === 'a,b,a', { live, replayed, after, reads: ad.reads });
    h2.cancel();
  }
  {
    // waiting aborts the first read before the deadline; once the deadline has passed, the buffer
    // coming back must not open a request next to the video's.
    files['slow2'] = new Uint8Array(64);
    pending = true; requestRanges = [];
    const buffered = { length: 1, start: () => 0, end: () => 1e9 };
    const video = makeVideo({ currentTime: 0, readyState: 4, seeking: false, buffered });
    const ad = Object.assign(fakeAdapter(), { startupDeadlineMs: 50 });
    const h = EmbedSubs.run('http://p/movie/slow2', video, () => {}, ad);
    await wait(20);
    video.readyState = 2;
    (video.listeners.waiting || []).forEach(f => f());
    await wait(60);
    pending = false; video.readyState = 4;
    await wait(1200);
    ok('no read after the startup deadline, even when a waiting retry was queued', requestRanges.length === 1 && video._mkvSubsState === 'error',
      { requestRanges, s: video._mkvSubsState });
    h.cancel();
  }
  {
    // A timed-out reconnect of a file whose index is cached: a seek in that play stays given up
    // (cached lines only, no reads); the next engine start tries again.
    files['slow3'] = new Uint8Array(64);
    let failB = true;              // b fails (and backs off) in the first play, so a seek would have something to read
    const ad = Object.assign(fakeAdapter({ items: [{ id: 'a', s: 1 }, { id: 'b', s: 500 }], failRead: it => failB && it.id === 'b' }),
      { startupDeadlineMs: 50 });
    ad.complete = () => false;
    const h1 = EmbedSubs.run('http://p/movie/slow3', makeVideo({ currentTime: 0 }), () => {}, ad);
    await wait(40); h1.cancel(); failB = false;
    pending = true;
    const v2 = makeVideo({ currentTime: 0 });
    const h2 = EmbedSubs.run('http://p/movie/slow3', v2, () => {}, ad);
    await wait(100);
    const s2 = v2._mkvSubsState; h2.cancel();
    pending = false; requestRanges = [];
    const v3 = makeVideo({ currentTime: 0 });
    const h3 = EmbedSubs.run('http://p/movie/slow3', v3, null, ad);
    await wait(40);
    const seekReads = requestRanges.length, s3 = v3._mkvSubsState, cues3 = v3.children[0] ? v3.children[0].track.cues.length : -1;
    h3.cancel();
    const v4 = makeVideo({ currentTime: 0 });
    const h4 = EmbedSubs.run('http://p/movie/slow3', v4, () => {}, ad);
    await wait(40);
    ok('timed-out reconnect with a cached index stays given up for seeks, retried on the next start',
      s2 === 'error' && s3 === 'error' && seekReads === 0 && cues3 === 1 && v4._mkvSubsState === 'ready' && requestRanges.length > 0,
      { s2, s3, seekReads, cues3, s4: v4._mkvSubsState });
    h4.cancel();
  }
  {
    // The link now serves another file with no usable subtitles: blank overlay, unavailable, remembered.
    files['f10'] = new Uint8Array(64);
    let unsupported = false;
    const ad = fakeAdapter({ discover: () => unsupported ? null : { items: [{ id: 'a', s: 0 }] } });
    ad.complete = () => false;
    const h1 = EmbedSubs.run('http://p/movie/f10', makeVideo({ currentTime: 0 }), () => {}, ad);
    await wait(40); h1.cancel();
    files['f10'] = new Uint8Array(128); unsupported = true;
    const v = makeVideo({ currentTime: 0, parentNode: { appendChild(el) { el.parentNode = this; }, removeChild() {} }, style: {} });
    v.textTracks = { length: 0 };
    const h2 = EmbedSubs.run('http://p/movie/f10', v, () => {}, ad);
    await wait(40);
    requestRanges = [];
    const v3 = makeVideo({ currentTime: 0 });
    EmbedSubs.run('http://p/movie/f10', v3, null, ad);
    await wait(40);
    ok('changed size with an unsupported replacement settles unavailable, remembered for seeks',
      v._mkvSubsState === 'unavailable' && v.children.length === 0 && v3._mkvSubsState === 'unavailable' && requestRanges.length === 0,
      { s: v._mkvSubsState, tracks: v.children.length, s3: v3._mkvSubsState, requestRanges });
    h2.cancel();
  }
  {
    // A lazy format (MP4): tracks are marked before they're attached, nothing is read until a track is
    // shown or _embedLoad asks for a window, and that demand ends when the load settles.
    files['lazy'] = new Uint8Array(64);
    const demands = [];
    const ad = Object.assign(fakeAdapter({ items: [{ id: 'a', s: 10 }, { id: 'b', s: 500 }, { id: 'c', s: 900 }] }), { lazy: true });
    ad.describe = () => [{ label: 'English', srclang: 'en', forced: false }, { label: 'English (forced)', srclang: 'en', forced: true }];
    ad.candidates = (rec, now, c) => {
      const d = c.demand(0); demands.push(d && (d === 'now' ? 'now' : d.from + '-' + d.to)); demands.push(c.demand(1));
      if (!d) return [];
      const lo = d === 'now' ? now - 30 : d.from, hi = d === 'now' ? now + 60 : d.to;
      return rec.index.items.filter(it => !rec.fetched[it.id] && it.s >= lo && it.s <= hi);
    };
    let marksAtAppend = null;
    const v = makeVideo({ currentTime: 0 });
    const append = v.appendChild; v.appendChild = function (el) { if (!marksAtAppend) marksAtAppend = [el.track._embedded, el.track._forced, typeof el.track._embedLoad]; return append.call(this, el); };
    const h = EmbedSubs.run('http://p/movie/lazy', v, () => {}, ad);
    await wait(40);
    const idle = ad.reads.length;
    const t0 = v.children[0].track, t1 = v.children[1].track;
    let loaded = false;
    const p = t0._embedLoad(400, 600, 5000).then(() => { loaded = true; });
    await wait(60);
    const during = demands.slice();
    await p;
    demands.length = 0; (v.listeners.timeupdate || []).forEach(f => f()); await wait(20);
    const after = demands.slice(), readsAfter = ad.reads.join();
    let timedOut = null;
    await t0._embedLoad(850, 950, 1).then(() => { timedOut = 'resolved'; }, e => { timedOut = e.message; });
    ok('lazy tracks: marked before attach, nothing read until asked, _embedLoad reads only its window and then lets go',
      JSON.stringify(marksAtAppend) === JSON.stringify([true, false, 'function']) && t1._forced === true && idle === 0 && loaded &&
      readsAfter === 'b' && during.includes('400-600') && after.every(d => d === null) && /^(timeout|resolved)$/.test(timedOut),
      { marksAtAppend, idle, readsAfter, during: during.slice(0, 4), after: after.slice(0, 4), timedOut });
    // A load that can't finish in time rejects and leaves no demand behind.
    ad.read = () => new Promise(() => {});
    let late = null;
    await t0._embedLoad(5, 15, 50).then(() => { late = 'resolved'; }, e => { late = e.message; });
    demands.length = 0; (v.listeners.timeupdate || []).forEach(f => f()); await wait(10);
    ok('_embedLoad times out and releases its demand', late === 'timeout' && demands.every(d => d === null), { late, demands });
    let cancelledLoad = null;
    const pending = t0._embedLoad(0, 2000, 5000).catch(e => { cancelledLoad = e.message; });
    h.cancel(); await pending;
    ok('cancel rejects a pending _embedLoad', cancelledLoad === 'cancelled', cancelledLoad);
  }
  {
    // The overlay's fallback (a native player that empties a track's cues) shows lines where Subs shows them.
    files['fall'] = new Uint8Array(64);
    const overlayEl = { textContent: '', className: '' };
    ctx.document.createElement = tag => (tag === 'track' ? makeTrackElement() : overlayEl);
    const v = makeVideo({ currentTime: 0, parentNode: { appendChild(el) { el.parentNode = this; }, removeChild() {} }, style: {}, classList: { toggle() {}, remove() {} } });
    const ad = fakeAdapter({ items: [{ id: 'a', s: 1 }] });
    const h = EmbedSubs.run('http://p/movie/fall', v, () => {}, ad);
    await wait(40);
    const tr = v.children[0].track; tr.mode = 'showing'; tr.cues.length = 0;      // live cues gone: the cache draws
    ctx.Subs = { delay: 0, timingOf: t => (t === tr ? { scale: 2, off: 1, delay: 0.5 } : null) };
    v.currentTime = 1.5; (v.listeners.seeked || []).forEach(f => f()); const before = overlayEl.textContent;
    v.currentTime = 4; (v.listeners.seeked || []).forEach(f => f()); const at = overlayEl.textContent;
    // Moved before the start, a line is kept the way Subs keeps it (subs.js placed()): from 0, for 0.05 s.
    ctx.Subs.timingOf = () => ({ scale: 1, off: -3, delay: 0 });
    v.currentTime = 0.02; (v.listeners.seeked || []).forEach(f => f()); const clamped = overlayEl.textContent;
    delete ctx.Subs; h.cancel();
    ctx.document.createElement = tag => (tag === 'track' ? makeTrackElement() : { textContent: '', className: '' });
    ok('overlay fallback applies line-up scale', before === '' && at === 'line a', { before, at });   // 1-2 s shows at 3.5-5.5 s
    ok('overlay fallback keeps a line moved before the start, as Subs does', clamped === 'line a', clamped);
  }
  {
    // Chromium turns on a newly added subtitle track by itself once any track was shown on that video
    // (its automatic track selection, after the script's own mode).  The core puts its choice back:
    // the saved modes (Off kept), or the auto-on pick when there is one.
    files['pick'] = new Uint8Array(64);
    const browserLike = () => {
      const v = makeVideo({ currentTime: 0 }), append = v.appendChild;
      let first = true;
      v.appendChild = function (el) { const r = append.call(this, el); if (first) { first = false; setTimeout(() => { el.track.mode = 'showing'; }, 0); } return r; };
      return v;
    };
    const ad = () => Object.assign(fakeAdapter({ items: [{ id: 'a', s: 1 }] }), { describe: () => [{ label: 'English', srclang: 'en' }, { label: 'Dutch', srclang: 'nl' }] });
    const v1 = browserLike();
    const h1 = EmbedSubs.run('http://p/movie/pick', v1, () => {}, ad());
    await wait(120);
    const off = v1.children.map(c => c.track.mode).join();
    h1.cancel();
    const v2 = browserLike(); files['pick2'] = new Uint8Array(64);
    ctx.Subs = { delay: 0, autoOn: t => v2.children.some(c => c.track === t && c.srclang === 'nl') };   // a real TextTrack's language is srclang
    const h2 = EmbedSubs.run('http://p/movie/pick2', v2, () => {}, ad());
    await wait(120);
    const auto = v2.children.map(c => c.track.mode).join();
    h2.cancel();
    const v3 = browserLike(); v3._subsChoice = true; files['pick3'] = new Uint8Array(64);
    const h3 = EmbedSubs.run('http://p/movie/pick3', v3, () => {}, ad());
    await wait(120);
    const chosen = v3.children.map(c => c.track.mode).join();
    h3.cancel(); delete ctx.Subs;
    ok("the browser's own track pick is undone; auto-on picks by Subs.autoOn, not after a choice",
      off === 'disabled,disabled' && auto === 'disabled,showing' && chosen === 'disabled,disabled', { off, auto, chosen });
  }
  {
    // A track that is showing keeps its playback window while Line up reads another window of it.
    files['both'] = new Uint8Array(64);
    const ad = Object.assign(fakeAdapter({ items: [{ id: 'a', s: 10 }, { id: 'c', s: 200 }, { id: 'b', s: 500 }] }), { lazy: true });
    ad.candidates = (rec, now, c) => {
      const d = c.demand(0);
      if (!d) return [];
      const ws = [].concat(d).map(w => w === 'now' ? [now - 30, now + 60] : [w.from, w.to]);
      return rec.index.items.filter(it => !rec.fetched[it.id] && ws.some(w => it.s >= w[0] && it.s <= w[1])).sort((x, y) => Math.abs(x.s - now) - Math.abs(y.s - now));
    };
    const read = ad.read; ad.read = function (rec, item, range) { return item.id === 'b' ? (ad.reads.push('b'), new Promise(() => {})) : read.apply(this, arguments); };
    const v = makeVideo({ currentTime: 0 });
    const h = EmbedSubs.run('http://p/movie/both', v, () => {}, ad);
    await wait(120);
    const t0 = v.children[0].track;
    t0.mode = 'showing';
    t0._embedLoad(400, 600, 5000).catch(() => {});
    await wait(40);
    ok('a pending Line up read keeps the showing track\'s own window, and nothing between the two is read', ad.reads.join() === 'a,b', ad.reads);
    h.cancel();
  }
  {
    // The modes put back after the browser's pick never undo a choice made in the menu meanwhile, and
    // a choice (a language, or Off) comes back on a reconnect whatever the browser picks.
    const browserLike = (extra, pickAt) => {
      const v = makeVideo(Object.assign({ currentTime: 0 }, extra || {})), append = v.appendChild;
      let first = true;
      v.appendChild = function (el) { const r = append.call(this, el); if (first) { first = false; setTimeout(() => { el.track.mode = 'showing'; }, pickAt || 0); } return r; };
      return v;
    };
    // What the Subtitles menu does (views.js): the choice, counted, and the track chosen (null for Off).
    const menu = (v, i) => { v._subsChoice = true; v._subsRev = (v._subsRev || 0) + 1; v._subsWant = i >= 0 ? v.children[i].track : null; v.children.forEach((c, k) => { c.track.mode = k === i ? 'showing' : 'disabled'; }); };
    const modes = v => v.children.map(c => c.track.mode).join();
    const ad = () => Object.assign(fakeAdapter({ items: [{ id: 'a', s: 1 }] }), { describe: () => [{ label: 'English', srclang: 'en' }, { label: 'Dutch', srclang: 'nl' }] });
    files['race'] = new Uint8Array(64);
    const v = browserLike(null, 40);                // the browser picks late, after the viewer's Off
    ctx.Subs = { delay: 0, autoOn: t => v.children.some(c => c.track === t && c.srclang === 'nl') };
    const h = EmbedSubs.run('http://p/movie/race', v, () => {}, ad());
    await until(() => v.children.length === 2);
    await wait(20);
    menu(v, -1);                                     // Off, between the two put-backs
    await wait(120);
    const race = modes(v);
    h.cancel();
    files['race2'] = new Uint8Array(64);
    const w = browserLike(null, 40);
    const hw = EmbedSubs.run('http://p/movie/race2', w, () => {}, ad());
    await until(() => w.children.length === 2);
    await wait(20);
    menu(w, 1);                                      // Dutch, then the browser turns English on
    await wait(120);
    const race2 = modes(w);
    hw.cancel();
    files['life'] = new Uint8Array(64);
    const a = browserLike();
    ctx.Subs.autoOn = t => a.children.some(c => c.track === t && c.srclang === 'en');
    const h1 = EmbedSubs.run('http://p/movie/life', a, () => {}, ad());
    await wait(120);
    const auto = modes(a);
    menu(a, 1);                                      // Dutch
    h1.cancel();
    const b = browserLike({ _subsChoice: a._subsChoice, _subsRev: a._subsRev, _subsWant: a._subsWant });    // the reconnect: same video
    const h2 = EmbedSubs.run('http://p/movie/life', b, () => {}, ad());
    await wait(120);
    const dutch = modes(b);
    menu(b, -1);                                     // Off
    h2.cancel();
    const c = browserLike({ _subsChoice: true, _subsRev: b._subsRev, _subsWant: null });
    const h3 = EmbedSubs.run('http://p/movie/life', c, () => {}, ad());
    await wait(120);
    const off = modes(c);
    h3.cancel(); delete ctx.Subs;
    ok('a menu choice right after the tracks appear is kept over a late browser pick (Off, or Dutch alone)', race === 'disabled,disabled' && race2 === 'disabled,showing', { race, race2 });
    ok('auto-on, then Dutch and Off each survive a reconnect over the browser\'s pick', auto === 'showing,disabled' && dutch === 'disabled,showing' && off === 'disabled,disabled', { auto, dutch, off });
  }
  {
    // mkv-fixture writes one byte per character: hand it the UTF-8 bytes as a binary string.
    files['utf8.mkv'] = buildMkv({ subtitleTrack: { number: 7, lang: 'en' }, cuesIndexesSubtitle: true, cueText: Buffer.from('Café 日本', 'utf8').toString('latin1') });
    const v = makeVideo();
    const h = MkvSubs.extract('http://p/movie/utf8.mkv', v, () => {});
    await wait(80);
    const c = v.children[0] && v.children[0].track.cues[0];
    ok('MKV cue text "Café 日本" decodes without TextDecoder', c && c.text === 'Café 日本', c && c.text);
    h.cancel();
  }
  if (fail) { console.log(fail + ' embedsubs test(s) failed'); process.exit(1); }
  console.log('all embedsubs tests passed');
})().catch(e => { console.error(e); process.exit(1); });
