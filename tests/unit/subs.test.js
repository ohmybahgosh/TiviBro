/* Subtitles from OpenSubtitles (discussion #19): reading SRT, WebVTT and ASS files, the search filled in
   from what's playing, lining a subtitle up with one in time (shift and frame rate), and the helper's
   OpenSubtitles requests (sorted lower-case parameters, the key, the download, the daily limit).
     node tests/unit/subs.test.js */
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { EventEmitter } = require('events');
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };

const store = {};
const ctx = { localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; } }, Store: { settings: {}, saveSettings() {} },
  U: { LANGS: [['en', 'English'], ['es', 'Spanish']], pad: (n) => (n < 10 ? '0' : '') + n }, console, Math, JSON, Date, setInterval, clearInterval, isFinite };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/js/subs.js'), 'utf8') + ';this.Subs = Subs;', ctx);
const T = ctx.Subs._test;

// Files.
const srt = '﻿1\r\n00:00:01,500 --> 00:00:03,000\r\n<font color="#fff">Hello <i>there</i></font>\r\n\r\n2\r\n00:00:04,000 --> 00:00:05,250\r\n{\\an8}Second\r\nline\r\n\r\n';
let c = T.parse(srt);
ok('SRT: times, two lines, italics kept, font and position tags gone', c.length === 2 && c[0].s === 1.5 && c[0].e === 3 && c[0].text === 'Hello <i>there</i>' && c[1].text === 'Second\nline' && c[1].e === 5.25, JSON.stringify(c));
c = T.parse('WEBVTT\n\n00:01.000 --> 00:02.500 align:start\nShort form\n\n01:00:00.000 --> 01:00:01.000\nAn hour in\n');
ok('WebVTT, short and long times', c.length === 2 && c[0].s === 1 && c[0].e === 2.5 && c[1].s === 3600, JSON.stringify(c));
c = T.parse('[Script Info]\nTitle: x\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:02.00,0:00:04.50,Default,,0,0,0,,{\\i1}Hi{\\i0}\\Nthere, you\n');
ok('ASS dialogue lines', c.length === 1 && c[0].s === 2 && c[0].e === 4.5 && c[0].text === 'Hi\nthere, you', JSON.stringify(c));
ok('broken blocks are skipped', T.parse('1\nnot a time\nx\n\n2\n00:00:05,000 --> 00:00:04,000\nbackwards\n').length === 0);

// What's playing.
ok('a movie: the title without tags and the year', JSON.stringify(T.guess({ title: 'EN - The Matrix (1999) [4K]', item: { name: 'EN - The Matrix (1999) 4K' } })) === JSON.stringify({ type: 'movie', query: 'The Matrix', year: '1999', season: 0, episode: 0 }),
  JSON.stringify(T.guess({ title: 'EN - The Matrix (1999) [4K]', item: { name: 'EN - The Matrix (1999) 4K' } })));
const ep = T.guess({ title: '|US| Breaking Bad   S2 E5   Breakage', item: { ep: true, season: 2, num: 5 } });
ok('an episode: the show, season and episode', ep.type === 'episode' && ep.query === 'Breaking Bad' && ep.season === 2 && ep.episode === 5, JSON.stringify(ep));
ok('My media: title and year', T.guess({ title: 'Heat (1995)', sub: '1995', item: { title: 'Heat', year: 1995 } }).year === '1995');

// Lining up: a subtitle 2.4 s late, and one made for 25 fps against a 23.976 fps video.
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const ref = []; let at = 5; for (let i = 0; i < 300; i++) { at += 1.2 + rnd() * 9; const len = 0.8 + rnd() * 3; ref.push({ s: at, e: at + len }); at += len; }
let r = T.align(ref.map((x) => ({ s: x.s + 2.4, e: x.e + 2.4 })), ref);
ok('finds a 2.4 s shift', r && Math.abs(r.off + 2.4) < 0.06 && r.scale === 1 && r.match > 0.9, JSON.stringify(r));
const k = 25 / 23.976;
r = T.align(ref.map((x) => ({ s: x.s / k + 1, e: x.e / k + 1 })), ref);
ok('and a frame-rate difference', r && Math.abs(r.scale - k) < 1e-6 && r.match > 0.85, JSON.stringify(r));
r = T.align(ref.map((x, i) => ({ s: (i * 37) % 2000, e: (i * 37) % 2000 + 1 })).sort((a, b) => a.s - b.s), ref);
ok('unrelated subtitles score low', r.match < 0.4, JSON.stringify(r));

// The helper's requests to OpenSubtitles, with https stubbed.
const S = require('../../service/subtitles.js');
const url = S._test.searchUrl({ query: 'The  Matrix', year: '1999', langs: ['es', 'EN', 'ea', 'bad lang!'], type: 'movie' });
ok('search address: sorted parameters, lower case, + for spaces', url === 'https://api.opensubtitles.com/api/v1/subtitles?languages=ea,en,es&order_by=download_count&query=the+matrix&type=movie&year=1999', url);
const calls = [];
const replies = [];
https.request = (o, cb) => {
  const req = new EventEmitter(); let body = '';
  req.write = (d) => { body += d; }; req.setTimeout = () => {}; req.abort = () => {};
  req.end = () => {
    calls.push({ o, body });
    const r = replies.shift(); const res = new EventEmitter();
    res.statusCode = r.code; res.headers = r.headers || {}; res.resume = () => {};
    setImmediate(() => { cb(res); setImmediate(() => { if (r.body != null) res.emit('data', Buffer.from(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), r.latin1 ? 'latin1' : 'utf8')); res.emit('end'); }); });
  };
  return req;
};
const KEY = 'a'.repeat(32);
(async () => {
  const p = (fn, q) => new Promise((res) => S[fn](q, res));
  let out = await p('search', { key: 'short', query: 'x' });
  ok('a missing or bad key is refused before asking', out.error === 'key' && calls.length === 0);
  replies.push({ code: 301, headers: { location: '/api/v1/subtitles?languages=en&query=heat' } });
  replies.push({ code: 200, body: { total_count: 2, data: [
    { attributes: { language: 'en', release: 'Heat.1995.BluRay', download_count: 900, hearing_impaired: true, fps: 23.976, from_trusted: true, feature_details: { title: 'Heat', year: 1995 }, files: [{ file_id: 11, file_name: 'heat.srt' }] } },
    { attributes: { language: 'en', release: 'no files' } }] } });
  out = await p('search', { key: KEY, query: 'Heat', langs: ['en'] });
  ok('search: follows the redirect, keeps the key, reads the results', out.results && out.results.length === 1 && out.results[0].id === 11 && out.results[0].hi && out.results[0].fps === 23.976 && calls[1].o.headers['Api-Key'] === KEY && /^TiviBro v/.test(calls[1].o.headers['User-Agent']), JSON.stringify(out));
  replies.push({ code: 200, body: { link: 'https://dl.opensubtitles.com/x/heat.srt', file_name: 'heat.srt', remaining: 4, reset_time: '23 hours' } });
  replies.push({ code: 200, body: 'Caf\xe9 au lait', latin1: true });
  out = await p('get', { key: KEY, token: 'tok', id: 11 });
  ok('download: asks for the file with the token, then fetches it; old Latin-1 files read right', out.text === 'Café au lait' && out.remaining === 4 && JSON.parse(calls[2].body).file_id === 11 && calls[2].o.headers.Authorization === 'Bearer tok' && calls[3].o.hostname === 'dl.opensubtitles.com' && !calls[3].o.headers['Api-Key'], JSON.stringify(out));
  replies.push({ code: 406, body: { message: 'You have downloaded your allowed 5 subtitles for 24h' } });
  out = await p('get', { key: KEY, id: 11 });
  ok('the daily limit says so', out.error === 'limit' && /allowed 5/.test(out.message), JSON.stringify(out));
  replies.push({ code: 200, body: { token: 'T', user: { allowed_downloads: 20, level: 'Sub leecher' } } });
  out = await p('login', { key: KEY, user: 'bob', pass: 'pw' });
  ok('sign in gives a token and the daily allowance', out.token === 'T' && out.allowed === 20 && JSON.parse(calls[calls.length - 1].body).username === 'bob');
  replies.push({ code: 401, body: { message: 'Error, invalid username/password' } });
  out = await p('login', { key: KEY, user: 'bob', pass: 'no' });
  ok('a wrong password says so', out.error === 'login' && /username and password/.test(out.message), JSON.stringify(out));
  console.log(fails ? fails + ' FAILED' : 'all subtitle checks passed');
  process.exit(fails ? 1 : 0);
})();
