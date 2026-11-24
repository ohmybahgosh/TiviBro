/* The phone's Settings while TiviBro isn't on the TV's screen (service/companion.js, from app/js/setsnap.js's copy):
   pages, sections and search answered by the helper; a switch or a choice kept and shown changed until TiviBro makes
   it; buttons still need TiviBro; the PIN checked as TiviBro checks it; and TiviBro on screen answers as before.
     node tests/unit/companion-away.test.js */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const Companion = require('../../service/companion.js');
const C = require('../../scripts/companion/tb-phone.js');
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-away-'));
let open = false, visible = false;
const launched = [];
const mk = () => Companion.create({ dir, version: 'test', log: () => {}, launch: (p, cb) => { launched.push(p); cb(null); }, sysinfo: (cb) => cb({ model: 'X', webos: '1', name: 'Den' }), app: () => ({ open, visible }), editor: () => null });
let c = mk();
function ctl(u, body) {
  return new Promise((resolve) => {
    const res = Object.assign(new (require('events'))(), { code: 0, writeHead(x) { this.code = x; }, end(b) { resolve({ code: this.code, j: JSON.parse(b) }); } });
    const req = new (require('events'))(); req.method = body ? 'POST' : 'GET'; req.url = u;
    c.control(req, res, u.split('?')[0]);
    process.nextTick(() => { if (body) req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end'); });
  });
}
// The copy as setsnap.js makes it: English and Spanish, two pages.
const page = (lang) => ({ title: lang === 'es' ? 'Reproducción' : 'Playback', trail: [lang === 'es' ? 'Reproducción' : 'Playback'], rows: [
  { i: 0, kind: 'head', label: 'Player' },
  { i: 1, kind: 'toggle', label: lang === 'es' ? 'Mostrar reloj' : 'Show clock', sub: 'In the corner', on: true },
  { i: 2, kind: 'choice', label: 'Skip credits', sub: '', options: ['Show a button', 'Skip automatically', 'Off'], cur: 0, value: 'Show a button' },
  { i: 3, kind: 'action', label: 'Reload guide now', sub: '' },
  { i: 4, kind: 'page', label: 'Advanced', sub: '' }] });
const copy = (pin) => ({ at: Date.now(), version: 'test', pin: pin || '', langs: {
  en: { sections: [{ id: 'playback', title: 'Playback' }], msgs: { saved: 'Saved for later', changed: 'Changed' }, pages: { 'playback|': page('en'), 'playback|4': { title: 'Advanced', trail: ['Playback', 'Advanced'], rows: [{ i: 0, kind: 'toggle', label: 'Hidden switch', on: false }] } } },
  es: { sections: [{ id: 'playback', title: 'Reproducción' }], msgs: { saved: 'Guardado' }, pages: { 'playback|': page('es') } } } });
// Parental's PIN hash (app/js/util.js U.hash of "tivibro:<pin>:pin").
const hash = (p) => { let h = 0x811c9dc5; const s = 'tivibro:' + p + ':pin'; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; } return h.toString(36); };

(async () => {
  await ctl('/companion/set', { on: true });
  const s = (await ctl('/companion/pair', { open: true })).j;
  const cred = await C.pair({ host: '127.0.0.1', port: s.port }, s.pairing.code, { name: 'Away' });
  const ask = (a, o) => C.ask(cred, 'settings', a, Object.assign({ seal: true, noOpen: true }, o || {}));

  let e = await ask({ op: 'sections' }).catch((x) => x);
  ok('no copy yet: TiviBro away is "closed", as before', e && (e.closed || e.code === 'closed'), JSON.stringify(e));
  let r = (await ctl('/companion/snapshot', copy())).j;
  ok('TiviBro leaves its copy', r.ok && r.langs.join() === 'en,es', JSON.stringify(r));

  r = await ask({ op: 'sections' });
  ok('the sections, from the copy, marked as such', r.data.sections[0].id === 'playback' && r.data.away === true, JSON.stringify(r));
  r = await ask({ op: 'page', sec: 'playback', path: [] }, { lang: 'es' });
  ok('a page in the phone\'s language', r.data.title === 'Reproducción' && r.data.away && r.data.rows[1].label === 'Mostrar reloj', JSON.stringify(r).slice(0, 200));
  r = await ask({ op: 'page', sec: 'playback', path: [4] });
  ok('a page inside a page', r.data.title === 'Advanced' && r.data.rows[0].label === 'Hidden switch');
  r = await ask({ op: 'find', q: 'clock' });
  ok('search finds a setting with its place', r.data.hits.length === 1 && r.data.hits[0].sec === 'playback' && r.data.hits[0].path.length === 0, JSON.stringify(r));

  r = await ask({ op: 'toggle', sec: 'playback', path: [], i: 1, on: false });
  ok('a switch changed: kept, shown off and waiting, with the copy\'s word', r.data.msg === 'Saved for later' && r.data.page.rows[1].on === false && r.data.page.rows[1].pending === true, JSON.stringify(r).slice(0, 300));
  r = await ask({ op: 'choice', sec: 'playback', path: [], i: 2, v: 1 });
  ok('a choice changed: shown picked', r.data.page.rows[2].cur === 1 && r.data.page.rows[2].value === 'Skip automatically' && r.data.page.rows[2].pending);
  r = await ask({ op: 'toggle', sec: 'playback', path: [], i: 1, on: true });
  r = await ask({ op: 'page', sec: 'playback', path: [] });
  ok('opened again: both still shown changed (the switch\'s latest)', r.data.rows[1].on === true && r.data.rows[1].pending && r.data.rows[2].cur === 1);
  ok('TiviBro was never opened for any of it', launched.length === 0, JSON.stringify(launched));

  e = await ask({ op: 'action', sec: 'playback', path: [], i: 3 }).catch((x) => x);
  ok('a button still needs TiviBro: "closed"', e && (e.closed || e.code === 'closed'), JSON.stringify(e));
  r = await ask({ op: 'choice', sec: 'playback', path: [], i: 2, v: 9 });
  ok('a choice that isn\'t one: the page as it is, nothing kept', r.data.msg === 'Changed' && r.data.page.rows[2].cur === 1);

  // Kept through a restart of the helper.
  c.stop(); c = mk(); await ctl('/companion/set', { on: true });
  const s2 = (await ctl('/companion/status')).j;
  const cred2 = Object.assign({}, cred, { port: s2.port });
  r = await C.ask(cred2, 'settings', { op: 'page', sec: 'playback', path: [] }, { seal: true, noOpen: true });
  ok('the copy and the waiting changes outlive a helper restart', r.data.rows[1].pending && r.data.rows[2].cur === 1, JSON.stringify(r).slice(0, 200));

  // TiviBro back: it collects the changes, in order, once.
  r = (await ctl('/companion/pending')).j;
  ok('TiviBro gets the changes, the switch once, in order', r.changes.length === 2 && r.changes[0].op === 'choice' && r.changes[0].v === 1 && r.changes[1].op === 'toggle' && r.changes[1].on === true && r.changes[1].label === 'Show clock', JSON.stringify(r));
  r = (await ctl('/companion/pending')).j;
  ok('...and only once', r.changes.length === 0);

  // A PIN on Settings: asked for and checked like TiviBro does, wrong ones counted.
  await ctl('/companion/snapshot', copy(hash('1234')));
  r = await C.ask(cred2, 'settings', { op: 'sections' }, { seal: true, noOpen: true });
  ok('locked with a PIN: the phone is asked for it', r.data.locked === true, JSON.stringify(r));
  r = await C.ask(cred2, 'settings', { op: 'sections', pin: '0000' }, { seal: true, noOpen: true });
  ok('a wrong PIN is refused', r.data.locked && /Wrong PIN/.test(r.data.msg));
  r = await C.ask(cred2, 'settings', { op: 'sections', pin: '1234' }, { seal: true, noOpen: true });
  ok('the right PIN opens it', Array.isArray(r.data.sections));
  for (let i = 0; i < 5; i++) await C.ask(cred2, 'settings', { op: 'sections', pin: '9' }, { seal: true, noOpen: true });
  r = await C.ask(cred2, 'settings', { op: 'sections', pin: '1234' }, { seal: true, noOpen: true });
  ok('five wrong ones lock it for a while, even for the right one', r.data.locked && /Too many/.test(r.data.msg), JSON.stringify(r));

  // TiviBro on screen: it answers itself, as before (the copy isn't used).
  open = true; visible = true;
  r = await C.ask(cred2, 'settings', { op: 'sections' }, { seal: true, noOpen: true });
  ok('TiviBro on screen: the question goes to TiviBro (no answer here: "pending")', r.pending === true || r.state === 'sent', JSON.stringify(r));

  c.stop();
  console.log(fails ? fails + ' failures' : 'all away settings tests passed');
  process.exit(fails ? 1 : 0);
})().catch((x) => { console.error(x); process.exit(1); });
