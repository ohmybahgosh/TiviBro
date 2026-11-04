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
    Store: { settings, edits: { display: {} }, saveEdits() {}, saveSettings() {} },
    Source: { streamUrl: ch => ch.url },
    Net: { wrap: u => u, active: false, ua: '' },
    U: { clamp: (v, a, b) => Math.max(a, Math.min(b, v)) },
    Log: { info: (g, m) => logs.push(m), warn: (g, m) => logs.push(m), error: (g, m) => logs.push(m), debug() {}, state() {}, closing() {} },
    addEventListener: (t, f) => { winL[t] = f; }
  };
  if (opts.mkvSubs) ctx.MkvSubs = opts.mkvSubs;
  // What playback learns (playmemo.js), in a localStorage that can outlive one setup (an app restart).
  if (opts.memo) {
    const ls = opts.memo;
    ctx.localStorage = { getItem: k => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); }, removeItem: k => { delete ls[k]; } };
    ctx.Store.playlist = { id: 'p1' };
  }
  if (opts.mp4Subs) ctx.Mp4Subs = opts.mp4Subs;
  ctx.window = ctx;
  vm.createContext(ctx);
  const load = (f, name) => vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/js', f), 'utf8') + '\nthis.' + name + ' = ' + name + ';', ctx);
  load('caps.js', 'Caps'); if (opts.memo) load('playmemo.js', 'PlayMemo'); load('player.js', 'Player');
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
        // Like a real element: play through the buffered range the playhead is in, stop at its end.
        const r = video._ranges, ct = video.currentTime, cur = r.find(x => ct >= x[0] - 0.01 && ct <= x[1] + 0.01);
        if (cur) video.currentTime = Math.min(ct + 0.1 * video.playbackRate, cur[1]);
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
  return { P, video, run, feed, last, made, states, notices, logs, nav, winL, settings, ctx, get now() { return now; } };
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

// ---- a channel change starts as soon as enough is buffered, not on the next 400ms watchdog tick ----
t = setup();
t.P.play({ n: 'Quick', url: 'http://p/live/u/p/9.ts' });
t.feed(0, 4); t.run(100);
const pl = t.logs.filter(l => /Playing after/.test(l))[0] || '';
ok('starts within 100ms when the provider sends a head start', !t.video.paused && /Playing after (\d+)ms/.test(pl) && +/after (\d+)ms/.exec(pl)[1] <= 100, pl);

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
ok('tries the TV player and the HLS version before giving up', t.logs.some(l => /Still failing; trying the TV player/.test(l)) && t.logs.some(l => /with hls engine/.test(l)));
ok('an HLS version that is not there sends it back to MPEG-TS at once', t.logs.some(l => /Its HLS version doesn't play here \(.*\); back to MPEG-TS/.test(l)));
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

// ---- MPEG-TS or HLS per channel, whichever holds up (#47) ----
{
  // (HLS reloads by itself twice before a network error counts as a drop.)
  const drop = (m) => { const e = m.last(); if (e.kind === 'ts') e.h.err('NetworkError', 'EarlyEof', {}); else for (let i = 0; i < 3; i++) e.h.hlsError('e', { fatal: true, type: 'networkError', details: 'fragLoadError' }); };
  // Two drops in three minutes on MPEG-TS: its HLS version.
  let m = setup();
  m.P.play({ n: 'Swap', url: 'http://p/live/u/p/80.ts' });
  m.feed(0, 30); m.run(3000);
  drop(m); m.run(1500); m.feed(0, 30); m.run(3000);
  drop(m); m.run(1500);
  ok('swap: two drops in three minutes on MPEG-TS switch to HLS', m.last().kind === 'hls' && m.logs.some(l => /dropped 2 times in 3 minutes on MPEG-TS; switching to its HLS version/.test(l)), m.made.map(x => x.kind).join(','));
  m.feed(0, 30); m.run(3000);
  ok('swap: and plays as HLS', m.P.playing);
  // HLS dropping twice in turn: back to MPEG-TS.
  drop(m); m.run(1500); m.feed(0, 30); m.run(3000);
  drop(m); m.run(1500);
  ok('swap: HLS dropping twice goes back to MPEG-TS', m.last().kind === 'ts' && m.logs.some(l => /on HLS; switching to its MPEG-TS version/.test(l)), m.made.map(x => x.kind).join(','));
  // A third switch is allowed, then it settles.
  for (let k = 0; k < 6; k++) { m.feed(0, 30); m.run(3000); drop(m); m.run(1500); }
  const swaps = m.logs.filter(l => /switching to its/.test(l)).length;
  ok('swap: at most three switches in ten minutes', swaps === 3, swaps);

  // The switch on the last reconnect of the budget is kept (it went to the TV player and back to MPEG-TS before).
  m = setup({ settings: { buffer: 'custom', custom: { prebuffer: 1, ahead: 10, back: 4, stall: 4, retries: 2 } } });
  m.P.play({ n: 'Budget', url: 'http://p/live/u/p/81.ts' });
  m.feed(0, 30); m.run(3000);
  drop(m); m.run(1500);
  drop(m); m.run(1500);
  ok('swap: a switch on the last reconnect of the budget sticks', m.last().kind === 'hls' && !m.logs.some(l => /Still failing; trying the TV player/.test(l)), m.made.map(x => x.kind).join(','));

  // An HLS version that never shows a picture: back to MPEG-TS after 8 seconds, not 15.
  m = setup();
  m.P.play({ n: 'No picture', url: 'http://p/live/u/p/83.ts' });
  m.feed(0, 30); m.run(3000);
  drop(m); m.run(1500); m.feed(0, 30); m.run(3000);
  drop(m); m.run(1500);
  m.video.readyState = 0; m.video._ranges = []; m.run(9000);
  ok('swap: an HLS version with no picture goes back to MPEG-TS within 8 seconds', m.last().kind === 'ts' && m.logs.some(l => /HLS version doesn't play here \(no video yet\); back to MPEG-TS/.test(l)), m.made.map(x => x.kind).join(',') + ' ' + m.logs.filter(l => /back to|No playable/.test(l)).join(' | '));
  // A trickle switches at once.
  m = setup();
  m.P.play({ n: 'Trickle', url: 'http://p/live/u/p/82.ts' });
  m.feed(0, 40); m.run(3000);
  let e0 = 40; const n0 = m.made.length;
  for (let i = 0; i < 600 && m.made.length === n0; i++) { e0 += 0.03; m.video._ranges = [[0, e0]]; m.run(100); }
  m.run(1500);
  ok('swap: a stream trickling in on MPEG-TS goes to HLS straight away', m.last().kind === 'hls' && m.logs.some(l => /is trickling in on MPEG-TS; switching to its HLS version/.test(l)), m.made.map(x => x.kind).join(','));
}

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

// ---- issue #34: a paused movie whose connection the provider closed ----
t = setup();
t.P.play({ n: 'Paused film', url: 'http://p/movie/u/p/30.mkv' }, { live: false });
t.video.duration = 7200; t.feed(0, 4000); t.run(2000);
t.video.currentTime = 1200; t.run(500);
t.P.setPaused(true); t.run(60000);
t.P.setPaused(false);
const fire = code => { t.video.error = { code }; t.video.l.error.forEach(f => f()); };
fire(2);                                                   // the old connection is gone
t.run(1500);
fire(4);                                                   // and the old link is refused before the first frame
t.run(1500);
ok('#34: a refused reopen of a movie that played is a reconnect, not another pipeline', !t.logs.some(l => /Trying the/.test(l)) && t.logs.some(l => /provider closed the connection, reconnecting/.test(l)) && /movie\/u\/p\/30\.mkv$/.test(t.video._src), t.logs.filter(l => /Trying|closed/.test(l)).join(' | '));
ok('#34: and never says the format cannot be played', !t.states.some(s => /format/.test(s)), t.states.join(' | '));
t.video.duration = 7200; t.feed(0, 4000); t.run(1500);
ok('#34: it comes back at the same spot, still playing', Math.abs(t.video.currentTime - 1200) < 3 && !t.video.paused, t.video.currentTime);

t = setup({ settings: { buffer: 'custom', custom: { prebuffer: 1, ahead: 10, back: 4, stall: 4, retries: 2 } } });
t.P.play({ n: 'Gone film', url: 'http://p/movie/u/p/31.mp4' }, { live: false });
t.video.duration = 7200; t.feed(0, 4000); t.run(2000);
t.video.currentTime = 900; t.run(500);
for (let i = 0; i < 6; i++) { t.video.error = { code: i ? 4 : 2 }; t.video.l.error.forEach(f => f()); t.run(6000); }
const lastState = t.states[t.states.length - 1];
ok('#34: when reconnecting really fails, the message says the provider closed the connection and offers to try again', /^error: The provider closed the connection/.test(lastState) && /Press OK to try again/.test(lastState) && !/format/.test(lastState), lastState);
t.P.retryNow(); t.video.duration = 7200; t.feed(0, 4000); t.run(1500);
ok('#34: OK tries again from where it was', Math.abs(t.video.currentTime - 900) < 3, t.video.currentTime);

t = setup();
t.P.play({ n: 'Long pause', url: 'http://p/movie/u/p/32.mkv' }, { live: false });
t.video.duration = 7200; t.feed(0, 4000); t.run(2000);
t.video.currentTime = 3000; t.run(500);
t.P.setPaused(true); t.run(30000);
t.P.setPaused(false);
ok('#34: a short pause just plays on', !t.video.paused && t.video._src !== '' && !t.logs.some(l => /opening the video again/.test(l)));
t.P.setPaused(true); t.run(4 * 60000);
t.P.setPaused(false);
ok('#34: after a long pause the movie is opened again', t.logs.some(l => /Paused for \d+s; opening the video again at 300\ds/.test(l)), t.logs.slice(-3).join(' | '));
t.video.duration = 7200; t.feed(0, 4000); t.run(1500);
ok('#34: at the same spot, playing', Math.abs(t.video.currentTime - 3000) < 3 && !t.video.paused, t.video.currentTime);

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

// ---- the most a stream has held, for buffer info (#44): live channels bank less than the profile allows ----
t = setup();
t.P.play({ n: 'Most', url: 'http://p/live/u/p/30.ts' });
t.feed(0, 12); t.run(2500);
ok('buffer info knows the most held so far', t.P.stats && t.P.stats.most >= 11 && t.P.stats.cap === 30, JSON.stringify(t.P.stats));
t.video.currentTime = 10; t.run(600);
ok('and keeps the most, not the latest', t.P.stats.most >= 11 && t.P.stats.ahead < 3, t.P.stats.most + ' / ' + t.P.stats.ahead);

// ---- remembered across restarts (playmemo.js): the pipeline a channel needed, and its cushion ----
{
  const ls = {};
  let m = setup({ memo: ls });
  const ch = { k: 'only-hls', n: 'Only HLS', url: 'http://p/live/u/p/40.ts' };
  m.P.play(ch);
  m.last().h.err('MediaError', 'unsupported', {});          // the demuxer can't take it: next pipeline
  ok('memo: a channel the demuxer refuses tries the TV player', m.last().kind === 'native' || !!m.video._src, m.last().kind);
  m.video.l.error && m.video.l.error.forEach(f => { m.video.error = { code: 4 }; m.video._src = 'x'; f(); });
  m.run(100);
  ok('memo: then its HLS version', m.last().kind === 'hls', m.last().kind);
  m.feed(0, 10); m.run(1500);
  ok('memo: plays as HLS', m.P.playing && m.logs.some(l => /Playing after/.test(l)));
  m.ctx.PlayMemo.flush();
  ok('memo: remembered', /only-hls/.test(ls['tivibro.playMemo'] || '') && /"hls"/.test(ls['tivibro.playMemo']), ls['tivibro.playMemo']);
  // The next day (a new app start): straight to HLS.
  m = setup({ memo: ls });
  m.P.play(ch);
  ok('memo: next time it starts as HLS at once', m.made.length === 1 && m.last().kind === 'hls' && m.logs.some(l => /which played this channel last time/.test(l)), m.made.map(x => x.kind).join(','));
  // A channel that played on the usual pipeline leaves nothing behind.
  m.P.play({ k: 'plain', n: 'Plain', url: 'http://p/live/u/p/41.ts' }); m.feed(0, 10); m.run(1500);
  m.ctx.PlayMemo.flush();
  ok('memo: a channel that plays the usual way is not stored', !/plain/.test(ls['tivibro.playMemo']));
  // The cushion a channel earned comes back after a restart.
  m.P.play({ k: 'dry', n: 'Dry', url: 'http://p/live/u/p/42.ts' }); m.feed(0, 4); m.run(2500); m.run(4000);
  const earned = m.P.stats.target;
  m.ctx.PlayMemo.flush();
  m = setup({ memo: ls });
  m.P.play({ k: 'dry', n: 'Dry', url: 'http://p/live/u/p/42.ts' }); m.feed(0, 4); m.run(2500); m.run(4000);
  ok('memo: the earned cushion is there from the first refill after a restart', m.P.stats.target >= earned && earned > 3, earned + ' then ' + m.P.stats.target);
}

// ---- Automatic buffer: a steady provider starts fast, a shaky one holds more ----
{
  const ls = {};
  let m = setup({ memo: ls, settings: { buffer: 'auto' } });
  m.P.play({ k: 'a1', n: 'A1', url: 'http://steady.example/live/u/p/1.ts' });
  ok('auto: learning at first', /Automatic \(still learning\)/.test(m.logs.find(l => /^Start /.test(l)) || ''), m.logs.find(l => /^Start /.test(l)));
  const PM = m.ctx.PlayMemo;
  for (let i = 0; i < 4; i++) PM.started('steady.example');
  PM.watched('steady.example', 50000); for (let i = 0; i < 40; i++) PM.watched('steady.example', 50000);    // about 35 minutes, never dry
  for (let i = 0; i < 4; i++) PM.started('shaky.example');
  for (let i = 0; i < 40; i++) PM.watched('shaky.example', 50000);
  for (let i = 0; i < 10; i++) PM.ranDry('shaky.example');                                                  // 10 in about 33 minutes
  m.P.play({ k: 'a2', n: 'A2', url: 'http://steady.example/live/u/p/2.ts' });
  ok('auto: a steady provider starts at 0.8s', /Automatic \(steady\).*prebuffer 0.8s/.test(m.logs.filter(l => /^Start /.test(l)).pop()), m.logs.filter(l => /^Start /.test(l)).pop());
  m.P.play({ k: 'b1', n: 'B1', url: 'http://shaky.example/live/u/p/1.ts' });
  ok('auto: a very shaky one holds 6s', /Automatic \(very shaky\).*prebuffer 6s/.test(m.logs.filter(l => /^Start /.test(l)).pop()), m.logs.filter(l => /^Start /.test(l)).pop());
  // Running dry counts against the provider; time watched counts for it.
  m.P.play({ k: 'c1', n: 'C1', url: 'http://new.example/live/u/p/1.ts' }); m.feed(0, 30); m.run(3000); m.run(10000);
  m.video._ranges = [[0, m.video.currentTime + 0.1]]; m.run(2000);
  const h = JSON.parse(JSON.stringify(PM.summary())).find(x => x.host === 'new.example');
  ok('auto: watching and running dry are counted for the provider', h && h.dry === 1 && h.hours > 0.002, JSON.stringify(h));
}

// ---- arriving slower than it plays: reconnect while there is still a cushion ----
{
  const m = setup();
  m.P.play({ n: 'Slow', url: 'http://p/live/u/p/50.ts' });
  m.feed(0, 40); m.run(3000);
  let e0 = 40; for (let i = 0; i < 200; i++) { e0 += 0.03; m.video._ranges = [[0, e0]]; m.run(100); }   // 20s of a slow trickle, cushion still big
  ok('slow: not before the cushion is nearly gone', !m.logs.some(l => /arriving at/.test(l)));
  // From now on video arrives at 40% of real time.
  let end = e0;
  const n0 = m.made.length;
  for (let i = 0; i < 400 && m.made.length === n0; i++) { end += 0.03; m.video._ranges = [[0, end]]; m.run(100); }
  const lg = m.logs.find(l => /arriving at/.test(l)) || '';
  ok('slow: reconnects before running dry, with the cushion still there', /arriving at \d+% of real time with [12]\.\d+s left/.test(lg) && m.made.length === n0 + 1 && !m.logs.some(l => /Buffer ran dry/.test(l)), lg);
  // A stall (nothing at all for 8s, then a burst) is left to the refill, which keeps the burst.
  const st2 = setup();
  st2.P.play({ n: 'Stall', url: 'http://p/live/u/p/52.ts' });
  st2.feed(0, 34); st2.run(3000);
  let e3 = 34;
  for (let k = 0; k < 4; k++) { st2.run(8000); for (let i = 0; i < 20; i++) { e3 += 0.4; st2.video._ranges = [[0, e3]]; st2.run(100); } }
  ok('slow: a stall then a burst is not a trickle', !st2.logs.some(l => /arriving at/.test(l)), st2.logs.filter(l => /arriving|dry|Reconnect/.test(l)).join(' | '));
  // A steady stream never does.
  const q = setup();
  q.P.play({ n: 'Fine', url: 'http://p/live/u/p/51.ts' });
  q.feed(0, 6); q.run(2500);
  let e2 = 6; for (let i = 0; i < 600; i++) { e2 += 0.1; q.video._ranges = [[0, e2]]; q.run(100); }
  ok('slow: a stream keeping up is left alone', !q.logs.some(l => /arriving at|ran dry/.test(l)) && q.made.length === 1, q.logs.filter(l => /arriving|dry/.test(l)).join(' | '));
}

// ---- the start, split up for Stream info ----
{
  const m = setup();
  m.P.play({ n: 'Timed', url: 'http://p/live/u/p/60.ts' });
  m.run(300); m.video._ranges = [[0, 0.5]]; m.run(200); m.video.readyState = 4; m.video._ranges = [[0, 4]]; m.run(200); m.run(500);
  const s = m.P.stats;
  ok('timing: first data, first picture and the start are known', s && s.startMs >= 500 && s.dataMs >= 300 && s.dataMs <= s.startMs && /first data \d+ms/.test(m.logs.find(l => /Playing after/.test(l)) || ''), JSON.stringify(s));
}

// ---- memory-safe playback (#42, #46): less video held after a close while playing, or on a 1 GB TV ----
{
  let m = setup({ settings: { buffer: 'max' } });
  m.P.play({ n: 'Big', url: 'http://p/live/u/p/70.ts' });
  ok('memory: Rock solid holds a minute normally', m.last().src && /Rock solid \(prebuffer 8s\)/.test(m.logs.find(l => /^Start /.test(l))) && !m.P.memSafe);
  m = setup({ settings: { buffer: 'max' } });
  m.P.memorySafe('TiviBro closed while playing once this week');
  m.P.play({ n: 'Big', url: 'http://p/live/u/p/70.ts' });
  m.feed(0, 30); m.run(9000);
  ok('memory: after a close while playing, memory-safe', /Rock solid, memory-safe/.test(m.logs.find(l => /^Start /.test(l))) && m.P.stats.cap === 20 && /closed while playing/.test(m.P.memSafe), m.P.stats.cap + ' ' + m.P.memSafe);
  m.last().h.err('NetworkError', 'EarlyEof', {});
  const n0 = m.made.length; m.run(900);
  ok('memory: a reconnect waits a second for the old player to go', m.made.length === n0, m.made.length - n0);
  m.run(400);
  ok('memory: then reconnects', m.made.length === n0 + 1);
  m = setup({ settings: { buffer: 'max' } });
  m.nav.deviceMemory = 1;
  m.P.play({ n: 'Small TV', url: 'http://p/live/u/p/71.ts' });
  ok('memory: a TV with 1 GB is memory-safe from the start', /memory-safe/.test(m.logs.find(l => /^Start /.test(l)) || '') && /1 GB/.test(m.P.memSafe), m.P.memSafe);
}

// ---- sloppy streams: a growing cushion, quick reconnect when data stops, timestamp jumps ----
t = setup();
t.P.play({ n: 'Sloppy', url: 'http://p/live/u/p/20.ts' });
t.feed(0, 4); t.run(2500);
ok('sloppy: playing', t.P.playing);
t.run(4000);                                   // plays through the 4s it has: runs dry
ok('running dry starts a refill', /buffering/.test(t.states[t.states.length - 1]) && t.logs.some(l => /Buffer ran dry/.test(l)));
const goal1 = t.P.stats.target;
ok('the first dry spell already raises the cushion', goal1 > 3 && t.logs.some(l => /cushion raised/.test(l)), goal1);
t.video._ranges = [[0, 4 + 2.6]]; t.run(500);
ok('a refill does not wait forever for the bigger cushion: back after 4s at the profile target', t.P.playing === false);
t.video._ranges = [[0, 4 + 3.2]]; t.run(4000);
ok('…resumes once 4s have passed with the profile target buffered', /playing/.test(t.states[t.states.length - 1]), t.states[t.states.length - 1]);
t.run(5000);                                   // dry again, and nothing more arrives
const m0 = t.made.length;
t.run(8000);
ok('no data for 4s during a refill reconnects', t.made.length > m0 && t.logs.some(l => /No data from the provider/.test(l)));

t = setup();
t.P.play({ n: 'Jumpy', url: 'http://p/live/u/p/21.ts' });
t.feed(0, 20); t.run(2500);
t.video.currentTime = 19.9; t.run(300);
for (let k = 1; k <= 8; k++) { t.video._ranges = [[0, 20], [500, 500 + k * 0.5]]; t.run(400); }   // new video keeps arriving at 500s
ok('timestamps jumping ahead: follows the stream', t.video.currentTime >= 500 && t.logs.some(l => /timestamps jumped/.test(l)), t.video.currentTime);
t.video._ranges = [[500, 506]]; t.video.currentTime = 505.9; t.run(400);
for (let k = 1; k <= 8; k++) { t.video._ranges = [[2, 2 + k * 0.5], [500, 506]]; t.run(400); }
ok('timestamps jumping back: follows the stream too', t.video.currentTime >= 2 && t.video.currentTime < 5, t.video.currentTime);

t = setup();
t.P.play({ n: 'Outage', url: 'http://p/live/u/p/22.ts' });
t.feed(0, 30); t.run(2500);
t.last().h.err('NetworkError', 'EarlyEof', {}); t.run(1500);
for (let i = 0; i < 6; i++) { t.last().h.err('NetworkError', 'HttpStatusCodeInvalid', { code: 404 }); t.run(6000); }
ok('a channel that played and now gets HTTP errors keeps the same pipeline', t.made.every(e => e.kind === 'ts') && t.video._src === '' && !t.logs.some(l => /Trying the/.test(l)));

t = setup();
t.P.play({ n: 'Busy', url: 'http://p/live/u/p/23.ts' });
for (let i = 0; i < 4; i++) { t.last().h.err('NetworkError', 'HttpStatusCodeInvalid', { code: 503 }); t.run(3000); }
ok('busy answers (503) get more tries on the same pipeline before anything else', t.last().kind === 'ts' && !t.states.some(x => /^error/.test(x)));

// Native MKV playback must share the subtitle resolver's session URL.
let resolveMkv, cancelledMkv = 0;
t = setup({mkvSubs: {extract(url, video, resolved) { resolveMkv = resolved; return {cancel() {cancelledMkv++;}}; }}});
t.P.play({n: 'MKV', url: 'http://provider/movie/u/p/1.mkv'}, {live: false});
ok('MKV native playback waits for the shared URL instead of opening the provider twice', t.video.src === '' && typeof resolveMkv === 'function');
resolveMkv('http://relay/session/one');
ok('native video uses the exact URL resolved by subtitle discovery', t.video.src === 'http://relay/session/one');
t.P.stop();
ok('stopping native MKV playback cancels subtitle discovery', cancelledMkv === 1);

let hintedExt;
t = setup({mkvSubs: {extract(url, video, resolved, ext) { hintedExt = ext; resolved(url); return {cancel() {}}; }}});
t.P.play({n: 'Signed movie', url: 'http://mock/signed-file'}, {live: false, meta: {item: {ext: 'mkv'}}});
ok('My media passes its known container to subtitle extraction for extensionless links', hintedExt === 'mkv');

// ---- Aspect (discussion #31) ----
t = setup();
const F = t.P.aspectFit, near = (a, b) => Math.abs(a - b) < 0.002;
let f = F('contain', 1920, 1080, 1920, 1080);
ok('Aspect: Original, Fill and Zoom are plain object-fit', f.fit === 'contain' && f.sx === 1 && F('fill', 720, 576, 1920, 1080).fit === 'fill' && F('cover', 720, 576, 1920, 1080).fit === 'cover' && F('cover', 720, 576, 1920, 1080).sx === 1);
f = F('16:9', 720, 540, 1920, 1080);
ok('Aspect 16:9: a squashed 4:3 picture fills a 16:9 screen', f.fit === 'fill' && f.sx === 1 && f.sy === 1, JSON.stringify(f));
f = F('4:3', 1920, 1080, 1920, 1080);
ok('Aspect 4:3: shown 4:3 with bars at the sides', f.fit === 'fill' && near(f.sx, 0.75) && f.sy === 1, JSON.stringify(f));
f = F('21:9', 1920, 1080, 1920, 1080);
ok('Aspect 21:9: a letterboxed 2.35:1 film fills the height, sides cropped, shape kept', near(f.sx, 2.35 / (16 / 9)) && near(f.sy, 2.35 / (16 / 9)), JSON.stringify(f));
f = F('stretch43', 1920, 1080, 1920, 1080);
ok('Aspect 4:3 to 16:9: the 4:3 middle of a pillarboxed picture is stretched to the full width', near(f.sx, 4 / 3) && f.sy === 1, JSON.stringify(f));
f = F('stretch43', 640, 480, 1920, 1080);
ok('Aspect 4:3 to 16:9: a 4:3 picture is stretched to the screen', f.sx === 1 && f.sy === 1 && f.fit === 'fill', JSON.stringify(f));
t.settings.display = '21:9';
t.P.play({ k: 'c1', n: 'Wide', url: 'http://p/live/u/p/40.ts' });
t.feed(0, 30); t.run(1000);
ok('Aspect from Settings applies to the video with a transform', t.video.style.objectFit === 'fill' && /^scale\(1\.32/.test(t.video.style.transform), t.video.style.objectFit + ' ' + t.video.style.transform);
t.P.setAspect('4:3', t.P.current);
ok('Aspect for one channel is remembered by its key', t.P.displayFor({ k: 'c1' }) === '4:3' && t.P.displayFor({ k: 'c2' }) === '21:9' && t.video.style.transform === 'scale(0.75,1)', t.video.style.transform);
t.P.play({ k: 'c2', n: 'Other', url: 'http://p/live/u/p/41.ts' }); t.feed(0, 30); t.run(1000);
t.P.play({ k: 'c1', n: 'Wide', url: 'http://p/live/u/p/40.ts' }); t.feed(0, 30); t.run(1000);
ok('and comes back with the channel', t.video.style.transform === 'scale(0.75,1)', t.video.style.transform);
t.P.setAspect('contain', null);
ok('changing the default leaves a channel with its own choice alone', t.P.displayFor({ k: 'c9' }) === 'contain' && t.video.style.transform === 'scale(0.75,1)');
t.P.setAspect('contain', t.P.current);
ok('Original for this channel clears the transform', t.video.style.objectFit === 'contain' && t.video.style.transform === '', t.video.style.transform);
t.settings.display = 'bogus';
ok('an unknown stored value falls back to Original', t.P.displayFor({ k: 'c7' }) === 'contain');

// Native MP4 playback: the same shared session URL, through the MP4 reader.
const fakeMp4 = (o) => ({ isMp4: (u, c) => /\.(mp4|m4v|mov)$/i.test(u.split(/[?#]/)[0]) || /^(mp4|m4v|mov)$/i.test(c || ''),
  extract(url, video, resolved, ext) { o.calls.push({ url, resolved, ext }); return { cancel() { o.cancelled++; } }; } });
let mp4 = { calls: [], cancelled: 0 }, mkvCalls = 0;
t = setup({ mp4Subs: fakeMp4(mp4), mkvSubs: { extract(u, v, r) { mkvCalls++; r(u); return { cancel() {} }; } } });
t.P.play({ n: 'Episode', url: 'http://provider/series/u/p/7.mp4' }, { live: false });
ok('MP4 native playback waits for the shared URL', t.video.src === '' && mp4.calls.length === 1 && typeof mp4.calls[0].resolved === 'function' && mkvCalls === 0);
mp4.calls[0].resolved('http://relay/session/two');
ok('native MP4 video uses the URL resolved by subtitle discovery', t.video.src === 'http://relay/session/two');
t.P.stop();
ok('stopping native MP4 playback cancels subtitle discovery', mp4.cancelled === 1);

mp4 = { calls: [], cancelled: 0 };
t = setup({ mp4Subs: fakeMp4(mp4) });
t.P.play({ n: 'Signed movie', url: 'http://mock/signed-file' }, { live: false, meta: { item: { ext: 'mp4' } } });
ok('My media passes mp4 container for extensionless links', mp4.calls.length === 1 && mp4.calls[0].ext === 'mp4');

mp4 = { calls: [], cancelled: 0 }; mkvCalls = 0;
t = setup({ mp4Subs: fakeMp4(mp4), mkvSubs: { extract(u, v, r) { mkvCalls++; r(u); return { cancel() {} }; } } });
t.P.play({ n: 'Film', url: 'http://provider/movie/u/p/3.mkv' }, { live: false });
ok('MKV still goes to MkvSubs', mkvCalls === 1 && mp4.calls.length === 0 && t.video.src === 'http://provider/movie/u/p/3.mkv');
t.P.stop();
t = setup({ mp4Subs: fakeMp4(mp4) });
t.P.play({ n: 'Clip', url: 'http://provider/movie/u/p/4.avi' }, { live: false });
ok('other files play directly, without subtitle extraction', mp4.calls.length === 0 && t.video.src === 'http://provider/movie/u/p/4.avi');

if (fail) { console.log(fail + ' player test(s) failed'); process.exit(1); }
console.log('all player tests passed');
