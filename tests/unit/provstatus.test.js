/* Provider status (app/js/provstatus.js): telling the provider's trouble from TiviBro's, and what to tell them.
     node tests/unit/provstatus.test.js */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };
let now = Date.UTC(2026, 10, 9, 12, 0, 0);
const toasts = [], logs = [];
const ctx = { console, Math, JSON, Object, Array, String, RegExp, Promise, Error, Intl,
  Date: class extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } },
  Store: { loaded: () => [{ id: 'p1', type: 'xtream', server: 'https://tv.example.com', user: 'bob', pass: 'pw' }] },
  Source: { account: { status: 'Active', exp: '2026-11-19', active: 0, max: 4 } },
  U: { toast: (m) => toasts.push(m), hhmm: (t) => new Date(t).toISOString().slice(11, 16), request: () => ({ promise: Promise.resolve('') }) },
  Log: { warn: (s, m) => logs.push(m) }, Net: { port: 47811 } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/js/provstatus.js'), 'utf8') + ';this.P = ProvStatus;', ctx);
const P = ctx.P, api = 'https://tv.example.com/player_api.php?username=bob&password=pw', live = (n) => 'https://tv.example.com/live/bob/pw/' + n + '.ts';
const step = (ms) => { now += ms; };

ok('classify: Cloudflare, busy, login, missing, DNS, refused, timeout', P.classify(522) === 'cf' && P.classify(523) === 'cf' && P.classify(503) === 'busy' && P.classify(401) === 'auth' &&
  P.classify(404) === 'gone' && P.classify('ENOTFOUND') === 'dns' && P.classify('ECONNREFUSED') === 'refused' && P.classify('timeout') === 'timeout' && P.classify(200) === '');

// Other sites answer; the provider's server is down behind Cloudflare (the morning of Nov 9).
P.note('https://api.github.com/repos/x', true);
P.note(api, false, 522, 'api'); step(20000); P.note(api, false, 523, 'api'); step(3000);
ok('two failures are not an outage yet', !P.now().length && !toasts.length);
P.note(live(10525), false, 523, 'stream'); step(1000);
const d = P.now()[0] || {};
ok('three from the provider with nothing going through: it says so, once', d.host === 'tv.example.com' && /Cloudflare/.test(d.title) && toasts.length === 1 && /not TiviBro/.test(toasts[0]), JSON.stringify(d).slice(0, 200) + ' ' + toasts.join(' | '));
ok('and that the TV\'s internet works (other sites answered)', d.netOk === true);
ok('the message for the provider: when, what failed, the codes, the internet works, the account', /Since /.test(d.tell) && /channel list, guide and streams/.test(d.tell) && /HTTP 522/.test(d.tell) && /HTTP 523/.test(d.tell) &&
  /origin server/.test(d.tell) && /internet connection works/.test(d.tell) && /0 of 4 connections/.test(d.tell) && /2026-11-19/.test(d.tell), d.tell);
ok('no login or password in it', !/bob|pw/.test(d.tell) && !/bob|pw/.test(logs.join(' ')), d.tell);
P.note(live(10598), false, 522, 'stream'); step(60000); P.note(api, false, 522, 'api');
ok('not said again every few seconds', toasts.length === 1);
P.note(live(10598), true);
ok('the provider answers again: back to normal', !P.now().length);

// A channel change: "busy" from streams alone, a few times, is the provider still counting the last channel.
P._reset(); toasts.length = 0;
P.note('https://api.github.com/x', true);
for (let i = 0; i < 4; i++) { P.note(live(100 + i), false, 503, 'stream'); step(800); }
ok('a few "busy" answers on channel changes are not an outage', !P.now().length && !toasts.length);
for (let i = 0; i < 6; i++) { P.note(live(200 + i), false, 503, 'stream'); step(15000); }
const b = P.now()[0] || {};
ok('"busy" on every channel for over a minute is', /busy/.test(b.title || '') && toasts.length === 1, JSON.stringify(b).slice(0, 160));

// One channel the provider doesn't have is that channel, not the provider.
P._reset(); toasts.length = 0;
P.note(live(1), false, 404, 'stream'); step(500); P.note(live(1), false, 404, 'stream'); step(500); P.note(live(1), false, 404, 'stream');
ok('one missing channel is not an outage', !P.now().length);

// Login refused.
P._reset(); toasts.length = 0;
P.note(api, false, 401, 'api'); step(1000); P.note(api, false, 401, 'api'); step(1000); P.note(api, false, 401, 'api');
const a = P.now()[0] || {};
ok('a login refused three times: says so, and what to tell them', /login/.test(a.title || '') && /login is refused/.test(a.tell || ''), JSON.stringify(a).slice(0, 200));

// Requests elsewhere never count against the provider; the helper's own address is ignored.
P._reset(); toasts.length = 0;
for (let i = 0; i < 6; i++) { P.note('https://epg.example.org/guide.xml', false, 522, 'guide'); P.note('http://127.0.0.1:47811/x/https/tv.example.com/live/bob/pw/1.ts', false, 522, 'stream'); }
ok('other sites failing, and the helper\'s own address, are not the provider', !P.now().length && !toasts.length);

console.log(fails ? fails + ' FAILED' : 'all provider status checks passed');
process.exit(fails ? 1 : 0);
