/* Subs and embedded (MKV, MP4) tracks: the timing it applies to a track (Subs.timing), turning
   subtitles on by themselves (Subs.autoOn: not after the viewer chose, never a forced track), and Line
   up with a track that is read from the file as it plays (_embedLoad, a common time span).
     node tests/unit/subs-lineup.test.js */
'use strict';
const vm = require('vm'), fs = require('fs'), path = require('path');
let fail = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + JSON.stringify(x).slice(0, 400) : '')); if (!c) fail++; };
const wait = ms => new Promise(r => setTimeout(r, ms));

const toasts = [], menus = [], settings = {};
const vid = { textTracks: [], currentTime: 0 };
const ctx = { localStorage: { getItem: () => null, setItem() {} }, Store: { settings, saveSettings() {} },
  U: { LANGS: [['en', 'English', 'eng'], ['nl', 'Dutch', 'nld']], toast: (m, ms) => toasts.push([m, ms]), pad: n => n,
    lang: s => ({ en: 'en', eng: 'en', english: 'en', nl: 'nl', nld: 'nl' })[String(s || '').toLowerCase()] || '' },
  UI: { menu: (t, items) => menus.push({ t, items }) }, document: { getElementById: () => vid },
  console, Math, JSON, Date, setInterval, clearInterval, setTimeout, clearTimeout, isFinite, Promise };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/js/subs.js'), 'utf8') + ';this.Subs = Subs;', ctx);
const Subs = ctx.Subs;

const mk = (label, lang, cues, extra) => Object.assign({ kind: 'subtitles', label, language: lang, mode: 'disabled',
  cues: cues.map(c => ({ startTime: c.s, endTime: c.e, text: 'x' })), addCue(c) { this.cues.push(c); } }, extra || {});
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const ref = []; let at = 5; for (let i = 0; i < 300; i++) { at += 1.2 + rnd() * 9; const len = 0.8 + rnd() * 3; ref.push({ s: at, e: at + len }); at += len; }
const k = 25 / 23.976;
const lineUpWith = async (target, other) => {
  vid.textTracks = [target, other]; menus.length = 0;
  Subs.lineUpMenu([target, other]);
  const item = menus.length && menus[menus.length - 1].items.filter(i => i.label === other.label)[0];
  if (item) item.action();
  await wait(150);
};

(async () => {
  {
    // Golden: two downloaded subtitles line up exactly as before embedded tracks got their own path.
    const target = mk('English (OpenSubtitles)', 'en', ref.map(x => ({ s: x.s / k + 1.7, e: x.e / k + 1.7 })), { mode: 'showing' });
    await lineUpWith(target, mk('Dutch (OpenSubtitles)', 'nl', ref));
    const first = target.cues.slice(0, 3).map(c => [+c.startTime.toFixed(3), +c.endTime.toFixed(3)]);
    ok('OpenSubtitles vs OpenSubtitles Line up result unchanged', toasts[toasts.length - 1][0] === 'Lined up: 1.75 s earlier, frame rate fixed (99% match)' &&
      JSON.stringify(first) === JSON.stringify([[6.223, 9.785], [13.589, 15.02], [22.785, 25.183]]), { toast: toasts[toasts.length - 1], first });
    const tm = Subs.timing(target);
    Subs._test.shift(0.5);
    const tm2 = Subs.timing(target), plain = Subs.timing(mk('Other', 'en', []));
    ok('Subs.timing reflects a Line up and Timing', tm && Math.abs(tm.scale - k) < 1e-6 && Math.abs(tm.off - (-1.7 * k)) < 0.06 && tm.delay === 0 &&
      tm2.delay === 0.5 && tm2.scale === tm.scale && plain.scale === 1 && plain.off === 0 && plain.delay === 0.5, { tm, tm2, plain });
    Subs.reset();
  }
  {
    settings.autoSubs = true; settings.subsLang = 'en';
    const v = { };
    const en = mk('English', 'en', []), nl = mk('Dutch', 'nl', []), forced = mk('English (forced)', 'en', [], { _forced: true });
    const before = [Subs.autoOn(en, v), Subs.autoOn(nl, v), Subs.autoOn(forced, v)];
    v._subsChoice = true;
    const after = Subs.autoOn(en, v);
    settings.autoSubs = false;
    const offSetting = Subs.autoOn(en, {});
    ok('explicit Off survives a reconnect re-attach (no auto-on)', before[0] === true && before[1] === false && after === false && offSetting === false, { before, after, offSetting });
    ok('autoSubs skips a forced track', before[2] === false);
  }
  {
    // 25 tracks read from the file: the menu lists them all and reads none of them until one is picked.
    const calls = [];
    const target = mk('English', 'en', ref.slice(0, 10), { mode: 'showing', _embedded: true });
    const others = Array.from({ length: 24 }, (_, i) => mk('Track ' + i, 'en', [], { _embedded: true, _embedLoad: () => { calls.push(i); return Promise.resolve(); } }));
    menus.length = 0;
    Subs.lineUpMenu([target].concat(others));
    ok('opening Line up with 25 MP4 tracks requests nothing', menus.length === 1 && menus[0].items.length === 24 && calls.length === 0, { menus: menus.length, calls });
  }
  {
    // The target is read around now (cues 1000-1300 s, 2.4 s late); the reference is read only when picked,
    // over the target's span and a margin, and the match is scored over the time both have.
    const near = ref.filter(x => x.s > 1000 && x.s < 1300);
    const target = mk('English', 'en', near.map(x => ({ s: x.s + 2.4, e: x.e + 2.4 })), { mode: 'showing', _embedded: true });
    let asked = null;
    const reference = mk('Dutch', 'nl', [], { _embedded: true, _embedLoad(from, to, ms) {
      asked = [from, to, ms];
      ref.filter(x => x.e > from && x.s < to).forEach(x => this.addCue({ startTime: x.s, endTime: x.e, text: 'y' }));
      return Promise.resolve();
    } });
    vid.currentTime = 1150;
    await lineUpWith(target, reference);
    const r = toasts[toasts.length - 1][0];
    // The target's span plus 30 s each side, within Line up's ±120 s search around now (and the window).
    const want = [Math.max(near[0].s + 2.4 - 30, 1150 - 150), Math.min(near[near.length - 1].e + 2.4 + 30, 1150 + 180)];
    ok('picking an MP4 reference reads only that track around the target span and releases demand', asked && asked[2] === 20000 &&
      Math.abs(asked[0] - want[0]) < 1e-6 && Math.abs(asked[1] - want[1]) < 1e-6 &&
      /^Lined up: 2\.40 s earlier/.test(r), { asked, want, r });
    Subs.reset();
    // Full downloaded reference (2000+ s) against the same windowed target: scored over the common span.
    const target2 = mk('English', 'en', near.map(x => ({ s: x.s + 2.4, e: x.e + 2.4 })), { mode: 'showing', _embedded: true });
    await lineUpWith(target2, mk('Dutch (OpenSubtitles)', 'nl', ref));
    const r2 = toasts[toasts.length - 1][0];
    ok('windowed target vs full reference matches over the common span', /^Lined up: 2\.40 s earlier \((9\d|100)% match\)/.test(r2), r2);
    Subs.reset();
  }
  {
    const target = mk('English', 'en', ref.slice(0, 40), { mode: 'showing', _embedded: true });
    let ms = null;
    const slow = mk('Dutch', 'nl', [], { _embedded: true, _embedLoad: (f, t, m) => { ms = m; return Promise.reject(new Error('timeout')); } });
    toasts.length = 0;
    await lineUpWith(target, slow);
    const shown = toasts.map(t => t[0]);
    ok('Line up times out cleanly after 20000 ms with the existing toast', ms === 20000 && shown[0] === 'Lining up…' &&
      /took too long/.test(shown[shown.length - 1]) && target.cues[0].startTime === ref[0].s, { ms, shown });
  }
  {
    // Both tracks read around where they were watched, the target a minute late: the shift is tested
    // before the overlap is judged, so lines outside the uncorrected overlap still count.
    const win = ref.filter(x => x.s < 90).slice(0, 10);
    const target = mk('English', 'en', win.map(x => ({ s: x.s + 60, e: x.e + 60 })), { mode: 'showing', _embedded: true });
    toasts.length = 0;
    await lineUpWith(target, mk('Dutch', 'nl', win, { _embedded: true }));
    const r = toasts.length ? toasts[toasts.length - 1][0] : '';
    ok('embedded pair a minute apart lines up (60 s earlier, full match)', /^Lined up: 60(\.0+)? s earlier \((9\d|100)% match\)/.test(r) &&
      Math.abs(target.cues[0].startTime - win[0].s) < 0.06, { r, first: target.cues[0].startTime, want: win[0].s });
    Subs.reset();
    // Late in the film, a frame-rate difference moves lines out of the uncorrected overlap.
    const late = ref.filter(x => x.s > 1500 && x.s < 1700);
    const t2 = mk('English', 'en', late.map(x => ({ s: x.s / k, e: x.e / k })), { mode: 'showing', _embedded: true });
    toasts.length = 0;
    await lineUpWith(t2, mk('Dutch', 'nl', late, { _embedded: true }));
    const r2 = toasts.length ? toasts[toasts.length - 1][0] : '';
    ok('embedded pair late in the film: frame rate fixed', /frame rate fixed \((9\d|100)% match\)/.test(r2), { r2, n: late.length });
    Subs.reset();
  }
  if (fail) { console.log(fail + ' subs-lineup test(s) failed'); process.exit(1); }
  console.log('all subs-lineup tests passed');
})().catch(e => { console.error(e); process.exit(1); });
