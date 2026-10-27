// Player: reconnects that resume, offline waits, the never-silent retry ladder, HDR routing,
// pausing live TV and the app going to the background.  Runs player.js against a fake <video>,
// fake demuxers and a fake clock.
const fs = require('fs'), path = require('path'), vm = require('vm');
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + x : '')); if (!c) fail++; };

function setup(opts) {
  opts = opts || {};
  let now = 1e9, timers = [], seq = 0;
  const later = (fn, ms, every) => { const id = ++seq; timers.push({ id, at: now + (ms || 0), fn, every }); return id; };
  const clear = id => { timers = timers.filter(t => t.id !== id); };
  const winL = {};
  const video = {
    _src: '', currentTime: 0, paused: true, readyState: 0, duration: NaN, ended: false, seeking: false, videoHeight: 0, videoWidth: 0,
    style: {}, muted: false, playbackRate: 1, error: null, _ranges: [], l: {},
    get buffered() { const r = this._ranges; return { length: r.length, start: i => r[i][0], end: i => r[i][1] }; },
    play() { this.paused = false; return Promise.resolve(); }, pause() { this.paused = true; },
    load() { if (!this._src) { this.readyState = 0; this.currentTime = 0; this._ranges = []; this.duration = NaN; } },
    removeAttribute(k) { if (k === 'src') this._src = ''; }, getAttribute(k) { return k === 'src' ? this._src : null; },
    set src(v) { this._src = v; }, get src() { return this._src; },
    addEventListener(t, f) { (this.l[t] = this.l[t] || []).push(f); }
  };
  const made = [];
  const handlers = () => ({});
  const mpegts = {
    Events: { MEDIA_INFO: 'mi', ERROR: 'err', LOADING_COMPLETE: 'lc' }, ErrorTypes: { NETWORK_ERROR: 'NetworkError', MEDIA_ERROR: 'MediaError' },
    getFeatureList: () => ({ mseLivePlayback: true }),
    createPlayer(src) { const p = { kind: 'ts', src, h: handlers(), dead: false, on(e, f) { this.h[e] = f; }, attachMediaElement() {}, load() {}, pause() {}, unload() {}, detachMediaElement() {}, destroy() { this.dead = true; }, statisticsInfo: {} }; made.push(p); return p; }
  };
  function Hls(cfg) { this.cfg = cfg; this.kind = 'hls'; this.h = {}; this.levels = []; made.push(this); }
  Hls.isSupported = () => true;
  Hls.Events = { ERROR: 'hlsError', MANIFEST_PARSED: 'hlsManifestParsed' };
  Hls.ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' };
  Hls.prototype = { on(e, f) { this.h[e] = f; }, loadSource(u) { this.src = u; }, attachMedia() {}, recoverMediaError() {}, swapAudioCodec() {}, destroy() { this.dead = true; } };
  const settings = Object.assign({ buffer: 'balanced', engine: 'auto', format: 'ts', hdrRoute: 'auto', display: 'contain' }, opts.settings);
  const logs = [];
  const nav = { onLine: true, userAgent: 'Mozilla/5.0 (Web0S; Linux/SmartTV) Chrome/108.0.5359.211' };
  const ctx = {
    console, Math, JSON, Object, Array, String, RegExp, isFinite, Infinity, Promise,
    Date: { now: () => now },
    setTimeout: (f, ms) => later(f, ms), clearTimeout: clear, setInterval: (f, ms) => later(f, ms, ms), clearInterval: clear,
    navigator: nav,
    MediaSource: { isTypeSupported: () => true },
    mpegts, Hls,
    document: { createElement: () => ({ canPlayType: t => /dtsc/.test(t) ? '' : 'maybe' }) },
    Store: { settings, edits: { display: {} } },
    Source: { streamUrl: ch => ch.url },
    Net: { wrap: u => u, active: false, ua: '' },
    U: { clamp: (v, a, b) => Math.max(a, Math.min(b, v)) },
    Log: { info: (g, m) => logs.push(m), warn: (g, m) => logs.push(m), error: (g, m) => logs.push(m), debug() {} },
    addEventListener: (t, f) => { winL[t] = f; }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const load = (f, name) => vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/js', f), 'utf8') + '\nthis.' + name + ' = ' + name + ';', ctx);
  load('caps.js', 'Caps'); load('player.js', 'Player');
  const P = ctx.Player;
  P.bind(video);
  const states = [], notices = [];
  P.on('state', (s, m) => states.push(s + (m ? ': ' + m : '')));
  P.on('notice', m => notices.push(m));
  // Advance the clock in 100ms steps.  A playing video moves through what is buffered.
  function run(ms) {
    const end = now + ms;
    while (now < end) {
      now += 100;
      if (!video.paused && video.readyState >= 2) {
        const r = video._ranges, e = r.length ? r[r.length - 1][1] : 0;
        video.currentTime = Math.min(video.currentTime + 0.1 * video.playbackRate, e);
      }
      let due;
      while ((due = timers.filter(t => t.at <= now).sort((a, b) => a.at - b.at)[0])) {
        if (due.every) due.at += due.every; else clear(due.id);
        due.fn();
      }
    }
  }
  // The current engine delivers media: buffer [from, to] and enough data to play.
  function feed(from, to) { video.readyState = 4; video._ranges = [[from, to]]; if (video.currentTime < from) video.currentTime = from; video.videoHeight = 1080; video.videoWidth = 1920; }
  const last = () => made[made.length - 1];
  return { P, video, run, feed, last, made, states, notices, logs, nav, winL, settings, get now() { return now; } };
}

// ---- a live channel that drops reconnects, and keeps going ----
let t = setup();
t.P.play({ n: 'News', url: 'http://p/live/u/p/1.ts' });
ok('live TS uses the built-in demuxer', t.last().kind === 'ts');
t.feed(0, 30); t.run(3000);
ok('starts playing after the prebuffer', t.P.playing && !t.video.paused);
t.last().h.err('NetworkError', 'EarlyEof', {});
ok('a dropped connection shows a reconnect message', /buffering: Connection dropped/.test(t.states[t.states.length - 1]), t.states[t.states.length - 1]);
const before = t.made.length;
t.run(1000);
ok('and reconnects by itself', t.made.length === before + 1 && t.last().kind === 'ts');

// ---- an HTTP error before data is the provider, not CORS: retry, don't switch the host ----
t = setup();
t.P.play({ n: 'A', url: 'http://p/live/u/p/2.ts' });
t.last().h.err('NetworkError', 'HttpStatusCodeInvalid', { code: 509 });
t.run(1000);
ok('HTTP 509 before data retries the same pipeline', t.last().kind === 'ts', t.last().kind);
t.last().h.err('NetworkError', 'Exception', { msg: 'Failed to fetch' });
t.run(100);
ok('a refused fetch moves to the TV player', t.video._src === 'http://p/live/u/p/2.ts', t.video._src);

// ---- no network: wait without spending retries, reconnect when it is back ----
t = setup();
t.P.play({ n: 'B', url: 'http://p/live/u/p/3.ts' });
t.feed(0, 30); t.run(3000);
t.nav.onLine = false;
t.last().h.err('NetworkError', 'Exception', {});
t.run(20000);
ok('offline: waits with a message', /No network/.test(t.states[t.states.length - 1]), t.states[t.states.length - 1]);
ok('offline: no reconnect attempts spent', !t.logs.some(l => /Reconnect \d+\//.test(l)));
const n0 = t.made.length;
t.nav.onLine = true; t.winL.online();
ok('back online: reconnects at once', t.made.length === n0 + 1);

// ---- the retry ladder: other pipelines, then slow retries for a channel that played ----
t = setup({ settings: { buffer: 'custom', custom: { prebuffer: 1, ahead: 10, back: 4, stall: 4, retries: 2 } } });
t.P.play({ n: 'C', url: 'http://p/live/u/p/4.ts' });
t.feed(0, 30); t.run(3000);
for (let i = 0; i < 12; i++) {
  const e = t.last();
  if (!e.dead && e.kind === 'ts') e.h.err('NetworkError', 'EarlyEof', {});
  else if (!e.dead && e.kind === 'hls') e.h.hlsError('e', { fatal: true, type: 'networkError', details: 'levelLoadError', response: { code: 404 } });
  else { t.video.error = { code: 2 }; t.video._ranges = []; t.video.l.error.forEach(f => f()); }
  t.run(9000);
}
ok('tries the TV player and the HLS version before giving up', t.logs.some(l => /Still failing; trying the TV player/.test(l)) && t.logs.some(l => /Still failing; trying the HLS version/.test(l)));
ok('then keeps retrying slowly with a message, not an error', /still trying/i.test(t.states[t.states.length - 1]) || t.logs.some(l => /retrying every 15s/.test(l)), t.states[t.states.length - 1]);
ok('no error state yet', !t.states.some(s => /^error/.test(s)));

// ---- a channel that never played gives up with a clear error ----
t = setup({ settings: { buffer: 'custom', custom: { prebuffer: 1, ahead: 10, back: 4, stall: 4, retries: 1 } } });
t.P.play({ n: 'D', url: 'http://p/live/u/p/5.ts' });
for (let i = 0; i < 10; i++) {
  const e = t.last();
  if (e.kind === 'ts') e.h.err('NetworkError', 'HttpStatusCodeInvalid', { code: 404 });
  else if (e.kind === 'hls') e.h.hlsError('e', { fatal: true, type: 'networkError', details: 'manifestLoadError', response: { code: 404 } });
  t.run(30000);
}
ok('never-played channel ends on an error after every pipeline', /^error/.test(t.states[t.states.length - 1]), t.states[t.states.length - 1]);

// ---- a movie that drops resumes where it was ----
t = setup();
t.P.play({ n: 'Film', url: 'http://p/movie/u/p/9.mkv' }, { live: false, startAt: 0 });
ok('movie files use the TV player', t.video._src === 'http://p/movie/u/p/9.mkv');
t.video.duration = 7200; t.feed(0, 4000); t.run(3000);
t.video.currentTime = 1800; t.run(1000);
t.video.error = { code: 2 }; t.video.l.error.forEach(f => f());
ok('position holds while reconnecting', Math.abs(t.P.position - 1800.4) < 2, t.P.position);
t.run(1500);
t.video.duration = 7200; t.feed(0, 4000); t.run(1000);
ok('reconnect resumes at the same spot', Math.abs(t.video.currentTime - 1800) < 3, t.video.currentTime);
// the TV player saying "ended" mid-film is a drop, not the end
t.video.ended = true; t.run(500);
ok('an early "ended" reconnects instead of finishing', !t.states.some(s => s === 'ended') && t.logs.some(l => /treating it as a dropped connection/.test(l)));

// ---- seeking during a reconnect lands there once it is back ----
t = setup();
t.P.play({ n: 'Film', url: 'http://p/movie/u/p/9.mp4' }, { live: false });
t.P.seekTo(600);
ok('seek before the first frame is remembered', t.P.position === 600);
t.video.duration = 7200; t.feed(0, 4000); t.run(2000);
ok('and applied when playback starts', Math.abs(t.video.currentTime - 600) < 3, t.video.currentTime);

// ---- Dolby Vision found in the HLS master playlist goes to the TV player ----
t = setup();
t.P.play({ n: 'UHD', url: 'http://p/live/uhd.m3u8' });
ok('HLS starts on hls.js', t.last().kind === 'hls');
t.last().h.hlsManifestParsed('e', { levels: [{ height: 2160, attrs: { CODECS: 'hvc1.2.4.L153.B0,ec-3', 'VIDEO-RANGE': 'PQ', 'SUPPLEMENTAL-CODECS': 'dvh1.08.06/db1p' } }] });
t.run(100);
ok('Dolby Vision switches to the TV player before the first frame', t.video._src === 'http://p/live/uhd.m3u8', t.video._src);
ok('the stream is described', t.P.media === '4K  HEVC  Dolby Vision 8  E-AC-3', t.P.media);
t = setup();
t.P.play({ n: 'UHD', url: 'http://p/live/hdr.m3u8' });
t.last().h.hlsManifestParsed('e', { levels: [{ height: 2160, attrs: { CODECS: 'hvc1.2.4.L153.B0,mp4a.40.2', 'VIDEO-RANGE': 'PQ' } }] });
t.run(100);
ok('HDR10 stays on hls.js by default', t.last().kind === 'hls' && !t.last().dead);
t = setup({ settings: { hdrRoute: 'tv' } });
t.P.play({ n: 'UHD', url: 'http://p/live/u/p/7.ts' });
t.last().h.mi({ videoCodec: 'hvc1.2.4.L153.90', audioCodec: 'mp4a.40.2', height: 2160 });
t.run(100);
ok('"TV player for all HDR" moves 10-bit HEVC TS over', t.video._src === 'http://p/live/u/p/7.ts', t.video._src);
t = setup();
t.P.play({ n: 'Film', url: 'http://p/movie/u/p/8.mkv' }, { live: false, meta: { media: { video: 'hevc', range: 'HDR10', audio: ['dts'], channels: 6 } } });
ok('a DTS-only film on a C2 warns about sound', t.notices.some(n => /DTS/.test(n)), t.notices.join(' | '));

// ---- pausing live TV ----
t = setup();
t.P.play({ n: 'E', url: 'http://p/live/u/p/6.ts' });
t.feed(0, 30); t.run(3000);
t.P.setPaused(true);
t.run(10000);
ok('short live pause keeps the stream', !t.last().dead && t.video.paused);
t.P.setPaused(false);
ok('and resumes in place', !t.video.paused);
t.P.setPaused(true);
t.run(70000);
ok('a long live pause lets the connection go', t.last().dead);
const n1 = t.made.length;
t.P.setPaused(false);
ok('play returns to live', t.made.length === n1 + 1 && t.notices.indexOf('Back to live') >= 0);

// ---- the app going to the background ----
t = setup();
t.P.play({ n: 'Film', url: 'http://p/movie/u/p/10.mp4' }, { live: false });
t.video.duration = 5400; t.feed(0, 4000); t.run(2000);
t.video.currentTime = 2500; t.run(500);
t.P.suspend();
ok('hidden: stream closed, position kept', t.video._src === '' && Math.abs(t.P.position - 2500) < 2, t.P.position);
t.P.resume(); t.video.duration = 5400; t.feed(0, 4000); t.run(1500);
ok('back: resumes at the same spot', Math.abs(t.video.currentTime - 2500) < 3, t.video.currentTime);

// ---- catch-up reconnects continue from where playback reached ----
t = setup();
let off = 0, first = true;
t.P.play({ n: 'F', url: '' }, { live: false, timeshift: true, urlFn: () => { if (!first) off += t.P.position; first = false; return 'http://p/timeshift/' + Math.round(off) + '.ts'; } });
t.feed(0, 60); t.run(20000);
t.last().h.err('NetworkError', 'EarlyEof', {});
t.run(1000);
ok('catch-up reconnect asks for the right offset', /timeshift\/(1[89]|20)\.ts$/.test(t.last().src.url), t.last().src.url);

if (fail) { console.log(fail + ' player test(s) failed'); process.exit(1); }
console.log('all player tests passed');
