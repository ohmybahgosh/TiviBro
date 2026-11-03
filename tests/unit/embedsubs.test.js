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
    id: 'fake', headBytes: 16, startupDeadlineMs: 0, reuseSession: true, reads,
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
  if (fail) { console.log(fail + ' embedsubs test(s) failed'); process.exit(1); }
  console.log('all embedsubs tests passed');
})().catch(e => { console.error(e); process.exit(1); });
