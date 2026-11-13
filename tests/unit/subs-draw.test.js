/* Subtitle lines on screen (discussion #19 follow-up): TiviBro draws them itself, exactly the lines whose
   time includes now, so a line can't stay stuck after Timing, Line up or a seek moved it, and the frame
   rate fix (23.976 / 24 / 25 fps) scales every line's time.  Runs subs.js against a small fake video.
     node tests/unit/subs-draw.test.js */
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };

function classes() { const s = {}; return { contains: (k) => !!s[k], add: (k) => { s[k] = 1; }, remove: (k) => { delete s[k]; }, toggle: (k, on) => { if (on) s[k] = 1; else delete s[k]; } }; }
function makeTrack(kind, label, language) {
  // Like the browser: the cue list stays in start order when lines are added.
  const t = { kind, label, language, mode: 'disabled', cues: [], addCue(c) { this.cues.push(c); this.cues.sort((a, b) => a.startTime - b.startTime); } };
  return t;
}
const stage = { classList: classes(), kids: [], appendChild(el) { el.parentNode = this; this.kids.push(el); } };
stage.classList.add('full');
const video = { currentTime: 0, textTracks: [], classList: classes(), parentNode: stage,
  addTextTrack(kind, label, lang) { const t = makeTrack(kind, label, lang); this.textTracks.push(t); return t; } };
const store = {};
const ctx = {
  localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; } }, Store: { settings: {}, saveSettings() {} },
  U: { LANGS: [['en', 'English']], pad: (n) => (n < 10 ? '0' : '') + n }, console, Math, JSON, Date, isFinite,
  setInterval: () => 1, clearInterval: () => {},
  VTTCue: function (s, e, text) { this.startTime = s; this.endTime = e; this.text = text; },
  document: { getElementById: (id) => (id === 'video' ? video : null), createElement: () => ({ style: {}, textContent: '', className: '' }) }
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/js/subs.js'), 'utf8') + ';this.Subs = Subs;', ctx);
const Subs = ctx.Subs, T = Subs._test;
const board = () => stage.kids.filter((k) => k.className === 'subs-captions')[0];
const shown = (t) => { video.currentTime = t; Subs.draw(); const b = board(); return b && b.style.display !== 'none' ? b.textContent : ''; };

// A downloaded subtitle with overlapping lines and one long line, like real files have.
const cues = [
  { s: 10, e: 14, text: 'First' },
  { s: 12, e: 13, text: 'Overlaps the first' },
  { s: 15, e: 40, text: 'A long sign on the wall' },
  { s: 16, e: 17, text: 'One' }, { s: 18, e: 19, text: 'Two' }, { s: 20, e: 21, text: 'Three' }, { s: 22, e: 23, text: 'Four' },
  { s: 24, e: 25, text: 'Five' }, { s: 26, e: 27, text: 'Six' }, { s: 28, e: 29, text: 'Seven' }, { s: 30, e: 31, text: 'Eight' },
  { s: 32, e: 33, text: 'Nine' }, { s: 34, e: 35, text: 'Ten' }, { s: 36, e: 37, text: 'Eleven' }, { s: 38, e: 39, text: 'Twelve' },
  { s: 41, e: 43, text: 'Last <i>line</i>' }
];
Subs.reset();
const tr = T.addTrack('English (OpenSubtitles)', 'en', cues);
ok('a downloaded subtitle is drawn by TiviBro and the TV\'s own drawing is hidden', tr.mode === 'showing' && video.classList.contains('subs-drawn') && !!board());
ok('nothing before the first line', shown(5) === '');
ok('one line at its time', shown(10.5) === 'First');
ok('overlapping lines both show, in start order', shown(12.5) === 'First\nOverlaps the first', shown(12.5));
ok('a line goes the moment it ends', shown(13) === 'First' && shown(14) === '', shown(13) + '|' + shown(14));
ok('a long line still shows after a dozen short ones', shown(38.5) === 'A long sign on the wall\nTwelve', shown(38.5));
ok('tags are not shown as text', shown(42) === 'Last line', shown(42));

// The report: a line stuck on screen while newer lines are drawn over it.  Moving the times while a line
// is showing (Timing, Line up, the frame rate fix) must leave exactly the lines of the new times.
ok('before: "First" on screen', shown(11) === 'First');
T.shift(5);
ok('Later by 5 s while a line shows: it goes, nothing is left behind', shown(11) === '', shown(11));
ok('and comes back at its new time', shown(15.5) === 'First');
T.shift(-5);
ok('back to 0: the lines of now, exactly', shown(16.5) === 'A long sign on the wall\nOne', shown(16.5));
ok('a seek back shows the lines there, not the last ones', shown(12.2) === 'First\nOverlaps the first' && shown(41.5) === 'Last line' && shown(10.1) === 'First');
T.shift(-12);
const first = tr.cues[0];
ok('a line moved before 0 still ends after it starts', first.startTime === 0 && first.endTime > first.startTime && first.endTime <= 2.001, first.startTime + '..' + first.endTime);
ok('lines moved before 0 never show at 0 longer than their own time', shown(0.01) === 'First\nOverlaps the first' && shown(2.1) === '', shown(2.1));
T.shift(12);

// A provider track whose line ends before it starts is never shown.
const bad = video.addTextTrack('subtitles', 'Provider', 'en');
bad.addCue(new ctx.VTTCue(50, 49, 'backwards'));
tr.mode = 'disabled'; bad.mode = 'showing';
ok('a line with its end before its start never shows', shown(49.5) === '' && shown(50.5) === '');
bad.mode = 'disabled';
ok('with every subtitle off, nothing shows and the TV\'s drawing is back', shown(11) === '' && !video.classList.contains('subs-drawn'));

// Subtitles read from a movie file have their own drawing (mkvsubs.js).
const mkv = video.addTextTrack('subtitles', 'English', 'en'); mkv._tbMkv = true; mkv.addCue(new ctx.VTTCue(10, 14, 'from the file')); mkv.mode = 'showing';
ok('lines from a movie file are left to their own drawing', shown(11) === '' && !video.classList.contains('subs-drawn'));
mkv.mode = 'disabled';

// Preview (not fullscreen): not drawn.
tr.mode = 'showing';
stage.classList.remove('full');
ok('only drawn in fullscreen', shown(11) === '');
stage.classList.add('full');
ok('fullscreen again: drawn', shown(11) === 'First');

// Frame rate fix: a subtitle made for 23.976 fps on a 25 fps copy.
const k = 23.976 / 25;
Subs.setRate(k);
ok('frame rate fix scales every line', Math.abs(tr.cues[tr.cues.length - 1].startTime - 41 * k) < 1e-6 && Math.abs(tr.cues[0].endTime - 14 * k) < 1e-6, tr.cues[0].endTime);
ok('and the screen follows', shown(41 * k + 0.1) === 'Last line' && shown(43 * k + 0.05) === '' && shown(40.9) === 'Last line', shown(43 * k + 0.05));
T.shift(2);
ok('with a delay on top: time x scale + delay', Math.abs(tr.cues[0].startTime - (10 * k + 2)) < 1e-6, tr.cues[0].startTime);
ok('Timing says both', Subs.timing === '+2.0 s, 23.976 to 25 fps', Subs.timing);
T.shift(-2); Subs.setRate(1);
ok('off: back to the file\'s own times', tr.cues[0].startTime === 10 && tr.cues[0].endTime === 14 && Subs.timing === 'in time', Subs.timing);

// Line up with the frame rate fix on: the lines land on the reference as shown.
let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const ref = []; let at = 5; for (let i = 0; i < 200; i++) { at += 1.2 + rnd() * 9; const len = 0.8 + rnd() * 3; ref.push({ s: at, e: at + len, text: 'r' + i }); at += len; }
Subs.reset();
const refTrack = T.addTrack('Reference', 'en', ref);
const late = T.addTrack('Late', 'es', ref.map((c) => ({ s: c.s + 3, e: c.e + 3, text: c.text })));
Subs.setRate(25 / 24);
const r = T.lineUp(late, refTrack);
ok('Line up with a frame rate fix on lines the subtitle up with the other as shown', r && Math.abs(late.cues[10].startTime - refTrack.cues[10].startTime) < 0.06 && Math.abs(late.cues[150].startTime - refTrack.cues[150].startTime) < 0.06,
  r && (late.cues[150].startTime + ' vs ' + refTrack.cues[150].startTime));
Subs.reset();
ok('a new video starts with no fix', Subs.rate === 1 && Subs.delay === 0);

// Downloads kept for a while (discussion #19): a movie played again gets its subtitles and timing back.
ctx.Log = { info() {}, warn() {} };
const toasts = []; ctx.U.toast = (m) => toasts.push(m);
Subs.restore({ id: 'm1' });
T.addTrack('English (OpenSubtitles)', 'en', [{ s: 1, e: 2, text: 'Hi' }, { s: 3, e: 4, text: 'There' }]);
T.keep('English (OpenSubtitles)', 'en', [{ s: 1, e: 2, text: 'Hi' }, { s: 3, e: 4, text: 'There' }]);
T.shift(0.5);
Subs.reset();
ok('a new video starts with no kept subtitles of its own', Subs.restore({ id: 'm2' }) === 0 && Subs.delay === 0);
Subs.reset();
const before = video.textTracks.length;
ok('the movie played again gets its download back, on, with its timing', Subs.restore({ id: 'm1' }) === 1 && video.textTracks.length === before + 1 &&
  video.textTracks[before].mode === 'showing' && video.textTracks[before].cues.length === 2 && Subs.delay === 0.5 && Math.abs(video.textTracks[before].cues[0].startTime - 1.5) < 1e-9 && /on again/.test(toasts.pop()),
  JSON.stringify(video.textTracks[before] && video.textTracks[before].cues));
Subs.reset();
store['tivibro.subsKept'] = JSON.stringify(Object.assign(JSON.parse(store['tivibro.subsKept']), { 'v:old': { at: Date.now() - 8 * 86400e3, subs: [{ label: 'x', lang: 'en', c: [[1, 2, 'a']] }] } }));
ok('anything older than a week is let go', Subs.restore({ id: 'old' }) === 0 && Subs.keptCount() === 1);
Subs.reset();
ctx.Store.settings.keepSubs = 0;
ok('Keep downloaded subtitles Off brings nothing back', Subs.restore({ id: 'm1' }) === 0);
Subs.reset(); delete ctx.Store.settings.keepSubs;

// Search results (discussion #19): under each language, best match first, names cut in the middle.
ctx.Subs = Subs;
const res = [
  { id: 1, lang: 'en', release: 'Feature.Presentation.2024.720p.HDTV', downloads: 9000, year: 2024 },
  { id: 2, lang: 'en', release: 'Feature.Presentation.2024.1080p.WEB-DL.x264-GRP', downloads: 300, year: 2024 },
  { id: 3, lang: 'en', release: 'Feature.Presentation.2019.1080p.WEB-DL', downloads: 20000, year: 2019 },
  { id: 4, lang: 'es', release: 'Feature.Presentation.2024.Latino', downloads: 50, year: 2024 },
  { id: 5, lang: 'en', release: 'Feature.Presentation.2024.1080p.WEB-DL.x264-GRP.machine', downloads: 99999, year: 2024, ai: true }
];
const menu = T.listed(res, { title: 'Feature Presentation', item: { name: 'Feature Presentation (2024) 1080p WEB-DL x264-GRP' } }, { query: 'Feature Presentation', year: '2024', type: 'movie' });
const shownRows = menu.map(r => (r.head ? '# ' : '') + r.label);
ok('results: a heading per language, your languages in order', shownRows[0] === '# English  ·  4' && /^# (Spanish|es)  ·  1$/.test(shownRows[5]), shownRows.join(' | '));
ok('results: the right year and the release closest to what is playing first, machine translations last', /1080p\.WEB-DL\.x264-GRP$/.test(shownRows[1]) && /720p/.test(shownRows[2]) && /2019/.test(shownRows[3]) && /machine/.test(shownRows[4]), shownRows.join(' | '));
const long = T.shortName('A.Very.Long.Release.Name.2024.2160p.UHD.BluRay.REMUX.HDR.HEVC.Atmos-SOMEGROUPNAME');
ok('results: a long release name is cut in the middle, keeping its end', long.length <= 58 && /^A\.Very\.Long/.test(long) && /SOMEGROUPNAME$/.test(long) && /…/.test(long), long);

// Issue #86: a subtitle that turns itself off comes back on; Off picked in the menu stays off.
{
  const v = { textTracks: [makeTrack('subtitles', 'English', 'en'), makeTrack('subtitles', 'Spanish', 'es')], _subsRev: 3 };
  Subs.forget();
  v.textTracks[0].mode = 'showing'; T.keepOn(v);
  v.textTracks[0].mode = 'disabled'; T.keepOn(v);
  ok('a subtitle that turned itself off is on again', v.textTracks[0].mode === 'showing' && v.textTracks[1].mode === 'disabled');
  // The same track, made again (a reconnect): found by its name and language.
  v.textTracks = [makeTrack('subtitles', 'Spanish', 'es'), makeTrack('subtitles', 'English', 'en')];
  T.keepOn(v);
  ok('also when the track list was made again', v.textTracks[1].mode === 'showing' && v.textTracks[0].mode === 'disabled');
  // Off in the menu (a new pick: _subsRev moves on, the wanted key empty).
  v._subsRev = 4; v._subsChoice = true; v._subsWantKey = ''; v.textTracks[1].mode = 'disabled';
  T.keepOn(v); T.keepOn(v);
  ok('Off picked in the menu stays off', v.textTracks.every((t) => t.mode !== 'showing'));
  // Another language picked in the menu: that one is kept from then on.
  v._subsRev = 5; v._subsWantKey = 'Spanish|es'; v.textTracks[0].mode = 'showing'; T.keepOn(v);
  v.textTracks[0].mode = 'disabled'; T.keepOn(v);
  ok('a new pick is the one kept', v.textTracks[0].mode === 'showing' && v.textTracks[1].mode === 'disabled');
  Subs.forget(); v.textTracks[0].mode = 'disabled'; T.keepOn(v);
  ok('a new movie or channel starts with nothing to keep', v.textTracks.every((t) => t.mode !== 'showing'));
}

console.log(fails ? fails + ' FAILED' : 'all subtitle drawing checks passed');
process.exit(fails ? 1 : 0);
